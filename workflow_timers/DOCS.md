# WorkFlow Timers guide

## Dashboard tab and ordinary card

The sidebar panel is registered automatically when the integration loads. To also
use the card in dashboards:

1. Enable Advanced mode in your Home Assistant user profile if Resources is hidden.
2. Open **Settings → Dashboards → Resources → Add resource**.
3. URL: `/local/workflow-timers/workflow-timers.js?v=1.0.2`; type: **JavaScript Module**.
4. In the desired dashboard, create a view with layout **Panel (1 card)**.
5. Add a manual card:

```yaml
type: custom:workflow-timers-card
title: Časovače
```

[examples/dashboard-view.yaml](examples/dashboard-view.yaml) contains a complete
view definition. The same card also works inside a normal view. Both locations
read the same server-side plans; they do not create duplicate timers.

## Creating a plan

Select **Upravit přehled**, then **Nový časovač**. Enter a name, select weekdays
or a calendar date, choose both times and select devices. Each selected device
can have its own parameters. Brightness and fan percentage have number inputs;
other service parameters can be entered as JSON objects under the selected device.
For example, a light can use `{"color_temp_kelvin": 2700, "transition": 3}`.
Parameters must be supported by the entity's Home Assistant service. Targets
cannot be overridden in JSON parameters.

Light and switch targets use their `turn_on` and `turn_off` services; covers use
`open_cover` and `close_cover`. Target selection is entity-based. Climate devices,
arbitrary scripts and scenes are not included in this first editor.

**Po–Pá** means Monday to Friday, including public holidays. Sunrise and sunset
require `sun.sun` and a correctly configured Home Assistant location. The offset
range is −120 to +120 minutes. Time calculations and day boundaries use Home
Assistant's time zone. A single-date plan stays visible after completion, paused.

## Pause and skip semantics

- The switch enables/disables the **plan**, without immediately changing the device.
  Disabling also suppresses its future off action. Use the device controls elsewhere
  in Home Assistant if you want to turn the device off immediately.
- **Dnes vynechat** skips remaining activations on today's calendar date. Scheduled
  `turn_off`/`close_cover` actions still run. It does not undo an activation that has
  already happened. **Obnovit dnes** cancels the skip; missed actions are not replayed.
- The skip date is determined and stored by the server. It survives restarts and
  automatically stops matching at local midnight, without a running browser.
- Saving a plan or enabling it at a scheduled minute can execute that minute's
  action, as in upstream Scheduler. This implementation uses two point-in-time
  actions, not a continuously enforced desired state. It does not replay an entire
  missed interval after a long shutdown.
- Both times apply to the selected **calendar days**. Daily plans can turn on in
  the evening and off the next morning. An overnight interval anchored to one
  selected weekday is not supported; the editor rejects that fixed-time case.
  For sun-based plans, the two events likewise run on the selected calendar days.
- Several plans may target the same entity. Each scheduled action runs independently;
  the latest executed action wins. The UI shows actual entity state, not a prediction.

WorkFlow only lists its own tagged plans. Existing Scheduler rules are retained
and remain managed by their existing card. Existing Node-RED/input_datetime
arrangements are not automatically migrated. When switching a device to WorkFlow,
disable its old Node-RED scheduling to avoid two systems controlling it.

## Updates, data and rollback

Update this add-on through the store and press **Start** again to copy the new
files, then restart Home Assistant Core. Keep the slug `workflow_timers` unchanged.
The installer touches only `custom_components/scheduler` and `www/workflow-timers`.
It does not change `configuration.yaml` or the `.storage` directory.

Scheduler data is stored in Home Assistant's `.storage/scheduler.storage`, which
belongs to the Home Assistant backup. An add-on-only backup does **not** contain
these plans. Take a full Home Assistant backup before first installation or update.
The installer keeps copies of replaced code in its private `/data/backups` directory,
along with a `files.json` journal. A failed file copy rolls completed writes back.
A process or power failure during installation may require restarting the installer
before restarting Core. Uninstalling the installer does not remove the installed
integration or its data.

For a full rollback, restore a Home Assistant backup. To return to official
Scheduler, remove WorkFlow skip tags or cancel active skips first, restore official
Scheduler files, remove the WorkFlow dashboard resource/card and restart Core.
The sidebar entry goes away when the modified integration is no longer loaded.
Keep the original Scheduler data if you want its plans to remain available.

## Troubleshooting

- No sidebar entry: check the installer log, restart Core, and add the Scheduler
  integration under Devices & services. Refresh the browser.
- Unknown custom card: add the resource as a JavaScript module and reload the page.
- No devices: supported domains are light, switch, fan, input_boolean and cover.
- Read-only view: changes in the WorkFlow UI require an administrator account.
- A device stays unavailable: the row reports its real HA state. Check the device
  integration and Home Assistant logs; saving a timer does not prove service execution.
- Skip is missing after an update: an official HACS Scheduler update may have
  replaced the WorkFlow backend. Run this installer again and restart Core.

No long-lived access token, extra exposed port, Supervisor API permission or
external JavaScript CDN is needed. The frontend uses the signed-in HA session.

## Device selection

Search uses the Home Assistant entity friendly name and entity ID, ignoring case
and accents. Names are displayed above IDs; the stored entity IDs are never renamed.
Selected devices remain at the top even when they do not match the current search.
The selection count always includes all selected devices. Unchecking returns an
entity to name order (or hides it when it does not match the current search).

Dropdowns use native keyboard behavior with an application-themed picker where
customizable select is supported. Other browsers retain their native picker.

Imported plans may include shared on/off state conditions. The editor shows them
under Conditions and preserves them unless unchecked. Per-device checkboxes select
which of the two scheduled actions applies; this supports off-only companion
devices while retaining at least one action at each scheduled time.
