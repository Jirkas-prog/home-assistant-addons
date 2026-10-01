# Knowledge Atlas

<img src="logo.png" alt="Knowledge Atlas logo" width="128" />

A personal knowledge and project workspace for Home Assistant. Keep notes in ordinary Markdown files and explore their connections in a 2D or 3D map.

This is the **stable channel**, version **5.0.1**. The add-on name and identity are permanent; future major versions update this same add-on. A new development major is promoted here only after the owner explicitly confirms it is stable. See [Release channels](docs/RELEASE-CHANNELS.md).

- Nested branches, cross-links, searchable records and live statistics.
- Projects, a task board and a timeline with start and due dates.
- Work journals, inventory-linked bills of materials and shopping lists.
- Reusable procedures with independent, persistent checklist runs.
- Source-linked flashcards, review history and deterministic review schedules.
- Saved views that automatically recompute from manually edited Markdown.
- Inventory with quantities, location filters and CSV export.
- Configurable physical places, devices and server document roots.
- PDF viewer, UTF-8 text editor and file uploads.
- Complete managed-file backups, verified restore previews and reversible schema upgrades.
- Stable attachment IDs, browser drafts, concurrent-edit comparison and source repair tools.
- English by default, with a persistent English/Czech switch in **Settings and locations**.
- Home Assistant Ingress access and persistent storage under `/config`.

## First launch

New installations start empty. Open **Backup and restore** to export all saved library data or import a verified ZIP. Personal backup archives are separate from the add-on source and packages. See [Backup and restore](docs/BACKUP-RESTORE.md) for the exact contents, import steps and recovery behavior.

A fresh installation starts in English and asks you to choose **English** or **Czech**. Confirm once to store the choice on the server. An existing library keeps its current language without a new prompt after an update. You can change it later in **Settings and locations**. All inherited V3 work tools remain available.

## Install

For local development, run `npm ci`, `npm run build` and `npm start`. On Windows, `Start.ps1` checks the library identity before starting; use `-Port 8102` to run another version alongside the default port 8099. `Stop.ps1` only stops the process owned by that version. Each checkout uses its own `data` directory unless `DATA_DIR` is explicitly set.

The permanent slug is `knowledge_atlas_v5`. It intentionally retains the existing V5 identity so installed V5 instances receive normal updates with their library preserved. Real Supervisor installation and container startup are still unverified in this environment.

Install **Knowledge Atlas** from the repository:

1. In Home Assistant, open **Settings → Apps → App store** (called **Add-ons** in older versions).
2. Open **Repositories** and add `https://github.com/Jirkas-prog/home-assistant-addons`.
3. Refresh the store, select **Knowledge Atlas**, install and start it.
4. Select **Open web UI**. Use the settings page to configure the language, document root and locations.

For a manual installation, copy this directory to `/addons/knowledge_atlas`, then reload the local app store.

Home Assistant builds the image locally from the Dockerfile. Supported architectures are `amd64` and `aarch64`. See [V5 verification notes](docs/VERIFICATION-V5.md) for tested environments and remaining limits.

Fresh installations start with an empty library. Existing libraries are preserved. No personal library or machine-specific settings are included in this repository.

See [DOCS.md](DOCS.md) for operation and backups, [FORMAT.md](FORMAT.md) for manual records, and [CHANGELOG.md](CHANGELOG.md) for releases.
