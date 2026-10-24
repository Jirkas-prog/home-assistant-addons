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
