// The Now strip (step 6b slice 4): a line under the top bar about right now. Clicking it selects the current half-day.
import { useContext } from "react";
import { focusLabel } from "../plan/focus.ts";
import { PlanCtx, useFocused } from "./planview.ts";
import type { TimerView } from "../actions/types.ts";
import type { NowStrip as Strip } from "../plan/now.ts";
import { formatDuration } from "../week/format.ts";
import { halfName } from "./labels.ts";

/** "13:05" as "1:05 PM", like the rest of the UI. */
const clock = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};
const dayName = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "23:05" or "1:02:05" left. */
export const countdown = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};

/** What's left on the timer at `nowMs`: from its end while running, else as stored. */
export const timerLeft = (t: TimerView, nowMs: number) => (t.running && t.endsAt ? Math.max(0, Date.parse(t.endsAt) - nowMs) : t.remainingMs);

type Props = { strip: Strip; onSelect: () => void; timer?: TimerView | null; nowMs?: number; onTimer?: (action: string) => void; borrowed?: { unpaid: number; minutes: number } | null };

export function NowStrip({ strip, onSelect, timer = null, nowMs = Date.now(), onTimer, borrowed = null }: Props) {
  return (
    <div className={`nowstrip ${strip.kind}${timer ? " has-timer" : ""}`}>
      <StripLine strip={strip} onSelect={onSelect} />
      {borrowed && (
        <span className="now-borrowed" title="Borrowed time still to make up (step 7)">
          Borrowed {formatDuration(borrowed.minutes)} to make up{borrowed.unpaid > 1 ? ` (${borrowed.unpaid})` : ""}
        </span>
      )}
      {timer && <TimerBox t={timer} nowMs={nowMs} onTimer={onTimer ?? (() => {})} />}
    </div>
  );
}

/** The compact timer in the top bar (step 10), on every view while a timer runs: client color, time left, the pick. */
export function TopTimer({ t, nowMs, color, client, onClick }: { t: TimerView; nowMs: number; color: string; client: string | null; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const left = timerLeft(t, nowMs);
  return (
    <button type="button" className={`top-timer ${t.kind}${t.ended ? " ended" : ""}${t.running ? "" : " paused"}`} style={{ "--c": color } as React.CSSProperties} onClick={onClick} title={`${t.kind === "break" ? "Break" : "Focus"}: ${t.label}${client ? ` (${client})` : ""}. Open the focus screen`}>
      <span className="top-timer-dot" aria-hidden="true" />
      <strong className="top-timer-count">{t.ended ? "Time's up" : countdown(left)}</strong>
      {!t.running && !t.ended && <span className="top-timer-state">paused</span>}
      <span className="top-timer-label">{t.kind === "break" ? "Break" : t.label}</span>
    </button>
  );
}

function TimerBox({ t, nowMs, onTimer }: { t: TimerView; nowMs: number; onTimer: (action: string) => void }) {
  const left = timerLeft(t, nowMs);
  // The pick's focused time so far, this session included (step 6d), when the pick is in the week shown.
  const view = useContext(PlanCtx);
  const focused = useFocused();
  const pick = t.pickId === null ? undefined : Object.values(view.week ?? {}).flatMap((d) => d.picks).find((p) => p.id === t.pickId);
  const note = pick ? focusLabel(focused(pick.id), pick.size) : null;
  const b = (action: string, label: string, primary = false) => (
    <button key={action} type="button" className={primary ? "mini primary" : "mini"} onClick={() => onTimer(action)}>
      {label}
    </button>
  );
  return (
    <div className={`now-timer ${t.kind}${t.ended ? " ended" : ""}${t.running ? "" : " paused"}`} role="timer" aria-label={`${t.kind === "break" ? "Break" : "Focus"} timer`}>
      <span className="now-timer-tag">{t.kind === "break" ? "Break" : "Focus"}</span>
      {t.ended ? <strong>Time's up</strong> : <strong className="now-count">{countdown(left)}</strong>}
      {!t.running && !t.ended && <span className="muted">paused</span>}
      <span className="now-timer-label">{t.label}</span>
      {note && <span className="now-timer-focus">{note}</span>}
      {t.ended ? [b("timer.done", t.pickId ? "Done" : "Finish", true), b("timer.extend", "+15 min"), b("timer.next", "Next pick")] : [t.running ? b("timer.pause", "Pause") : b("timer.resume", "Resume"), b("timer.extend", "+15")]}
      {b("timer.stop", "Stop")}
    </div>
  );
}

function StripLine({ strip: s, onSelect }: { strip: Strip; onSelect: () => void }) {
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
      <span key="picks" className={s.draft ? "now-draft" : undefined}>
        {s.draft ? `${s.picks.total} draft ${s.picks.total === 1 ? "pick" : "picks"}, not committed` : `${s.picks.done} of ${s.picks.total} picks done`}
      </span>,
    );
  if (s.overBy) parts.push(<span key="over" className="now-over">Over by {formatDuration(s.overBy)}</span>);
  if (s.nextPick)
    parts.push(
      <span key="next" className={s.draft ? "now-pick now-draft" : "now-pick"}>
        Next: {s.nextPick}
        {s.draft && <span className="draft-tag">draft</span>}
      </span>,
    );
  if (s.next && (s.kind === "off" || s.kind === "pto")) parts.push(<span key="nextday">Next workday {dayName(s.next)}</span>);
  if (s.kind === "away") parts.push(<span key="go">Go to today (T)</span>);

  const label = s.half && !s.flex ? `${halfName(s.half)}: ` : "";
  return (
    <button type="button" className="now-select" onClick={onSelect} title={s.half ? `Select ${halfName(s.half).toLowerCase()} today` : "Go to today"}>
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
