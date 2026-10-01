# Work tools

Open **Work tools** in the navigation. A project also exposes **Project tools** from its record details. Use the five tool buttons and project selector to choose a workflow. Search and category filters narrow the list of tools; saved-view results use their own stored filters across the whole library.

Tools are ordinary `type: knowledge` records with an additional `tool` object. The record format remains schema 2; the tool object has its own `schema: 1`. Old records stay readable without rewriting them. Tool records appear in the library and map, are searchable, and use the same history, export and conflict protections. Statistics count tools separately from ordinary knowledge notes.

## Work journal

Create an entry with a title, optional project, local date, minutes spent, next action and Markdown notes. The summary cards show the journal entry count and recorded minutes in the current scope. Minutes are explicit user estimates, not a running timer.

## Bill of materials

Add one row per inventory item or leave a row unlinked for a material that is not in the inventory. Quantities are positive whole units. A specification may describe an acceptable alternative, but the application never substitutes another inventory item automatically.

Enable **Include this bill in material planning** to count its demand against other active bills. Completed bills stop contributing. The calculation for each item is:

`free = max(0, available inventory - other active planned bills)`

`missing = max(0, required - free)`

This is transparent material planning, not a physical reservation or consumption transaction. Overlapping plans can exceed stock; the UI shows that condition. Unlinked materials have zero known stock and appear in the shopping list. CSV exports only missing quantities and neutralizes spreadsheet formula prefixes.

## Procedures

Create and reorder the steps, then start a run. A run stores the source ID and revision, a full copy of the steps and the Markdown notes. Later changes to the source do not change existing runs. Each checkbox save checks the current record revision. Completing all steps marks the run completed; reopening a step returns it to in progress. The source procedure lists its run history.

Starts use stable operation IDs, so retrying a lost response does not create a duplicate run. A referenced source cannot be archived until incoming tool references are removed. Runs can be opened as ordinary records to add notes; the dedicated checklist keeps the captured steps intact.

## Practice

Create a card deck with questions, answers and optional source-record/page references. Reveal an answer before rating it. The deterministic schedule uses calendar dates:

- Again: review again today.
- Hard: at least one day, otherwise the previous interval multiplied by 1.2 and rounded up.
- Good: one day initially, otherwise the previous interval multiplied by 2.3 and rounded up.
- Easy: four days initially, otherwise the previous interval multiplied by 3 and rounded up.

Intervals are capped at 3,650 days. This is a simple review schedule, not a claim to implement a particular learning-science algorithm. Reviews keep stable card IDs and history; retried submissions cannot append the same review twice. Removing a card retains its historical review entries. Source pages are recorded as a human-readable reference; open the source record to access its attached documents.

## Saved views

Save any combination of record type, status, project, exact tag and search words. Computed rules include projects without an open task, overdue tasks and decks due for practice. Project membership follows an explicit project link or the parent hierarchy. A task due today is not overdue. Open pages update date-based results every 30 seconds and file-based results through the existing automatic snapshot refresh. Saved views do not include other saved views in their results.

## Manual authoring

Copy one of `templates/journal.md`, `bom.md`, `procedure.md`, `cards.md` or `view.md` into the library. Choose a unique ID, rename the file to exactly `<id>.md`, and edit the YAML metadata and Markdown body. Use existing IDs for project, inventory and source references. No import button, rebuild, AI or manual index refresh is required.

Collections have bounds: 500 rows/steps/cards per record and 5,000 reviews per deck, subject to the existing record-size limit. Archive or split long histories before reaching those bounds. Invalid files remain on disk and are reported in diagnostics; healthy files stay usable. Back up before broad manual changes.
