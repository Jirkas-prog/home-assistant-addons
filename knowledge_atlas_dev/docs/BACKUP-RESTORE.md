# Backup and restore

Open **Backup and restore** in the sidebar. The file counts come from the current library and managed document root. Use **Refresh file counts** after external edits.

For additive imports, use **Import data package**. This separate workflow adds or updates selected records and attachments while preserving the rest of the library. See [Incremental data packages](DATA-PACKAGES.md). Full restore remains a complete library replacement.

## Export

Select **Download full backup**. The ZIP contains every saved record, including knowledge, projects, tasks, inventory, links and structured work tools; settings, language and the library-wide list order (`list-order.json`); managed attachments, including unattached files; record and attachment history; archived records; and empty folders. A manifest lists sizes and SHA-256 hashes. Each stream is verified, and additions, deletions or edits detected before finalization abort the backup. Keep external editors idle while exporting; this is a verified file copy, not an operating-system snapshot.

Keep the ZIP outside the application's data and document directories. The ZIP contains the library's private content in readable form. Export archives contain saved library data and should be stored separately from installation files.

### Transfer progress and controls

Uploads and downloads show a progress bar, percentage with two decimal places, the current direction's speed in B/s, KiB/s, MiB/s or GiB/s, transferred bytes and an approximate remaining time (hours:minutes:seconds). The estimate uses recent throughput, so it changes with the connection and pauses. No estimate is shown until enough data has moved. English uses a decimal point; Czech uses a decimal comma.

Use **Pause**, **Resume** or **Cancel transfer**. Resume continues from confirmed chunks, each at most 2 MiB. An interrupted chunk may be repeated, and progress can return to the last confirmed boundary. A lost upload acknowledgement is reconciled with the server before sending more bytes. Temporary connection errors retry automatically with increasing delays, capped at 30 seconds. Returning to the tab or regaining connectivity wakes the retry. A deliberate Pause stays paused until Resume; cancellation stops retries and removes temporary files without restoring or modifying the library.

Navigation within the app preserves the transfer and displays floating controls outside the backup page. Uploads also survive refreshing or closing the page, connection loss and add-on restarts. When you return to the library, **Resume an upload** shows the original filename, confirmed progress and retention deadline. Choose **Resume upload**, **Later**, or **Cancel transfer**. The reminder remains available after choosing Later. Inactive uploads are retained for **7 full days (168 hours)** after the last saved progress, verification, or deliberate resume. Merely viewing the recovery list does not extend this period. Cleanup runs at startup or when another transfer starts and never removes active transfers, current library records or preserved restore rollback libraries. It does not run at local midnight.

For an incomplete upload, select the original ZIP again: browsers cannot silently reopen a local file after a page is closed. The app checks the file size, a sample fingerprint and SHA-256 hashes of every previously uploaded chunk locally, showing verification progress. A different file is rejected without deleting the saved upload. Only the remaining bytes are sent. Checking a large uploaded prefix can take time but does not consume upload bandwidth. A fully uploaded ZIP needs no local file selection: Resume verifies the retained server copy and refreshes the restore preview, including an expired preview.

Confirmed offsets and chunk hashes are written to a persistent journal alongside the temporary upload. Restart recovery removes only unacknowledged trailing bytes and interrupted chunk files. Transfers use the same persistent operations volume as restore staging. Retention requires that volume to remain available; uninstalling the add-on or deleting its data is not a resumable interruption. At most four transfers can be retained at once.

Downloads require the tab to remain open; their pause/resume controls work within that session. Refreshing or closing the tab or restarting the server requires a new download. Prepared downloads expire after 7 days of inactivity and are cleaned at startup or when another transfer starts.

Minimizing a window does not intentionally pause the add-on. Browsers and mobile operating systems can freeze or discard background pages, preventing JavaScript and requests from running. The add-on cannot guarantee background execution while the browser or device sleeps. When the page remains loaded, automatic retries resume from confirmed parts after it wakes. When it was discarded, select the original ZIP through **Resume upload**. In Chrome, add your Home Assistant address to **Settings > Performance > Always keep these sites active**. In Edge, use the corresponding **Always keep these sites active** exception in performance settings. Prevent device sleep during an uninterrupted transfer. See the [Chrome performance documentation](https://support.google.com/chrome/answer/12929150) and [Edge performance documentation](https://support.microsoft.com/en-us/edge/learn-about-performance-features-in-microsoft-edge).

Before downloading, the server prepares and verifies a temporary ZIP on disk. Its final size provides an exact transfer denominator. **Preparing and checking the ZIP** is a separate stage with no invented percentage or ETA. After upload reaches 100%, **verifying the backup** remains visible until the restore preview is ready. Restoring still requires the normal confirmation.

Where supported in a standalone browser, choose a destination file at the start; chunks are written to its temporary writable stream and committed only when complete. In Home Assistant frames or other browsers, chunks go to browser file storage, with IndexedDB as a fallback. At completion, select **Save ZIP** to keep the archive in your downloads before closing the tab or starting another transfer. Browser storage is subject to available space and browser quotas. These paths avoid building one archive-sized ArrayBuffer; the IndexedDB fallback assembles references to stored Blobs at completion. The browser may still need additional temporary disk space. Cancelled local temporary files are discarded, and abandoned browser temporary files older than 7 days are cleaned when a new download starts.

The server needs free space for the prepared download ZIP. Import needs space for the received ZIP, verification staging, extracted files and the preserved previous library. The received ZIP is retained until its preview is restored or discarded, allowing verification to be repeated without another upload. All transfer operations remain local and use Home Assistant Ingress-relative URLs.

External PC/phone paths, physical places, remote URLs and additional server roots such as `/share` are preserved as references. Their external contents are not files owned by the active library. Browser drafts have not been saved to the server; save them as records before exporting. Temporary uploads, generated caches and rollback copies of previous libraries are outside the active library backup. Back those up separately if needed.

## Restore

1. On a fresh V5 installation, choose the interface language. The library starts empty.
2. Open **Backup and restore** and choose **Preview and restore backup**.
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
