"""The browser viewport endpoint never bypasses ingress, CSRF or the view lease."""
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.browser_instagram import BrowserInstagram, HOME, VIEWPORTS
from app.server import create_apps
from app.state import State


class BrowserModeRoutesTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('No live network in tests'))
        self.network.start()
        self.temp = tempfile.TemporaryDirectory()
        self.state = State(Path(self.temp.name))
        self.runtime = SimpleNamespace(page=SimpleNamespace(url=HOME), home=Mock(), set_mode=Mock(), close=Mock(),
                                       resume_failed_editor=Mock(return_value=False))
        self.browser = BrowserInstagram(self.state, runtime_factory=lambda profile: self.runtime)
        service = SimpleNamespace(state=self.state, browser_instagram=self.browser, connection_guard=threading.RLock())
        self.admin, self.public = create_apps(service, ingress=True)
        self.client = self.admin.test_client()
        self.source = {'REMOTE_ADDR': '172.30.32.2'}
        self.headers = {'X-RT-Request': '1'}

    def tearDown(self):
        self.browser.shutdown()
        self.temp.cleanup()
        self.network.stop()

    def post(self, data, **kwargs):
        return self.client.post('/api/browser/mode', json=data,
                                headers=kwargs.get('headers', self.headers),
                                environ_overrides=kwargs.get('environ_overrides', self.source))

    def test_mode_route_is_admin_only_and_requires_ingress_csrf_same_origin(self):
        self.assertEqual(self.public.test_client().post('/api/browser/mode', json={'mode': 'mobile'},
                                                        headers=self.headers).status_code, 404)
        self.assertEqual(self.post({'mode': 'mobile'}, environ_overrides={}).status_code, 403)
        self.assertEqual(self.post({'mode': 'mobile'}, headers={}).status_code, 403)
        self.assertEqual(self.post({'mode': 'mobile'}, headers=self.headers | {'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.runtime.set_mode.assert_not_called()

    def test_mode_requires_active_browser_view_and_browser_connection_method(self):
        self.assertEqual(self.post({'mode': 'mobile'}).status_code, 400)
        self.browser.start()
        self.state.data['connection_method'] = 'official'
        self.assertEqual(self.post({'mode': 'mobile'}).status_code, 400)
        self.runtime.set_mode.assert_not_called()

    def test_malformed_or_unrecognized_mode_never_reaches_runtime(self):
        self.browser.start()
        for data in ([], {}, {'mode': 'mobile', 'url': 'https://example.test/'}, {'mode': None},
                     {'mode': 1}, {'mode': ['mobile']}, {'mode': 'tablet'}, {'mode': 'MOBILE'}):
            with self.subTest(data=data):
                self.assertEqual(self.post(data).status_code, 400)
        self.runtime.set_mode.assert_not_called()

    def test_valid_modes_return_matching_dimensions_and_preserve_private_profile(self):
        self.browser.start()
        profile = self.browser.profile
        for mode in ('mobile', 'desktop'):
            response = self.post({'mode': mode})
            self.assertEqual(response.status_code, 200)
            result = response.get_json()
            self.assertEqual(result['mode'], mode)
            self.assertEqual((result['width'], result['height']), VIEWPORTS[mode])
            self.assertTrue(result['active'])
            self.assertEqual(self.browser.profile, profile)
            self.assertNotIn(str(profile), response.get_data(as_text=True))
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.runtime.set_mode.call_count, 2)
        self.assertFalse(self.state.data['enabled'])

    def test_partial_mode_failure_closes_runtime_and_ends_interaction_lease(self):
        self.browser.start()
        self.runtime.set_mode.side_effect = RuntimeError('PRIVATE_SYNTHETIC_DETAIL')
        response = self.post({'mode': 'mobile'})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('PRIVATE_SYNTHETIC_DETAIL', response.get_data(as_text=True))
        self.runtime.close.assert_called_once()
        self.assertFalse(self.browser.status()['active'])
        self.assertEqual(self.browser.status()['mode'], 'desktop')
