# Knowledge Atlas Dev

<img src="logo.png" alt="Knowledge Atlas logo" width="128" />

A personal knowledge and project workspace for Home Assistant. Keep notes in ordinary Markdown files and explore their connections in a 2D or 3D map.

This is the **development channel**, version **5.0.1-dev.44**. The add-on name and identity are permanent; future major versions update this same add-on. New development versions are published here immediately, without changing the stable channel. See [Release channels](docs/RELEASE-CHANNELS.md).

- Independent atlas spaces with a top selector, empty-space creation, renaming and a saved default. Existing libraries remain in the General space.
- An optional offline cat companion that roams panel edges, peeks out and steps aside while typing.
- Five selectable themes in **Settings and locations > Appearance**: Original, Lime, Paper, Graphite and Tide. Preview locally before saving; each atlas space remembers its own appearance. Themes use local CSS and existing icons.
- Nested branches, cross-links, searchable records and live statistics.
- Open directly on the task timeline; load the knowledge map only through its central **Download knowledge map** button.
- Dated record cards, editable and fixed list positions with automatic renumbering, and date/importance sorting.
- Drag entire branches in 2D/3D, save their positions with the library, and reset each layout independently.
- Connect bubbles parent-first, detach branches into separate islands and follow hierarchy arrows in every map layout.
- Persistent history in **Settings and locations > Restore recent changes**, with dated descriptions and confirmed Undo/Redo for saved edits, ratings, ordering and map arrangements.
- Full breadcrumb paths wrap onto multiple lines.
- Six retained map layouts in 2D and 3D, cached geometry and readable labels with progressive detail.
- Combined topic, type and multi-value importance filters.
- Projects, configurable task boards and a timeline with start and due dates.
- Five-tab task cards: details, attachments, comments, activity and checkpoints.
- Full backups or checkbox-selected sections with a merge preview, managed attachments and discussion history.
- Five-star importance controls on records and timeline tasks; narrow timeline bars prioritize the title and reveal the whole rating only when it fits. Importance influences bubble sizes.
- A resizable details panel with a remembered width and keyboard controls.
- Work journals, inventory-linked bills of materials and shopping lists.
- A dedicated notebook journal with day/week/month contents, date ranges, experience markers, linked tasks, photo galleries, EXIF suggestions and offline places.
- Multiple journal attachments, Office text previews and an explicit open-as-text fallback for local files.
- Lightweight journal navigation with server-side text search and attachment previews downloaded only on request.
- Reusable procedures with independent, persistent checklist runs.
- Source-linked flashcards, review history and deterministic review schedules.
- Saved views that automatically recompute from manually edited Markdown.
- Inventory with quantities, location filters and CSV export.
- Configurable physical places, devices and server document roots.
- Integrated Markdown, PDF, text and media previews, UTF-8 editing and file uploads.
- Configurable document opening by bubble double-click, with the map view preserved.
- Compact timeline lanes, open-ended tasks, status filters and smooth Ctrl-wheel/pinch zoom.
- Dated checkpoints with completion criteria, quick checkboxes and deadline-based urgency colors.
- Complete managed-file backups, verified restore previews and reversible schema upgrades.
- Stable attachment IDs, browser drafts, concurrent-edit comparison and source repair tools.
- English by default, with a persistent English/Czech switch in **Settings and locations**.
- Home Assistant Ingress access and persistent storage under `/config`.

## Choose an appearance

Open **Settings and locations > Appearance** and select a preview card. Original retains the earlier dark interface; Lime keeps the illuminated green design. Paper pairs warm ivory with olive details and editorial headings. Graphite uses slate surfaces, lavender accents and tighter corners. Tide combines light blue, teal actions and rounded surfaces.

The entire interface previews immediately. **Save settings** stores the choice for this atlas space and its other windows. **Cancel**, Escape or the close button restores the saved appearance; a theme-only preview needs no extra confirmation. Other unsaved settings still require discard confirmation. Theme changes appear in the existing settings history and full backups. Importing a partial record package does not replace the destination space's appearance.

Maps use the selected canvas and label colors without changing coordinates or requesting a rebuild. Record colors and urgency meanings remain unchanged. Everything works offline, with no theme images, web fonts or dependencies added. See [Appearance design](docs/APPEARANCE.md) for the palette rationale and inspiration.

## Arrange the knowledge map

Search and 2D/3D switching remain on the compact map toolbar. Open **Filters and layout** for area, record type, importance and layout choices. Active filters appear as removable chips beside the result count; **Clear filters** restores the complete map, including from an empty result. Closing options leaves the current map view in place.

Open the map and choose **Connect**. Click the parent bubble first, then the child: its previous parent is replaced and all descendants stay attached. The branch keeps its coordinates; parent bubbles are larger and arrows point toward children. Each record has one hierarchical parent; other record relationships remain separate cross-links.

Choose **Disconnect**, then click a hierarchy line or child bubble to turn that whole branch into a separate island. No record is deleted. To insert an existing bubble between two others, connect the new intermediate bubble under the parent, then connect the child under it. Cycles are rejected.

Close the mode with its X button or Escape to drag branches again. Escape first clears a selected parent. Positions are saved per layout and dimension and survive rebuilds; **Reset view** restores computed positions without undoing the hierarchy. **Settings and locations > Restore recent changes** can undo a hierarchy edit and its saved arrangement together, after confirmation.

## First launch

New installations start empty. Open **Backup and restore** to export all saved library data or import a verified ZIP. Personal backup archives are separate from the add-on source and packages. See [Backup and restore](docs/BACKUP-RESTORE.md) for the exact contents, import steps and recovery behavior.

A fresh installation starts in English and asks you to choose **English** or **Czech**. Confirm once to store the choice on the server. An existing library keeps its current language without a new prompt after an update. You can change it later in **Settings and locations**.

## Install

For local development, run `npm ci`, `npm run build` and `npm start`. On Windows, `Start.ps1` checks the library identity before starting; use `-Port 8102` to run another version alongside the default port 8099. `Stop.ps1` only stops the process owned by that version. Each checkout uses its own `data` directory unless `DATA_DIR` is explicitly set.

The permanent slug is `knowledge_atlas_dev`. It uses a separate add-on configuration volume and an independent library. Installing Dev does not transfer or alter stable data. Real Supervisor installation and container startup are still unverified in this environment.

Install **Knowledge Atlas Dev** from the repository:

1. In Home Assistant, open **Settings → Apps → App store** (called **Add-ons** in older versions).
2. Open **Repositories** and add `https://github.com/Jirkas-prog/home-assistant-addons`.
3. Refresh the store, select **Knowledge Atlas Dev**, install and start it.
4. Select **Open web UI**. Use the settings page to configure the language, document root and locations.

For a manual installation, copy this directory to `/addons/knowledge_atlas_dev`, then reload the local app store.

Home Assistant builds the image locally from the Dockerfile. Supported architectures are `amd64` and `aarch64`. See [Validation](docs/VERIFICATION.md) for tested environments and remaining limits.

Fresh installations start with an empty library. Existing libraries are preserved. No personal library or machine-specific settings are included in this repository.

See [DOCS.md](DOCS.md) for operation and backups, [FORMAT.md](FORMAT.md) for manual records, and [CHANGELOG.md](CHANGELOG.md) for releases.

### Quick capture and journal outlines

Use **Add** in the top bar, or the arrow beside the existing creation button, to start a task, journal entry, note or project from the current page. Press **Alt+N** outside text fields and dialogs to open the same chooser. Settings must be saved or closed first. New records belong to the active atlas space and current area, if filtered; choose a project in the editor when needed. New notes and projects put writing below the title, with optional fields under **Organization and details**. Importance remains at the top.

A blank new journal entry offers **Daily reflection**, **Weekly review** and **Meeting / event** outlines. These are editable Markdown starters, not automatic or recurring entries. A weekly review spans seven days from the selected date, unless a custom range or appointment time has already been chosen. Existing writing and saved records are never replaced; title, task links and other properties stay intact. The usual draft recovery and Save entry action apply.

### Combined calendar

Open **Combined calendar** in the sidebar to see tasks in blue and journal entries in purple. Both have a source icon, and either type can be hidden with its checkbox. Month opens by default; Day, Week and Year are available in the same view picker. Year cells show dots in both source colors. Existing record colors are preserved.

Click an entry to open its original detail, then close it to return to the same calendar period. Use **Add** above the calendar or a date/time slot to choose between a task and journal entry with the date prefilled. Tasks remain date-only; journals can retain an appointment time. Undated tasks stay in the collapsible list below the grid. The Filters button exposes area, importance and project selection; search also checks unloaded record text.

The combined overview downloads lightweight, cached metadata only. Opening a record fetches that record, and automatic attachment previews follow the existing limit of 10 MB per file for the open journal entry only. No map, attachment contents or full library bodies are fetched just to browse dates. The view belongs to the current atlas space.

### Task planning and journal handoff

Switch tasks between Board, Timeline, and Calendar. The calendar uses the journal's day, week, month, and year navigation. A task with a start and due date spans that inclusive range; with only one date it appears on that date. Undated tasks remain accessible under **No date**. Timeline open-ended ranges are unchanged. Click a calendar date to prefill a new task.

Choose **Set as default** below the view to remember that layout (and the calendar period) for this atlas space. The preference lives in its settings and settings backups. Other spaces keep their own defaults.

In a task card, **New project** creates and selects a project while preserving the task draft. **Write in journal**, or **Save and write in journal**, opens an editable journal draft for today, linked to that task and project. It reuses the title, tags, and importance. Saving the journal does not complete the task. Attachments are neither copied nor fetched by this action.

Dropdowns use an application menu on desktop and mobile. Long lists include search; arrows, Home/End, Enter, Escape and Tab work without the operating system's picker. Space switching remains within the add-on, including Home Assistant Ingress.

### Restoring recent changes

Open **Settings and locations**, then expand **Restore recent changes**. The list is loaded only on demand, 40 descriptions at a time. New entries show their time, affected record and changed properties; older entries remain available even if their original timestamp was not recorded.

Each action asks for confirmation. Selecting an older applied entry undoes that entry and every newer applied entry together; the confirmation states the exact count. An undone entry restores the necessary steps in their original order. A new saved edit discards the redo branch. Save or discard unsaved settings before restoring history. Global Ctrl+Z no longer changes the atlas; text fields retain their native undo.

The history is separate for each space and survives restarts. It retains up to 1,000 steps within a 256 MiB compressed storage budget. Full library replacement starts a new history boundary. Revision conflicts or externally edited target files prevent a restore from overwriting newer data.

## Cat personalities

Open **Settings and locations → Pet settings**. Choose a personality and save.
The original **Explorer** is the default for new and existing spaces; its walking,
grooming, sleeping and three-second cursor game remain unchanged. **Quiet companion**
prefers long rests and never chases the pointer. **Curious researcher** investigates
new windows and attachments. **Playful acrobat** favors tabs, hops and paw taps.
Animation controls apply independently: Full animation, Follow system or No animation.
Preferences are stored per atlas space, included in settings backups and described
in recent-change history. See [the behavior guide](docs/CAT-PERSONALITIES.md).
