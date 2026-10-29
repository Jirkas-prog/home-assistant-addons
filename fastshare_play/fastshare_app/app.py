import atexit
import logging
import os
from pathlib import Path
import signal
import threading
import time

from flask import Flask, Response, jsonify, request, send_from_directory, render_template
from waitress import create_server
from werkzeug.exceptions import HTTPException

from .engine import Engine
from .homeassistant import HomeAssistant
from .mqtt import Publisher
from .provider import FastShare, ProviderError, safe_url
from urllib.parse import urlsplit
from .storage import Settings, Store
from .media import install_media
from .local_web import (install_local_web, load_secret, lan_application, LAN_CONTAINER_PORT,
                        viewer_application, viewer_access, VIEWER_CONTAINER_PORT)


def create_app(directory=None, start=True):
    directory = Path(directory or os.environ.get('FASTSHARE_DATA', '.runtime')).resolve()
    settings = Settings(directory)
    if not os.environ.get('SUPERVISOR_TOKEN') and not settings.path.exists():
        settings.save({'download_dir': str(directory / 'downloads'), 'mqtt_enabled': False})
    store = Store(directory)
    engine = Engine(settings, store)
    ha = HomeAssistant(directory)
    publisher = Publisher(engine)
    web = Path(__file__).resolve().parent.parent / 'download_www'
    secret = load_secret(directory)
    app = Flask(__name__, static_folder=None, template_folder=str(web))
    app.config['MAX_CONTENT_LENGTH'] = 32 * 1024
    app.extensions.update(engine=engine, settings=settings, store=store, homeassistant=ha, publisher=publisher)

    @app.before_request
    def access():
        if request.environ.get('fastshare.viewer'):
            return viewer_access(settings)
        # Trust only the actual TCP peer, never X-Forwarded-For supplied by clients.
        allowed = {'172.30.32.2'} if os.environ.get('SUPERVISOR_TOKEN') else {'127.0.0.1', '::1'}
        if not request.environ.get('fastshare.lan') and request.remote_addr not in allowed:
            return jsonify(error='Access this page through Home Assistant Ingress.'), 403
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('X-FastShare-Request') != '1' or not request.is_json:
                return jsonify(error='Invalid request.'), 403
            if not isinstance(request.get_json(silent=True), dict):
                return jsonify(error='Expected a JSON object.'), 400

    install_local_web(app, settings, ha, secret, web)
    install_media(app, settings, secret)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
        return response

    @app.errorhandler(Exception)
    def error_handler(error):
        if isinstance(error, (ValueError, ProviderError)):
            return jsonify(error=str(error)), 400
        if isinstance(error, HTTPException):
            return jsonify(error=error.description if error.code in (401, 429) else error.name), error.code
        # Exception strings may contain provider URLs with tokens or passwords.
        logging.error('Request failed (%s)', type(error).__name__)
        return jsonify(error='The operation failed. Check your connection and settings.'), 500

    @app.get('/')
    @app.get('/widget')
    def index():
        viewer = bool(request.environ.get('fastshare.viewer'))
        return render_template('viewer.html' if viewer else 'index.html', viewer=viewer)

    @app.get('/api/player-config')
    def viewer_config():
        return jsonify(language=settings.get()['language'])

    @app.get('/<name>')
    def assets(name):
        if name not in {'app.js', 'viewer.js', 'player.js', 'local-login.js', 'style.css', 'workflow-fastshare.js', 'translations.js', 'cs.json', 'icon.svg'}:
            return jsonify(error='Nenalezeno.'), 404
        return send_from_directory(web, name)

    @app.get('/api/thumbnail')
    def thumbnail():
        url = safe_url(request.args.get('url', ''))
        parts = urlsplit(url)
        if parts.hostname != 'img.fastshare.cloud' or not parts.path.startswith('/upload/'):
            raise ValueError('Invalid thumbnail address.')
        client = FastShare()
        try:
            with client.request(url) as response:
                mime = response.headers.get('Content-Type', '').split(';')[0].lower()
                if mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'):
                    raise ValueError('Preview unavailable')
                data = response.raw.read(5_000_001, decode_content=True)
                if len(data) > 5_000_000:
                    raise ValueError('Preview unavailable')
                return Response(data, mimetype=mime)
        finally:
            client.close()

    @app.get('/api/state')
    def state():
        return jsonify(**engine.snapshot(), dashboard_error=ha.error, addon=ha.slug,
                       homeassistant=bool(os.environ.get('SUPERVISOR_TOKEN')))

    @app.get('/api/settings')
    def get_settings():
        return jsonify(settings.public())

    @app.post('/api/settings')
    def save_settings():
        data = request.get_json()
        with engine.lock:
            if data.get('download_dir', settings.get()['download_dir']) != settings.get()['download_dir']:
                unfinished = store.query("SELECT id FROM jobs WHERE path<>'' AND status NOT IN ('completed','cancelled') LIMIT 1")
                if unfinished:
                    raise ValueError('First finish or cancel partial downloads, then change the folder.')
            result = settings.save(data)
        engine.wake.set()
        return jsonify(result)

    @app.post('/api/clear-secret')
    def clear_secret():
        key = request.get_json().get('key')
        if key not in ('email_password', 'mqtt_password'):
            raise ValueError('Unknown password field.')
        return jsonify(settings.save({key: ''}, internal=True))

    @app.post('/api/login')
    def login():
        data = request.get_json()
        if not isinstance(data.get('username'), str) or not isinstance(data.get('password'), str):
            raise ValueError('Enter a username and password.')
        client = FastShare()
        try:
            session = client.login(data['username'], data['password'])
            settings.save({'fastshare_session': session}, internal=True)
            return jsonify(ok=True)
        finally:
            client.close()

    @app.post('/api/logout')
    def logout():
        settings.save({'fastshare_session': {}}, internal=True)
        return jsonify(ok=True)

    @app.get('/api/search')
    def search():
        client = FastShare()
        try:
            return jsonify(items=client.search(request.args.get('q', '')))
        finally:
            client.close()

    @app.post('/api/jobs')
    def add_job():
        data = request.get_json()
        if not isinstance(data.get('url'), str) or len(data['url']) > 3000:
            raise ValueError('Enter a FastShare link.')
        job = engine.add(data['url'])
        return jsonify(id=job['id'], status=job['status'])

    @app.post('/api/jobs/<int:job_id>/<action>')
    def job_action(job_id, action):
        engine.action(job_id, action, request.get_json().get('mode'))
        return jsonify(ok=True)

    @app.post('/api/priority-clear')
    def clear_priority():
        engine.clear_priority()
        return jsonify(ok=True)

    @app.post('/api/email-test')
    def test_email():
        try:
            engine.poll_email(settings.get(), test=True)
            engine.health.update(email=True, email_message='Connection and folder verified.')
            return jsonify(message='Sign-in and folder access are working.')
        except Exception:
            raise ValueError('Sign-in failed. Check the server, folder and app password.') from None

    @app.get('/api/dashboards')
    def dashboards():
        return jsonify(items=ha.dashboards())

    @app.post('/api/dashboard')
    def dashboard():
        path = request.get_json().get('dashboard') or None
        if path is not None and (not isinstance(path, str) or len(path) > 200):
            raise ValueError('Invalid dashboard.')
        rows = request.get_json().get('rows', 'auto')
        if str(rows) not in ('auto', '2', '3', '4'):
            raise ValueError('Choose Auto or 2, 3, 4 rows.')
        return jsonify(ha.add_view(path, 'auto' if rows == 'auto' else int(rows)))

    if start:
        engine.start()
        publisher.start()

        def setup():
            if not os.environ.get('SUPERVISOR_TOKEN'):
                return
            for _ in range(6):
                try:
                    ha.install_resource()
                    return
                except Exception:
                    ha.error = 'The card cannot be registered yet. Add to dashboard will retry registration.'
                if engine.stop.wait(30):
                    return
        threading.Thread(target=setup, daemon=True).start()
    return app


if __name__ == '__main__':
    app = create_app()
    servers = []

    def close(*args):
        app.extensions['engine'].close()
        app.extensions['publisher'].close()
        for server in servers:
            server.close()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, close)
    signal.signal(signal.SIGINT, close)
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    cfg = app.extensions['settings'].get()
    server = create_server(app, host='0.0.0.0' if os.environ.get('SUPERVISOR_TOKEN') else '127.0.0.1',
                           port=int(os.environ.get('PORT', '8099')), threads=12, map={})
    servers.append(server)
    if os.environ.get('SUPERVISOR_TOKEN') or cfg['lan_enabled']:
        local_server = create_server(lan_application(app), host='0.0.0.0',
                                     port=LAN_CONTAINER_PORT if os.environ.get('SUPERVISOR_TOKEN') else cfg['lan_port'], threads=12, map={})
        servers.append(local_server)
        threading.Thread(target=local_server.run, daemon=True).start()
    if os.environ.get('SUPERVISOR_TOKEN') or cfg['viewer_enabled']:
        viewer_server = create_server(viewer_application(app), host='0.0.0.0',
                                     port=VIEWER_CONTAINER_PORT if os.environ.get('SUPERVISOR_TOKEN') else cfg['viewer_port'], threads=12, map={})
        servers.append(viewer_server)
        threading.Thread(target=viewer_server.run, daemon=True).start()
    server.run()
