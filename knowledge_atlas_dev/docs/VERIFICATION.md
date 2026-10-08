# Validation

Validated for Knowledge Atlas Dev `5.0.1-dev.44` on 2026-10-08.

- All 273 application tests pass. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, incremental data packages, resumable transfers, concurrent editing, appearance and language persistence, deep breadcrumb paths and 2D/3D node picking.
- The production web build passes.
- English/Czech language audits pass with 1429 matching translation keys.
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
- Restart and update tests preserve existing records and saved language settings. Existing record schemas and storage paths remain compatible; task discussion data uses the additional files described below.
- Journal tests cover old daily records, inclusive and overlapping ranges, leap months, manual Markdown search, place validation, EXIF dates/offsets/GPS hemispheres, inert Office previews, binary and UTF-16 text fallback, preview limits and original-byte downloads.
- English/Czech browser checks cover creating and editing entries, day/week/month/custom ranges, related-record links, saved-place lookup, multi-file uploads, EXIF suggestions, photo navigation, PDF/Markdown/DOCX viewing and custom-extension text previews. Saved language and the selected entry survive reloads; console checks found no errors. All fixtures are generic.

Run `npm test`, `npm run build`, `npm run check:languages` and `npm run check:addon` in the add-on directory. Run `node scripts/check-atlas-channels.mjs` from the repository root.

## Selectable appearance (5.0.1-dev.44)

All 273 tests, production build, language audit (1429 keys), add-on and permanent-channel checks pass. New coverage verifies migration from settings without an appearance, every palette surviving restart, unchanged existing preferences, invalid/prototype values, stale writes, per-space browser hints and blocked browser storage. Extended integration tests check independent space preferences, settings undo/redo and full backup restoration to a new directory. New theme text/accent pairs meet 4.5:1 against core surfaces; arbitrary record colors are not an accessibility certification.

Browser checks with a generic library exercised the five-card settings section, live Paper preview, saved Original/Graphite/Tide calendars, a task detail dialog and Graphite persistence after server restart. Visual review found and corrected pale event titles, helper links and legacy secondary text on light backgrounds. The Tide map loading screen stayed within a 390 x 844 document; the final Tide calendar was captured at 1440 x 1000. Styles add approximately 5.8 kB gzip over Dev 43, without new image requests or dependencies.

The local browser automation became blocked on the existing native discard confirmation during an intermediate build. The final theme-only preview now closes directly while other edited settings retain confirmation. Interactive cancellation, mobile selection and the final themed 2D/3D canvas pass could not be completed in that browser session; their rendering/state paths were reviewed in source, with palette and persistence behavior covered by automated tests. No live Home Assistant or physical phone test was performed.

## Illuminated sage appearance (5.0.1-dev.43)

All 270 tests, production build, language audit (1411 keys), add-on and permanent-channel checks pass. The visual update uses shared CSS palette tokens, gradients and existing icons; it adds no dependencies, external imagery or animation loops. The built stylesheet is approximately 24.5 kB gzip. The persistence and API code is unchanged.

Browser checks with a generic 14-record library covered the task calendar, record cards, task details, checkpoint warning colors, nested project menus, on-demand map loading and both 2D/3D renderers. At 390 x 844, the document remained viewport-sized and the task dialog had no horizontal content overflow. Primary actions, selected tabs and navigation retain non-color cues. Core palette contrast measurements are 10.79:1 for primary text on panels, 6.32:1 for secondary text on panels, 5.24:1 for secondary text on raised surfaces and 11.29:1 for text on the accent color. These are token-pair measurements, not a complete accessibility certification of every record color or screen.

The local browser console recorded no warnings or errors. Generic records, the saved language and default task view remained after restarting the server. Physical-phone rendering, operating-system high-contrast mode and a live Home Assistant update were not tested.

## Compact map controls (5.0.1-dev.42)

All 270 tests, the production build, English/Czech language audit (1411 keys), add-on checks and permanent-channel checks pass. Browser checks with a generic six-record library covered collapsed filter controls, removable filter chips, recovery from an empty result, nested themed layout menus, retained layout preferences after reload, 2D/3D switching and the shared library type filters.

At 390 x 844, the map canvas measured 536 pixels high, compared with approximately 248 pixels in the previous version's screenshot. Both document dimensions stayed equal to the viewport. Opening the options overlay did not resize the canvas or move its bubbles. Escape closed the options and returned focus to their trigger without ending hierarchy editing. A selected parent survived a pending search when it remained in the final results; a search that hid it cleared the selection and explained why. Search and layout updates did not display a false empty-result message.

The request log contained no attachment or document-file requests during map filtering. Browser console checks recorded no warnings or errors in this run. These checks used a local production build and an emulated mobile viewport; physical mobile hardware and a live Home Assistant installation were not tested.

## Manual map hierarchy (5.0.1-dev.41)

Four new tests cover self-links, cycles, missing records, reparenting and detaching whole branches, insertion of intermediate records, complete content preservation, one-step persistent undo/redo, coordinate conflicts with rollback, and idempotent retries. Every layout is checked in both dimensions for parent/child radius ordering and stable saved coordinates after topology changes, branch dragging and rebuilds. A fresh store and position reader recover the saved state. Resetting coordinates retains the edited hierarchy.

Browser checks with a generic six-record library covered parent-first selection, replacement of an existing parent, detaching by clicking a line in both 2D and 3D, cycle rejection, branch dragging, mobile linking, and retained edits after reload and server restart. Arrows appear in the middle of hierarchical connections. The 390 x 844 layout keeps both document dimensions equal to the viewport; compact tools and prompts leave room for bubbles. Production build, add-on configuration, language and permanent-channel checks pass.

One unattributed MutationObserver error was recorded during page navigation, similar to earlier local browser checks; its source was not established. The tested map interactions completed successfully. Physical touchscreen gestures and a live Home Assistant installation were not tested.

## Combined calendar (5.0.1-dev.37)

All 247 tests pass. Production build, English/Czech language audit (1355 keys), add-on packaging checks and permanent-channel checks pass. New coverage verifies mixed date ranges, midnight endings, independent source filters, unchanged original colors and data, lightweight metadata, profile-specific ETags and 304 responses, rejected partial-record writes, and unchanged urgency from neighboring checkpoint dates.

Browser checks used a generic library of more than 1500 records, directly and inside a same-origin frame with an Ingress-style prefix. They covered month/week/day/year views, distinct task/journal colors and icons, overflow lists, both visibility checkboxes, full-text search across both types, task and journal details, calendar-date-prefilled creation and saving of both record types, and returning to the same date after closing details. Saved test entries survived a server restart. The year view shows both source dots on mixed days.

At 390 x 844, the document remained exactly viewport-sized with no horizontal or outer-page scrolling. Switching atlas spaces worked through the mobile menu; the second space contained only its own undated task. English and Czech interfaces rendered correctly, and browser console checks recorded no warnings or errors. On a 1440 x 1000 viewport, month rows fit two event lanes without overlapping the overflow controls. Opening a task renders zero related-record checkboxes until its organization section expands; the test then displayed 1570 choices and preserved the saved form.

The compressed calendar metadata response was approximately 77 kB in this generic fixture; size depends on record count and metadata. Before opening a record, request logs contained only space metadata, backup-transfer recovery checks and calendar workspace requests, with unchanged polls returning 304. No attachment, full-record or map requests occurred during that browsing phase. Opening a journal fetched only that journal's attachment preview; automated tests also verify that listing and search never read attachment contents. Physical mobile hardware and a live Home Assistant installation were not part of this verification.

## Quick capture and writing-first editors (5.0.1-dev.36)

The suite passes 243 tests, including localized journal starters, year-boundary weekly ranges, preserved custom ranges and appointment times, existing task links and protection against replacing saved or non-empty writing. Production build, language audit, add-on checks and permanent-channel checks pass.

Browser checks used generic records at desktop and 390-pixel widths, both directly and inside a same-origin frame with an Ingress-style prefix. They covered Alt+N, suppressing that shortcut while editing, opening all four creation actions, focus on the note title after dialog handoff, optional organization controls, saving note text and tags, journal draft recovery, a saved seven-day journal and English/Czech outlines. Space switching on the mobile viewport reached the separate English test space. The related-record list had zero checkbox inputs while collapsed and 1,568 after expansion. No atlas, map-renderer or attachment-file request was recorded during these capture workflows; normal metadata refreshes and selected-record Markdown retrieval remain.

A browser pass caught and fixed an editor render error before publication. One unlocalized MutationObserver error was recorded during an embedded space navigation, without a source URL; the navigation completed and the new-space editor worked. Its origin was not established. These local browser and fixture checks are not a real Supervisor update or a physical-phone test.

## Timeline startup and deferred map

Three additional tests cover lightweight task snapshots, distinct conditional-response validators for each content profile, absence of saved-position reads until a map request, complete record retrieval, rejection of partial-record saves, automatic Markdown updates, cancellation of obsolete requests, and gzip asset negotiation with original MIME types and uncompressed fallback.

English/Czech browser checks confirm the default timeline, persisted language, the central map button, keyboard activation, successful 2D/3D rendering, full Markdown loading in record details and the editor, and task importance changes that preserve notes and checkpoints. At 390 pixels the button remains fully visible without horizontal page overflow. No browser console errors were recorded.

Server request logs show no atlas request, map renderer, layout worker or 3D module before the download button is activated, including after visiting the map section. The 3D module is requested only on switching to 3D. A generic 213-record fixture produced a 55.5 kB initial workspace JSON response compared with 5.87 MB for its complete map snapshot, before compression. The initial JavaScript bundle is approximately 533 kB before compression, down from 892 kB; its precompressed HTTP response is approximately 169 kB. These are local fixture and build measurements, not Home Assistant startup-time guarantees.

## Task workspace and selected backups

Twelve regression tests cover legacy column mapping, revision-protected comments, recoverable comment deletion, independent activity and undo/redo events, incomplete-checkpoint completion confirmation, project-column migration, and rollback after a board-order write failure. Backup cases cover selected tasks, combined tasks and journals, managed attachment bytes, reference-only ancestors, unchanged destination project content, full discussion restoration, and idempotent reimport. Map exports restore coordinates into an empty library while preserving existing manual arrangements. Fault injection checks interrupted activity outbox writes and rollback of a failed discussion import.

Browser checks with a generic 109-record library verified the five tabs, English comment creation, Czech checkpoint completion, persistent language and checkpoint IDs after reload, integrated Markdown viewing with Escape returning to the task card, project-column renaming, and a 390-pixel card without horizontal page overflow. The checkbox-selected task/journal download reached 100.00% in an embedded frame. The browser automation could not capture the resulting Blob download, so final operating-system file saving was not verified in that run; server archive contents and restore round trips are covered by automated tests. No browser console errors were recorded.

Request logs retain the lightweight task profile and no automatic atlas, map-renderer or 3D-module request. The initial JavaScript is approximately 544 kB before compression and 173 kB compressed, about 2.2% above the preceding 169 kB baseline. Board and card code are separate lazy chunks, approximately 2.9 kB and 4.9 kB compressed. Comments, activity and document bytes do not enter startup snapshots. These are local build and generic-fixture checks; timing on Home Assistant hardware remains unmeasured.

## Journal loading

The journal regression case verifies a metadata-only workspace profile, distinct ETags, complete selected-entry retrieval, rejection of partial-record saves, preserved attachment references after an importance edit, full-text search over unloaded entries, and automatic search changes after manual Markdown edits. Listing, searching and editing do not read attachment contents or saved map positions.

A generic 1,531-record fixture returned approximately 0.50 MB of journal navigation JSON compared with 98.80 MB for complete records, before compression. Compressed payloads were approximately 74 kB and 664 kB respectively; the repetitive synthetic bodies compress unusually well. One local request pair completed in 72 ms and 1,083 ms; these are individual development-machine measurements, not medians or Home Assistant performance guarantees. A selected journal entry was 928 bytes and its initial request took approximately 171 ms.

The current calendar regression tests cover Monday-based weeks, leap dates, month/year navigation, inclusive spanning bars, minimum non-overlapping lanes, timed overlap columns, midnight endpoints and optional clock validation. Download tests verify sequential transfers, the inclusive 10 MB boundary, unknown-size and remote references, cancellation before the next file, streamed size enforcement and recovery after one file fails. HTTP checks prove metadata requests do not read text attachment contents, the automatic file endpoint rejects oversized files, explicit original downloads remain complete, and single-record reads are isolated from the store cache.

English/Czech browser checks on a generic 1,533-record library verified the default month, day/week/year navigation, spanning bars, overflow-day navigation, the record dialog, persisted clock edits and language settings, photo navigation and return to the calendar. Request logs show sequential small-file downloads only after opening their entry and no original request for the 10,000,001-byte attachment. The integrated photo and PDF viewers use Blob URLs from completed downloads; the PDF page rendered successfully and the Markdown viewer displayed formatted text. Calendar navigation requests neither entry bodies nor attachments. A 390-pixel viewport was checked for page and dialog overflow, including long header controls. No browser console errors were recorded. These are local fixtures, not a real Home Assistant installation.

## Runtime validation limits

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

History checks cover persisted descriptions and timestamps, legacy entries without timestamps, bounded pagination, selected-range Undo/Redo, stale revisions, invalid selections, external edits, no-op ranges and rollback after a multi-file range write fails. The settings section requires confirmation, keeps native text undo and loads no attachment contents. Verification uses only generic library fixtures.
