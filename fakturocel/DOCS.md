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
- PDF and readable Excel export;
- optional scheduled Google Drive backups, complete ZIP/Excel backup formats, and local or cloud restoration;
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

Private working-data protection is enabled by default; encryption of backup destinations is optional and defaults to Off. The add-on generates and remembers a data key, so normal startup does not ask for a password. Store the recovery-key PDF separately from backups. The PDF contains the complete secret key and is intentionally readable.

Open **Encryption by location** to enable or disable encryption independently for local `/share` backups, downloaded ZIP/portable backups, and Google Drive files. All three default to **Off** on new installations. Already saved choices remain in place. Disabling an active destination requires confirmation that files there can be read by other users. Templates and direct Excel downloads are always unencrypted, including the complete Excel backup sheet inside combined downloads.

Turning local backup encryption back on converts existing managed plaintext `.fakturocel` files using the remembered key. Existing downloaded and cloud copies keep their original protection. Invoice PDFs and exported templates remain readable; archived copies follow working-data protection. Working-data encryption is configured under **Data security**. Enable it to create encrypted backups or protect Google credentials.

Working-data encryption can be disabled after a warning and explicit confirmation. Unencrypted files can be read by other users who can access the same storage. An optional 6–12 digit application PIN is available and is disabled by default.

Complete data deletion requires all of these steps:

1. download the current portable backup;
2. select the downloaded backup again so its current contents can be verified;
3. select the downloaded backup again so the application can verify it;
4. type `DELETE DATA` and confirm.

The procedure removes Fakturocel's managed data, keys, PIN, pairings, and managed automatic backups. It does not delete Home Assistant full backups or files copied elsewhere.

### Complete backup formats

**Download backup to this device** offers **Complete ZIP archive**, **Excel with complete application data**, or **ZIP and Excel**. The selection is remembered. A combined download is one ZIP containing both files. Scheduled Google Drive backups use the same choices and upload the two files separately when both formats are selected.

ZIP and Excel generation shows a percentage progress bar with stages for worksheet creation, compression, and downloading. **Cancel** or Escape stops generation and discards the temporary file without changing application records. Manual cloud backups show generation, upload, verification, and retention progress; cancellation keeps application data and older complete backups. Interrupted cloud copies are cleaned up after the next successful backup. Long saves and restores show an activity indicator; completion or failures appear in the application.

All formats derive from one validated database snapshot. They include business settings, records, templates, images, fonts, archived invoice PDFs, attachments, and history. Excel restores from its **Application backup** worksheet, including its binary attachments; ordinary summary worksheets are readable views, not an alternative source of truth. Editing a summary worksheet does not change the restored snapshot. Files without the complete backup worksheet are rejected rather than silently losing documents or attachments.

Automatic encrypted share backups use AES-GCM. Keep the separately stored recovery-key PDF to restore them on another installation. ZIP and portable downloads use their configured encryption choice. Excel downloads and template exports are always unencrypted, including the complete Excel backup worksheet. Google Drive ZIP and Excel use the cloud encryption choice. Older encrypted ZIP, Excel, portable, and template files still require the key active when they were created.

The add-on uses one in-memory SQLite database with an encrypted durable snapshot. File-format selection does not create parallel databases. Automatic local recovery files still use the `.fakturocel` format after each confirmed change. They remain available when Google Drive is unavailable.

**Restore data from backup** accepts `.zip`, `.xlsx`, and existing `.fakturocel` files. It validates checksums, records, and attachments, shows the number of documents, companies, templates, and attachments, and requires confirmation before replacement. A mandatory local backup of the current state is made first. A change to current records after the preview prevents restoration until a new preview is generated.

### Google Drive automatic backups

Open **Settings and data → Google Drive backups**. The Google connection requires working-data encryption to protect account credentials. Cloud backup files have a separate encryption choice and automatic uploads are off until explicitly enabled. The add-on's scheduler runs independently of the browser; the add-on must be running and have internet access.

1. Create or select your own project in Google Cloud and enable the **Google Drive API**.
2. Configure **Google Auth Platform** branding and audience. If the project is in Testing mode, add your account as a test user.
3. Create an OAuth client of type **TVs and Limited Input devices** for the headless add-on. Copy the client ID and client secret into Fakturocel.
4. Select **Connect Google account**, open the returned Google authorization URL in another tab, and enter the displayed code. Keep the Fakturocel window open until connection is confirmed.
5. Select ZIP, Excel, or both, an interval from 1 to 720 hours, and 2 to 100 backup sets to retain. Enable **Automatic backups** and save. The default interval is 24 hours and the default retention is 10 sets.
6. Set **Encryption by location → Google Drive backup files** to the desired protection. Encryption defaults to Off; enable it when you want protected cloud files. Use **Back up to Google Drive now** to verify the first backup. Save the recovery-key PDF separately when files are encrypted.

The `drive.file` scope grants access to files created or selected for this application, rather than all Drive files. Each connection creates a visible Fakturocel folder. Uploads use resumable-upload sessions and verify the returned file size and checksum. Both selected formats must be uploaded and verified before a set is marked complete or old copies are pruned. A failed upload records its error and retries with increasing delays, up to one hour.

Google may expire refresh tokens after seven days for projects with an external audience and Testing publishing status. Set an appropriate production publishing status for unattended backups. See Google's [device authorization guide](https://developers.google.com/identity/protocols/oauth2/limited-input-device), [refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration), and [Drive permission documentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

**Restore from Google Drive** lists files in the selected Fakturocel folder, downloads and verifies the chosen file, and uses the same preview and restoration checks as local files. After reinstalling, connect using the same Google Cloud project and account, select the older Fakturocel folder, and supply its recovery key only for an older encrypted file. Selecting an older folder for restoration does not change the destination or retention rules for new backups.

Client credentials and refresh tokens are encrypted in the add-on vault. They are not returned to the browser after setup and are excluded from portable backups, alongside access PINs and device pairings. Reconnect Google after restoring to a fresh installation. Disconnect Google Drive before disabling encryption.

Disconnecting or clearing add-on data stops uploads and removes the locally stored connection. It keeps existing Google Drive copies. Remove cloud copies directly in Google Drive when required, and manage the application's granted access in your Google account separately. Retention deletes only tagged backups in the active installation's folder.

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
