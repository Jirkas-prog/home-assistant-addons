# Task workspace

The initial page remains **Tasks and timeline**, with the continuous timeline selected. Choose **Board** for compact cards. Select a project to configure its columns; **All projects** groups tasks by the five default semantic columns. Tasks without a project remain visible.

The default columns are **Nice to have**, **Backlog**, **In progress**, **Stuck** and **Done**. Existing planned tasks appear in Backlog. Optional work is selected explicitly. Existing statuses remain `draft`, `active`, `learning` and `done`; the first two columns share `draft`. A missing custom column falls back to the current status instead of hiding the task.

Project columns live in its Markdown front matter as `board: { schema: 1, columns: [...] }`. Each column has a permanent `id`, a user-defined `name` and a semantic `status`. Renaming retains IDs. Keep at least one column for each status. Removing an occupied column or changing its status requires a destination for affected tasks. The board update and task moves form one undo step. Custom names are user content and are not translated.

Drag a card onto a column to change its status, or above another visible card to insert it before that card in the global record order. **Move or reorder** provides equivalent selects for keyboard and touch. Hidden records retain their global sequence. Fixed tasks retain their positions; unfix a task before reordering it. Columns scroll independently; the board scrolls horizontally.

## Task card

Titles on boards, timelines and record lists open the same card. Counters open the corresponding tab. Map selection retains its details panel; editing a selected task opens this card. Bubble double-click retains its configured document action.

- **Details:** title, project, column, tags, calendar dates, assignee text, summary and Markdown description. Formatting controls insert standard Markdown. Expand **Links, branch and list order** for related records, parent, date and fixed position controls.
- **Attachments:** existing locations, uploads, default document selection and integrated previews. Save new links before opening them. Removing a link keeps the file. Unsupported local formats retain the text/download fallback.
- **Comments:** dated Markdown comments, editing, recoverable deletion and restoration. Browser drafts survive closing the tab. Stale revisions are rejected; the latest comments reload while the draft remains available for review before saving again.
- **Activity:** successful changes, undo/redo events and external file changes detected while the server is observing the task. Detection timestamps describe discovery, not an inferred edit time or author. Events survive undo-stack trimming and are not automatically deleted. Earlier edits are not reconstructed.
- **Checkpoints:** existing dates, criteria and completion controls, retaining IDs and timestamps. Urgency considers hidden neighboring tasks. Completing a task with pending checkpoints requires confirmation and does not check them automatically.

Importance and physical locations remain above the tabs. Save commits the task draft across Details, Attachments and Checkpoints together; comments save independently. Closing a document returns to the same task tab. Closing the card preserves the originating view. Keyboard tab navigation, focus containment and narrow-screen layouts are supported.

## Storage and loading

Tasks retain their Markdown schema with optional `task.columnId`. Comments use `comments/<record-id>.json`, schema 1, with stable IDs, body, creation/update timestamps and a deleted flag. Limits: 20,000 characters per comment, 10,000 comments per record and a 32 MiB comments file. Deletion retains the content for restoration.

Activity uses `activity/<record-id>/<event-id>.json`, schema 1, with stable event ID, timestamp, source and changed-field names. It does not duplicate document contents. A durable undo-journal outbox replays interrupted event writes idempotently after the edit commits. Failed multi-file board operations roll back verified writes. Both data directories are included in full backups and relevant selected-section backups.

Startup excludes comments, activity and map coordinates. Board and dialog code load on demand. Comments/activity load on their tabs in pages of 50; the board fetches counts separately. File signatures cache parsed discussions. Attachments open only on request. No cloud account or online editor is required.

The interaction design is inspired by [Nextcloud Deck](https://github.com/nextcloud/deck). Atlas implements it within its existing React/Node application, without bundling Deck source or requiring its PHP/Vue server stack.
