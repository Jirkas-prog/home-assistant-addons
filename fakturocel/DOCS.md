# Fakturocel Home Assistant Add-on

Fakturocel is a self-hosted invoicing application for Home Assistant OS. It starts with an empty database and two generic invoice templates. The package contains no customers, invoices, logos, signatures, or other personal business data.

## Installation

1. Add `https://github.com/Jirkas-prog/home-assistant-addons` to **Settings → Add-ons → Add-on Store → Repositories**.
2. Install **Fakturocel**.
3. Enable automatic startup and the sidebar entry if desired.
4. Start the add-on and open its Web UI.

Home Assistant Ingress provides the web interface. Port `8443/tcp` is an optional HTTPS endpoint for paired standalone clients. Disable `remote_enabled` when no client needs this endpoint.

## Language

English is the default language. Open **Settings and data → Language** to switch the interface to Czech. The preference is stored with the application data and survives add-on restarts, upgrades, and backup restoration. Translation changes labels only; action names, data keys, formulas, and stored records remain unchanged.

## Main features

- invoices and quotes with sorting, filters, saved views, custom columns, and bulk actions;
- companies, activities, work logs, reusable text, and review tasks;
- annual invoiced and received-payment reports separated by currency;
- archived invoice PDFs that can be downloaded or printed again;
- PDF and encrypted Excel export;
- a visual invoice-template editor with variables, images, rulers, guides, snapping, layers, locks, and undo history;
- application themes, text scaling, custom colors, branding, and contrast checks;
- standard, scientific, 3D-printing, and user-defined formula calculators;
- record origin, last-change details, synchronization conflict comparison, and rollback before merge;
- keyboard navigation and application-owned error and confirmation dialogs.

## Data and upgrades

Persistent application data is stored under the add-on's `/data` directory. Closing a browser does not delete it. If no previous Fakturocel data exists, the application starts empty. Compatible older Fakturocel data in the same add-on storage is migrated during startup; archived PDFs remain attached to their records.

Create a portable backup before upgrading. Keep the `fakturocel` slug and update the existing installation so Home Assistant retains `/data`.

## Backups and recovery

The default automatic-backup folder is `/share/fakturocel/backups`. Change it on the add-on **Configuration** tab or in the application. Settings also provide actions to create a server backup, download a portable `.fakturocel` backup, restore data, and download a recovery-key PDF.

Encryption is enabled by default. The add-on generates and remembers a data key, so normal startup does not ask for a password. Store the recovery-key PDF separately from backups. The PDF contains the complete secret key and is intentionally readable.

Encryption can be disabled after a warning and explicit confirmation. Unencrypted files can be read by other users who can access the same storage. An optional 6–12 digit application PIN is available and is disabled by default.

Complete data deletion requires all of these steps:

1. download the current portable backup;
2. download the recovery-key PDF when encryption is enabled;
3. select the downloaded backup again so the application can verify it;
4. type `DELETE DATA` and confirm.

The procedure removes Fakturocel's managed data, keys, PIN, pairings, and managed automatic backups. It does not delete Home Assistant full backups or files copied elsewhere.

## Invoice templates and calculators

The editor can place text, variable fields, tables, images, lines, colored areas, and QR codes. Text supports fonts, size, emphasis, alignment, spacing, and overflow behavior. Templates can be exported and imported independently.

Custom calculator formulas use Excel-style numeric expressions. English function names such as `SUM`, `AVERAGE`, `IF`, `ROUND`, and `SQRT` are documented in the editor. Function arguments use semicolons; a leading equals sign is optional.

## Network endpoint

The optional port `8443/tcp` uses a locally generated TLS certificate and a separate random token for every paired device. Pairing files contain the token and certificate fingerprint. The client verifies the fingerprint before sending data. The endpoint cannot administer Home Assistant users, Fakturocel roles, encryption keys, or full data deletion.

Expose the endpoint only through a trusted LAN, VPN, or a properly configured secure reverse proxy. Port `8099` remains internal to Home Assistant Ingress.

## Limits

- one attachment: 25 MB;
- unwrapped application backup content: 145 MB;
- imported portable backup: 300 MB;
- one document: 100 line items;
- one installation: 100 custom calculators;
- one calculator: 200 numeric fields and 20 results.

See [SECURITY.md](SECURITY.md) for the storage and encryption model and [TESTING.md](TESTING.md) for verification commands and coverage.
