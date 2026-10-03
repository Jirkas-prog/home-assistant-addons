# Validation

Validated for Knowledge Atlas Dev `5.0.1-dev.19` on 2026-10-03.

- All 182 application tests pass. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, incremental data packages, resumable transfers, concurrent editing, language persistence, deep breadcrumb paths and 2D/3D node picking.
- The production web build passes.
- English/Czech language audits pass with 1038 matching translation keys.
- Add-on checks cover configuration, package and lockfile versions, Dockerfile metadata, documentation, graphics and example records.
- The repository channel check verifies the two permanent directories, names and slugs, independent storage and empty first launches.
- Browser checks cover English/Czech breadcrumb menus, ancestor and sibling navigation, keyboard controls, dropdown contrast, cross-branch map selection, small nodes, visible labels, first-click selection in 3D and mouse-wheel zoom in both modes.
- Additional browser checks cover details-panel resizing, saved widths, keyboard resizing, double-click reset, 2D/3D canvas adjustment and mobile layout. Five-star controls were checked in both languages, including direct saves, reload persistence, editor/detail agreement, scheduled and unscheduled tasks, timeline zoom and narrow screens.
- Importance tests cover Markdown round trips, legacy defaults, all five bubble sizes, click targets, automatic file refresh, complete backups and task updates that preserve dates and notes while rejecting stale writes.
- Document checks cover stable default attachment IDs, reorder/restart persistence, automatic manual edits, complete backup restoration, safe inline media, ranged responses, UTF-8 limits and credential-free remote text loading.
- Browser checks cover formatted Markdown, PDF rendering, TXT editing and saving, image previews, persisted document selection, and double-click opening/closing in both 2D and 3D with the view and panel state preserved.
- Timeline tests check inclusive dates, open endpoints, minimum lane counts over varied overlaps, off-screen filtering, continuous zoom limits, cursor anchoring, wheel units, pinch scaling and panning, bounded ruler ticks and all-date fitting.
- English/Czech browser checks cover all eight timeline presets, status checkboxes, importance saves inside bars, keyboard pan/zoom, labels following the viewport and a 390-pixel layout without horizontal page overflow. Native physical touchpad and touchscreen gestures have not been exercised on hardware; their coordinate calculations have automated coverage.
- Checkpoint tests cover validation, completion timestamps, inclusive dates, importance thresholds, overdue overrides, nearby deadline pressure, manual edits, search, API conflict protection, restart, backup restoration and localization.
- English/Czech browser checks cover adding and removing checkpoints, editing dates and criteria, quick completion and reopening, saved completion times after restart, red/green bar changes, overdue counts, checkpoint search and marker dialogs. Filters retain urgency from hidden neighboring tasks. Saves preserve the timeline range, keyboard focus returns after saving and closing, and the checklist and editor fit a 390-pixel layout. No browser console errors were recorded.
- Restart and update tests preserve existing records and saved language settings; no storage schema or path changes are introduced by this release.
- Journal tests cover old daily records, inclusive and overlapping ranges, leap months, manual Markdown search, place validation, EXIF dates/offsets/GPS hemispheres, inert Office previews, binary and UTF-16 text fallback, preview limits and original-byte downloads.
- English/Czech browser checks cover creating and editing entries, day/week/month/custom ranges, related-record links, saved-place lookup, multi-file uploads, EXIF suggestions, photo navigation, PDF/Markdown/DOCX viewing and custom-extension text previews. Saved language and the selected entry survive reloads; console checks found no errors. All fixtures are generic.

Run `npm test`, `npm run build`, `npm run check:languages` and `npm run check:addon` in the add-on directory. Run `node scripts/check-atlas-channels.mjs` from the repository root.

## Validation limits

A real Home Assistant Supervisor installation, container startup and update have not been verified in this environment. The Docker daemon is unavailable, so Dockerfile checks are static; an image build and container startup were not run. Backup recovery has automated process and fault-injection coverage; this is not physical power-loss certification. External documents remain references unless they are stored in the managed document directory. Save browser drafts before exporting a library.

## Backup transfer validation

Development release 5.0.1-dev.8 adds regression coverage for localized hundredth-percent formatting, 20 GiB progress arithmetic, throughput/ETA sampling, lost acknowledgements, confirmed upload offsets, interrupted and oversized chunks, validated download ranges, pause/resume, cancellation and isolated temporary cleanup. The HTTP round trip verifies the complete backup manifest and every attached byte while preserving saved settings. Existing backup, restore, record, language and update-preservation tests remain part of the suite.

Browser verification used a generic 32 MiB binary attachment in an embedded frame: download, pause/resume, save the ZIP, upload that same file, pause/resume during in-app navigation, successful SHA-256 preview, and cancellation in both directions. English and Czech controls and numeric formats were checked. This verifies local embedded-browser behavior; it does not substitute for testing on a running Home Assistant Supervisor, all browser storage implementations or a real multi-gigabyte network transfer.

Development release 5.0.1-dev.9 adds durable upload journals, recovery endpoints, local original-file verification and retained restore previews. Ten additional tests cover restarted services, truncated unacknowledged tails, failed journal commits, old upload retention, malformed journals, interrupted verification, renewed previews, cancellation, file mismatches outside the sampled fingerprint, lost verification responses, saved settings and preserved rollback libraries.

The embedded-browser test closed an upload at 24.99% (8 MiB of a generic 32.01 MiB ZIP), stopped and restarted the local server, then reopened the page. English and Czech recovery dialogs retained the exact progress. Selecting the original ZIP resumed successfully through the SHA-256 restore preview. Reloading at 100% recovered and reverified the ZIP without selecting a file again. Discarding the preview removed the recovery prompt on the next reload. Tests do not simulate physical power loss or certify every browser/storage implementation.

## Incremental package validation

Development release 5.0.1-dev.10 adds twelve tests covering partial nested libraries, managed attachments, an optional destination branch, identical reimports, conflict choices and history, stale previews, changed staging files, graph validation, missing attachments and locations, rollback after a failed write, and recovery after abruptly terminating a separate server process during the commit. The suite also covers durable upload purpose, protected HTTP endpoints, duplicate concurrent requests, reserved property names as record IDs, symlink containment, and preservation of an external edit encountered during rollback. Complete backups include the merged records and original attachment bytes; existing settings and unrelated files remain unchanged.

English and Czech browser checks used a generic school package in an embedded frame. They verified keeping an existing record, adding a category beneath an existing branch, explicitly replacing a conflicting record, reusing an already imported document, updated search and counts, and opening the imported notebook in the integrated text viewer. Import fixtures contained no personal data. These checks used a small package; a 500 MB package transfer and an import on a real Home Assistant installation have not been exercised.

## Transfer retention and reconnection

Development release 5.0.1-dev.11 adds seven regression tests for seven-day elapsed-time retention, crossing local midnight and a daylight-saving transition, restart with six-day-old uploads, durable renewal and new progress, preservation of active chunks and package merges, six-day restore previews, and rebuilding a missing preview from a retained complete ZIP. Client tests exercise automatic retry after lost acknowledgements, returning from a hidden or stalled page, deliberate pause, online/focus events and cancellation without duplicate bytes. Existing records, settings and rollback libraries remain protected.

English and Czech browser checks verified the seven-day help text, localized retention deadline, unchanged 50% progress after page reload, persisted language choice and unchanged sample record identifiers. No browser console errors were observed. Browser sleep was simulated through lifecycle events in automated tests; operating-system suspension and a real Home Assistant installation have not been exercised. The application cannot force a suspended browser to continue executing.

## Record cards and list ordering

Automated coverage checks insertion at position one, moves in both directions and to position fifty, contiguous renumbering, stale-order conflicts, invalid inputs, manual Markdown additions and deletions, restart persistence, full backup restoration, failed atomic writes, cached API refresh, date validation, unknown-date placement and importance/date tie breaking. Incremental package reimports ignore derived positions and preserve the destination sequence. Reordering leaves Markdown bytes, content revisions, star ratings and record dates unchanged.

English/Czech browser checks cover sort labels and choices, moves from 1 to 50 and 1 to 3, saved record dates, new-record insertion and matching task/timeline positions. Desktop and 390-pixel card layouts contain long titles, long descriptions and unbroken strings without horizontal page overflow. Sort choice and language survive reloads. Browser console checks report no errors. These checks use only generic fixtures.

## Persistent undo and redo

Ten additional tests exercise 1,000 retained steps, restart persistence, redo branching, ratings, checkpoints, fixed list positions, map layouts, settings, attachment text and archival. Fault injection covers failed history commits, partial multi-file travel, interrupted-edit recovery, stale browser revisions, external edits, changed document targets, unsafe paths and copied-library boundaries. Unrelated binary attachment contents are not read when recording an edit. Existing update, full-backup and incremental-package tests continue to pass.

English/Czech browser checks verify count updates after star changes, Undo/Redo, keyboard shortcuts, reload persistence, map dragging as one step and restoration of coordinates. The map no longer renders the topic legend. A 390-pixel viewport keeps both history controls accessible without horizontal page overflow. Verification uses only generic library fixtures.
