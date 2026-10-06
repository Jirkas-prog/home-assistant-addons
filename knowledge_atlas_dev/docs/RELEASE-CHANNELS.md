# Release channels

Knowledge Atlas has two installable channels in the same Home Assistant repository.

| Property | Stable | Development |
| --- | --- | --- |
| Name | Knowledge Atlas | Knowledge Atlas Dev |
| Directory | `knowledge_atlas` | `knowledge_atlas_dev` |
| Permanent slug | `knowledge_atlas_v5` | `knowledge_atlas_dev` |
| Current version | `5.0.1` | `5.0.1-dev.23` |
| Release stage | stable | experimental |

Names, slugs, configuration volumes and data paths remain fixed across major releases.

## Development and promotion

1. Develop in `knowledge_atlas_dev` and publish development releases there. A release such as `6.0.0-dev.1` changes only Dev.
2. Stable remains on its approved major version until the owner explicitly confirms the development major is stable and authorizes promotion. Passing tests or publishing Dev is not approval.
3. At promotion, transfer the approved implementation into `knowledge_atlas`, retain its stable release metadata and storage identity, and set the stable version.
4. Publish both channel folders on `main`; keep their names and directories constant.
5. Update manifest, package and lockfile versions, Docker build version and changelog together. Run the repository channel check, tests, build, language audit and add-on checks.

## Library storage

Each channel has an independent add-on configuration volume. Both expose `/config` inside their own container and start with an empty library. Use **Backup and restore** for an intentional transfer between channels. An update retains the saved library and language preference.

Home Assistant identifies an app using its repository and slug. See the official [configuration documentation](https://developers.home-assistant.io/docs/apps/configuration/) and [communication identifiers](https://developers.home-assistant.io/docs/apps/communication/).
