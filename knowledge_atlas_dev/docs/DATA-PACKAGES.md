# Incremental data packages

## Selected-backup extension

The app's checkbox-selected exports use package manifest version **2**. Version 1 packages remain supported by the importer and the existing record/document package creation script. Older importers reject version 2 instead of silently losing discussion data.

Version 2 also permits `library/comments/<record-id>.json`, `library/activity/<record-id>/<event-id>.json` and `library/selection.json`. Discussion schemas are described in [Task workspace](TASK-WORKSPACE.md). Sidecars must reference packaged record IDs. The selection file uses schema 1 and contains `parts`, `contexts` (reference-only record IDs), relevant `locations`, `order` entries (`id`, `position`, `fixed`) and optional `map` positions by layout slot. These are validated before writes; arbitrary metadata filenames remain rejected.

The selected-backup merge adds missing location definitions without replacing existing ones, preserves existing global order, and adds missing saved positions for accepted records. Existing map arrangements win, including on reimport. Comment and event files participate in conflict preview, checksum validation, stale-preview detection, atomic installation and recovery rollback. Stable event IDs cannot be replaced by different content. Reimporting the same package is idempotent. Settings unrelated to these additions retain their destination values.

Use **Backup and restore > Import data package** to add branches, projects, knowledge, journal entries, tasks or inventory records with their managed attachments. A package contains only the records and files being delivered. The existing library does not need to be uploaded, replaced or copied as a whole.

## Import workflow

1. Select the package ZIP with **Import data package**. Progress, speed, estimated time, pause/cancel and continuation after closing the page work like full backup uploads. The saved transfer remembers its package import mode.
2. Review new, identical and conflicting records. Expand a record to compare incoming content and metadata with the current version. Long previews are limited to 12,000 characters.
3. Optionally choose a destination for new top-level branches. This choice does not move existing records. Internal parent, project, related-record and work-tool links retain their IDs.
4. For each conflicting ID, keep the current record (the default) or explicitly use the incoming version. Replacement applies to the entire record, including attachments and task/tool metadata; arbitrary paragraphs and checkpoint lists are not combined automatically. The previous record is saved in history.
5. Confirm the choices and select **Merge data package**. The operation continues on the server if the page is closed. Records immediately participate in the map, search, statistics and the next full backup.

Matching uses permanent record IDs, not titles. Identical records are skipped. Reimporting the same package reuses unchanged imported documents and does not create duplicate records. A new package can update the same IDs after review. Missing references must be satisfied by the package or the current library. Choices that break the resulting graph are rejected. If the library changes after preview, select **Refresh package preview** without uploading the ZIP again.

Documents go under `imports/<package-content-hash>/<original-path>` in the existing document root. Attachment paths in record metadata are rewritten. Existing files at other paths are never overwritten. All packaged documents are retained, including unlinked files. Reimport refuses to replace previously imported documents that were edited locally; update the package contents to deliver a new version. Markdown prose and code remain verbatim, so arbitrary inline paths are not rewritten. Use structured attachments for portable document links.

Settings, language, library identity, locations, history and unrelated records remain in place. The package's special `addon` location ID maps to the receiving Add-on location. In version 1 packages, other location IDs must already exist; create them in Settings before import. Version 2 selected exports include the required location definitions. Device, physical-place and web references remain references. Full backup ZIPs use **Preview and restore backup** and retain their complete-replacement behavior.

## Create a package outside the add-on

Prepare standard Markdown records and only the required attachments:

```text
school-input/
  library/
    school.md
    physics-notes.md
  documents/
    school/
      notebook.pdf
```

The `library` folder contains `<record-id>.md` files with the normal YAML front matter and Markdown schema. Do not include settings, caches or history. Records can refer to existing destination IDs absent from the package. Each Add-on attachment must be included under `documents` with its original relative path. For example, attachment metadata can contain:

```yaml
resources:
  - id: notebook
    label: Physics notebook
    locationId: addon
    path: school/notebook.pdf
previewResourceId: notebook
```

From the add-on source directory, with its npm dependencies installed:

```sh
node scripts/create-package.js /path/to/school-input /path/to/school-package.zip "School notebooks"
```

The output must be outside the input directory and must not already exist. This offline tool streams files into ZIP, calculates checksums and rejects links, unexpected record filenames and oversized input. Keep input files idle during creation. It prints record/document counts and input size when complete. No data is sent to a network service.

## Version 1 ZIP format for other applications

ZIP entries use UTF-8 relative paths with forward slashes. The root contains `manifest.json`, `library/` and `documents/`. The manifest has these fields:

| Field | Value |
| --- | --- |
| `format` | `knowledge-atlas-package` |
| `version` | `1` |
| `title` | Optional display title, at most 180 characters |
| `created` | ISO 8601 timestamp |
| `directories` | Every explicit ZIP directory, without its trailing slash |
| `files` | Every file except the manifest: objects containing `path`, integer `bytes` and lowercase hexadecimal `sha256` |

Every file must be listed exactly once. Sizes and SHA-256 checksums are verified before preview and again before applying changes. Links, traversal, ambiguous paths, hidden directories, duplicate names and settings files are rejected. Limits are 20 GiB of uploaded ZIP data, 20 GiB of expanded content, fewer than 50,000 entries, 8 MB for the manifest and approximately 1 MB per Markdown record. Represent meaningful folders as category records; empty document directories do not create knowledge records.

## Storage and recovery

The server journals only affected record/document writes and preserves previous versions of replaced records. It does not duplicate the rest of the library. Allow space for the ZIP, extraction, destination copies and recovery metadata. Atomic new-file installation requires hard-link support on the destination filesystem, such as local ext4 or NTFS; unsupported storage fails without replacing existing content.

Application writes are serialized and application reads wait for a merge to finish. Keep external filesystem editors idle during import. A failure rolls back applied writes. Startup recovers a process interrupted during commit before serving the library. If an external editor changed a recovery target, the app preserves the journal and refuses to overwrite unexpected content; retain the operations directory for manual recovery. This is process-recovery protection, not physical power-loss certification. Personal packages remain separate from add-on source and distribution files.
