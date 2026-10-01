# Release verification: 1.2.0

Date: 2026-09-30. Local environment: Windows, Node.js 24.15.0. Browser checks use a separate temporary library; no personal records were changed or included in the release.

| Check | Result |
| --- | --- |
| `npm ci` | Passed with the committed lockfile. |
| `npm test` | 20 passed, 0 failed. Includes record CRUD, conflicts, file history, traversal/symlink restrictions, external Markdown refresh, inventory, tasks, dates, both languages and restart persistence. |
| Existing repository tests, `node --test tests/addon.test.js` from the repository root | 3 passed, 0 failed. |
| `npm run build` | Passed; PDF worker and supporting assets included. |
| `npm run check:languages` | Passed; 394 paired messages; Czech source text restricted to `shared/locales/cs.json`. |
| Language and code preservation | AST identifier comparison during extraction; runtime enum-ID checks; byte comparison of records before and after language saves. |
| English browser UI | Navigation, settings, 2D/3D maps, task board, timeline dates, record code display, PDF rendering and TXT editing verified. |
| Czech browser UI | Navigation, settings, board statuses, task creation, date editing, timeline, PDF rendering, TXT editing and persistence after reload verified. |
| Generic seed library | Six valid records; existing files and edited samples preserved on restart. |
| Logo | SVG application mark and matching 256×256 PNG icon/logo inspected. |
| Base container image | Registry manifest for `node:24.15.0-alpine` includes Linux amd64 and arm64/v8. |
| Container build/runtime | Not verified: local Docker Desktop failed before the engine started, in its Inference Manager socket initialization. No factory reset or system reconfiguration was performed. |
| Real Home Assistant installation, restart and backup restore | Not verified in this environment. Release remains experimental. |

The Home Assistant configuration, version consistency, Dockerfile copy paths, documentation and PNG structure are checked by `npm run check:addon`. The configuration follows the [official app configuration documentation](https://developers.home-assistant.io/docs/apps/configuration/); graphics follow the [presentation requirements](https://developers.home-assistant.io/docs/apps/presentation/).

Repository publication adds only `knowledge_atlas/`. Existing `mybrowser/`, `fakturocel/`, root files and tests are preserved. Runtime data, personal notes, logs, dependency directories and build output are excluded from Git and from the Docker build context.

Known product limitations are documented in [DOCS.md](../DOCS.md), especially that the in-app ZIP export does not include attachments. This release does not claim to implement the separate development roadmap.
