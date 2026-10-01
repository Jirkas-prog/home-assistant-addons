# Journal records

Journal entries use ordinary schema-2 Markdown records with `tool.kind: journal`.
The body contains the narrative. `projectId` links the main project; `related`
links additional knowledge, skills, projects or other records by stable ID.

```yaml
tool:
  schema: 1
  kind: journal
  date: 2026-10-01
  endDate: 2026-10-07
  period: week
  minutes: 120
  next: Compare the measurements.
  places:
    - id: field-site
      label: Field site
      latitude: 50.0
      longitude: 14.0
resources:
  - id: field-photo
    label: Equipment setup
    locationId: addon
    path: journal/field-photo.jpg
    photo:
      takenAt: "2026-10-01T10:30:00"
      offset: "+02:00"
      latitude: 50.0
      longitude: 14.0
      source: exif
```

Both endpoints are inclusive local calendar dates. `endDate` must not precede
`date`. Older entries without it remain single-day entries. `period` is an editor
preset (`day`, `week`, `month`, `custom`); the saved dates are authoritative.
Entries may overlap, and navigation does not create placeholder days. Duration
is optional work effort expressed as `minutes` (zero means unspecified), not a
claim that every hour of a multi-day range was spent working.

Each place needs a stable ID and a label or a pair of valid coordinates. Up to
100 places are supported. Coordinates use WGS84 decimal degrees, including zero
and negative values. A text-only place works offline. Place labels and coordinates,
entry dates, titles and body text are included in search.

Photo metadata is optional. Capture time preserves the camera's local clock and
its separately stored offset. Metadata suggestions do not silently replace entry
dates or places. Absence of GPS or capture time means unknown, not the server's
location or the file's modification time. The example coordinates are generic.

Keep files inside the configured managed document root and use relative paths
with `locationId: addon` to include the actual bytes in full backups. A path to
another device is only a reference. See [Backup and restore](BACKUP-RESTORE.md)
and [the full record format](../FORMAT.md) before manually adding entries.
