"""WorkFlow panel and persistent, server-dated skip-today command."""
import asyncio

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.core import callback
from homeassistant.util import dt as dt_util

from .workflow_rules import MANAGED_TAG, SKIP_PREFIX


@websocket_api.websocket_command({vol.Required("type"): "scheduler/workflow_info"})
@callback
def websocket_info(hass, connection, msg):
    connection.send_result(msg["id"], {
        "version": "1.0.3",
        "today": dt_util.now().date().isoformat(),
        "time_zone": hass.config.time_zone,
    })


@websocket_api.websocket_command({
    vol.Required("type"): "scheduler/workflow_skip",
    vol.Required("schedule_id"): str,
    vol.Required("skip"): bool,
})
@websocket_api.async_response
async def websocket_skip(hass, connection, msg):
    connection.require_admin()
    coordinator = hass.data["scheduler"]["coordinator"]
    async with hass.data["scheduler"]["workflow_lock"]:
        if coordinator.async_get_schedule(msg["schedule_id"]) is None:
            connection.send_error(msg["id"], "not_found", "Časovač již neexistuje.")
            return
        tags = coordinator.async_get_tags_for_schedule(msg["schedule_id"])
        if MANAGED_TAG not in tags:
            connection.send_error(msg["id"], "invalid_format", "Tento časovač nespravuje WorkFlow.")
            return
        tags = [tag for tag in tags if not tag.startswith(SKIP_PREFIX)]
        if msg["skip"]:
            tags.append(SKIP_PREFIX + dt_util.now().date().isoformat())
        coordinator.async_assign_tags_to_schedule(msg["schedule_id"], tags)
        # Save before acknowledging; don't restart timers or replay current actions.
        await coordinator.store.async_save()
        hass.data["scheduler"]["schedules"][msg["schedule_id"]].async_write_ha_state()
        hass.bus.async_fire("scheduler_updated")
        connection.send_result(msg["id"], {"success": True})


async def async_setup_workflow(hass):
    hass.data["scheduler"]["workflow_lock"] = asyncio.Lock()
    websocket_api.async_register_command(hass, websocket_info)
    websocket_api.async_register_command(hass, websocket_skip)
    await async_register_panel(
        hass,
        frontend_url_path="workflow-timers",
        webcomponent_name="workflow-timers-panel",
        sidebar_title="Časovače",
        sidebar_icon="mdi:timer-outline",
        module_url="/local/workflow-timers/workflow-timers.js?v=1.0.3",
        trust_external=True,
    )
