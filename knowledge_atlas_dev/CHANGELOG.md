# Changelog

## 5.0.1-dev.39

- Let the cat land on the nearest usable control or panel edge underneath after releasing the cursor. Carry her onto buttons, fields and tabs without activating them.
- Add a gravity-driven fall, landing pose and short settling pause. Support narrow controls and keep occupied perches attached while scrolling.
- Resolve visible, unclipped and unobscured control tops at release time; follow moving targets and find a new landing below if a target disappears. Retain all personality and reduced-motion preferences.

## 5.0.1-dev.38

- Add a dedicated Pet settings section with four personalities: the original Explorer, Quiet companion, Curious researcher and Playful acrobat. Save per space, validate on the server and retain settings through backup/restore and updates.
- Give new personalities distinct rhythms, preferred perches, short-term exploration memory, cursor games and rest cycles. React separately to task tabs, journal writing, document previews, calendar, board, map, settings and backup transfers.
- Add sniffing, watching and paw-tapping poses. Keep the head in front of the collar and preserve continuous movement when personality changes mid-jump.
- Let typing quiet new personalities, keep backup sessions calm, and respect disabled/reduced motion and hidden tabs. Pet behavior remains offline and cannot operate controls or edit records.

## 5.0.1-dev.37

- Add a Combined calendar with blue tasks and purple journal entries, source icons and independent visibility checkboxes. Reuse month (default), week, day and year navigation, ranged entries and overflow lists.
- Open original task or journal details without leaving the calendar. Adding on a chosen date offers both record types and prefills the date; journal time slots also preserve the chosen hour. Keep undated tasks accessible below the calendar.
- Serve a cached calendar metadata profile without record bodies, attachment lists, checkpoint descriptions or map positions. Fetch full records only on open, preserve the existing per-entry preview policy, and reject incomplete summary writes.
- Render task organization controls and large related-record checklists only after expansion.
- Reuse project, area, importance and full-text search filters. Keep existing journal and task views, record colors and storage unchanged.

## 5.0.1-dev.36

- Add Quick capture to the top bar: create a task, journal entry, note or project without switching pages. Existing direct creation actions remain one click away; Alt+N opens the chooser outside editors.
- Offer daily reflection, weekly review and meeting/event outlines in empty new journal entries. Keep chosen titles, task links and content; weekly reviews extend a date-only single-day range to seven days.
- Put writing directly below the title for new notes and projects, keep importance at the top, and collapse optional organization fields. Render the related-record checklist only when expanded.
- Reuse existing editors, draft recovery and per-space storage. Choosing a creation action requests no map or attachment files and introduces no dependency or schema migration.

## 5.0.1-dev.35

- Move Undo and Redo from ordinary pages into a dedicated Restore recent changes section in Settings. Global history shortcuts no longer perform edits outside this section; native text undo remains available.
- Load history descriptions in pages of 40 only when the section opens. Preserve existing history; record timestamps and changed properties for new entries without downloading attachment contents.
- Confirm every undo or redo with the selected change and the exact number of affected steps. Older selections include newer applied changes, and undone ranges can be restored in order.
- Apply a selected range in one recoverable transaction, with revision and external-edit checks before any writes. Protect unsaved settings and retain the existing per-space history boundaries and limits.
- Ignore pending calendar resize notifications after the calendar has been removed during a settings refresh.

## 5.0.1-dev.34

- Prioritize task titles on the timeline and remove list numbers from task bars.
- Reveal importance only when all five stars fit beside a readable title. Adapt immediately to zooming, panning and resizing without clipping the rating control.
- Show checkpoint counters only on wide task bars with checkpoints, keeping narrow bars focused on the title and retaining checkpoint markers.

## 5.0.1-dev.33

- Render dropdown menus in the Atlas theme on desktop and mobile, with touch targets, keyboard navigation, and search in long lists. Space switching uses the same menu above the sidebar and dialogs.
- Add task calendar views for day, week, month, and year, reusing the journal calendar. Show undated tasks separately; clicking a date prefills a new task. Tasks with one endpoint appear on that date, while ranged tasks span both endpoints.
- Save the default task layout and calendar period independently for each atlas space, including across restarts and settings backups.
- Create and select a project without leaving a task draft. Save a task and open a linked journal draft, carrying its project, title, tags, and importance without copying attachments or changing completion state.

## 5.0.1-dev.32

- Move the space picker, space management actions and cat toggle to the top of the sidebar, with aligned controls on desktop and in the mobile menu.
- Fit the application to the available viewport. Keep the main navigation stationary and scroll task, journal, library, tool and backup contents within their own workspace instead of scrolling the entire page.
- Keep space-management dialogs outside the sidebar so they remain usable at every screen size. Show record details as the active workspace pane on narrow screens.

## 5.0.1-dev.31

- Simplify the task workspace to a compact search/view/action row and timeline navigation. Keep one New task action and move summary counts below the tasks.
- Group area, importance, project, status and board sorting controls in a collapsed Filters panel, with an active-filter count and Clear filters action.
- Move timeline gestures and the urgency legend into on-demand Help. Adapt controls to narrow screens without horizontal overflow.

## 5.0.1-dev.30

- Draw the collar behind the head and paws so it cannot cover the face while the cat sleeps or grooms.

## 5.0.1-dev.29

- Let the cat gently follow nearby pointers with its eyes, respecting its facing direction and reduced-motion preference.
- Release the cursor game when typing, clicking, dragging or leaving the window, with a cooldown that keeps editing comfortable.
- Preserve occupied perches when controls split an edge into several free intervals. Walk smoothly to available space when a panel narrows.
- Coalesce pointer updates into animation frames and keep the companion entirely local without extra downloads or services.
- Safely discard pending animation callbacks when the companion is turned off.

## 5.0.1-dev.28

- Add persistent per-space cat animation modes: Full animation (default), Follow system motion preference and Still companion. Report paused animation accurately in the top bar.
- Prevent global reduced-motion styles from disabling an explicitly selected full-animation mode, including in embedded add-on views.
- Track scroll and resize on animation frames instead of waiting for scrolling to stop. Carry the cat with its edge without restarting walks, jumps or naps.
- Keep the companion visible above the settings dialog without intercepting its controls.
- Verify legacy preference migration, validation, space isolation, restart persistence and backup restore.

## 5.0.1-dev.27

- Replace disappearing and resetting cat motion with continuous walking and curved jumps between visible panel edges. Approach newly opened dialogs and focused editors within three seconds.
- Add short walks, paw grooming, peeking over edges, longer naps, waking stretches and coordinated tail, head and paw animations.
- Let the cat stalk a nearby cursor, miss if it escapes, or cling and follow for three seconds before returning to an edge. The decoration never intercepts input.
- Preserve motion through scrolling, resizing and editing. Pause in hidden tabs, respect reduced motion, and use no network requests or additional dependencies.
- Add deterministic behavior tests covering movement continuity, dialog arrival, cursor play, reduced motion and layout changes.

## 5.0.1-dev.26

- Add independent atlas spaces with a persistent top selector, empty-space creation, renaming and a configurable default. Keep the original library in place as General.
- Give every space separate records, attachments, settings, search/index state, map arrangements, edit history and resumable transfer sessions. Keep space URLs stable across tabs and defaults.
- Keep backups and package imports scoped to the current space. Restore into a new empty space without replacing another atlas.
- Add an offline animated SVG cat that walks, peeks behind panel edges and rests. Include per-space controls, reduced-motion support and automatic retreat during typing or nearby pointer movement.
- Preserve existing General-space drafts and map layout preferences when opening the new space URL.

## 5.0.1-dev.25

- Protect pending local drafts from being overwritten by a new edit. Show the saved title and timestamp and require recovery or discard before editing or saving.
- Move task and journal validation to the correct tab and focus the title, date or checkpoint field that needs attention. Preserve all entered values.
- Label primary actions for their current page, focus new tasks on the title and distinguish an unsaved new task from a saved record.
- Load work-tool records with compact metadata for unrelated records, retaining full-text search for both global queries and saved views. Do not load map positions or unrelated Markdown bodies.
- Reuse complete task data already loaded by the workspace instead of requesting it again when opening a card.
- Preserve existing records, settings, storage formats and the stable channel.

## 5.0.1-dev.24

- Put journal writing first, with separate Entry, Organization, Attachments, Links and Places tabs, keyboard navigation, draft recovery and a specific Save entry action.
- Transfer only overview metadata for the map, library, inventory and settings; fetch complete records on demand and retain server-side full-text search. Keep the legacy full-record API compatible.
- Limit the library to 60 cards per page with visible counts and navigation.
- Keep healthy attachment downloads running beyond one minute by timing out inactivity instead of total duration. Show progress, download speed and remaining time.
- Prioritize text previews and allow selecting a queued file first, retrying a failed file and pausing automatic downloads with a browser-persisted data saver preference.
- Collapse optional journal area/importance filters, reserve space for calendar overflow controls and open a day list without losing the month context.
- Preserve stored records, attachments, settings, positions, backup formats and the stable channel.

## 5.0.1-dev.23

- Replace journal navigation with a month calendar by default, plus week, day and year views, date navigation and multi-day event bars.
- Open entries in a focused dialog and preserve the calendar date, filters and scroll position when it closes.
- Add optional local start/end times, all-day entries, overlap columns and creation from a calendar date or hour.
- Download managed attachments up to 10 MB each sequentially only for the open entry. Cancel unfinished downloads on close or entry change; keep larger files and web links manual.
- Reuse downloaded photo and PDF bytes in the integrated viewer, with photo navigation and cleanup on close.
- Avoid cloning unrelated record bodies when reading a single entry or attachment.
- Retain existing Markdown records, backups, experience flags, related tasks and English/Czech settings.

## 5.0.1-dev.22

- Load journal navigation metadata separately from record bodies and retrieve only the selected entry's complete text and attachment list.
- Load photos and document previews only after the user selects Download attachment preview; do not preload neighboring photo originals.
- Search journal bodies, places, tags and attachment labels on the server without downloading the full knowledge library.
- Preserve complete-record editing, revision checks, automatic Markdown updates, entry filters and English/Czech controls.
- Cancel obsolete entry, search and document requests and show localized loading, retry and timeout states.

## 5.0.1-dev.21

- Add a compact five-column task board, configurable project columns, card ordering and keyboard/touch move controls.
- Add a task dialog with Details, Attachments, Comments, Activity and Checkpoints tabs, Markdown formatting and integrated document previews.
- Persist revision-protected comments, recoverable deletions and independent activity events with undo/redo and interrupted-event recovery.
- Add checkbox-selected backups for tasks, journals, the knowledge map, inventory and other tools, including combined selections, managed files and discussion data.
- Merge selected backups with conflict previews, stable IDs, hierarchy references and preservation of unrelated records.
- Keep the timeline as the initial page and load the board, task dialog and map renderer on demand.

## 5.0.1-dev.20

- Open Tasks and timeline in timeline mode by default. Explicit section links remain supported.
- Load the knowledge map only after opening its section and pressing the central Download knowledge map button. Defer the map renderer, layout worker and saved coordinates until then.
- Start with complete task records and lightweight navigation metadata. Load full knowledge contents when opening record views or settings, and prevent incomplete navigation records from overwriting saved content.
- Load Markdown rendering and work tools on demand. Serve precompressed JavaScript and CSS with immutable caching for versioned assets.
- Keep automatic file indexing, live task updates, stored map arrangements and library data intact.

## 5.0.1-dev.19

- Remove the oversized topic legend below the map; use the topic filter and branch tree for navigation.
- Add persistent Undo and Redo controls with available-step counts, action descriptions and keyboard shortcuts. Retain up to 1,000 saved edits within a bounded compressed journal.
- Include record changes, importance, task checkpoints, list ordering, fixed positions, map moves/resets, settings, inventory movements, work-tool updates and saved attachment text edits.
- Preserve native text-editor undo and prevent stale history or external file changes from being silently overwritten. Recover interrupted history writes without copying unrelated attachments.

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
