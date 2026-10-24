# WorkFlow Timers

A Czech timer panel for Home Assistant, with one full-width row per plan.
Create a plan, choose one or more entities, set on/off times and selected weekdays,
and optionally configure sunrise/sunset offsets or a single calendar date.
No Node-RED wiring or per-timer YAML is needed.

This is an experimental distribution of the existing
[Scheduler integration](https://github.com/nielsfaber/scheduler-component)
with a new frontend and a persistent skip-today extension. It is installed through
the Home Assistant add-on store. The one-shot add-on installs files; scheduling
then runs inside Home Assistant Core, including when browsers are closed.

- Sidebar page: **Časovače**.
- Dashboard card: `custom:workflow-timers-card`, including full-width Panel views.
- Fixed times, weekdays, weekends, a single date, sunrise/sunset with ±120 minutes.
- Lights, switches, fans, input booleans and covers; multiple targets in one plan.
- Per-target brightness/fan percentage and optional JSON service parameters.
- Enable/disable a plan, or skip today's activation while retaining its off action.
- Related timers grouped under a shared heading, with group selection in the editor.
- Create named virtual switches (native input boolean helpers) directly in the editor.
- Actual target states, search, filters, edit mode and a responsive layout.

## Install from the existing repository

Repository: `https://github.com/Jirkas-prog/home-assistant-addons`

1. Refresh **Settings → Apps/Add-ons → Store → Repositories**.
2. Install **WorkFlow Timers**, then press **Start** once.
3. Read the installation log. The add-on stops after copying the files; this is normal.
4. Restart **Home Assistant Core**.
5. Open **Settings → Devices & services → Add integration**, search for **Scheduler**,
   and add it. Existing Scheduler installations keep their existing integration entry.
6. Open **Časovače** from the sidebar. Select **Upravit přehled → Nový časovač**.

If an official Scheduler installation already exists, the installer refuses to
overwrite it by default. Make a Home Assistant backup, disable HACS updates for
Scheduler, set `replace_existing_scheduler: true` in this add-on's configuration,
and start the installer again. WorkFlow and official Scheduler use the same
integration domain and must not be updated independently.

See [DOCS.md](DOCS.md) for dashboard setup, update/restore instructions and exact
timer semantics. See [THIRD_PARTY.md](THIRD_PARTY.md) for source attribution.

## Preview and checks

Run `python preview/serve.py`, then open the printed local URL. The demo uses
fictional entities and browser-local storage; it never connects to Home Assistant.
Append `?many=1` to the preview URL to test selection with 400 extra devices.

```sh
node --test tests/model.test.js
python -m unittest discover -s tests -p test_local.py
```

Linux tests against a real Home Assistant Python environment:

```sh
python tests/test_core.py
python tests/test_bootstrap.py
```

Validated with Home Assistant Core 2026.10.3 and Python 3.14. The add-on installer
uses Python 3.13. Physical devices and a real Home Assistant Supervisor installation
still require an installation smoke test. This version is marked experimental.
