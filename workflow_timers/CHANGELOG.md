# 1.0.5

- Add English/Czech interface selection, following Home Assistant by default and remembering explicit browser choices.
- Translate editor labels, validation messages, calendar labels and the standalone preview without changing user-defined names or service data.
- Preserve open forms during external language changes; changing language sends no scheduling commands.
- Use the permanent WorkFlow Timers product name in the sidebar and English documentation labels.
- Verify the existing scheduler model and installer preservation checks plus browser language regressions. Scheduling rules and storage formats are unchanged.

# 1.0.4

- Create named Home Assistant toggle helpers directly in the timer editor and select them automatically.
- Organize related timers into named groups, with group selection and creation in the editor.

# 1.0.3

- Fix sidebar panel creation in Home Assistant by setting host attributes after the custom element is connected.

# Changelog

## 1.0.2

- Preserve shared on/off state conditions when editing imported schedules.
- Support per-device on-only and off-only actions without adding unintended actions during edits.

## 1.0.1

- Made device names prominent, with secondary entity IDs and accent-insensitive search by either.
- Pinned selected devices above results, including during search, with an always-visible selection count.
- Restored unchecked devices to their alphabetical position and retained missing selected entities for removal.
- Improved editor text readability and styled dropdown pickers in supporting browsers, with native fallbacks.
- Added a 400-device preview fixture (`?many=1`) and selection regression checks.

## 1.0.0

- Added a Czech full-width timer panel and matching dashboard card.
- Added multi-entity on/off plans, per-entity parameters, weekdays, calendar dates
  and sunrise/sunset offsets.
- Added persistent server-side skip-today behavior that preserves off actions.
- Added a one-shot Home Assistant add-on installer with source backups and rollback.
- Based scheduling on the GPL-3.0 Scheduler integration; fixed rename identity,
  action-queue initialization and missing-sun timestamp indexing in this distribution.
- Verified standalone checks, UI creation/editing and isolated Home Assistant
  Core 2026.10.3 setup. Initial release remains experimental pending deployment
  on Home Assistant Supervisor and verification with physical devices.
