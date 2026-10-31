import type { DayShape, SourceResult, Week } from "../week/types";
import { shortDate } from "./labels";

type Props = { sources: SourceResult<unknown>[]; week: Week; isSampleWeek: boolean; sampleWeek: string; shape: DayShape };

const names = { dataverse: "Dataverse", outlook: "Outlook", google: "Google" } as const;

export function StatusBar({ sources, week, isSampleWeek, sampleWeek, shape }: Props) {
  const placedIds = (source: "outlook" | "google") => {
    const ids = new Set<string>();
    for (const d of week.days) {
      for (const e of d.allDay) if (e.source === source) ids.add(e.id);
      for (const p of [...d.early, ...d.am.events, ...d.pm.events, ...d.evening]) if (p.event.source === source) ids.add(p.event.id);
    }
    return ids.size;
  };
  const blocks = week.days.reduce((n, d) => n + d.am.focus.filter((f) => f.source === "dataverse").length + d.pm.focus.filter((f) => f.source === "dataverse").length, 0);

  return (
    <footer className="statusbar" aria-label="Source status">
      <span className="sample-pill">Sample data</span>
      <span className="muted">
        No accounts connected. Built-in sample{isSampleWeek ? "" : `; sample meetings exist only for the week of ${shortDate(sampleWeek)}`}.
      </span>
      <span className="sources">
        {sources.map((s) => (
          <span key={s.source} className={`source ${s.status}`}>
            <span className="dot" aria-hidden="true" />
            {names[s.source]}
            <span className="muted">
              {s.source === "dataverse" ? `${blocks} focus blocks` : `${placedIds(s.source)} events`} · {s.sample ? "sample" : s.fetchedAt ? `fetched ${s.fetchedAt}` : s.status}
            </span>
          </span>
        ))}
      </span>
      <span className="muted shape">
        Day shape {shape.start} · split {shape.split} · usual end {shape.end} · {shape.timeZone}
      </span>
    </footer>
  );
}
