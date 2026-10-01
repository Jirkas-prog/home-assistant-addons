# Changelog

## 5.0.1-dev.1

- Publish the permanent Knowledge Atlas Dev channel with an identity that survives major version updates.
- Keep stable and development libraries independent.
- Display the product name and current package version without hard-coded major-version branding.
- Preserve all V5 backup and restore functionality and empty first installations.


## 5.0.0

- Start with an empty library; keep all personal data outside the distributed add-on.
- Add a dedicated Backup and restore page with live file counts and a verified restore preview.
- Preserve managed documents, settings, history, trash and empty folders in portable ZIP backups.
- Detect source additions, deletions and edits while exporting; verify every restored file with SHA-256.
- Read earlier backup archives and preserve the replaced library for rollback.
- Isolate browser drafts by library identity so a clean installation does not offer drafts from another library.

## 4.0.0

- Ask for English or Czech once on a fresh installation, with English preselected.
- Persist setup completion on the server; retain older libraries and language preferences without prompting after an update.
- Keep language changes available in settings and preserve user content and code identifiers.
- Protect language saves against conflicts and retain the selection when a save fails.

## 3.0.0

- Publish the name Knowledge Atlas V3 without the development label.
- Keep the existing V3 add-on identity and persistent library.

## 3.0.0-dev.1 — independent development version

- Add work journals with dates, time spent, next steps, project links and derived statistics.
- Add bills of materials with inventory links, explicit planned demand, shortage calculations and safe shopping CSV export.
- Add reusable procedures with idempotent run creation, immutable step snapshots and revision-checked completion.
- Add source-linked flashcards with reveal/rating flow, persistent review history and deterministic day-based schedules.
- Add saved filters for matching records, projects without open tasks, overdue tasks and decks due for practice.
- Keep tool records in regular Markdown; include structured tool content in search, validation, backups, history and automatic refresh.
- Add dedicated tool editors with draft recovery, conflict comparison and English/Czech translations.
- Preserve the V2 checkpoint separately and add version-specific Windows launchers.

## 2.0.0-dev.1 — development checkpoint

- Apply shared dark scrollbar styling to the page, timeline, lists, editors and dialogs, with native scrolling and system high-contrast colors preserved.
- Use functional section titles shared with navigation; replace promotional headings in pages, dialogs and empty states in English and Czech.
- Add streaming full-library backups with managed attachments, SHA-256 manifests, validated restore previews and preserved previous libraries.
- Add schema 2 with stable attachment IDs, shared validation and explicit backed-up, idempotent migration from schema 1.
- Bind text saves to both content revision and attachment target; recheck revisions before file replacement.
- Add unpublished browser drafts and explicit three-way conflict comparison for records and text attachments.
- Keep healthy records readable/editable beside invalid files; add diagnostics and revision-checked source repairs with history.
- Add failure tests for interrupted restore, failed directory replacement, full disks, stale writes, tampered archives and linked history directories.
- Preserve English defaults, matching application/add-on branding and paired Czech translations.
- Track the remaining approved V2 work in `docs/V2-PLAN.md`. This checkpoint is not the completed V2 release.
- Add physical-place hierarchies, subtree inventory filters and separate per-place quantities with matching CSV totals.
- Add backed-up replacement of used places and revision-checked, idempotent transfers, loans and partial returns.

## 1.2.0 — 2026-09-30

- Add Knowledge Atlas as an independent Home Assistant add-on in this repository.
- Make English the default for metadata, documentation, examples, logs and interface text.
- Add a persistent English/Czech interface preference with separate translation catalogs.
- Preserve record contents, IDs, code and paths when changing interface language.
- Include matching SVG app branding and PNG add-on icon/logo using the existing Network symbol.
- Ship a clean six-record sample library without personal records or local settings.
- Add localization, settings persistence, seed preservation and package checks.
- Preserve the existing Markdown library, 2D/3D maps, task board, timeline, inventory, PDF viewer and text editor.

## 1.1.0 — local predecessor

- Add configurable locations, attachment uploads, PDF and text viewers, inventory, tasks and a timeline.
- Derive search, counts and views from manually editable Markdown records with automatic refresh.

Earlier local versions were not published as this repository add-on.
