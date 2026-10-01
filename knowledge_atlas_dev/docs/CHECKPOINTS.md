# Task checkpoints and urgency

In a task editor, choose **Add checkpoint**, enter a due date and describe what must be finished. Save the task. A checkpoint date must fall within the task's start and due dates when those endpoints are set. Tasks without endpoints can still contain dated checkpoints.

Open the flag inside a timeline bar to see completion criteria, dates, progress and the reason for its current color. Click a checkbox to complete or reopen a checkpoint. The same controls appear in task details. Checking off a checkpoint records its completion time; reopening clears that timestamp. Changes save immediately without moving or zooming the timeline. Use **Edit task and checkpoints** to add, edit or remove entries.

Diamonds along the lower edge of a bar mark the end of each checkpoint's due day. Multiple checkpoints on the same day share a marker. Clicking a marker opens the checklist. For short bars, zoom in with Ctrl + wheel or pinch to reveal the flag and stars. The keyboard can focus these controls, and Escape closes the checklist. Urgency is also explained in text, so color is not the only indicator.

## Color rules

Dates use the browser's local calendar day. A date stays valid through that whole day. Colors refresh automatically after midnight and on returning to the app.

- Any unchecked checkpoint dated before today makes the **whole task bar red**, even when the task's status is Done. Marking a task Done does not silently check off its checkpoints.
- A past task deadline also makes an unfinished task red. Checking all checkpoints does not mark the task itself Done.
- Otherwise, the next unchecked checkpoint or unfinished task deadline determines the remaining time. Higher importance starts the warning earlier: one to five stars correspond to a 4, 6, 8, 10 or 12-day warning window.
- The base urgency is `clamp(1 - daysRemaining / warningWindow, 0, 1)`. Green changes gradually through yellow to red as that date approaches. A deadline due today is urgent but is not yet labeled overdue.
- Other tasks' pending checkpoints and deadlines within three days of that next date add a bounded scheduling-pressure adjustment. Higher importance and closer dates contribute more. Each other task contributes at most once, using its strongest nearby deadline. The total adjustment is at most 20% of the base urgency, and the final score is capped at 1.
- A score below 0.35 is **On track**, from 0.35 is **Needs attention**, and from 0.75 is **Urgent**. Bar hue varies continuously from 120 degrees (green) to 0 (red).
- Tasks with no pending dates remain green. A completed task with all checkpoints checked remains green regardless of old dates.

Scheduling pressure uses all tasks in the current library. Hiding a status, project or search result does not change another task's color. It is a deadline-density indication; it does not infer working hours, effort, dependencies or personal availability. Editing a checkpoint, changing importance or changing a due date recalculates the result.

The nearby-task contribution is `(otherImportance / 5) * (1 - dateDistance / 4)`. Sum the strongest contribution per other task, multiply by `0.08`, cap at `0.2`, and multiply by base urgency. This only applies inside the warning window and before an overdue override.

## Markdown storage

Checkpoints are optional `task.checkpoints` entries in the existing YAML front matter. Existing records do not require migration. For example:

```yaml
task:
  start: "2026-10-01"
  due: "2026-10-15"
  checkpoints:
    - id: design-review
      due: "2026-10-05"
      description: "Approve the design and save the review notes."
      done: true
      completedAt: "2026-10-04T12:30:00.000Z"
    - id: prototype-test
      due: "2026-10-10"
      description: "Pass the acceptance tests and attach the results."
      done: false
```

Each task supports up to 200 checkpoints. IDs must be unique within the task, start with a lowercase letter or digit, and contain only lowercase letters, digits, hyphens or underscores (up to 120 characters). Dates use `YYYY-MM-DD`; descriptions contain 1–2000 characters. `done` is a YAML boolean. An optional `completedAt` must be a valid UTC timestamp on a completed checkpoint; omit it or set it to `null` when reopening manually. Keep IDs stable when editing descriptions or dates.

Manual file edits enter normal automatic indexing, search and task counts. Checkpoint descriptions and dates are searchable. The task board shows checkpoint progress and overdue checkpoint counts. Checkpoints are saved with custom metadata, history and complete library backups. Revision checks prevent a stale checkbox or editor from overwriting newer changes; refresh and retry after a conflict. No external notification service is contacted.
