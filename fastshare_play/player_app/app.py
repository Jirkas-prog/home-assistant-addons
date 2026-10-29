import atexit
import logging
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory
from waitress import create_server
from werkzeug.exceptions import HTTPException

from . import VERSION
from .catalog import Catalog
from .thumbnails import Thumbnails
from .nova import VIDEO_TYPES
from .settings import Settings, configure


def public_detail(item):
    for track in item.get('tracks', []): track.pop('path', None)
    return item


def player_application(app):
    def player(environ, start_response):
        environ['play.public'] = True
        return app(environ, start_response)
    return player


def create_app(directory=None, start=True, settings=None, local=None):
    settings = settings or Settings(directory or os.environ.get('PLAY_DATA', '.runtime'))
    catalog = Catalog(settings)
    metadata = Thumbnails(catalog)
    catalog.matcher = metadata
    web = Path(__file__).resolve().parent.parent / 'www'
    app = Flask(__name__, static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = 32768
    app.extensions.update(settings=settings, catalog=catalog, metadata=metadata)

    @app.before_request
    def access():
        public = request.environ.get('play.public', False)
        if public:
            if not settings.get()['lan_enabled']: abort(403)
            if request.path.startswith('/api/admin'): abort(403)
        elif request.environ.get('fastshare.lan') and local:
            if not local.settings.get()['lan_enabled']: abort(403)
            if not local.authenticated():
                if request.path == '/': return redirect('../')
                abort(401)
            if request.path.startswith('/api/admin'): abort(403)
        else:
            allowed = {'172.30.32.2'} if os.environ.get('SUPERVISOR_TOKEN') else {'127.0.0.1', '::1'}
            if request.remote_addr not in allowed: abort(403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('X-Play-Request') != '1' or not request.is_json: abort(403)
            if not isinstance(request.get_json(silent=True), dict): raise ValueError('Expected a JSON object.')
            if (public or request.environ.get('fastshare.lan')) and request.headers.get('Origin') and urlsplit(request.headers['Origin']).netloc != request.host: abort(403)

    @app.after_request
    def headers(response):
        response.headers.setdefault('Cache-Control', 'no-store')
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
        return response

    @app.errorhandler(Exception)
    def error_handler(error):
        if isinstance(error, FileNotFoundError): return jsonify(error='File not found.'), 404
        if isinstance(error, ValueError): return jsonify(error=str(error)), 400
        if isinstance(error, HTTPException): return jsonify(error=error.name), error.code
        logging.error('Request failed (%s)', type(error).__name__)
        return jsonify(error='The operation failed. Refresh the library and try again.'), 500

    @app.get('/')
    def index(): return send_from_directory(web, 'index.html')

    @app.get('/<name>')
    def assets(name):
        if name in ('LICENSE', 'NOTICE'): return send_from_directory(web.parent, name, mimetype='text/plain')
        if name not in ('app.js', 'style.css', 'cs.json', 'icon.svg'): abort(404)
        return send_from_directory(web, name)

    @app.get('/api/config')
    def config():
        value = settings.get()
        return jsonify(version=VERSION, language=value['language'], admin=not request.environ.get('play.public') and not request.environ.get('fastshare.lan'),
                       controls=bool(local) and not request.environ.get('play.public'),
                       cycle_previews=value['cycle_previews'], preview_error=metadata.error)

    @app.get('/api/library')
    def library(): return jsonify(catalog.listing(request.args))

    @app.get('/api/library/<file_id>')
    def detail(file_id): return jsonify(public_detail(catalog.detail(file_id)))

    @app.post('/api/library/<file_id>/play')
    def play(file_id):
        result = catalog.begin_play(file_id)
        result['item'] = public_detail(result['item'])
        return jsonify(result)

    @app.post('/api/library/<file_id>/progress')
    def progress(file_id): return jsonify(catalog.progress(file_id, request.get_json()))

    @app.post('/api/library/<file_id>/flags')
    def flags(file_id):
        catalog.flags(file_id, request.get_json())
        return jsonify(ok=True)

    @app.get('/api/library/<file_id>/stream')
    def stream(file_id):
        _, path, _ = catalog.resolve(file_id)
        return send_file(path, mimetype=VIDEO_TYPES[path.suffix.lower()], conditional=True, as_attachment=False)

    @app.get('/api/library/<file_id>/art/<kind>')
    def art(file_id, kind):
        path, mime = metadata.artwork(file_id, kind, int(request.args.get('index', 0)))
        return send_file(path, mimetype=mime, conditional=True, max_age=3600)

    @app.get('/api/library/<file_id>/subtitle/<int:track_id>')
    def subtitle(file_id, track_id):
        tracks = catalog.detail(file_id)['tracks']
        if track_id >= len(tracks): abort(404)
        path = Path(tracks[track_id]['path'])
        if path.stat().st_size > 2_000_000: abort(413)
        raw = path.read_bytes()
        try: text = raw.decode('utf-8-sig')
        except UnicodeDecodeError: text = raw.decode('cp1250')
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        if path.suffix.lower() == '.srt': text = 'WEBVTT\n\n' + re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', text)
        elif not text.startswith('WEBVTT'): abort(415)
        return Response(text, mimetype='text/vtt')

    @app.get('/api/admin/settings')
    def get_settings(): return jsonify(settings.public())

    @app.post('/api/admin/settings')
    def save_settings():
        result = configure(settings, request.get_json()); catalog.wake.set()
        return jsonify(result)

    @app.post('/api/admin/scan')
    def scan():
        catalog.wake.set()
        return jsonify(ok=True)

    @app.post('/api/admin/retry-previews')
    def retry_previews(): metadata.retry(); return jsonify(ok=True)

    if start: catalog.start()
    atexit.register(catalog.close)
    return app


def main():
    app = create_app()
    settings = app.extensions['settings'].get()
    limits = {'threads': 8, 'connection_limit': 100, 'channel_timeout': 60, 'outbuf_overflow': 1024 * 1024}
    ingress = create_server(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8099)), **limits)
    if os.environ.get('SUPERVISOR_TOKEN') or settings['lan_enabled']:
        public = create_server(player_application(app), host='0.0.0.0', port=8098 if os.environ.get('SUPERVISOR_TOKEN') else settings['lan_port'], **limits)
        threading.Thread(target=public.run, daemon=True, name='player-web').start()
    ingress.run()


if __name__ == '__main__': main()
