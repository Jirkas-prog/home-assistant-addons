"""Run in Linux with Home Assistant 2026.10.3: python tests/test_core.py."""
import asyncio
from datetime import datetime, timedelta
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import homeassistant
from homeassistant.core import HomeAssistant, CoreState
from homeassistant.util import dt as dt_util
from homeassistant.helpers import entity_registry, device_registry

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from custom_components.scheduler import const
from custom_components.scheduler.actions import ActionQueue
from custom_components.scheduler.store import ScheduleStorage
from custom_components.scheduler.timer import TimerHandler
from custom_components.scheduler.workflow import websocket_skip
from custom_components.scheduler.workflow_rules import MANAGED_TAG, SKIP_PREFIX


async def main():
    with tempfile.TemporaryDirectory() as folder:
        hass = HomeAssistant(folder)
        hass.config.time_zone = "Europe/Prague"
        dt_util.set_default_time_zone(ZoneInfo("Europe/Prague"))
        hass.state = CoreState.running
        device_registry.async_setup(hass)
        await device_registry.async_load(hass)
        await entity_registry.async_load(hass)
        today = dt_util.now().date().isoformat()
        tags = [MANAGED_TAG, SKIP_PREFIX + today]
        store = ScheduleStorage(hass)
        await store.async_load()
        writes = []
        calls = []
        coordinator = SimpleNamespace(
            state=const.STATE_READY,
            async_get_tags_for_schedule=lambda _: list(tags),
            async_get_schedule=lambda _: {"schedule_id": "test"},
            async_assign_tags_to_schedule=lambda _, value: tags.__setitem__(slice(None), value),
            store=store,
        )
        hass.data["scheduler"] = {"coordinator": coordinator, "workflow_lock": asyncio.Lock(), "schedules": {"test": SimpleNamespace(async_write_ha_state=lambda: writes.append(True))}}
        hass.states.async_set("switch.test", "off")
        async def capture(call):
            calls.append(call.service)
        hass.services.async_register("switch", "turn_on", capture)
        hass.services.async_register("switch", "turn_off", capture)

        async def execute(service):
            queue = ActionQueue(hass, "test", [], "and", False)
            queue.add_action({"action": "switch." + service, "entity_id": "switch.test", "data": {}})
            await queue.async_process_queue()
            await hass.async_block_till_done()
            await queue.async_clear()

        await execute("turn_on")
        assert calls == [], calls
        await execute("turn_off")
        assert calls == ["turn_off"], calls
        tags[:] = [MANAGED_TAG, SKIP_PREFIX + (dt_util.now().date() - timedelta(days=1)).isoformat()]
        await execute("turn_on")
        assert calls == ["turn_off", "turn_on"], calls

        # Execute the actual WebSocket handler: admin check, persistence, stable timer.
        connection = SimpleNamespace(require_admin=lambda: writes.append("admin"), send_result=lambda *args: writes.append(args), send_error=lambda *args: (_ for _ in ()).throw(AssertionError(args)))
        # HA decorators retain the coroutine in __wrapped__.
        handler = websocket_skip
        while hasattr(handler, "__wrapped__"):
            handler = handler.__wrapped__
        await handler(hass, connection, {"id": 1, "schedule_id": "test", "skip": True})
        assert SKIP_PREFIX + today in tags
        assert "admin" in writes

        # Real storage round-trip retains skip tags and action parameters.
        payload = const.ADD_SCHEDULE_SCHEMA({"name": "Test", "weekdays": ["mon"], "repeat_type": "repeat", "timeslots": [{"start": "07:00:00", "actions": [{"entity_id": "switch.test", "service": "switch.turn_on", "service_data": {}}]}, {"start": "09:00:00", "actions": [{"entity_id": "switch.test", "service": "switch.turn_off", "service_data": {}}]}]})
        entry = store.async_create_schedule(payload)
        store.async_create_tag({"name": SKIP_PREFIX + today, "schedules": [entry.schedule_id]})
        await store.async_save()
        restored = ScheduleStorage(hass)
        await restored.async_load()
        assert restored.async_get_schedule(entry.schedule_id)["timeslots"][1]["actions"][0]["service"] == "switch.turn_off"
        assert restored.async_get_tag(SKIP_PREFIX + today)

        timer = TimerHandler.__new__(TimerHandler)
        timer.hass = hass
        timer.id = "test"
        timer._weekdays = ["mon"]
        timer._start_date = timer._end_date = None
        now = datetime(2026, 10, 24, 12, tzinfo=ZoneInfo("Europe/Prague"))
        next_time = timer.calculate_timestamp("07:00:00", now)
        assert next_time.weekday() == 0 and next_time.hour == 7
        hass.states.async_set("sun.sun", "above_horizon", {"next_setting": "2026-10-24T16:00:00+00:00"})
        timer._weekdays = ["daily"]
        assert timer.calculate_timestamp("sunset-00:20:00", now).hour == 17
        spring = datetime(2026, 3, 29, 0, tzinfo=ZoneInfo("Europe/Prague"))
        assert timer.calculate_timestamp("02:30:00", spring) > spring
        timer._timeslots = [{"start": "sunset+00:00:00", "stop": None}, {"start": "23:59:00", "stop": None}]
        hass.states.async_remove("sun.sun")
        next_slot, timestamp = timer.next_timeslot()
        assert next_slot == 1 and timestamp is not None
        assert timer.timestamps[0] is None

        # Import/registration smoke test for the actual UI-facing integration APIs.
        import custom_components.scheduler.switch
        from custom_components.scheduler.workflow import async_setup_workflow
        with patch("custom_components.scheduler.workflow.async_register_panel") as panel:
            await async_setup_workflow(hass)
            assert panel.await_count == 1
            assert "scheduler/workflow_skip" in hass.data["websocket_api"]
        await hass.async_stop(force=True)
        print("PASS: HA Core action execution, skip/off protection, expiry, admin command, storage restart, WebSocket registration and panel setup")


if __name__ == "__main__":
    asyncio.run(main())
