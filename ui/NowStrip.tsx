// The Now strip (step 6b slice 4): a line under the top bar about right now. Clicking it selects the current half-day.
import type { NowStrip as Strip } from "../plan/now.ts";
import { formatDuration } from "../week/format.ts";
import { halfName } from "./labels.ts";

/** "13:05" as "1:05 PM", like the rest of the UI. */
const clock = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};
const dayName = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function NowStrip({ strip: s, onSelect }: { strip: Strip; onSelect: () => void }) {
  const parts: React.ReactNode[] = [];
  if (s.until && (s.kind === "slot" || s.kind === "lunch")) parts.push(<span key="until">until {clock(s.until)}</span>);
  if (s.until && s.kind === "before") parts.push(<span key="until">at {clock(s.until)}, in {formatDuration(s.untilMinutes ?? 0)}</span>);
  if (s.event)
    parts.push(
      <span key="ev" className="now-event">
        {s.event.now ? (
          <>
            In <strong>{s.event.title}</strong> until {clock(s.event.at)}
          </>
        ) : (
          <>
            <strong>{s.event.title}</strong> in {formatDuration(s.event.minutes)} ({clock(s.event.at)})
          </>
        )}
      </span>,
    );
  if (s.picks)
    parts.push(
      <span key="picks">
        {s.picks.done} of {s.picks.total} picks done
      </span>,
    );
  if (s.overBy) parts.push(<span key="over" className="now-over">Over by {formatDuration(s.overBy)}</span>);
  if (s.nextPick)
    parts.push(
      <span key="next" className="now-pick">
        Next: {s.nextPick}
      </span>,
    );
  if (s.next && (s.kind === "off" || s.kind === "pto")) parts.push(<span key="nextday">Next workday {dayName(s.next)}</span>);
  if (s.kind === "away") parts.push(<span key="go">Go to today (T)</span>);

  const label = s.half && !s.flex ? `${halfName(s.half)}: ` : "";
  return (
    <button type="button" className={`nowstrip ${s.kind}`} onClick={onSelect} title={s.half ? `Select ${halfName(s.half).toLowerCase()} today` : "Go to today"}>
      <span className="now-tag">Now</span>
      <span className="now-title">
        {s.kind === "slot" ? label : ""}
        {s.title}
      </span>
      {parts.map((p, i) => (
        <span key={i} className={i === 0 && s.until ? "now-part now-until" : "now-part"}>
          {p}
        </span>
      ))}
    </button>
  );
}
