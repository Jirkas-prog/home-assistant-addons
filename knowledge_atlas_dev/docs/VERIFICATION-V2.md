# V2 checkpoint verification

Checkpoint: `2.0.0-dev.1`, 2026-09-30, Windows / Node.js 24.15.0. Tests and browser work use separate temporary libraries; personal records are not included or migrated.

| Check              | Evidence                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated behavior | 39 tests: existing CRUD, search/refresh, inventory/tasks, languages and new backup/restore, migration, repair, attachment identity and conflict behavior.                                                                                                                                           |
| Restore recovery   | Full data + managed attachments + history round trip; new destination root; stale preview; checksum tampering; unsafe names; duplicate paths; interrupted rename journal and rollback after failed final replacement.                                                                               |
| Write safety       | Equal-content target replacement, resource reorder/removal, configured-root change, stale revisions, simulated full disk and symlinked history ancestor.                                                                                                                                            |
| Schema             | Version 1 reads, explicit version 2 migration, unknown metadata preservation and repeat migration with zero changes.                                                                                                                                                                                |
| English UI         | New maintenance section, diagnostics and schema preview exercised. Six-record test library upgraded through the UI; completion displayed and repeat preview showed zero changes.                                                                                                                    |
| Czech UI           | Language saved, applied to navigation and editor, and persisted after page reload.                                                                                                                                                                                                                  |
| Draft/conflict UI  | Passed after replacing native confirmation with an in-app exit panel: record draft recovered after closing/reopening; external Markdown conflict compared and merged in Czech while preserving an external tag; text attachment draft recovered and external text conflict merged/saved in English. |
| Containers / HA    | Not verified. Local Docker engine unavailable; installed WSL distribution has no Node runtime. No test HA instance supplied yet.                                                                                                                                                                    |

Inventory API acceptance additionally covers manual 3 + 2 stock distribution, subtree search/filter/CSV agreement, backed-up location replacement, cycle rejection, idempotent transfers, loans and partial returns. Browser acceptance passed in Czech: a parent-place filter showed 3 of 5 units; transfer, loan and return updated counts correctly. The English view reflected the same data after switching language.

Final source audit at this stage: 536 paired messages; English-only shipped source outside the Czech locale. Eight obsolete promotional title keys were removed.

Full restore also passed through the English UI: uploaded a 7-record/19-file test backup, reviewed counts and collisions, confirmed replacement, then reopened its text attachment at the newly mapped document root. The previous directory remained preserved.

Build, package/config/version/logo checks and 536-message source localization audit passed. The existing repository test suite passed all three tests; unrelated add-ons and repository files were not changed.

Functional-heading follow-up: all four main page titles match their navigation labels in English and Czech. New-record and settings dialogs use their actual function names; empty inventory and timeline headings describe their state. Both language variants were checked in the browser; all 39 add-on tests, the build, language audit and add-on checks passed again. The running personal application received the same focused UI changes and a successful rebuild, without changing its records or data format.

## Practical limits

Scrollbar follow-up: both application builds and the 75-file language audit passed. Browser inspection confirmed the shared track, thumb and dimensions on the page, tree, task list, horizontal timeline, editor body and Markdown field. Arrow keys moved the timeline horizontally and returned it to the start. The stylesheet includes a standard-property fallback and leaves system forced-color styling intact; Firefox and forced-color mode were not separately exercised.

Backups stream file contents but enumerate file metadata. Restore and migration need disk space for staging and the previous library. Supported limits and retained operation directories are documented in [DOCS.md](../DOCS.md).

Process interruption and injected errors are tested; physical power loss and arbitrary external programs changing files in the narrow interval between the final revision check and rename are not claimed to be prevented. Keep external editors idle during migration/restore. Restore is whole-library replacement, not a merge. Browser drafts are local to the browser and are not server backups.

This checkpoint is development work, not completion of the full V2 roadmap. See [V2-PLAN.md](V2-PLAN.md) for all approved items and remaining acceptance work.
