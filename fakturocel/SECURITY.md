# Fakturocel security model

## Stored data and remembered key

Production storage uses an in-memory SQLite database and an atomically written encrypted snapshot in `/data/fakturocel-vault.json`. Records, attachments, archived PDFs, media, settings, access roles, and history are encrypted before they reach disk.

The add-on generates a random 256-bit data key and stores it in `/data/fakturocel-keys.json` with restrictive permissions. This supports automatic startup without asking for a password. The key is outside `/share`, is never served as a static asset, and is not included in portable `.fakturocel` backups or exported templates.

A Home Assistant administrator with full host-storage access can retrieve both the encrypted data and the remembered key. Portable encrypted backups remain protected when stored separately from the recovery key.

## Encryption and recovery

The `FakturocelEncrypted` version 1 envelope uses AES-256-GCM with a random 96-bit IV and a 128-bit authentication tag. Purpose-specific authenticated data separates working storage, backups, templates, and key wrappers. Key identifiers select the correct remembered key during rotation and interrupted migrations.

The recovery string begins with `FC3-` and contains the complete data key. The recovery PDF is generated in memory only when the owner requests it, uses `Cache-Control: no-store`, and is intentionally readable. Store it separately from encrypted backups.

Encrypted Excel export uses Office Agile encryption with AES-256, SHA-512, 100,000 iterations, and integrity verification. Customer invoice PDFs remain readable; their archived bytes are protected inside application storage.

## Optional PIN and sessions

The optional 6–12 digit PIN is disabled by default and supplements Home Assistant authentication. Its scrypt verifier is stored in the protected application snapshot and is not transferred in portable backups.

Ingress sessions use random tokens in HttpOnly, SameSite=Strict cookies, expire after 12 hours, and are invalidated by restart, PIN change, access changes, or data deletion. Failed PIN attempts receive increasing delays. The PIN and session token are never stored in `localStorage`.

## Google Drive and backup containers

Google OAuth client credentials and refresh tokens are stored only in encrypted vault metadata. Portable backups contain application records and assets, not Google credentials, access PINs, or device pairings. Cloud configuration and restoration require an authenticated owner and POST operations require the Ingress CSRF token. Google credentials require working-data encryption; cloud files can independently be encrypted or plaintext after an explicit acknowledgment. Disconnect the account before disabling working-data encryption.

The add-on requests `drive.file` access, uses fixed Google API origins, rejects HTTP redirects, and checks resumable-upload destinations before sending a bearer token. Upload and download size and MD5 checksums verify transport completeness; the application snapshot also has a SHA-256 checksum, while encrypted data has an AES-GCM authentication tag. Retention is restricted to tagged backup sets in the active folder and only runs after a new complete set has been verified. Interrupted pairs cannot replace a complete set.

Destination policies choose encryption independently for local share backups, downloaded exports, and Google Drive files. They default to encryption when working-data protection is enabled. Turning off a destination requires an explicit warning acknowledgment. The working vault and Google credentials retain their own protection. Re-enabling local protection converts existing managed plaintext backups.

Encrypted ZIP is a container for AES-GCM-encrypted application data, with a readable generic manifest. Encrypted Excel protects both the workbook and its embedded complete snapshot. Plaintext destinations intentionally contain readable business data and remain readable to anyone with access to the files. Recovery PDFs and keys are never uploaded. XML import rejects document types and external entities, bounds expansion and part counts, checks encryption parameters, and requires complete backup data. Restoration uses owner-bound previews with expiration, generation and revision checks, and a mandatory backup before replacing data.

Disconnection cancels active network work and deletes local credentials. Add-on data deletion also clears restoration previews and connection metadata, while Google Drive copies and the Google account's authorization remain under user control.

## Deletion

Complete deletion requires an owner, a current portable-backup download, recovery-PDF download when encryption is enabled, reselection and verification of the same backup, an unchanged data revision, and the confirmation text `DELETE DATA`.

Deletion removes only registered Fakturocel data, keys, PIN data, pairing data, temporary files, and managed automatic backups. It does not remove Home Assistant full backups or copies outside managed paths.

## Calculator formulas

Custom formulas use a tokenizer and numeric abstract-syntax-tree interpreter. The implementation never calls `eval` or `Function`. Only documented operators, functions, ranges, and calculator input references are accepted. Length, nesting, range, token, and evaluation-step limits bound resource use.

## Paired-device endpoint

The optional HTTPS listener on port 8443 requires TLS 1.2 or later and a random device-specific token. The server stores only the token hash. Pairing files include the token and the generated certificate fingerprint; clients verify the fingerprint before sending the token and reject redirects.

The endpoint can transfer application working data but cannot administer Home Assistant users, Fakturocel roles, PINs, encryption keys, or complete deletion. Use it on a trusted LAN, through a VPN, or behind a properly configured secure reverse proxy.

## Limits

Encryption does not protect against a fully controlled host or an already authorized, unlocked browser. Operating-system swap, memory dumps, disk images, and Home Assistant full backups remain under host control. Automated tests are not an independent security audit.
