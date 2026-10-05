# Testing Fakturocel

Use Node.js 24.

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The automated suite covers:

- clean first run and data-model validation;
- invoice and quote creation, issue, PDF archive, payment status, cancellation, and reprinting;
- sorting, filtering, saved views, custom columns, and bulk actions;
- encrypted storage, portable backups, restoration, key rotation, recovery PDF, PIN, and verified deletion;
- complete ZIP/Excel snapshots, combined downloads, shared-string Excel restoration, corruption checks, preview revisions, and mandatory prior backups;
- independent local, download, and cloud encryption policies, plaintext warnings, local conversion, and credential protection;
- Google OAuth polling and expiration, restart persistence, encrypted upload and download, complete-set retention, interrupted transfers, retry scheduling, and recovery from older folders;
- Excel export and embedded complete backup;
- migration from compatible older formats without changing archived PDFs;
- template rendering, page overflow, overlap checks, custom fonts, and media;
- calculator parsing and formula limits without `eval` or `Function`;
- synchronization pairing, certificate pinning, conflict comparison, merge rollback, and idempotent retry;
- English default UI, persistent Czech selection, and unchanged action identifiers after translation;
- custom error dialogs and absence of native `alert`, `confirm`, or `prompt` calls.

The build output is written to `build/fakturocel`. Browser tests use temporary directories and generated sample data. No test fixture contains real customer or supplier information.

Google Drive tests use a local deterministic fake of the documented Google endpoints; no real account is contacted. Before enabling unattended backups on a real installation, connect your own OAuth client and account, create a cloud backup, and restore a downloaded copy on a separate test installation using its recovery key.

When Docker is available, also run:

```sh
docker build --build-arg BUILD_VERSION=3.9.0 --build-arg BUILD_ARCH=amd64 -t fakturocel-test .
```

Automated tests reduce regression risk but do not replace an independent security audit or validation on each supported Home Assistant architecture.
