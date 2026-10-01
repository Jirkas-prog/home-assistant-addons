# V3 scope and status

V3 is an independent version. It starts from V2 commit `725fffe`, not from a completed implementation of every V2 roadmap item. The version is `3.0.0`.

The first implementation follows the five-tool core proposed on 2026-10-01. This scope was stated while a preference question about the larger proposal remained unanswered. Do not describe all sixteen proposals as implemented or approved for this release.

| Proposal | Status |
| --- | --- |
| V3-01 Study plans | Proposed for a later iteration. |
| V3-02 Flashcards and practice | Implemented: manually authored questions, source references, reveal/rating, history and review schedule. No AI dependency. |
| V3-03 Work journal | Implemented: project link, date, minutes, findings in Markdown, next step, search and derived counts. |
| V3-04 Experiments and measurements | Proposed for a later iteration. |
| V3-05 Project bills of materials | Implemented: inventory links, other active planned demand, shortages and shopping CSV. Planning does not consume or move physical stock. |
| V3-06 Reusable procedures | Implemented: editable steps, independent runs, snapshot preservation, completion and run history. |
| V3-07 Equipment maintenance | Proposed for a later iteration. |
| V3-08 Equipment sets | Proposed for a later iteration. |
| V3-09 Inventory audit mode | Proposed for a later iteration. |
| V3-10 Saved views | Implemented: editable filters, project scope, tags, search and computed rules. |
| V3-11 Knowledge freshness | Proposed for a later iteration. |
| V3-12 Automation rules | Proposed for a later iteration. |
| V3-13 Home Assistant entity links | Proposed; needs an actual HA environment. |
| V3-14 Offline mobile mode | Proposed; needs a separate cache, identity and synchronization design. |
| V3-15 Project reports | Proposed for a later iteration. Markdown and shopping CSV export are already available. |
| V3-16 Optional library assistant | Proposed; provider choice and explicit data scope remain undecided. |

## Release requirements

The five core tools must work through the UI and from manually authored files. Existing records, attachments and other add-ons must remain intact. English is the default; Czech only lives in the Czech catalog. Navigation and headings use functional names, and all scrollable surfaces share the application theme.

Automated acceptance covers revision conflicts, duplicate submissions, manual edits, date boundaries, inventory planning and broken references. Real Home Assistant installation, container startup and update/restore testing remain an inherited limitation until a suitable environment is available.
