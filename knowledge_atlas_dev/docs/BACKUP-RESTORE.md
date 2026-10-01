# Backup and restore

Open **Backup and restore** in the sidebar. The file counts come from the current library and managed document root. Use **Refresh file counts** after external edits.

## Export

Select **Download full backup**. The ZIP contains every saved record, including knowledge, projects, tasks, inventory, links and structured work tools; settings and language; managed attachments, including unattached files; record and attachment history; archived records; and empty folders. A manifest lists sizes and SHA-256 hashes. Each stream is verified, and additions, deletions or edits detected before finalization abort the backup. Keep external editors idle while exporting; this is a verified file copy, not an operating-system snapshot.

Keep the ZIP outside the application's data and document directories. The ZIP contains the library's private content in readable form. Export archives contain saved library data and should be stored separately from installation files.

External PC/phone paths, physical places, remote URLs and additional server roots such as `/share` are preserved as references. Their external contents are not files owned by the active library. Browser drafts have not been saved to the server; save them as records before exporting. Temporary uploads, generated caches and rollback copies of previous libraries are outside the active library backup. Back those up separately if needed.

## Restore

1. On a fresh V5 installation, choose the interface language. The library starts empty.
2. Open **Backup and restore** and choose **Preview a backup**.
3. Select the ZIP. The server extracts it to a separate staging directory, checks every checksum, validates records and settings, and displays record/file counts and matching IDs.
4. Review the preview and select the confirmation checkbox. Restoring replaces the complete active library; it does not merge records. The current library is preserved for rollback.
5. Select **Restore this backup**. The interface reloads records, statistics and the language saved in the archive.

Managed attachments are relocated to `.restored-documents` in the destination library and the active `documentRoot` setting is updated. Add-on-relative attachment links still work. All other saved files remain byte-for-byte copies; the settings file changes only the document root. Check informational paths for other devices on the destination machine.

Restoring is rejected if the current library or staged archive changed after preview. A failed directory replacement restores the previous library; startup recovery handles an interrupted swap. Previous libraries remain under the sibling `.<library-name>-operations` directory. These directories are kept deliberately and are not removed by preview cleanup.

## Format and limits

Exports use backup manifest version 2, including empty directories. Restore accepts manifest versions 1 and 2. Record-only ZIP files lack the required full-backup manifest and cannot be restored through this workflow. The default export includes history. The advanced `api/export?history=0` variant omits history and the restore preview reports this omission.

Limits are 20 GiB of uncompressed data, 20 GiB of uploaded archive data and fewer than 50,000 archive entries. Symbolic links, special files, traversal paths, duplicate names and checksum mismatches are rejected. Large archives require enough space for the upload, extracted library and preserved previous library. Home Assistant's own backups remain a separate recovery option.

## Local backup tool

The same `Backups` class implements HTTP export and restore. Tests cover representative records of every type, structured work tools, binary documents, unlinked files, history, trash, empty directories, concurrent changes, malformed archives, restart recovery and rollback after failure.
