# Validation

Validated for Knowledge Atlas Dev `5.0.1-dev.4` on 2026-10-01.

- All 84 application tests pass. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, concurrent editing, language persistence, deep breadcrumb paths and 2D/3D node picking.
- The production web build passes.
- English/Czech language audits pass with 745 matching translation keys.
- Add-on checks cover configuration, package and lockfile versions, Dockerfile metadata, documentation, graphics and example records.
- The repository channel check verifies the two permanent directories, names and slugs, independent storage and empty first launches.
- Browser checks cover English/Czech breadcrumb menus, ancestor and sibling navigation, keyboard controls, dropdown contrast, cross-branch map selection, small nodes, visible labels, first-click selection in 3D and mouse-wheel zoom in both modes.
- Additional browser checks cover details-panel resizing, saved widths, keyboard resizing, double-click reset, 2D/3D canvas adjustment and mobile layout. Five-star controls were checked in both languages, including direct saves, reload persistence, editor/detail agreement, scheduled and unscheduled tasks, timeline zoom and narrow screens.
- Importance tests cover Markdown round trips, legacy defaults, all five bubble sizes, click targets, automatic file refresh, complete backups and task updates that preserve dates and notes while rejecting stale writes.
- Document checks cover stable default attachment IDs, reorder/restart persistence, automatic manual edits, complete backup restoration, safe inline media, ranged responses, UTF-8 limits and credential-free remote text loading.
- Browser checks cover formatted Markdown, PDF rendering, TXT editing and saving, image previews, persisted document selection, and double-click opening/closing in both 2D and 3D with the view and panel state preserved.
- Timeline tests check inclusive dates, open endpoints, minimum lane counts over varied overlaps, off-screen filtering, continuous zoom limits, cursor anchoring, wheel units, pinch scaling and panning, bounded ruler ticks and all-date fitting.
- English/Czech browser checks cover all eight timeline presets, status checkboxes, importance saves inside bars, keyboard pan/zoom, labels following the viewport and a 390-pixel layout without horizontal page overflow. Native physical touchpad and touchscreen gestures have not been exercised on hardware; their coordinate calculations have automated coverage.
- Restart and update tests preserve existing records and saved language settings; no storage schema or path changes are introduced by this release.

Run `npm test`, `npm run build`, `npm run check:languages` and `npm run check:addon` in the add-on directory. Run `node scripts/check-atlas-channels.mjs` from the repository root.

## Validation limits

A real Home Assistant Supervisor installation, container startup and update have not been verified in this environment. The Docker daemon is unavailable, so Dockerfile checks are static; an image build and container startup were not run. Backup recovery has automated process and fault-injection coverage; this is not physical power-loss certification. External documents remain references unless they are stored in the managed document directory. Save browser drafts before exporting a library.
