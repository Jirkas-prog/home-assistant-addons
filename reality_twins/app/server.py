import json
import logging
import os
import signal
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory
from waitress import create_server
from werkzeug.exceptions import HTTPException

from .importing import import_posts
from .instagram import InstagramError
from .scheduling import validate_schedule
from .service import Service


def create_apps(service, ingress=False):
    admin = Flask(__name__, static_folder='static', static_url_path='/static')
    public = Flask(__name__ + '.public', static_folder=None)
    admin.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

    @admin.before_request
    def guard():
        if ingress and request.remote_addr != '172.30.32.2':
            abort(403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get('X-RT-Request') != '1':
            abort(403)
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            abort(403)

    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
        return response
    admin.after_request(headers)
    public.after_request(headers)

    def error(e):
        status = e.code if isinstance(e, HTTPException) else 400
        message = ({403: 'Access denied.', 404: 'Not found.', 413: 'The uploaded files are too large.'}.get(status, 'Invalid request.')
                   if isinstance(e, HTTPException) else str(e))
        try:
            from .i18n import translate_error
            en, cs = translate_error(message, 'en'), translate_error(message, 'cs')
        except ImportError:
            en = cs = message
        return jsonify(error=en, error_cs=cs), status
    for app in (admin, public):
        for cls in (ValueError, InstagramError, HTTPException):
            app.register_error_handler(cls, error)

    @admin.get('/')
    def index():
        return send_from_directory(admin.static_folder, 'index.html')

    @admin.get('/api/state')
    def state():
        from .i18n import translate_error
        result = service.snapshot()
        for item in result['import_status']['errors']:
            item['message_cs'] = translate_error(item['message'], 'cs')
        result['warnings'] = [{'message': translate_error(m, 'en'), 'message_cs': translate_error(m, 'cs')} for m in result['warnings']]
        for obj in [result['account'], *result['queue'], *result['history']]:
            if obj.get('error'):
                obj['error_cs'] = translate_error(obj['error'], 'cs')
                obj['error'] = translate_error(obj['error'], 'en')
            if obj.get('note'):
                obj['note_cs'] = translate_error(obj['note'], 'cs')
        return jsonify(result)

    @admin.get('/api/calendars')
    def calendars():
        return jsonify(calendars=service.calendars())

    @admin.get('/api/calendar/week')
    def calendar_week():
        return jsonify(service.calendar_week(request.args.get('start', '')))

    @admin.post('/api/queue/scan')
    def scan():
        with service.queue_guard:
            service.queue.scan()
        return jsonify(ok=True)

    @admin.get('/api/import/folders')
    def import_folders():
        return jsonify(service.folder_importer.browse(request.args.get('path', '')))

    @admin.post('/api/import/scan')
    def import_scan():
        from .i18n import translate_error
        result = service.scan_import_folder()
        for item in result['errors']:
            item['message_cs'] = translate_error(item['message'], 'cs')
        return jsonify(result)

    @admin.post('/api/queue/reorder')
    def reorder():
        with service.queue_guard:
            service.queue.reorder(request.get_json()['ids'])
        return jsonify(ok=True)

    @admin.patch('/api/queue/<item_id>/caption')
    def caption(item_id):
        text = request.get_json()['caption']
        if not isinstance(text, str) or len(text) > 2200:
            raise ValueError('Captions must be text with at most 2200 characters.')
        service.queue.update_caption(item_id, text)
        return jsonify(ok=True)

    @admin.post('/api/queue/<item_id>/retry')
    def retry(item_id):
        service.queue.retry(item_id)
        return jsonify(ok=True)

    @admin.get('/api/queue/<item_id>/image')
    def image(item_id):
        return send_file(service.queue.image_path(item_id))

    @admin.post('/api/upload')
    def upload():
        files = request.files.getlist('files')
        with service.queue_guard:
            try:
                result = import_posts(service.queue, files)
            except (UnicodeError, OSError) as e:
                raise ValueError('The import could not be read. Check the file format and folder permissions.') from e
        return jsonify(result)

    @admin.put('/api/schedule')
    def schedule():
        result = validate_schedule(request.get_json())
        with service.state.lock:
            service.state.data['schedule'] = result
            service.state.save()
        return jsonify(ok=True)

    @admin.put('/api/settings')
    def settings():
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('Invalid request.')
        with service.connection_guard:
            if data.get('enabled'):
                if set(data) != {'enabled'}:
                    raise ValueError('Save settings first, then enable publishing separately.')
                service.enable()
            else:
                service.update_settings(data)
        if {'calendar_entity', 'schedule_source'} & data.keys():
            service.last_calendar_read = 0
            service.refresh_calendar(datetime.now(timezone.utc))
        return jsonify(ok=True)

    @admin.post('/api/account/check')
    def check():
        with service.connection_guard:
            return jsonify(service.account_client.check())

    @admin.post('/api/account/login')
    def login():
        data = request.get_json()
        if not isinstance(data, dict) or set(data) - {'username', 'password', 'verification_code'}:
            raise ValueError('Invalid request.')
        if any(not isinstance(v, str) or len(v) > 1024 for v in data.values()):
            raise ValueError('Invalid request.')
        with service.connection_guard:
            if service.state.data['connection_method'] != 'direct':
                raise ValueError('Select direct login in the connection settings first.')
            result = service.direct_instagram.login(data.get('username', ''), data.get('password', ''), data.get('verification_code', ''))
        if result.get('message'):
            from .i18n import translate_error
            result['message_cs'] = translate_error(result['message'], 'cs')
        return jsonify(result)

    def browser_client():
        if service.state.data['connection_method'] != 'browser':
            raise ValueError('Select browser sign-in in the connection settings first.')
        return service.browser_instagram

    @admin.post('/api/browser/start')
    def browser_start():
        with service.connection_guard:
            return jsonify(browser_client().start())

    @admin.get('/api/browser/status')
    def browser_status():
        return jsonify(browser_client().status())

    @admin.get('/api/browser/frame')
    def browser_frame():
        return Response(browser_client().frame(), mimetype='image/jpeg')

    @admin.post('/api/browser/input')
    def browser_input():
        if request.content_length and request.content_length > 8192:
            abort(413)
        return jsonify(browser_client().input(request.get_json()))

    @admin.post('/api/browser/finish')
    def browser_finish():
        with service.connection_guard:
            return jsonify(browser_client().finish())

    @admin.post('/api/browser/close')
    def browser_close():
        with service.connection_guard:
            return jsonify(browser_client().close_view())

    @admin.post('/api/oauth/start')
    def oauth():
        if service.state.data['connection_method'] != 'official':
            raise ValueError('Select the official API in the connection settings first.')
        return jsonify(url=service.instagram.oauth_url())

    @admin.post('/api/account/disconnect')
    def disconnect():
        with service.connection_guard:
            service.browser_instagram.disconnect()
            service.direct_instagram.disconnect()
            with service.state.lock:
                service.state.data.update(enabled=False, access_token='', account={'connected': False}, oauth_states={})
                service.state.save()
        return jsonify(ok=True)

    @admin.post('/api/attempts/<attempt_id>/resolve')
    def resolve(attempt_id):
        return jsonify(service.resolve(attempt_id, request.get_json()))

    @public.get('/healthz')
    def health():
        return jsonify(service='reality-twins-media', installation_id=service.state.data['installation_id'])

    @public.get('/media/<grant>.jpg')
    def media(grant):
        path = service.public_media(grant)
        if not path:
            abort(404)
        return send_file(path, mimetype='image/jpeg')

    @public.get('/oauth/callback')
    def callback():
        with service.connection_guard:
            if service.state.data['connection_method'] != 'official':
                raise ValueError('Select the official API in the connection settings first.')
            service.instagram.oauth_callback(request.args.get('code', ''), request.args.get('state', ''))
        return '<!doctype html><meta charset="utf-8"><title>Instagram connected</title><h1>Instagram connected / Instagram připojen</h1><p>You can close this window and return to Home Assistant.<br>Můžeš zavřít toto okno a vrátit se do Home Assistantu.</p>'

    return admin, public


def main():
    options_path = Path('/data/options.json')
    options = json.loads(options_path.read_text()) if options_path.exists() else {}
    data_dir = Path(os.environ.get('RT_DATA_DIR', '/data'))
    queue_dir = Path(os.environ.get('RT_QUEUE_DIR', options.get('queue_dir', '/share/reality_twins/PLANNED')))
    service = Service(data_dir, queue_dir, options.get('timezone', 'Europe/Prague'))
    ingress = bool(os.environ.get('SUPERVISOR_TOKEN'))
    admin, public = create_apps(service, ingress)
    standalone = os.environ.get('RT_STANDALONE') == '1'
    host = '0.0.0.0' if ingress or standalone else '127.0.0.1'
    admin_port = int(os.environ.get('RT_ADMIN_PORT', '8099'))
    public_port = int(os.environ.get('RT_MEDIA_PORT', '8098'))
    # No request URL/access logging: OAuth codes and signed media URLs are sensitive.
    logging.getLogger('werkzeug').disabled = True
    media_server = create_server(public, host=host, port=public_port, threads=4)
    admin_server = create_server(admin, host=host, port=admin_port, threads=8)
    threading.Thread(target=media_server.run, daemon=True).start()
    threading.Thread(target=service.run, daemon=True).start()
    def shutdown(*_):
        service.stop.set()
        service.browser_instagram.shutdown()
        admin_server.close()
        media_server.close()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print(f'Czech This View Publisher ready: dashboard {admin_port}, isolated media {public_port}', flush=True)
    admin_server.run()


if __name__ == '__main__':
    main()
