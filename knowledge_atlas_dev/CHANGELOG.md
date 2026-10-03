# Changelog

## 5.0.1-dev.18

- Add Constellations: compact subtree regions with varied branch directions and extra separation, in 2D and 3D.
- Add Hierarchy terraces: separate depth levels with parents centered over child branches.
- Retain all four existing layouts, add descriptions to compare all six, and save manual arrangements independently for the new modes, including backup and restore.

## 5.0.1-dev.17

- Add a Fixed position checkbox for every record type and a lock marker beside its list number.
- Keep reserved numbers unchanged when records are added, imported, moved or archived; automatically renumber other records around them.
- Persist fixed positions with the library order, including full backups, and prevent conflicting reservations or stale updates.


## 5.0.1-dev.16

- Wrap complete breadcrumb paths, including long names, without horizontal scrolling or truncation.
- Drag a map bubble to move its entire descendant branch in 2D or 3D, including descendants hidden by filters.
- Save manual positions in the library separately for each layout and dimension. Existing coordinates survive reloads, server restarts, index rebuilds, incremental package imports and full backup restoration; new records appear relative to their placed parent.
- Add Reset view to restore computed positions for the current layout and dimension. Fit entire map continues to change only the camera.
- Show pending saves and retryable failures, protect concurrent arrangements from silent overwrites, and reject invalid coordinate files without hiding library records.

## 5.0.1-dev.15

- Prevent card text from overflowing, with wrapped titles, bounded previews and visible metadata.
- Show each record's date and persistent list position; add newest-first, oldest-first, manual-order and importance sorting.
- Insert new records at position one and move existing entries to a chosen position, shifting the rest automatically across the library, task board and branch tree.
- Store the sequence atomically alongside Markdown and include it in full backups. Detect conflicting position changes without rewriting record content.

## 5.0.1-dev.14

- Keep the original map and add selectable spacious groups, hierarchical nebulae and regular grids in 2D and 3D. Compute geometry in a background worker, cache it locally and preserve the camera during filtering and record updates.
- Add constant-size, collision-aware labels and progressive detail on zoom. Combine exact importance ratings with topic, record type and text filters; retain dimmed ancestor context.
- Add a dedicated Journal notebook with day, week and month contents, inclusive date ranges and navigation that skips empty periods. Mark journal entries as experiences and link tasks using existing Markdown records and attachments.
- Start the sidebar tree collapsed and expose importance controls on all record types. Preserve existing libraries, journal entries, settings and backup formats.

## 5.0.1-dev.13

- Maintain a persistent, incremental record index and update it in the background. Reuse unchanged Markdown across reads and restarts, retain the last completed map during rebuilding, and detect external edits and restored libraries automatically.
- Show map indexing progress, percentage, elapsed time and estimated remaining time. Load cached snapshots without waiting for a rebuild and reuse compressed API responses.
- Allow longer explicit refreshes, distinguish slow loading from connection errors and avoid presenting an unloaded library as empty. Preserve search, statistics, records and saved settings.

## 5.0.1-dev.12

- Scroll the entire navigation sidebar together, including the logo, navigation, expanded branches and footer, on desktop and mobile. Remove the separate branch-tree scrollbar and preserve the themed scrollbar appearance.

## 5.0.1-dev.11

- Retain inactive uploads, prepared downloads and restore previews for seven elapsed days. Show upload retention deadlines and preserve confirmed bytes across page closure and add-on restarts.
- Retry temporary connection failures automatically from confirmed chunks, including after returning to a background tab. Keep deliberate pause and cancellation under user control.
- Protect active transfers and package merges from expiry cleanup; preserve current records, settings and restore rollback libraries. Document browser background-sleep settings in English and Czech interface guidance.

## 5.0.1-dev.10

- Import incremental data packages into an existing library without uploading or replacing a complete backup. Include nested records, tasks, work tools and managed documents.
- Preview new, identical and conflicting records; keep current content by default or choose an incoming record and preserve its previous version. Choose a target branch and validate the merged references.
- Isolate package documents, reuse identical imports, preserve settings and apply changes with a recovery journal and rollback after failure or restart.
- Retain resumable upload controls and package import mode across restarts. Add English/Czech controls, a documented package format and an offline package creation command.

## 5.0.1-dev.9

- Persist confirmed upload chunks across page closure, connection loss and add-on restarts. Offer Resume, Later and Cancel when returning, with the saved filename, size and precise progress.
- Check the selected original ZIP locally, including hashes of every confirmed chunk, before continuing without resending the uploaded prefix. Retain unfinished uploads until explicitly cancelled or completed.
- Keep fully uploaded archives available for verification retries and renewed restore previews. Preserve library records, settings and restore rollback data.
- Add English and Czech recovery controls and regression tests for restart, interrupted writes, file mismatch, cancellation and restored libraries.

## 5.0.1-dev.8

- Show backup upload and download percentages with two decimal places, the current direction's transfer speed, transferred size and an approximate remaining time.
- Pause, resume and cancel uploads and downloads using confirmed chunks and validated HTTP byte ranges. Reconcile interrupted upload acknowledgements without duplicating data.
- Prepare verified ZIPs on disk before downloading, and stream chunks to a chosen file or browser storage. Keep archive preparation and restore verification separate from transfer progress.
- Keep active transfers available while navigating the app, localize controls in English and Czech, and clean up cancelled or expired temporary transfers without changing the active library.

## 5.0.1-dev.7

- Add a unified journal with inclusive date ranges, entry-to-entry browsing, overlap filters, linked records and offline places.
- Upload multiple journal attachments, preserve original files, and suggest capture dates and coordinates from embedded EXIF.
- Add photo galleries and image navigation, inert Office document text previews and an explicit read-only text fallback for arbitrary local files.
- Preserve legacy daily entries, automatic Markdown indexing, full backups and saved English/Czech interface preferences.

## 5.0.1-dev.6

- Open PDFs, images and downloads after a complete library restore, including range requests and explicit downloads from restored document storage.
- Preserve attachment path validation and keep HTML downloads inert. Add an end-to-end backup, restore and attachment-delivery regression test.

## 5.0.1-dev.5

- Add dated task checkpoints with completion criteria, quick checkboxes and recorded completion times.
- Color the entire timeline bar red when a checkpoint is overdue. Gradually vary urgency from green to yellow to red using importance, upcoming deadlines and nearby pending deadlines across the library.
- Show checkpoint markers and completion counts inside task bars, with an accessible dialog explaining the current urgency. Preserve the time scale and position when checking off a checkpoint.
- Include checkpoints in task details, board progress, overdue counts, search, all-date fitting and complete backups. Recalculate urgency after midnight and when returning to the app.
- Validate manual Markdown and editor changes, preserve custom metadata and reject conflicting saves. Keep all controls and errors available in English and Czech.

## 5.0.1-dev.4

- Show physical locations and file attachments directly below importance, before record notes.
- Open record Markdown and attachments inside a closable viewer. Add formatted Markdown previews and inert image, audio and video viewing alongside PDF and UTF-8 editing.
- Choose a stable attachment ID to open by double-clicking a bubble in either map. Preserve pan, zoom, camera orientation and the details-panel state on return.
- Keep preview choices in Markdown, automatic indexing and complete backups. Text writes retain revision checks and draft recovery.
- Replace timeline task lists and separate importance rows with compact, non-overlapping task bars containing names and stars.
- Treat missing task endpoints as unbounded; tasks without dates span every visible period. Automatically pack visible tasks into the minimum number of rows.
- Add 24-hour, 3/7/30/90/180/360-day and all-date presets, continuous cursor-anchored Ctrl-wheel and pinch zoom, time panning, keyboard controls and independent status checkboxes.
- Provide English and Czech labels for the new controls, with no changes to stable-channel data or identity.

## 5.0.1-dev.3

- Resize the details panel by dragging its left edge or using the keyboard. Remember the width per browser and channel; double-click to reset it.
- Set five-star importance directly at the top of project, inventory item and task details, with immediate saving and matching editor controls.
- Scale project and inventory bubbles in both maps by their importance while retaining hierarchy-based sizing and normal defaults for existing records.
- Rate scheduled and unscheduled tasks directly on the timeline, including single-day tasks. Preserve dates, completion state and notes, and reject stale updates.
- Store importance in Markdown, detect manual changes automatically and preserve it in complete backups. Map legacy task priorities to stars and keep board labels consistent.
- Add English/Czech labels, accessible keyboard controls and a manual project template.

## 5.0.1-dev.2

- Click breadcrumb levels to navigate; right-click or use the dropdown arrow to open sibling branches and workspace sections. Keyboard navigation is supported.
- Derive record paths and sibling choices from the current library, including manually added, renamed and moved records.
- Open visible 2D and 3D nodes across all hierarchy levels using their bubbles or visible labels, with larger targets for small nodes.
- Resolve clicks from their current coordinates, preventing missed first clicks and overlapping labels from blocking visible bubbles.
- Increase mouse-wheel zoom sensitivity by 25% in both maps while preserving the cursor position in 2D.
- Improve dropdown contrast, including selected, disabled and forced-color states.
- Clarify the backup upload action as "Preview and restore backup" in both interface languages.

## 5.0.1-dev.1

- Markdown knowledge library with nested branches, cross-links, search and automatic statistics.
- Interactive 2D/3D maps, projects, task boards, timelines and inventory.
- Work journals, bills of materials, reusable procedures, flashcards and saved views.
- Configurable locations, PDF viewing, text editing and document uploads.
- Complete library backups with checksum verification, restore previews and rollback protection.
- Empty first installations, independent channel storage and persistent English/Czech language selection.
