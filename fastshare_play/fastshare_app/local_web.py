"""Separate authenticated LAN entry point; Ingress remains restricted to its proxy."""
from collections import OrderedDict, deque
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit

from flask import abort, jsonify, request, send_from_directory
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

COOKIE = 'workflow_fastshare_session'
LAN_CONTAINER_PORT = 8096
VIEWER_CONTAINER_PORT = 8098
VIEWER_ASSETS = {'viewer.js', 'player.js', 'workflow-fastshare.js', 'translations.js', 'cs.json', 'style.css', 'icon.svg'}


def viewer_access(settings):
    """The separate listener can only read media, even with an admin cookie."""
    if not settings.get()['viewer_enabled']:
        abort(403, description='Playback-only access is disabled.')
    if request.method not in ('GET', 'HEAD'):
        abort(403)
    allowed = request.endpoint in {'media.listing', 'media.details', 'media.stream', 'media.subtitle', 'viewer_config'}
    allowed |= request.endpoint == 'index' and request.path == '/'
    allowed |= request.endpoint == 'assets' and request.view_args.get('name') in VIEWER_ASSETS
    if not allowed or request.args.get('download') == '1':
        abort(403)


def load_secret(directory):
    path = Path(directory) / 'web-session.key'
    try:
        with path.open('r', encoding='ascii') as file:
            return file.read().strip()
    except FileNotFoundError:
        value = secrets.token_hex(32)
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='ascii') as file:
            file.write(value)
        return value


class LocalWeb:
    def __init__(self, settings, ha, secret):
        self.settings, self.ha = settings, ha
        self.signer = URLSafeTimedSerializer(secret, salt='lan-session-v1')
        self.lock = threading.RLock()
        self.tickets = {}
        self.attempts = OrderedDict()

    def authenticated(self):
        try:
            data = self.signer.loads(request.cookies.get(COOKIE, ''), max_age=14 * 86400)
            return data.get('version') == self.settings.get()['lan_auth_version'] and data.get('kind') == 'lan'
        except (BadSignature, SignatureExpired):
            return False

    def ticket(self):
        with self.lock:
            now = time.monotonic()
            self.tickets = {key: expiry for key, expiry in self.tickets.items() if expiry > now}
            if len(self.tickets) >= 30:
                self.tickets.pop(next(iter(self.tickets)))
            ticket = secrets.token_urlsafe(32)
            self.tickets[ticket] = now + 60
            return ticket

    def login(self, data):
        with self.lock:
            now = time.monotonic()
            peer = request.remote_addr or 'unknown'
            attempts = self.attempts.setdefault(peer, deque())
            self.attempts.move_to_end(peer)
            while len(self.attempts) > 512:
                self.attempts.popitem(last=False)
            while attempts and attempts[0] < now - 300:
                attempts.popleft()
            if len(attempts) >= 8:
                abort(429, description='Too many sign-in attempts. Try again in five minutes.')
            ticket, password = data.get('ticket', ''), data.get('password', '')
            if not isinstance(ticket, str) or not isinstance(password, str) or len(ticket) > 200 or len(password) > 256:
                abort(400)
            valid = bool(ticket) and self.tickets.pop(ticket, 0) > now
            saved = self.settings.get()['lan_password_hash']
            if not valid and password and saved:
                valid = check_password_hash(saved, password)
            if not valid:
                attempts.append(now)
                abort(401, description='Sign-in failed. Check the password or open a new link from Home Assistant.')
            attempts.clear()
        response = jsonify(ok=True)
        response.set_cookie(COOKIE, self.signer.dumps({'kind': 'lan', 'version': self.settings.get()['lan_auth_version']}),
                            max_age=14 * 86400, httponly=True, secure=request.is_secure, samesite='Strict', path='/')
        return response

    def configure(self, data):
        if set(data) - {'lan_enabled', 'lan_port', 'lan_host', 'password', 'clear_password',
                        'viewer_enabled', 'viewer_port', 'viewer_host'}:
            raise ValueError('Unknown local web setting.')
        patch = {key: value for key, value in data.items() if key.startswith(('lan_', 'viewer_'))}
        password = data.get('password', '')
        if not isinstance(password, str) or (password and not 10 <= len(password) <= 256):
            raise ValueError('Use a local web password between 10 and 256 characters.')
        if type(data.get('clear_password', False)) is not bool:
            raise ValueError('Invalid setting type: clear_password')
        current = self.settings.get()
        if password or data.get('clear_password') or data.get('lan_enabled') is False:
            patch['lan_password_hash'] = generate_password_hash(password) if password else ('' if data.get('clear_password') else current['lan_password_hash'])
            patch['lan_auth_version'] = secrets.token_hex(16)
        proposed = self.settings.save(patch, internal=True, dry_run=True)
        restart = False
        if os.environ.get('SUPERVISOR_TOKEN'):
            info = self.ha.supervisor('GET', '/addons/self/info')
            mapping = dict(info.get('network') or {})
            for prefix, port in [('lan', LAN_CONTAINER_PORT), ('viewer', VIEWER_CONTAINER_PORT)]:
                desired = proposed[f'{prefix}_port'] if proposed[f'{prefix}_enabled'] else None
                if mapping.get(f'{port}/tcp') != desired:
                    mapping[f'{port}/tcp'] = desired
                    restart = True
            if restart:
                self.ha.supervisor('POST', '/addons/self/options', {'network': mapping})
        else:
            restart = any(proposed[key] != current[key] for key in ('lan_enabled', 'lan_port', 'viewer_enabled', 'viewer_port'))
        self.settings.save(patch, internal=True)
        if 'lan_auth_version' in patch:
            with self.lock:
                self.tickets.clear()
        if restart and os.environ.get('SUPERVISOR_TOKEN'):
            def restart_later():
                try:
                    self.ha.supervisor('POST', '/addons/self/restart', timeout=60)
                except Exception:
                    # The container may stop before Supervisor replies. Never log tokens.
                    pass
            timer = threading.Timer(2, restart_later)
            timer.daemon = True
            timer.start()
        return {'settings': self.settings.public(), 'restart_required': restart,
                'automatic_restart': restart and bool(os.environ.get('SUPERVISOR_TOKEN'))}


def install_local_web(app, settings, ha, secret, web):
    local = LocalWeb(settings, ha, secret)
    app.extensions['local_web'] = local

    @app.before_request
    def local_access():
        if not request.environ.get('fastshare.lan'):
            return
        if not settings.get()['lan_enabled']:
            return jsonify(error='Local web access is disabled. Enable it through Home Assistant.'), 403
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('Origin')
            if origin and urlsplit(origin).netloc != request.host:
                abort(403)
        public = {'/', '/widget', '/local-login.js', '/translations.js', '/cs.json', '/style.css', '/icon.svg', '/api/session', '/api/local-auth'}
        if not local.authenticated():
            if request.path in ('/', '/widget'):
                return send_from_directory(web, 'local-login.html')
            if request.path not in public:
                return jsonify(error='Sign in to continue.'), 401
        if request.path in ('/api/local-ticket', '/api/local-settings'):
            return jsonify(error='Manage local web access through Home Assistant.'), 403

    @app.get('/api/session')
    def session():
        lan = bool(request.environ.get('fastshare.lan'))
        return jsonify(local=lan, authenticated=not lan or local.authenticated(),
                       password_available=bool(settings.get()['lan_password_hash']), language=settings.get()['language'])

    @app.post('/api/local-auth')
    def local_login():
        if not request.environ.get('fastshare.lan'):
            abort(404)
        return local.login(request.get_json())

    @app.post('/api/local-signout')
    def local_logout():
        response = jsonify(ok=True)
        response.delete_cookie(COOKIE, path='/')
        return response

    @app.post('/api/local-ticket')
    def ticket():
        if not settings.get()['lan_enabled']:
            raise ValueError('Enable local web access first.')
        return jsonify(ticket=local.ticket(), expires_in=60)

    @app.post('/api/local-settings')
    def configure():
        return jsonify(local.configure(request.get_json()))


def lan_application(app):
    def application(environ, start_response):
        environ['fastshare.lan'] = True
        return app(environ, start_response)
    return application


def viewer_application(app):
    def application(environ, start_response):
        environ['fastshare.viewer'] = True
        return app(environ, start_response)
    return application
