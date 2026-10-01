# Permanent release channels

Knowledge Atlas has exactly two installable channels in the same Home Assistant repository.

| Property | Stable | Development |
| --- | --- | --- |
| Permanent name | Knowledge Atlas | Knowledge Atlas Dev |
| Repository directory | `knowledge_atlas` | `knowledge_atlas_dev` |
| Permanent slug | `knowledge_atlas_v5` | `knowledge_atlas_dev` |
| Initial channel release | `5.0.1` | `5.0.1-dev.1` |
| Release stage | stable | experimental |

The stable slug retains the V5 identifier on purpose. Changing it would create a different installation identity. Names, slugs, mapped configuration volume and data paths remain fixed across future major releases. The folder was renamed for clarity; the slug was not renamed. Existing V5 installations should receive the `5.0.1` naming update through the normal Home Assistant update mechanism. Supervisor integration has not been exercised in this environment.

## Development and promotion

1. Develop in `knowledge_atlas_dev` and publish development releases there. For example, `5.0.1-dev.1` can become `6.0.0-dev.1` without changing the stable add-on.
2. Stable remains on its approved major version until the human owner explicitly confirms that the development major is stable and authorizes promotion. Passing tests or publishing Dev is not approval.
3. After approval, transfer the approved implementation into `knowledge_atlas`, retain its stable `release.json`, slug, name and storage identity, and set its stable version, such as `6.0.0`.
4. Do not create version-numbered add-on folders or permanent branches. Both channel folders are published on `main`; future work does not automatically copy Dev into stable.
5. Update the manifest, package and lockfile versions, Docker build version, changelog and current-version table together. Run `node scripts/check-atlas-channels.mjs` from the repository root, then tests, build, `check:languages` and `check:addon` in each affected channel.

The executable channel check prevents accidental renaming, slug changes, version mismatches, extra Knowledge Atlas catalog entries, wrong storage configuration and seeded first launches. The owner-approval rule is recorded in the repository's `AGENTS.md`. No automation promotes development releases to stable.

## Libraries and old installations

The two channels have independent add-on configuration volumes. Both expose `/config` inside their own container; they do not share a library. Dev starts empty. Use **Backup and restore** for an intentional transfer, and retain the exported archive. A channel update preserves the current library and language preference and must not run first-launch setup again.

The V3 and V4 catalog entries and old version branches were retired. Their Git history and local archived checkouts are preserved. Removing an entry from the repository does not migrate its installed data. Export records before uninstalling any old add-on. Existing V5 uses the stable channel identity and does not require an export/import merely for this naming update.

Home Assistant identifies an app using its repository and slug. See the official [configuration documentation](https://developers.home-assistant.io/docs/apps/configuration/) and [communication identifiers](https://developers.home-assistant.io/docs/apps/communication/).
