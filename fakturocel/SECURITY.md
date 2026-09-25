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
