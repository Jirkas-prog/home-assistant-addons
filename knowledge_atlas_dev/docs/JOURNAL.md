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

Optional `startTime` and `endTime` fields are paired `HH:MM` local clock values.
Omit both (or leave both empty) for all-day records. The combined end date/time
must be later than the start. A timed entry ending at `00:00` does not occupy
the following date. No timezone conversion changes the recorded local dates.
Times survive the same Markdown, backup, restore and package flows as other
tool fields. The calendar's display mode does not change the saved record period.

The Journal page starts with a monthly calendar and also offers week, day and
year views. Opening a record loads its body and sequentially downloads accessible
Add-on/Server attachments up to 10,000,000 bytes each. Calendar navigation only
uses metadata. Closing or switching records cancels pending downloads and releases
temporary previews. Larger files, external URLs and device locations remain explicit.

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
