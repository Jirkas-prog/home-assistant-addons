# Repository instructions

## Public repository privacy

- This repository is public. Use the owner's public GitHub handle and GitHub-provided `users.noreply.github.com` address in author and committer metadata. Never publish a personal name or personal email in a new commit.
- Before publishing any change, run `node scripts/check-public-content.mjs`. It checks the Git index, so stage the intended files first. It never prints matched secret values.
- Documentation must use generic paths and documentation-only network addresses. Do not include actual workstation paths or local network addresses.
- Keep private audit findings and remediation bundles outside the repository. Synthetic test fixtures, standard vendor assets, and their required license notices are allowed.
- A clean current tree does not establish that historical commits or GitHub cached views are clean. Audits must check history and public release/comment/artifact surfaces separately.
- Rewriting published history requires the owner's explicit exception to the existing no-force-push rule. Prepare and verify an offline candidate before requesting that exception; never infer it from a request to audit.

## Knowledge Atlas release policy

The owner requires exactly two permanent Knowledge Atlas add-ons in `main`:

| Directory | Permanent name | Permanent slug | Purpose |
| --- | --- | --- | --- |
| `knowledge_atlas` | Knowledge Atlas | `knowledge_atlas_v5` | Stable releases |
| `knowledge_atlas_dev` | Knowledge Atlas Dev | `knowledge_atlas_dev` | Immediate development releases |

The stable slug deliberately retains the original V5 identifier. Never change either slug or product name when incrementing a version. Do not create new per-version add-on folders, slugs or long-lived version branches.

- Implement new work in `knowledge_atlas_dev`. Publish requested development releases to that directory on `main`, increasing its version such as `6.0.0-dev.1`. This must not update the stable directory.
- Promote a development major to `knowledge_atlas` only after the human owner explicitly says that development version is stable and authorizes its stable release. Tests passing, time passing, or a request to publish Dev do not constitute stable-release approval.
- At promotion, retain the stable name, slug, data paths and installation identity. Copy the approved implementation and update the stable version; do not blindly copy Dev release metadata. Keep Dev independently updatable.
- The initial channel reorganization to stable `5.0.1` and Dev `5.0.1-dev.1` is authorized. It is a packaging and naming update of existing V5, not authorization to release V6 stable.
- Update `config.yaml`, `package.json`, both package-lock version fields, Docker build defaults and the changelog together. Product branding reads `release.json` and package version; do not hard-code a major version into interface labels.
- Never publish private libraries, backup ZIPs, restore staging/rollback data or machine settings. New installations must be empty. Stable and Dev must have separate storage.
- Run `node scripts/check-atlas-channels.mjs`, the affected add-on tests, build, language audit and add-on checks before publishing. Verify existing settings and record data survive updates.
- Keep all source, documentation, logs, tests and samples in English. Czech belongs only in `shared/locales/cs.json`.
- Preserve Fakturocel, MyBrowser and unrelated repository files. Use normal pushes; never force-push or rewrite shared history.

The old version branches were retired during the channel cleanup. Their history and local archived checkouts remain available. Use `main` as the canonical repository branch; a feature branch may be used temporarily for an actual change.
