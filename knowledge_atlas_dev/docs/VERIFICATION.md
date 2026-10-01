# Validation

Validated for stable `5.0.1` and development `5.0.1-dev.1` on 2026-10-01.

- All 57 application tests pass in each channel. Coverage includes Markdown records, automatic refresh, inventory, work tools, backup and restore, concurrent editing and language persistence.
- Both production web builds pass.
- English/Czech language audits pass with 701 matching translation keys in each channel.
- Add-on checks cover configuration, package and lockfile versions, Dockerfile metadata, documentation, graphics and example records.
- The repository channel check verifies the two permanent directories, names and slugs, independent storage and empty first launches.

Run `npm test`, `npm run build`, `npm run check:languages` and `npm run check:addon` in the add-on directory. Run `node scripts/check-atlas-channels.mjs` from the repository root.

## Validation limits

A real Home Assistant Supervisor installation, container startup and update have not been verified in this environment. Backup recovery has automated process and fault-injection coverage; this is not physical power-loss certification. External documents remain references unless they are stored in the managed document directory. Save browser drafts before exporting a library.
