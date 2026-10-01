# Knowledge Atlas documentation

## First start

Start the add-on and open its web interface through Home Assistant. Ingress handles authentication. The service accepts Ingress connections from the Supervisor gateway only; no host port is exposed.

A fresh V5 installation starts with an empty library. Use Backup and restore to import a complete backup, or create your first record. Generic English examples are available only through the optional local `npm run seed` command. An existing library containing Markdown records is never replaced or reseeded. The `.initialized` file prevents deleted examples from returning after a restart.

## Language

On the first launch of an empty installation, choose English (preselected) or Czech, then continue. The choice is saved on the server and survives restarts, browser changes and updates. If setup is interrupted before saving, it is offered again. Existing settings, older initialization markers and manually populated libraries skip this one-time screen and retain their saved language, defaulting to English if no language was stored.

Open **Settings and locations**, choose **English** or **Czech** under **Interface language**, and click **Save settings**. English is the default, including for older settings without a language field. The choice is stored in `/config/knowledge/settings.json` and is shared by all browser sessions. Other open sessions receive it on the next automatic refresh.

Only interface labels, date formats and known displayed errors are translated. Record text, code, filenames, field names, IDs and custom location names remain unchanged. The server API, operational logs, documentation and bundled examples use English. The entire Czech catalog is in `shared/locales/cs.json`.

## Library and automatic updates

Each top-level `.md` file in `/config/knowledge` describes one record. See [FORMAT.md](FORMAT.md) and [templates](templates/README.md). Edit files externally or use the web editor. A visible browser checks for changes about every three seconds and refreshes after returning to the window. Search, counters, maps, inventory and task views are derived from the current records; no rebuild or AI is needed.

Invalid files appear in the error banner. Healthy records remain editable as long as a change does not introduce additional graph errors. An invalid source is never overwritten by creating a record with the same filename. Open **Settings and locations → Diagnostics → Repair file** to edit and validate the source; the original remains in `.history/repairs`. Invalid settings leave the record snapshot readable so this repair path stays available. Archiving and settings changes remain restricted while record errors could hide incoming references.

File history is kept under `.history` and archived records under `.trash`. A record with children, incoming links or assigned tasks must have those references resolved before archival. Record and UTF-8 editors keep unpublished drafts in this browser's local storage, separate from saved records. Reopen the editor to recover a draft. Clearing site data removes those drafts; another browser does not receive them. A failed browser draft write is explicitly reported.

Concurrent saves reject stale content. The editor can compare the original, your draft and the latest saved version. Independent metadata changes are merged; overlapping fields require a choice before another save. Attachment writes also bind the attachment ID, settings revision and target file identity. Reordering references cannot redirect an open editor. The server rechecks file revisions immediately before replacement. External programs do not participate in its write queue, so an OS-wide atomic compare-and-swap guarantee is not claimed.

## Navigation and maps

Click a level in the page or record path to open it. Right-click that level, select its dropdown arrow or press **Arrow Down** / **Shift+F10** to open sibling branches or workspace sections. Use the arrow keys, **Home**, **End** and **Enter** to choose a destination; **Escape** closes the menu. Paths and sibling choices update automatically when records change.

Every visible map bubble can open its record regardless of the currently selected hierarchy level. Click the bubble or its visible label. Small bubbles retain a larger click target, and visible bubbles take priority over overlapping labels and padded targets. Area and search filters determine which records appear in the map.

Set **Importance** by clicking one of the five stars at the top of a project or inventory item's details. The change saves immediately and resizes its bubble in both 2D and 3D. Three stars keep the normal size; hierarchy still determines the base size. Use the arrow keys to change the focused rating, or **Home** / **End** for one / five stars. The editor offers the same control. The value is saved in Markdown; manual changes to `importance` are applied by automatic refresh. Older records default to three stars without a migration.

Use the mouse wheel to zoom in either map. Wheel sensitivity is increased by 25%; in 2D, the point under the cursor stays in place. Drag to pan in 2D or rotate in 3D. **Fit entire map** resets the view to the visible records.

Drag the left edge of the record details panel to change its width. The preference is saved in this browser for each release channel and survives reloads. Double-click the handle to restore the default width. With the handle focused, use **Left** / **Right** to resize, **Shift** for larger steps, or **Home** / **End** for the minimum / maximum width. The main view keeps usable space; on narrow screens the panel remains below it.

## Files and locations

The default document root is `/config/documents`. An attachment with location **Add-on** and path `school/physics.pdf` resolves to `/config/documents/school/physics.pdf`.

Use the **+** action in the location selector to manage locations. The available kinds are:

| Kind           | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Add-on files   | Files relative to the configured document root.                                 |
| Server files   | Files below another mapped root, initially `/share`.                            |
| Other device   | An informational path on a PC, laptop or phone.                                 |
| Web link       | An HTTP(S) link; remote PDF previews depend on the remote server's CORS policy. |
| Physical place | A description such as `Top left drawer`.                                        |

Device paths are informational in Home Assistant: installing the add-on does not mount your PC or phone. A standalone Windows server can additionally open local PC directories. Changing the document root changes path resolution; it does not move files. Renaming a location preserves its ID. Referenced locations cannot be removed until their references are reassigned.

The `/config` mapping corresponds to the add-on's directory under `/addon_configs/<repository-id>_knowledge_atlas_dev` on the host. Each channel has its own configuration directory and library. `/share` is also mapped with write capability, but its location is read-only in the app by default. Enable writes deliberately in location settings when needed. Do not expose this app directly on the internet outside authenticated Ingress.

Uploads accept files up to 50 MB and never overwrite an existing filename. The upload saves the file immediately; saving the record attaches its link. A cancelled record may therefore leave an unattached file. Text editing supports UTF-8 files up to 2 MB and saves a previous version in a `.history` folder beside the edited file. PDFs support pages, zoom, passwords and copying available page text. Scanned PDFs do not gain OCR automatically.

## Projects, tasks and inventory

Create a **Project**, then use **Add project task**. A task can reference a project with `projectId`, independently of its tree parent. The board has four fixed statuses: To plan, In progress, Waiting and Done. Drag a card or use its status selector. A start or due date adds the task to the timeline; click a timeline bar to edit it. Task dependencies, custom columns and recurring tasks are not implemented in this release.

Every task on the timeline has five clickable importance stars below its time bar, including short, single-day tasks. Unscheduled tasks have the same control. A click saves immediately; the task editor and details show the same rating. Stars do not alter dates, durations or completion status. Existing low, normal and high task priorities appear as one, three and five stars until a numeric importance is saved. The board's priority label reflects the rating: one or two stars are Low, three are Normal, and four or five are High.

Inventory supports explicit storage placements separate from attachments. In an item editor, choose **Set storage distribution**, specify physical places and their quantities, and save. A place can belong to another physical place (for example Workshop / Cabinet / Top drawer). Filtering a place includes its descendants; displayed quantities and CSV count only matching placements. A stock of three units in a workshop and two in a dormitory has five available units overall, but the workshop filter exports three.

Legacy `quantity` and resource references remain readable. Their distribution is not guessed: conversion starts with a quantity to assign explicitly, and existing references remain preserved. **One unique item** restricts available plus loaned stock to one. Counts of item records, available units and outstanding loans are distinct; note counts do not imply skill mastery.

Use **Moves and loans** in an item's detail to transfer units between configured placements, lend units to a named borrower/description, or return part or all of an outstanding loan. The server saves each movement and its quantity changes together, checks revisions and rejects negative balances. Repeating the same operation ID does not repeat the movement. Borrower data is descriptive; no messages or external services are contacted. The detail shows the 20 latest movements; full history remains in Markdown and backups. Project allocation and a complete history browsing/export interface remain roadmap work.

Settings can rename places, assign parents or move all references to a replacement physical place before removing the source. Replacing a used place preserves child places, quantities and attachment IDs, and runs as a backed-up whole-library transaction. Direct deletion of used places and cyclic hierarchies are rejected.

## Backups and updates

V5 provides a dedicated **Backup and restore** page. See [the full backup guide](docs/BACKUP-RESTORE.md). New archives include empty directories and use manifest version 2; version 1 archives remain readable. Export verifies the final file inventory as well as each file's streamed content.

**Download full backup** includes the record directory, settings, managed document root (including unattached files), history and trash, with a SHA-256 manifest. Files stream through the ZIP writer; complete PDFs or ZIPs are not buffered in RAM. `api/export?history=0` omits history. The current limits are 20 GiB of source/extracted data, 20 GiB of upload data and fewer than 50,000 files. Symbolic links, special files and a document root containing the library directory are rejected. Pause external file edits while backing up; a file changing during archive creation aborts the download.

External devices, web URLs and additional server roots such as `/share` are references, not included files. Back those roots up separately. Home Assistant backups remain important; the add-on uses cold backup mode. Real Supervisor backup and restore have not been verified in this environment.

**Preview and restore backup** streams an uploaded ZIP into an isolated staging directory, rejects unsafe or duplicate paths, verifies each checksum and validates records and settings. The preview reports counts, collisions and the new managed-document path. Confirming replaces the active library as a whole; it does not merge libraries. The previous directory is preserved, and external document roots are untouched. Managed files move to `.restored-documents` inside the new library, with settings updated accordingly. External location paths must be checked on the destination machine.

Changes to current files after the preview invalidate it. A failed final replacement restores the original directory; startup can recover an interrupted directory swap before initializing a fresh library. These safeguards have process/fault-injection tests, not physical power-loss certification. Preview tokens expire after 24 hours. Use **Discard preview** to remove staged uploads. Preserved libraries and successful operation files are retained in the sibling `.<library-name>-operations` directory; their location appears in diagnostics. Keep enough free disk space for the upload, extracted library and preserved original. Cleanup of preserved libraries is a deliberate manual storage operation.

Full-library restore requires a supported backup manifest with file checksums. Record-only ZIP files cannot be restored through this workflow. Language changes leave record contents unchanged. See [Validation](docs/VERIFICATION.md) for tested behavior and limits.

## Local development

Requires Node.js 22.13 or newer; the container uses Node.js 24.15.0.

```sh
npm ci
npm run icons
npm run check:languages
npm test
npm run build
npm run check:addon
npm start
```

Open `http://127.0.0.1:8099`. Local records and settings are stored in `data`, which is ignored by Git. `DATA_DIR`, `DOCUMENT_ROOT`, `HOST` and `PORT` can override paths and binding. For Vite development, run the server and `npm run dev` in separate terminals; the default proxy targets port 8099. Production uses relative asset and API URLs to support Ingress prefixes.

The app does not require Nextcloud, an AI service, a paid account or external synchronization. See [THIRD_PARTY.md](THIRD_PARTY.md) for the icon attribution.
