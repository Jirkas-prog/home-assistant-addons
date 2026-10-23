# MyBrowser

A Home Assistant sidebar panel for the original setup pages of your local devices, external websites, and locally hosted projects.

- Pinned, reorderable tabs with web-server availability indicators.
- An explicit edit mode for adding, unpinning, removing, and arranging pages.
- Brave runs inside the add-on; each saved page uses its own browser target.
- Saved but unpinned pages remain in the library.
- LAN access without internet, plus separate read-only historical copies.
- Optional static, npm, and Bun hosting with drag-and-drop uploads and file management.
- English by default, with a persistent Czech language setting.

Enable **Show in sidebar**, open **Edit panel**, and add a device URL such as `http://device.local/`. The original device page opens below the tab strip. See [DOCS.md](DOCS.md) for configuration, offline limitations, and hosting.

The Brave desktop and login session are shared across viewers. Use one active operator at a time. An offline copy cannot control an unreachable device.
