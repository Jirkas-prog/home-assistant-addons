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
- Excel export and embedded complete backup;
- migration from compatible older formats without changing archived PDFs;
- template rendering, page overflow, overlap checks, custom fonts, and media;
- calculator parsing and formula limits without `eval` or `Function`;
- synchronization pairing, certificate pinning, conflict comparison, merge rollback, and idempotent retry;
- English default UI, persistent Czech selection, and unchanged action identifiers after translation;
- custom error dialogs and absence of native `alert`, `confirm`, or `prompt` calls.

The build output is written to `build/fakturocel`. Browser tests use temporary directories and generated sample data. No test fixture contains real customer or supplier information.

When Docker is available, also run:

```sh
docker build --build-arg BUILD_VERSION=3.8.0 --build-arg BUILD_ARCH=amd64 -t fakturocel-test .
```

Automated tests reduce regression risk but do not replace an independent security audit or validation on each supported Home Assistant architecture.
