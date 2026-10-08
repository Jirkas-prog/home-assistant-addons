# Interaction design and bandwidth review

This review compares documented interaction patterns with Knowledge Atlas, rather than comparing marketing feature counts. The proposed choices below are product judgments. No third-party application source was copied or added as a dependency.

## Comparison by workflow

| Workflow | Reference and useful pattern | Knowledge Atlas decision |
| --- | --- | --- |
| Capture and organize a task | [Nextcloud Deck](https://github.com/nextcloud/deck/blob/main/docs/User_documentation_en.md) separates the board from card details, tags, deadlines and attachments. | Keep quick task creation and the existing five-tab card, including Checkpoints. Apply the same tab and dialog styling to journal editing. Avoid making classification mandatory before writing. |
| Find an entry in time | [Google Calendar search](https://support.google.com/calendar/answer/37176?hl=en) finds events beyond the currently visible period and opens their details. | Retain month as the default and day/week/year navigation. Keep full-text journal search independent of the visible month. Open overflowing day entries in a small list while retaining the month behind it. |
| Write and classify a note | [Obsidian properties](https://obsidian.md/help/properties) distinguishes structured metadata from note content. | Put journal title and writing area first. Move project, status, summary, tags, experience and next step to Organization; put files, record links and places in their own tabs. Existing Markdown fields remain unchanged. |
| Explore related knowledge | [Obsidian graph view](https://obsidian.md/help/plugins/graph) provides global and local graph exploration. | Keep the explicit map download gate, saved arrangements and multiple layouts. Fetch the selected record's text separately. A future local-neighborhood control should supplement existing topic filters without changing saved coordinates. |
| Find documents in a large library | [Paperless-ngx search](https://docs.paperless-ngx.com/usage/) and its [search index](https://docs.paperless-ngx.com/administration/) separate retrieval from viewing originals. | Search complete indexed Markdown on the server and return matching IDs. Send metadata to overview screens, then fetch only the opened record. Render 60 library cards per page to keep the document tree bounded. This does not add OCR or search inside PDF binaries. |
| View photos on a slow connection | [Immich's preview derivatives](https://docs.immich.app/FAQ/#why-are-there-so-many-thumbnail-generation-jobs) distinguish previews from originals. | This release retains original files and adds visible transfer progress, text-first sequencing, priority selection and a persistent data saver toggle. Server-generated thumbnails are a separate follow-up requiring cache limits and image decoder validation on supported add-on architectures. |
| Locate physical belongings | [HomeBox](https://github.com/sysadminsmedia/homebox) focuses on home inventory and organization. | Keep physical location, quantity and document attachments together. The immediate improvement is a metadata-only inventory overview. Next candidate: clearer location breadcrumbs and one action for moving quantities, retaining the stock movement history. |
| Back up selected data | [restic selection rules](https://restic.readthedocs.io/en/stable/040_backup.html) make backup scope explicit. | Retain the existing section checkboxes, merge preview and resumable transfers. Next candidate: compute bytes for the selected scope, distinguish referenced managed files from external paths and show that scope throughout export and import. |
| Use project tools | Deck's card details and Obsidian's content/properties separation provide consistent placement for secondary controls. | Keep specialized BOM, procedure and review-card editors. The tools workspace includes full tool records and compact metadata for unrelated records; saved-view full-text queries run against the server index. A shared shell must not hide tool-specific operations or download the map. |

## Implemented in 5.0.1-dev.24

1. **Write first:** open New journal entry, type a title and text, adjust dates if needed, and Save entry. Optional classification and links remain available in four other tabs. Drafts, revision conflicts, experience flags and task links continue to work.
2. **Navigate without losing context:** optional area and importance filters are collapsed behind Filters. Active filters remain indicated. Calendar overflow has its own reserved row and opens a day list; closing that list does not change the selected period.
3. **Keep overviews small:** map, library, inventory and settings receive metadata without Markdown bodies. A selected detail or Markdown reader loads one complete record. Partial records cannot overwrite a complete record. The legacy full-record API remains available.
4. **Keep search complete:** library, map and inventory searches run against the server's full indexed records, including text not downloaded by the browser. Cancellation discards obsolete searches. Record changes invalidate search results through the refreshed snapshot.
5. **Bound the library DOM:** filters and sorting operate across the complete overview, with 60 cards rendered per page. Changing a filter returns to the first page; opening and closing a detail keeps the current page.
6. **Explain transfers:** managed attachments of at most 10 MB download sequentially for the open entry. Text files go first. Each active transfer shows percentage to two decimal places, download speed and estimated remaining time. A healthy stream is not stopped merely because one minute elapsed; a 60-second idle period still fails visibly and leaves later files usable.
7. **Let the user control bandwidth:** pause automatic previews, resume them or select a queued file to prioritize it. Completed previews remain available while the entry is open. The automatic-preview preference is stored per browser. Closing an entry cancels its unfinished queue. This is not a new persistent resumable-original protocol; large backup transfers retain their existing separate resume mechanism.

## Data and compatibility

There is no record schema migration. Markdown, document roots, task details, map positions, IDs and backup formats retain their current meaning. Changes are confined to the Dev channel. No cloud service, external font, CDN or third-party account is required. Local offline use still requires the running add-on and a connection to it.

Overview profiles retain record metadata and attachment descriptors, but never attachment bytes. Their payload therefore still grows with record and attachment counts. Work tools retain their full-record profile in this release. Pagination bounds rendered cards; it is not server-side pagination of metadata. Existing conditional refreshes continue unchanged.

## Verification scenarios

- Open tasks first: no graph renderer or attachment originals should be requested.
- Open the journal month: no attachment bytes should be requested until an entry opens.
- Open an entry with an 8 MB photo on a 1 Mbit/s connection: the download must complete even when it takes longer than 60 seconds.
- Pause that queue, open a text attachment and resume: only the selected entry's files may transfer.
- Search for a word that occurs only in a knowledge body, open the result, edit and save: the complete original body must survive.
- Check library pagination, exact importance filters, sorting and manual Markdown updates together.
- Write a journal entry, switch tabs, link a task, mark it as an experience and save. Reopen it and verify all fields.
- Use a narrow viewport: calendar overflow controls must not cover event bars; editor tabs and close/save actions must stay reachable.
- Repeat the key actions in English and Czech. Switching language must not translate IDs, code or stored user content.

## Follow-up usability pass: 5.0.1-dev.25

- **Protect unfinished writing:** a pending local draft blocks editing and saving until it is recovered or discarded. Its title and saved time identify it; closing the editor keeps it. The same protection applies to record, task, tool, comment and text-document editors.
- **Make validation actionable:** task and journal errors select the relevant tab and focus the affected title, date or checkpoint control. Journal date, time, duration and coordinate errors explain how to correct the input. Field routing uses stable identifiers, independent of interface language.
- **Make primary actions predictable:** the task page says New task, inventory says New item, and journal says New journal entry. Tools use their own specific creation action; backup pages do not offer unrelated record creation. New tasks focus the title and show Not saved yet.
- **Reduce unnecessary data:** opening a complete task reuses its loaded record. Tools retain the metadata needed by materials, procedures and saved views, without unrelated Markdown bodies. Both global and saved-view full-text queries search the complete server index.

On a generic 1,563-record fixture, the tools workspace changed from 98,821,447 to 611,557 decoded bytes, and from 668,015 to 82,382 gzip bytes (about 88% less transferred data). This is a fixture measurement, not a guaranteed reduction for every library. Tool bodies are still included; a library made predominantly of large tool records will benefit less. Attachments and map positions are not part of this workspace payload.

Verification includes draft recovery after closing and reloading, disabled edits before a recovery choice, errors from inactive tabs, checkpoint completion text, English and Czech, full-text saved views, and a 1 Mbit/s connection. Storage formats, record IDs and existing content are unchanged.

## Next improvements, not included in this release

Prioritize measured costs: thumbnail derivatives and a bounded cache; selected-backup size estimates; project-local graph focus; adaptive idle polling; paged server metadata for substantially larger libraries. Each needs its own before/after measurement and failure-path checks. Adding an entire NAS stack or a second database solely to imitate its appearance would increase deployment cost without addressing the observed bottlenecks.


## Evidence-led capture iteration: 5.0.1-dev.36

Reviewed on 2026-10-08. Community comments below are individual experiences, not a representative survey or a claim that every user prefers these workflows. Product documentation verifies the interaction; Atlas implementation choices remain our judgment.

| Evidence | Useful principle | Applied in Atlas |
| --- | --- | --- |
| [Todoist users discussing favorite features](https://www.reddit.com/r/todoist/comments/1kgrbpg/) repeatedly mention quick entry and capturing metadata immediately. [Official Quick Add documentation](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz) describes task capture. | Capture an intention without first changing screens. | A compact top-bar chooser opens existing task, journal, note or project editors above the current page. Direct context-specific creation stays available. Alt+N opens the chooser outside editing controls and dialogs. No natural-language date parser is introduced. |
| A [Notion user describing review cycles](https://www.reddit.com/r/Notion/comments/ydpx88/) values daily entries and structured weekly reviews. [Notion database templates](https://www.notion.com/help/database-templates) reuse page structure and properties. | Reduce the effort of starting a repeated kind of writing. | Three optional outlines for empty new journal entries: daily reflection, weekly review and meeting/event. The selected date anchors the week; deliberate ranges and appointment times survive. These are built-in starters, not user-managed or scheduled templates. |
| [Obsidian Templates](https://obsidian.md/help/plugins/templates) inserts reusable text into the current note. | Keep the resulting content ordinary and editable. | Starter text becomes ordinary Markdown in the existing journal record, with its normal backup, draft recovery and task links. No template engine, cloud service or separate data store is added. |

### Iteration boundaries and checks

The browser pass exposed a second obstacle: the generic new-record form placed many properties above the writing area, and its native autofocus was lost when launched from another dialog. New notes and projects now put title and writing first, retain the top importance control, and collapse optional organization fields. Explicit focus runs after dialog handoff. The related-record checklist mounts only when expanded, avoiding thousands of hidden checkbox elements. Existing record and inventory workflows keep their property controls expanded.

- The chooser does not navigate to another workspace profile, load map positions or fetch attachment originals. Only normal editor code and subsequent save/refresh requests are needed.
- New records inherit the active space and current area, rather than silently becoming children of whichever unrelated record was last selected.
- Starting from a linked task retains that link and the chosen title. Applying an outline cannot replace a saved record or non-empty draft body.
- Weekly date arithmetic uses calendar dates, including year boundaries. Existing custom ranges and appointment times are preserved.
- Candidate follow-ups: user-defined reusable templates and project-scoped saved filters. Validate their demand and backup behavior separately instead of adding settings and hidden persistence preemptively.
