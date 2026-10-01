# Repository instructions

## Publishing

- Use the public GitHub handle and GitHub-provided noreply address for commit author and committer metadata.
- Stage the intended files and run `node scripts/check-public-content.mjs` before publishing.
- Use generic examples in documentation. Publish source, documentation, tests and distributable assets only.
- Use normal pushes to `main`. A temporary feature branch may be used for an actual change.
- Keep documentation focused on the current product, its configuration and usage.
- Preserve Fakturocel, MyBrowser and unrelated repository files.

## Knowledge Atlas release policy

Maintain exactly two permanent Knowledge Atlas add-ons:

| Directory | Permanent name | Permanent slug | Purpose |
| --- | --- | --- | --- |
| `knowledge_atlas` | Knowledge Atlas | `knowledge_atlas_v5` | Stable releases |
| `knowledge_atlas_dev` | Knowledge Atlas Dev | `knowledge_atlas_dev` | Development releases |

- Names, slugs, mapped configuration volumes and data paths remain fixed when versions increase.
- Implement new work in `knowledge_atlas_dev`. Publish requested development releases there with an increased development version, without changing stable.
- Publish completed, tested Knowledge Atlas changes to the public Dev channel immediately after implementation; the owner has authorized this standing workflow. Increase the Dev version and use a normal push to `main` without requiring a separate upload request. Stable promotion still requires explicit approval.
- Promote a development major to stable only when the owner explicitly confirms it is stable and authorizes its release. Passing tests or publishing Dev is not stable-release approval.
- At promotion, transfer the approved implementation and retain stable release metadata, name, slug and storage identity. Keep Dev independently updatable.
- Update `config.yaml`, `package.json`, both package-lock version fields, Docker build defaults and the changelog together. Branding reads `release.json` and the package version.
- New installations start empty. Stable and Dev use separate storage. Runtime data, backups and machine settings do not belong in source or packages.
- Run `node scripts/check-atlas-channels.mjs` and the affected add-on tests, build, language audit and add-on checks. Verify saved settings and records survive updates.
- Keep source, documentation, logs, tests and samples in English. Czech belongs only in `shared/locales/cs.json`.
