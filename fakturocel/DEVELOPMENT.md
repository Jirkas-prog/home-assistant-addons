# Fakturocel development

Fakturocel requires Node.js 24. Run `npm ci`, `npm test`, `npm run build`, and `npm run test:browser` before changing the add-on version.

`server/secure-store.mjs` owns encrypted persistence. `server/server.mjs` provides the Ingress and optional paired-device endpoints. The shared model and validation live under `src/`; `src/renderer.js` creates PDF output and `src/editor.js` implements the visual template editor.

English source strings are canonical. Czech interface text belongs only in `src/locales/cs.json` or `translations/cs.yaml`. Do not translate action identifiers, object keys, formula function names, filenames used as protocol values, or other code tokens.

Tests must use generated sample data. Never add real invoices, customers, supplier details, logos, signatures, private keys, pairing files, or portable backups to the repository.
