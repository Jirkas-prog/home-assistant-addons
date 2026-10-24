"""Isolated Linux integration startup test; never connects to a real household."""
import asyncio
from pathlib import Path
import shutil
import tempfile

from homeassistant import bootstrap, loader
from homeassistant.core import HomeAssistant


async def main():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        source = Path(__file__).resolve().parents[1]
        shutil.copytree(source / "custom_components", root / "custom_components", ignore=shutil.ignore_patterns("__pycache__"))
        hass = HomeAssistant(folder)
        loader.async_setup(hass)
        try:
            result = await bootstrap.async_from_config_dict({
                "homeassistant": {"name": "Timer QA", "time_zone": "Europe/Prague", "latitude": 50.0, "longitude": 15.0, "elevation": 100, "unit_system": "metric"},
                "http": {"server_host": "127.0.0.1", "server_port": 18773},
                "frontend": {},
            }, hass)
            assert result is not None
            flow = await hass.config_entries.flow.async_init("scheduler", context={"source": "user"}, data={})
            assert flow["type"] == "create_entry", flow
            await hass.async_block_till_done()
            assert "scheduler" in hass.data, flow
            coordinator = hass.data["scheduler"]["coordinator"]
            coordinator.async_create_schedule({"name": "QA timer", "weekdays": ["daily"], "repeat_type": "repeat", "start_date": None, "end_date": None, "tags": ["workflow-timers:v1"], "timeslots": [{"start": "07:00:00", "actions": [{"entity_id": "switch.qa", "service": "switch.turn_on", "service_data": {}}]}, {"start": "09:00:00", "actions": [{"entity_id": "switch.qa", "service": "switch.turn_off", "service_data": {}}]}]})
            await hass.async_block_till_done()
            schedules = coordinator.async_get_schedules()
            assert len(schedules) == 1, schedules
            schedule = schedules[0]
            assert schedule["entity_id"] and len(schedule["timestamps"]) == 2, schedule
            entity_id = schedule["entity_id"]
            coordinator.async_edit_schedule(schedule["schedule_id"], {"name": "Renamed QA timer"})
            await hass.async_block_till_done()
            assert coordinator.async_get_schedules()[0]["entity_id"] == entity_id
            assert coordinator.async_get_schedules()[0]["name"] == "Renamed QA timer"
            assert "workflow-timers" in hass.data["frontend_panels"]
            assert await hass.config_entries.async_unload(flow["result"].entry_id)
            print("PASS: full Home Assistant bootstrap, config flow, schedule entity, both timestamps, rename, sidebar panel and unload")
        finally:
            await hass.async_stop(force=True)


if __name__ == "__main__":
    asyncio.run(main())
