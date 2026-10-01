# Markdown record format

One file describes one record. Its filename is `<id>.md`. Keep records directly in the library directory; express hierarchy with `parent`, not nested folders.

Work tools use the same record format with a validated `tool` extension. See [Work tools](docs/WORK-TOOLS.md) and the five additional files in `templates/` for manually editable examples. Tool records use `type: knowledge` and are counted separately from ordinary knowledge notes.

```yaml
---
schema: 2
id: example-note
title: Example note
type: knowledge
parent: null
status: draft
summary: A short searchable description.
color: "#a7e87b"
tags: [example]
related: []
resources: []
---
# Example note

Write your explanation here.
```

| Field                | Meaning                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `schema`             | Required format version: `2` for new records. Version `1` remains readable.                       |
| `id`                 | Stable unique ID: lowercase ASCII letters, digits, hyphens and underscores; up to 120 characters. |
| `title`              | Nonempty name, at most 180 characters.                                                            |
| `type`               | `category`, `project`, `knowledge`, `skill`, `code`, `item` or `task`.                            |
| `parent`             | An existing record ID or `null`. Cycles are rejected.                                             |
| `status`             | `draft`, `learning`, `active` or `done`. Display labels depend on record type and language.       |
| `summary`            | Short description, up to 2,000 characters. Quote YAML values containing `: `.                     |
| `color`              | Six-digit hexadecimal color including `#`.                                                        |
| `tags`               | Array of text tags.                                                                               |
| `related`            | Array of other existing record IDs; self-links are rejected.                                      |
| `resources`          | Array of file, web or place references, described below.                                          |
| `quantity`           | Optional positive integer for inventory records; defaults to one in the UI.                       |
| `projectId`          | Optional ID of an existing project, particularly useful for tasks.                                |
| `importance`         | Optional integer from `1` to `5` for projects, inventory items and tasks. Controls project/item bubble size and task importance stars. |
| `task`               | Optional task properties: `start`, `due`, `priority`, `assignee`.                                 |
| `created`, `updated` | Optional ISO timestamps. Managed by the web editor on save.                                       |

Text after the YAML header is the Markdown body. Additional metadata, such as provenance, is preserved. Hierarchy validation is iterative and has no fixed depth limit; practical rendering capacity depends on the device and library size.

## Importance

Set `importance: 1` through `importance: 5` in a project or inventory item's YAML header. Five stars at the top of the record details allow immediate updates without opening the editor; the editor also offers the same control. The numeric value is independent of the interface language. Use [the project template](templates/project.md) for a manually created record.

Tasks use the same top-level field. A numeric `importance` takes precedence over the legacy `task.priority`. If importance is missing or null, low, normal and high task priorities display as one, three and five stars; otherwise the default is three. Saving task importance in the UI also updates `task.priority` for compatibility: one/two stars map to `low`, three to `normal`, four/five to `high`. Task dates, duration, assignee and other metadata are preserved. See [the task template](templates/task.md).

At the same hierarchy level, one through five stars use 65%, 82%, 100%, 130% and 160% of the normal bubble radius. The hierarchy still determines the base size; other record types keep their existing sizing. Older records without this field retain their normal size (three stars) without a migration. Compatibility values `low`, `normal` and `high` are read as one, three and five stars; saving through the importance control or editor writes a number. Direct Markdown edits are picked up by automatic refresh, and the field is preserved in exports and full backups.

## Resources

```yaml
resources:
  - id: notebook-pdf
    label: Project notebook
    locationId: addon
    path: school/physics.pdf
  - id: reference-docs
    label: Documentation
    locationId: internet
    path: https://example.com/docs
```

Use a location ID from settings. IDs are machine identifiers and are never translated or renamed when switching interface language. Compatibility IDs for the built-in physical locations remain stable: `kolej` (Dormitory), `pokoj` (Room) and `dilna` (Workshop). Custom names are user data. Legacy resources may use `url` instead of `path`; missing location IDs fall back to `internet` for URLs and `pc` for other paths.

Schema 2 resources require unique stable `id` values within the record, using the same character rules as record IDs. Keep an attachment ID when changing its label or position. Give a new attachment a new ID. File access uses `api/nodes/<record-id>/resources/<resource-id>/file` relative to the app root. Text writes additionally require both the content revision and the target revision returned by the metadata endpoint.

Schema 1 resources receive deterministic IDs in read responses without rewriting their source files. Saving a record in the web editor writes schema 2. **Settings and locations → Preview schema upgrade** offers an explicit whole-library upgrade, backed by a complete ZIP and a preserved previous directory. Unknown metadata is preserved, and an already upgraded library is unchanged on a repeated run.

## Inventory placements

For new inventory records, use `stock` instead of assigning the same legacy `quantity` to multiple resource locations:

```yaml
stock:
  mode: stock
  placements:
    - id: workshop-box
      locationId: dilna
      detail: Top left drawer
      quantity: 3
    - id: dormitory-box
      locationId: kolej
      detail: Desk
      quantity: 2
```

Placement IDs are stable and unique within a record. Quantities are nonnegative integers; zero keeps a placement available as a future transfer/return destination. Locations must be physical places. `mode: unique` limits the sum of available and outstanding loan quantities to one. Legacy `quantity` is ignored when `stock` exists. Attachments stay in `resources` and do not multiply stock counts. Optional `loans` and `movements` are maintained by the movement API; manually changing them requires preserving quantities and operation IDs.

Location settings may contain `parentId` for physical places. The parent must also be physical, and cycles are invalid. Storage-root kinds do not inherit filesystem paths through this hierarchy.

## Task dates

```yaml
projectId: example-project
task:
  start: "2026-10-01"
  due: "2026-10-05"
  priority: normal
  assignee: Alex
```

Dates use `YYYY-MM-DD`; empty strings mean unspecified. A due date cannot precede the start date. Priority is `low`, `normal` or `high`. Date-only values remain date-only when changing languages. UI labels do not alter these field names or enum values.
