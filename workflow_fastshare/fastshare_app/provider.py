"""Protocol checked against the provider's Kodi 1.0.10 and live file pages."""
import base64
from email.message import Message
from html import unescape
from html.parser import HTMLParser
import re
import unicodedata
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlsplit, urlunsplit

import requests

API = 'https://fastshare.cz/api/api_kodi.php'


class ProviderError(Exception):
    def __init__(self, message, action=False, retryable=False):
        super().__init__(message)
        self.action = action
        self.retryable = retryable


def safe_url(url):
    try:
        parts = urlsplit(unescape(url).strip())
        host = (parts.hostname or '').lower()
        if (parts.scheme not in ('http', 'https') or parts.username or parts.password or
                parts.port not in (None, 80, 443) or not re.fullmatch(r'(?:(?:www|data\d+|img)\.)?fastshare\.(?:cloud|cz)', host)):
            raise ValueError()
        return urlunsplit(('https', host, parts.path or '/', parts.query, ''))
    except (ValueError, TypeError):
        raise ValueError('Enter a valid file link from fastshare.cloud or fastshare.cz.') from None


def file_link(url):
    url = safe_url(url)
    parsed = urlsplit(url)
    match = re.match(r'^/(\d+)(?:/|$)', parsed.path)
    file_id = match.group(1) if match else parse_qs(parsed.query).get('id', [''])[0] if parsed.path == '/download.php' else ''
    if not re.fullmatch(r'\d{1,18}', file_id):
        raise ValueError('The link does not contain a FastShare file ID.')
    # Keep only the file identity, never execute action parameters from an email.
    url = urlunsplit(('https', parsed.hostname, parsed.path, '' if match else 'id=' + file_id, ''))
    name = unquote(parsed.path.rsplit('/', 1)[-1])
    if not name or name.isdigit() or name.endswith('.php'):
        name = 'File ' + file_id
    return file_id, url, name


def filename(value):
    value = unicodedata.normalize('NFC', value)
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', '_', value).strip(' .')
    # A portable basename; job IDs avoid collisions with existing downloads.
    return value.encode('utf-8')[:180].decode('utf-8', 'ignore') or 'file.bin'


def free_url(url):
    file_id, url, _ = file_link(url)
    # This is the same free-download form endpoint used on provider file pages.
    return 'https://fastshare.cloud/free/?' + urlencode({'lang': 'cs', 'u': file_id,
            'r': base64.b64encode(url.encode()).decode()})


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.free = ''
        self.refresh = ''
        self.title = ''
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self.in_title = True
        if tag == 'form' and attrs.get('action', '').startswith('/free/'):
            self.free = attrs['action']
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'refresh':
            match = re.search(r'url\s*=\s*(.+)', attrs.get('content', ''), re.I)
            if match:
                self.refresh = match.group(1).strip(' \"\'')

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


class FastShare:
    def __init__(self, session=None):
        self.http = requests.Session()
        self.http.trust_env = False
        self.http.headers['User-Agent'] = 'WorkFlow-FastShare/1.0 (+HomeAssistant)'
        self.session = session or {}
        token = self.session.get('token')
        if token:
            for domain in ('fastshare.cz', 'fastshare.cloud'):
                self.http.cookies.set('FASTSHARE', token, domain=domain, secure=True)

    def close(self):
        self.http.close()

    def request(self, url, method='GET', headers=None, data=None, redirects=True):
        for _ in range(7):
            url = safe_url(url)
            try:
                response = self.http.request(method, url, headers=headers, data=data,
                                             timeout=(15, 35), stream=True, allow_redirects=False)
            except requests.RequestException:
                raise ProviderError('FastShare is not responding. A retry will follow automatically.', retryable=True) from None
            if response.is_redirect:
                location = response.headers.get('Location', '')
                response.close()
                if not redirects:
                    raise ProviderError('FastShare changed its login address.')
                url = safe_url(urljoin(url, location))
                method, data = 'GET', None
                continue
            if response.status_code in (429, 503):
                response.close()
                raise ProviderError('FastShare is busy or limiting concurrent transfers. Retrying later.', retryable=True)
            if response.status_code in (401, 403):
                response.close()
                raise ProviderError('FastShare rejected the transfer. Check your account, credit or service limits.', action=True)
            if response.status_code >= 400:
                status = response.status_code
                response.close()
                raise ProviderError('The file is unavailable (HTTP %s).' % status)
            return response
        raise ProviderError('Too many FastShare redirects.')

    def limited_text(self, response):
        with response:
            raw = response.raw.read(2_000_001, decode_content=True)
            if len(raw) > 2_000_000:
                raise ProviderError('FastShare returned an oversized response.')
            return raw.decode('utf-8', 'replace')

    def api(self, parameters):
        from urllib.parse import urlencode
        import json
        # Credentials are required in the provider's GET API; never log this URL.
        try:
            response = self.request(API + '?' + urlencode(parameters), redirects=False)
            result = json.loads(self.limited_text(response))
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (ValueError, requests.RequestException):
            raise ProviderError('FastShare returned an invalid response.') from None

    def login(self, username, password):
        if not username.strip() or not password or len(username) > 300 or len(password) > 1000:
            raise ValueError('Enter your username and password.')
        user = self.api({'process': 'login', 'login': username.strip(), 'password': password}).get('user') or {}
        token = user.get('hash', '') if isinstance(user, dict) else ''
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{10,512}', token):
            raise ProviderError('Sign-in failed. Check your username and password.')
        return {'token': token, 'username': username.strip(),
                'unlimited': str(user.get('unlimited', '')).lower() in ('true', '1'),
                'credit': str((user.get('data') or {}).get('value', ''))}

    def search(self, query):
        if not 2 <= len(query.strip()) <= 160:
            raise ValueError('Search must contain 2 to 160 characters.')
        result = self.api({'process': 'search', 'pagination': '60', 'term': query.strip(), 'adult': 'false'})
        rows = (result.get('search') or {}).get('file') or []
        if isinstance(rows, dict):
            rows = [rows]
        items = []
        for row in rows[:60]:
            try:
                file_id, url, _ = file_link(row['download_url'])
                name = str(row['filename'])
                thumbnail = ''
                try:
                    candidate = safe_url(row.get('thumbnail', ''))
                    if urlsplit(candidate).hostname == 'img.fastshare.cloud' and urlsplit(candidate).path.startswith('/upload/'):
                        thumbnail = candidate
                except ValueError:
                    pass
                items.append({'file_id': file_id, 'name': name, 'url': url,
                              'page_url': free_url(url),
                              'thumbnail': thumbnail,
                              'total': int((row.get('data') or {}).get('value', 0)),
                              'resolution': str(row.get('resolution', ''))})
            except (KeyError, ValueError, TypeError):
                continue
        return items

    def download(self, url, offset=0, validator=''):
        file_id, url, hint = file_link(url)
        headers = {'Accept-Encoding': 'identity'}
        if offset and validator:
            headers.update({'Range': 'bytes=%s-' % offset, 'If-Range': validator})
        if not self.session and urlsplit(url).path == '/download.php':
            response = self.request(free_url(url), method='POST', data=b'', headers=headers)
            return self.check_download(response), hint
        if not self.session or '/download.php' not in urlsplit(url).path:
            response = self.request(url)
            if 'text/html' not in response.headers.get('Content-Type', '').lower():
                return self.check_download(response), hint
            body = self.limited_text(response)
            page = Page()
            page.feed(body)
            for _ in range(2):
                if not page.refresh:
                    break
                url = safe_url(urljoin(url, page.refresh))
                body = self.limited_text(self.request(url))
                page = Page()
                page.feed(body)
            hint = page.title.split(' online ke ')[0].split('|')[0].strip() or hint
            if self.session:
                matches = [urljoin(url, link) for link in page.links if '/download.php?' in link]
                matches = [link for link in matches if file_link(link)[0] == file_id]
                if not matches:
                    raise ProviderError('FastShare did not provide a download link. Check the account and file availability.', action=True)
                url = matches[0]
            else:
                if not page.free:
                    raise ProviderError('Free transfer is unavailable. Open the file on FastShare.', action=True)
                url = safe_url(urljoin(url, page.free))
                response = self.request(url, method='POST', data=b'', headers=headers)
                return self.check_download(response), hint
        response = self.request(url, headers=headers)
        return self.check_download(response), hint

    def check_download(self, response):
        content_type = response.headers.get('Content-Type', '').lower()
        if any(t in content_type for t in ('text/', 'application/json', 'application/xhtml')):
            body = self.limited_text(response).lower()
            if 'captcha' in body:
                raise ProviderError('FastShare requires a CAPTCHA. Open the link on FastShare, then retry the job.', action=True)
            if any(word in body for word in ('ček', 'současně', 'wait', 'limit')):
                raise ProviderError('FastShare is limiting free downloads. Retrying soon.', retryable=True)
            raise ProviderError('FastShare returned a page instead of a file. Check your account or credit.', action=True)
        return response


def response_name(response, fallback):
    message = Message()
    message['Content-Disposition'] = response.headers.get('Content-Disposition', '')
    return filename(message.get_filename() or fallback)
