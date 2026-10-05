# Changelog

## 3.9.0

- Added optional scheduled Google Drive backups with renewable account access, configurable interval, format, and retention.
- Added complete ZIP archives, Excel backups, and combined ZIP+Excel downloads built from one validated application snapshot.
- Added local and Google Drive restoration with a verified preview, revision checks, and a mandatory backup of current data.
- Added recovery from earlier Fakturocel Drive folders after reinstalling, without changing the destination for new backups.
- Added independently configurable encryption for local share backups, downloaded backups/Excel/templates, and Google Drive, with explicit plaintext warnings and conversion of managed local files when re-enabled.
- Protected credentials inside encrypted server storage and excluded them from portable backups.
- Verified uploads before pruning complete backup sets; interrupted pairs never displace a complete backup.
- Added English and Czech backup interfaces and tests for both languages.
- Corrected the default backup-folder fallback and remaining English export labels.

## 3.8.0

- Published Fakturocel as a standalone add-on in a Home Assistant add-on repository.
- Made English the default for metadata, documentation, logs, errors, tests, examples, and the user interface.
- Added a persistent English/Czech language selector under Settings and data.
- Preserved an empty first-run state with generic templates and no personal business data.
- Added sortable, filterable, configurable lists, saved views, and bulk document actions.
- Added record origin and last-change details, per-field conflict comparison, and rollback before synchronization merge.
- Expanded the invoice-template editor with rulers, guides, snapping, layers, element locking, and undo history.
- Added interface scaling, themes, custom colors, branding, logo selection, and contrast checks.
- Added persistent calculators, including user-defined Excel-style formulas and configurable ordering.
- Added encrypted storage, encrypted portable backups and Excel export, recovery-key PDF, optional PIN, and mandatory verified backup before data deletion.
- Added an optional TLS synchronization endpoint for standalone clients while keeping Ingress separate.
- Fixed form redraws so item changes preserve scroll position, focus, and the text cursor; all dialogs include a bottom Back or Cancel action.

## 3.7.0

- Added synchronization metadata, conflict review, saved list views, bulk actions, editor guides, accessibility improvements, and interface customization.

## 3.6.0

- Added the optional paired-device synchronization protocol and offline data merge support.

## 3.5.0

- Added unified overview layouts, document filters, and archived PDF reprinting.
