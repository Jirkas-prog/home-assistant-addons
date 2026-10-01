# Manual records

Copy a template into the library directory (`/config/knowledge` in the add-on, `data` locally). Set a unique `id` and name the file exactly `<id>.md`. Enter a title, body and any relevant fields. Set `parent` to an existing record ID or `null`; a task's `projectId` must reference an existing project.

The app automatically includes valid records in search, statistics, the tree, maps, inventory and task views. There is no build step or AI dependency. Optional `created` and `updated` fields use ISO timestamps. The web editor maintains these fields on save.

The physical location in the item template is an example. Use an ID from your own settings. See [FORMAT.md](../FORMAT.md) for the complete format.
