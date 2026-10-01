# V5 verification

Verified on 2026-10-01.

## Automated acceptance

- The inherited 52 application tests pass.
- Five V5 tests verify an empty first installation, persistent library identity, complete backup/restore of every record kind and structured work tools, binary and unlinked documents, history, trash and empty directories.
- The restored settings retain language, library identity and configured locations. All other restored files are compared by SHA-256.
- Version-one backup compatibility, changed empty folders after preview, additions during streamed export, duplicate directory names and incomplete directory manifests are covered.
- Build, source language scan and manifest/version/Dockerfile/logo/template checks pass.

## Personal archive acceptance

A private archive was produced outside the source repository from the current saved library. Every archived file was compared with its original bytes and SHA-256 digest. The same ZIP was uploaded through the English V5 interface into a separate empty test library, previewed, confirmed and restored. The restored library loaded its saved Czech preference, all record IDs and no validation errors. Each content/history file remained byte-identical; only the active document root changed in settings. Empty directories were preserved.

The ZIP, checksum sidecar, detailed verification report, restored private test library and screenshots containing private data stay outside the V5 source and distribution packages. Fresh production V5 uses a new empty data directory. Browser draft keys include a library identity and a V5 namespace, so it does not offer drafts from older libraries on the same origin.

## Limits

Backups include saved active-library files and the managed document root. External files remain references; unpublished browser drafts must be saved before export. Previous restore rollback libraries and temporary uploads are not copied into the active-library archive. No provider, AI or network download is used to collect external project contents.

Real Home Assistant container installation remains unverified because a suitable runtime is unavailable. Backup and restore have been exercised through the local production server and browser, including an actual private archive round trip.
