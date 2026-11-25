"""Official Instagram API. Never log credentials or blindly retry media_publish."""
import time
from urllib.parse import urlencode
import requests


class InstagramError(RuntimeError):
    pass


class Instagram:
    def __init__(self, state, session=None):
        self.state = state
        self.session = session or requests.Session()

    def request(self, method, path, data=None):
        with self.state.lock:
            token = self.state.data['access_token']
            version = self.state.data['api_version']
        if not token:
            raise InstagramError('Instagram is not connected.')
        url = f'https://graph.instagram.com/{version}/{path.lstrip("/")}'
        try:
            r = self.session.request(method, url, headers={'Authorization': f'Bearer {token}'},
                                     params=data if method == 'GET' else None,
                                     data=data if method == 'POST' else None, timeout=(10, 45))
            result = r.json()
            if not isinstance(result, dict):
                raise ValueError()
        except (requests.RequestException, ValueError):
            raise InstagramError('Instagram did not return a valid response. Check the connection.') from None
        if not r.ok or 'error' in result:
            err = result.get('error', {})
            # Do not reflect Meta messages: they can contain submitted data or credentials.
            code = err.get('code', r.status_code) if isinstance(err, dict) else r.status_code
            sub = err.get('error_subcode', '') if isinstance(err, dict) else ''
            raise InstagramError(f'Instagram API rejected the request (code {code}/{sub}).')
        return result

    def check(self):
        with self.state.lock:
            checked_token = self.state.data['access_token']
        result = self.request('GET', 'me', {'fields': 'user_id,username'})
        identity = str(result.get('user_id') or result.get('id') or '')
        if not identity.isdigit() or not result.get('username'):
            raise InstagramError('Instagram did not return a professional account ID and username.')
        with self.state.lock:
            if self.state.data['access_token'] != checked_token:
                raise InstagramError('Connection changed during verification. Check the new connection again.')
            self.state.data['account'].update(connected=True, id=identity,
                                             username=result['username'], error=None)
            self.state.save()
            return dict(self.state.data['account'])

    def oauth_url(self):
        with self.state.lock:
            app_id, secret, base = (self.state.data[k] for k in ('app_id', 'app_secret', 'public_media_base_url'))
        if not all((app_id, secret, base)):
            raise ValueError('Enter Instagram App ID, App Secret and the public HTTPS URL.')
        return 'https://www.instagram.com/oauth/authorize?' + urlencode({
            'enable_fb_login': 'false', 'force_reauth': 'true', 'client_id': app_id,
            'redirect_uri': base + '/oauth/callback', 'response_type': 'code',
            'scope': 'instagram_business_basic,instagram_business_content_publish',
            'state': self.state.oauth_state(time.time()),
        })

    def oauth_callback(self, code, nonce):
        self.state.consume_oauth_state(nonce, time.time())
        with self.state.lock:
            app_id, secret, base = (self.state.data[k] for k in ('app_id', 'app_secret', 'public_media_base_url'))
        try:
            short = self.session.post('https://api.instagram.com/oauth/access_token', data={
                'client_id': app_id, 'client_secret': secret, 'grant_type': 'authorization_code',
                'redirect_uri': base + '/oauth/callback', 'code': code}, timeout=(10, 45))
            short.raise_for_status()
            short_result = short.json()
            if not isinstance(short_result, dict):
                raise ValueError()
            entries = short_result.get('data', [short_result])
            if not isinstance(entries, list) or not entries or not isinstance(entries[0], dict):
                raise ValueError()
            short_token = entries[0]['access_token']
            if not isinstance(short_token, str) or not short_token:
                raise ValueError()
            long = self.session.get('https://graph.instagram.com/access_token', params={
                'grant_type': 'ig_exchange_token', 'client_secret': secret,
                'access_token': short_token}, timeout=(10, 45))
            long.raise_for_status()
            result = long.json()
            if not isinstance(result, dict):
                raise ValueError()
            token, expires = result['access_token'], int(result['expires_in'])
            if not isinstance(token, str) or not token or expires <= 0:
                raise ValueError()
        except (requests.RequestException, ValueError, KeyError, TypeError):
            raise InstagramError('The login token exchange failed. Check your Meta app configuration.') from None
        with self.state.lock:
            self.state.data.update(access_token=token, enabled=False)
            self.state.data['account'] = {'connected': False, 'expires_at': time.time() + expires,
                                          'token_created_at': time.time()}
            self.state.save()
        return self.check()

    def refresh_if_needed(self):
        now = time.time()
        with self.state.lock:
            account = dict(self.state.data['account'])
            token = self.state.data['access_token']
            original_token = token
        expires = account.get('expires_at')
        if expires and expires - now > 7 * 86400:
            return
        if expires and expires <= now:
            raise InstagramError('The Instagram login expired. Reconnect the account.')
        if now - account.get('token_created_at', now) < 86400:
            return
        if now - account.get('last_refresh_attempt', 0) < 3600:
            return
        with self.state.lock:
            self.state.data['account']['last_refresh_attempt'] = now
            self.state.save()
        try:
            r = self.session.get('https://graph.instagram.com/refresh_access_token', params={
                'grant_type': 'ig_refresh_token', 'access_token': token}, timeout=(10, 45))
            r.raise_for_status()
            result = r.json()
            token, expires = result['access_token'], int(result['expires_in'])
        except (requests.RequestException, ValueError, KeyError):
            raise InstagramError('Login refresh failed; reconnect before the token expires.') from None
        with self.state.lock:
            if self.state.data['access_token'] != original_token:
                return
            self.state.data['access_token'] = token
            self.state.data['account'].update(expires_at=now + expires, token_created_at=now)
            self.state.save()

    def container_status(self, container_id):
        return self.request('GET', container_id, {'fields': 'status_code'}).get('status_code')

    def permalink(self, media_id):
        return self.request('GET', media_id, {'fields': 'permalink'}).get('permalink', '')
