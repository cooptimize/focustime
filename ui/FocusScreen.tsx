// The focus screen (step 10): a calm full view while focus runs. A large countdown, the one pick (title, client,
// open link), the next meeting, and only Done, +15 and Stop, plus the sound control. Esc goes back to Today; the
// timer keeps running on the server and stays in the top bar.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { TimerView } from "../actions/types.ts";
import type { NowStrip } from "../plan/now.ts";
import type { Pick } from "../plan/types.ts";
import { formatDuration } from "../week/format.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { WorkLink } from "./WorkLink.tsx";

type Props = {
  t: TimerView | null;
  nowMs: number;
  pick: Pick | null;
  client: string | null;
  color: string;
  /** The next (or current) meeting today, from the Now strip. */
  event: NowStrip["event"] | null;
  onTimer: (action: string) => void;
  /** Start focus when nothing runs (the planned pick, else a plain timer). */
  onStart: () => void;
  onClose: () => void;
  /** The sound control (slice 5). */
  sound?: ReactNode;
};

const clock = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};

export function FocusScreen({ t, nowMs, pick, client, color, event, onTimer, onStart, onClose, sound }: Props) {
  const main = useRef<HTMLButtonElement>(null);
  useEffect(() => main.current?.focus(), [t?.kind, t?.ended, !t]);
  const left = t ? timerLeft(t, nowMs) : 0;
  const style = { "--c": color } as CSSProperties;

  if (!t)
    return (
      <main className="focus-screen idle" aria-label="Focus" style={style}>
        <p className="focus-kind">Nothing running</p>
        <div className="focus-actions">
          <button ref={main} type="button" className="focus-btn primary" onClick={onStart}>Start focus</button>
          <button type="button" className="focus-btn" onClick={onClose}>Back to Today</button>
        </div>
      </main>
    );

  const brk = t.kind === "break";
  return (
    <main className={`focus-screen ${t.kind}${t.ended ? " ended" : ""}${t.running ? "" : " paused"}`} aria-label="Focus" style={style}>
      <p className="focus-kind">{brk ? "Break" : "Focus"}{!t.running && !t.ended ? " · paused" : ""}</p>
      <div className="focus-count" role="timer" aria-live="off" aria-label={t.ended ? "Time's up" : `${countdown(left)} left`}>
        {t.ended ? "Time's up" : countdown(left)}
      </div>
      {!brk && (
        <div className="focus-pick">
          <h1>
            {pick?.itemUrl ? (
              <WorkLink clientKey={pick.clientKey} url={pick.itemUrl}>{pick.title}</WorkLink>
            ) : (
              pick?.title ?? t.label
            )}
          </h1>
          {client && (
            <p className="focus-client">
              <span className="swatch" aria-hidden="true" /> {client}
            </p>
          )}
        </div>
      )}
      {event && (
        <p className="focus-next">
          {event.now ? <>In <strong>{event.title}</strong> until {clock(event.at)}</> : <>Next: <strong>{event.title}</strong> at {clock(event.at)}, in {formatDuration(event.minutes)}</>}
        </p>
      )}
      <div className="focus-actions">
        <button ref={main} type="button" className="focus-btn primary" onClick={() => onTimer("timer.done")} title={pick ? "End the session and tick the pick done" : "End the session"}>
          {pick ? "Done" : "Finish"}
        </button>
        <button type="button" className="focus-btn" onClick={() => onTimer("timer.extend")} title="Add 15 minutes">
          +15
        </button>
        <button type="button" className="focus-btn" onClick={() => onTimer("timer.stop")} title="Stop without ticking the pick">
          Stop
        </button>
      </div>
      {sound && <div className="focus-sound">{sound}</div>}
      <button type="button" className="link-btn focus-back" onClick={onClose} title="Back to Today (Esc); the timer keeps running">
        Back to Today, the timer keeps running
      </button>
    </main>
  );
}
