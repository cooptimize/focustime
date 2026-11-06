// The Now strip (step 6b slice 4): a line under the top bar about right now. Clicking it selects the current half-day.
import type { TimerView } from "../actions/types.ts";
import type { NowStrip as Strip } from "../plan/now.ts";
import { formatDuration } from "../week/format.ts";
import { clientColor, halfName } from "./labels.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { progressLabel } from "../plan/weeklist.ts";

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

// Step 10: the running timer lives in the top bar (TopTimer) and on the focus screen; the strip offers Start focus.
type Props = { strip: Strip; onSelect: () => void; onStartFocus?: (() => void) | null; borrowed?: { unpaid: number; minutes: number } | null };

export function NowStrip({ strip, onSelect, onStartFocus = null, borrowed = null }: Props) {
  return (
    <div className={`nowstrip ${strip.kind}`}>
      <StripLine strip={strip} onSelect={onSelect} />
      {borrowed && (
        <span className="now-borrowed" title="Borrowed time still to make up (step 7)">
          Borrowed {formatDuration(borrowed.minutes)} to make up{borrowed.unpaid > 1 ? ` (${borrowed.unpaid})` : ""}
        </span>
      )}
      {onStartFocus && (
        <button type="button" className="mini now-start" onClick={onStartFocus} title="Start focus on the next planned to-do">
          Start focus
        </button>
      )}
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
        {s.draft ? `${s.picks.total} ${s.picks.total === 1 ? "to-do" : "to-dos"}, press Done to keep the plan` : `${s.picks.done} of ${s.picks.total} to-dos done`}
      </span>,
    );
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

type MustsRow = { clientKey: string; name: string; musts: number; done: number; left: number; leftMinutes: number; nice: number; track?: { kind: string; text: string } | null };

/**
 * Step 15 (D268): one context line under the top bar instead of the Now strip, the ritual chips and the Musts strip:
 * now / next in a few words, then each client's musts ("Northwind 0/2 · Harbor 0/1"); a click on the musts opens
 * the details. No "Still realistic?" here: that question is Check-in's alone.
 */
/**
 * The musts summary (step 11): "Musts 2/5 · Fabrikam 1/2 …" with a popover per client. Step 16.2: in the Week tab's
 * header (the stacked context line under the top bar is gone; Today's Now mode carries now and next, the Focus
 * button a running timer).
 */
export function MustsSummary({ musts, colors, onPlanWeek }: { musts: MustsRow[]; colors: Record<string, string>; onPlanWeek: () => void }) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !pop.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const shown = musts.filter((m) => m.musts > 0);
  if (!shown.length) return null;
  // U3: musts once, as a swatch and "0/2" per client; amber when the on-track question says tight, muted otherwise.
  return (
    <div className="cl-musts" ref={pop}>
      <button type="button" className="cl-musts-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Musts done this week, per client" aria-label={`Musts: ${shown.map((m) => `${m.name} ${m.done} of ${m.musts}${m.track?.kind === "at_risk" ? ", tight" : ""}`).join(", ")}`}>
        <span className="cl-label">Musts</span>
        {shown.map((m) => (
          <span key={m.clientKey} className={`cl-must${m.track?.kind === "at_risk" ? " tight" : ""}`} style={{ "--c": clientColor(m.clientKey, colors) } as CSSProperties} title={`${m.name}${m.track ? ` · ${m.track.text}` : ""}`}>
            <span className="swatch" aria-hidden="true" />
            {m.done}/{m.musts}
          </span>
        ))}
      </button>
      {open && (
        <div className="cl-pop" role="dialog" aria-label="Musts this week">
          <h3>Musts this week</h3>
          <ul>
            {shown.map((m) => (
              <li key={m.clientKey} style={{ "--c": clientColor(m.clientKey, colors) } as CSSProperties}>
                <span className="swatch" aria-hidden="true" />
                <strong>{m.name}</strong> {progressLabel(m)}
              </li>
            ))}
          </ul>
          <button type="button" className="link-btn" onClick={() => (setOpen(false), onPlanWeek())}>
            Open Plan the week
          </button>
        </div>
      )}
    </div>
  );
}
