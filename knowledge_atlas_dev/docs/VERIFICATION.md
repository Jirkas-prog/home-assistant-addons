# Validation

Validated for Knowledge Atlas Dev `5.0.1-dev.2` on 2026-10-01.

- All 67 application tests pass. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, concurrent editing, language persistence, deep breadcrumb paths and 2D/3D node picking.
- The production web build passes.
- English/Czech language audits pass with 707 matching translation keys.
- Add-on checks cover configuration, package and lockfile versions, Dockerfile metadata, documentation, graphics and example records.
- The repository channel check verifies the two permanent directories, names and slugs, independent storage and empty first launches.
- Browser checks cover English/Czech breadcrumb menus, ancestor and sibling navigation, keyboard controls, dropdown contrast, cross-branch map selection, small nodes, visible labels, first-click selection in 3D and mouse-wheel zoom in both modes.
- Restart and update tests preserve existing records and saved language settings; no storage schema or path changes are introduced by this release.

Run `npm test`, `npm run build`, `npm run check:languages` and `npm run check:addon` in the add-on directory. Run `node scripts/check-atlas-channels.mjs` from the repository root.

## Validation limits

A real Home Assistant Supervisor installation, container startup and update have not been verified in this environment. The Docker daemon is unavailable, so Dockerfile checks are static; an image build and container startup were not run. Backup recovery has automated process and fault-injection coverage; this is not physical power-loss certification. External documents remain references unless they are stored in the managed document directory. Save browser drafts before exporting a library.
