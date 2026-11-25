"""Week browsing reads real calendar dates without touching the publishing clock."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import copy
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.service import Service
from app.server import create_apps


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        fixed = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)
        return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)


class CalendarViewTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request',
                             side_effect=AssertionError('Unexpected real network access'))
        self.network.start()
        self.clock = patch('app.service.datetime', FixedDatetime)
        self.clock.start()
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.service = Service(root / 'DATA', root / 'PLANNED')
        self.service.state.data.update(schedule_source='home_assistant', calendar_entity='calendar.publisher')
        self.service.ha_get = Mock(return_value=[])

    def tearDown(self):
        self.service.queue.close()
        self.temp.cleanup()
        self.clock.stop()
        self.network.stop()

    def event(self, at, uid='event', **kwargs):
        return {'uid': uid, 'summary': uid, 'start': {'dateTime': at}, **kwargs}

    def test_requested_week_fetches_fresh_events_beyond_snapshot_horizon(self):
        self.service.calendar_slots = [self.event('2026-11-26T16:00:00+01:00', 'cached')]
        self.service.ha_get.return_value = [self.event('2027-01-12T16:00:00+01:00', 'future')]
        view = self.service.calendar_week('2027-01-11')
        self.service.ha_get.assert_called_once_with('calendars/calendar.publisher', {
            'start': '2027-01-11T00:00:00+01:00', 'end': '2027-01-18T00:00:00+01:00'})
        self.assertEqual(view['start'], '2027-01-11T00:00:00+01:00')
        self.assertEqual(view['end'], '2027-01-18T00:00:00+01:00')
        self.assertEqual(view['timezone'], 'Europe/Prague')
        self.assertEqual(view['source'], 'home_assistant')
        self.assertEqual(view['slots'][0]['at'], '2027-01-12T15:00:00+00:00')
        self.assertEqual(view['slots'][0]['label'], 'future')
        self.service.ha_get.return_value = []
        self.assertEqual(self.service.calendar_week('2027-01-11')['slots'], [])
        self.assertEqual(self.service.ha_get.call_count, 2)

    def test_success_never_changes_scheduler_cache_or_persistent_state(self):
        cached = [{'at': '2026-11-25T15:00:00+00:00', 'key': 'due'}]
        self.service.calendar_slots = cached
        self.service.calendar_error = 'Existing scheduler error'
        self.service.last_calendar_read = 123
        before = copy.deepcopy(self.service.state.data)
        with patch.object(self.service.state, 'save') as save, patch.object(self.service.queue, 'claim') as claim:
            self.service.calendar_week('2026-11-23')
        self.assertIs(self.service.calendar_slots, cached)
        self.assertEqual(self.service.calendar_error, 'Existing scheduler error')
        self.assertEqual(self.service.last_calendar_read, 123)
        self.assertEqual(self.service.state.data, before)
        save.assert_not_called()
        claim.assert_not_called()

    def test_filters_all_day_cancelled_missing_timezone_and_malformed_events(self):
        valid_at = '2026-11-25T16:00:00+01:00'
        self.service.ha_get.return_value = [
            {'uid': 'all-day', 'start': {'date': '2026-11-25'}},
            self.event(valid_at, 'cancelled', status='cancelled'),
            self.event(valid_at, 'canceled', status='CANCELED'),
            self.event('2026-11-25T16:00:00', 'no-zone'),
            self.event('invalid', 'bad-time'),
            self.event(None, 'empty-time'),
            {'uid': 'bad-start', 'start': '2026-11-25'},
            {'uid': 'absent-start'}, None, [],
            self.event(valid_at, 'valid'),
        ]
        view = self.service.calendar_week('2026-11-23')
        self.assertEqual([slot['label'] for slot in view['slots']], ['valid'])

    def test_range_is_start_inclusive_end_exclusive_even_for_overlapping_events(self):
        self.service.ha_get.return_value = [
            self.event('2026-11-22T22:59:59Z', 'before'),
            self.event('2026-11-22T23:00:00Z', 'start'),
            self.event('2026-11-29T22:59:59Z', 'last'),
            self.event('2026-11-29T23:00:00Z', 'next-week'),
        ]
        slots = self.service.calendar_week('2026-11-23')['slots']
        self.assertEqual([slot['label'] for slot in slots], ['start', 'last'])

    def test_stable_key_matches_scheduler_across_title_and_offset_changes(self):
        self.service.ha_get.return_value = [self.event('2026-11-25T16:00:00+01:00')]
        view_key = self.service.calendar_week('2026-11-23')['slots'][0]['key']
        self.service.ha_get.return_value = [self.event('2026-11-25T15:00:00Z', summary='Renamed')]
        self.service.refresh_calendar(datetime(2026, 11, 25, 15, tzinfo=timezone.utc))
        self.assertEqual(self.service.calendar_slots[0]['key'], view_key)

    def test_spring_week_uses_seven_local_days_not_168_hours(self):
        view = self.service.calendar_week('2026-03-23')
        self.assertEqual(view['start'], '2026-03-23T00:00:00+01:00')
        self.assertEqual(view['end'], '2026-03-30T00:00:00+02:00')
        self.assertEqual((datetime.fromisoformat(view['end']) - datetime.fromisoformat(view['start'])).total_seconds(), 167 * 3600)

    def test_autumn_week_uses_seven_local_days_not_168_hours(self):
        self.service.ha_get.return_value = [
            self.event('2026-10-25T02:30:00+01:00', 'second'),
            self.event('2026-10-25T02:30:00+02:00', 'first'),
        ]
        view = self.service.calendar_week('2026-10-19')
        self.assertEqual(view['start'], '2026-10-19T00:00:00+02:00')
        self.assertEqual(view['end'], '2026-10-26T00:00:00+01:00')
        self.assertEqual((datetime.fromisoformat(view['end']) - datetime.fromisoformat(view['start'])).total_seconds(), 169 * 3600)
        self.assertEqual([slot['label'] for slot in view['slots']], ['first', 'second'])

    def test_configured_timezone_defines_request_bounds(self):
        self.service.state.data['schedule']['timezone'] = 'America/New_York'
        view = self.service.calendar_week('2026-11-23')
        self.assertEqual(view['timezone'], 'America/New_York')
        self.assertEqual(view['start'], '2026-11-23T00:00:00-05:00')
        self.assertEqual(view['end'], '2026-11-30T00:00:00-05:00')

    def test_invalid_dates_do_not_call_home_assistant(self):
        for start in (None, 20261123, '', '20261123', '2026-W48-1', '2026-02-30',
                      '2026-11-23T00:00:00', ' 2026-11-23', '2026-11-23 ', '2026-1-2'):
            with self.subTest(start=start), self.assertRaisesRegex(ValueError, 'YYYY-MM-DD'):
                self.service.calendar_week(start)
        self.service.ha_get.assert_not_called()

    def test_start_range_is_bounded_to_366_days_in_both_directions(self):
        today = FixedDatetime.now(timezone.utc).date()
        for offset in (-367, 367):
            with self.subTest(offset=offset), self.assertRaisesRegex(ValueError, '366 days'):
                self.service.calendar_week((today + timedelta(days=offset)).isoformat())
        self.service.ha_get.assert_not_called()
        for offset in (-366, 366):
            self.service.calendar_week((today + timedelta(days=offset)).isoformat())
        self.assertEqual(self.service.ha_get.call_count, 2)

    def test_range_uses_local_today(self):
        self.service.state.data['schedule']['timezone'] = 'Pacific/Kiritimati'
        # At 12:00 UTC it is already the next date in UTC+14.
        local_today = FixedDatetime.now(timezone.utc).date() + timedelta(days=1)
        self.service.calendar_week((local_today + timedelta(days=366)).isoformat())
        with self.assertRaisesRegex(ValueError, '366 days'):
            self.service.calendar_week((local_today - timedelta(days=367)).isoformat())

    def test_missing_calendar_and_invalid_upstream_response_are_explicit_errors(self):
        self.service.state.data['calendar_entity'] = ''
        with self.assertRaisesRegex(ValueError, 'Select a Home Assistant calendar'):
            self.service.calendar_week('2026-11-23')
        self.service.ha_get.assert_not_called()
        self.service.state.data['calendar_entity'] = 'calendar.publisher'
        self.service.ha_get.return_value = {'error': 'not events'}
        with self.assertRaisesRegex(ValueError, 'invalid calendar response'):
            self.service.calendar_week('2026-11-23')

    def test_upstream_failure_does_not_replace_scheduler_cache(self):
        cached = [{'at': '2026-11-25T15:00:00+00:00', 'key': 'due'}]
        self.service.calendar_slots = cached
        self.service.calendar_error = ''
        self.service.last_calendar_read = 123
        self.service.ha_get.side_effect = ValueError('Calendar unavailable')
        with self.assertRaisesRegex(ValueError, 'Calendar unavailable'):
            self.service.calendar_week('2026-11-23')
        self.assertIs(self.service.calendar_slots, cached)
        self.assertEqual(self.service.calendar_error, '')
        self.assertEqual(self.service.last_calendar_read, 123)

    def test_internal_view_returns_the_entire_week_without_snapshot_limit(self):
        self.service.state.data.update(schedule_source='internal', schedule={
            'timezone': 'Europe/Prague',
            'weekly': [{'id': 'daily-' + str(hour), 'days': list(range(7)),
                        'time': str(hour) + ':00', 'enabled': True} for hour in (10, 12, 16)],
            'once': [{'id': 'midnight-next-week', 'at': '2026-11-30T00:00:00+01:00', 'enabled': True}],
        })
        view = self.service.calendar_week('2026-11-23')
        self.assertEqual(view['source'], 'internal')
        self.assertEqual(len(view['slots']), 21)
        self.service.ha_get.assert_not_called()

    def test_internal_view_reuses_spring_gap_and_autumn_overlap_rules(self):
        self.service.state.data.update(schedule_source='internal', schedule={
            'timezone': 'Europe/Prague',
            'weekly': [{'id': 'daily', 'days': list(range(7)), 'time': '02:30', 'enabled': True}],
            'once': [],
        })
        self.assertEqual(len(self.service.calendar_week('2026-03-23')['slots']), 6)
        autumn = self.service.calendar_week('2026-10-19')['slots']
        self.assertEqual(len(autumn), 7)
        self.assertEqual(autumn[-1]['at'], '2026-10-25T02:30:00+02:00')

    def test_week_route_is_read_only_ingress_protected_and_never_public(self):
        admin, public = create_apps(self.service, ingress=True)
        client = admin.test_client()
        route = '/api/calendar/week?start=2026-11-23'
        source = {'REMOTE_ADDR': '172.30.32.2'}
        self.assertEqual(client.get(route).status_code, 403)
        self.assertEqual(client.get(route, headers={'X-Forwarded-For': '172.30.32.2'}).status_code, 403)
        self.assertEqual(client.get(route, environ_overrides=source,
                                    headers={'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        with patch.object(self.service.state, 'save') as save, patch.object(self.service, 'publish') as publish:
            response = client.get(route, environ_overrides=source)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['start'], '2026-11-23T00:00:00+01:00')
        self.assertEqual(response.get_json()['slots'], [])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        save.assert_not_called()
        publish.assert_not_called()
        self.assertEqual(public.test_client().get(route).status_code, 404)
        self.assertEqual(client.post(route, environ_overrides=source,
                                     headers={'X-RT-Request': '1'}).status_code, 405)

    def test_week_route_invalid_range_and_upstream_failure_return_explicit_errors(self):
        admin, _ = create_apps(self.service)
        client = admin.test_client()
        for route in ('/api/calendar/week', '/api/calendar/week?start=wrong',
                      '/api/calendar/week?start=2029-01-01'):
            with self.subTest(route=route):
                response = client.get(route)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.get_json()['error'])
                self.assertNotIn('slots', response.get_json())
        self.service.ha_get.assert_not_called()
        self.service.ha_get.side_effect = ValueError('Calendar unavailable')
        response = client.get('/api/calendar/week?start=2026-11-23')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()['error'], 'Calendar unavailable')
        self.assertNotIn('slots', response.get_json())


if __name__ == '__main__':
    unittest.main()
