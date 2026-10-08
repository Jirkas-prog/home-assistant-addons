import React, { useMemo } from "react";
import { t } from "../shared/i18n.js";
import { JournalCalendar } from "./journal-calendar.jsx";
import { taskCalendarEntry } from "../shared/task-workflow.js";
import { RecordStamp } from "./record-list.jsx";

export function TaskCalendar({
  tasks,
  date,
  mode,
  onDate,
  onMode,
  onEdit,
  onCreate,
}) {
  const entries = useMemo(
    () => tasks.map(taskCalendarEntry).filter(Boolean),
    [tasks],
  );
  const undated = tasks.filter((n) => !n.task?.start && !n.task?.due);
  return (
    <div className="task-calendar">
      <JournalCalendar
        date={date}
        mode={mode}
        entries={entries}
        onDate={onDate}
        onMode={onMode}
        dateOnly
        onOpen={(entry) => onEdit(tasks.find((n) => n.id === entry.id))}
        onCreate={onCreate}
      />
      {!!undated.length && (
        <details className="task-undated">
          <summary>{t("tasks.undated", undated.length)}</summary>
          <div>
            {undated.map((n) => (
              <button key={n.id} onClick={() => onEdit(n)}>
                <strong>{n.title}</strong>
                <RecordStamp node={n} importance />
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
