# Validation

Validated for Knowledge Atlas Dev `5.0.1-dev.9` on 2026-10-01.

- All 116 application tests pass. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, resumable transfers, concurrent editing, language persistence, deep breadcrumb paths and 2D/3D node picking.
- The production web build passes.
- English/Czech language audits pass with 893 matching translation keys.
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
