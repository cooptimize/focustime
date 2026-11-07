// MB-1: Today on the phone. The Now card (the block under way, until when and what's left; the meeting under way or
// the next one; the to-do in progress or next, with big Start and Done), today's to-dos grouped by block (a tap opens
// the to-do's sheet), and Next up (the rest of today's meetings and blocks). Between blocks or after the day it says
// so plainly. Every change is an existing action; ticking my own to-do runs at once (Undo in the toast).
import type { CSSProperties, ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { Slot } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import type { DayEvent } from "../plan/todaycal.ts";
import { nowCard, type NowCard } from "../plan/phonenow.ts";
import { clientColor, startClock } from "./labels.ts";
import { formatDuration } from "../week/format.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { todoLine, useTodoSheet } from "./TodoSheet.tsx";
import { userZone } from "../week/zone.ts";

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));
const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** The Now card's state for today's blocks and calendar. */
export function phoneNowOf(blocks: readonly Slot[], events: readonly DayEvent[], now: string): NowCard {
  return nowCard(
    blocks.map((s) => ({ half: s.half, clientKey: s.focus[0]?.clientKey ?? null, start: s.start, end: s.end })),
    events.map((e) => ({ id: e.event.id, title: e.event.title, start: e.start, end: e.end, isPersonal: e.event.isPersonal, unavailable: e.event.unavailable, notMeeting: e.event.notMeeting, allDay: e.event.allDay })),
    now,
  );
}

export function PhoneNowCard({ card, data, pick, nowMs, nameOf, committed, onStart, onDone, onTimer, onFocusScreen }: {
  card: NowCard;
  data: WeekLoadData;
  pick: Pick | null;
  nowMs: number;
  nameOf: (k: string) => string;
  committed: boolean;
  onStart: (p: Pick) => void;
  onDone: (p: Pick) => void;
  onTimer: (a: "timer.done" | "timer.extend") => void;
  onFocusScreen: () => void;
}): ReactNode {
  if (card.kind === "none") return null;
  const tz = userZone(data);
  const t = data.timer;
  const block = card.kind === "after" ? null : card.block;
  const client = block?.clientKey ?? null;
  const name = client ? nameOf(client) : "Open";
  const when = (iso: string) => startClock(iso, tz);
  const running = !!t && (!pick || t.pickId === pick.id);
  const head =
    card.kind === "block" ? { tag: running ? "Focusing" : "Now", title: name, line: `until ${when(card.block.end)} · ${formatDuration(card.leftMinutes)} left` }
    : card.kind === "before" ? { tag: "Your day starts", title: `${when(card.block.start)} · ${name}`, line: `in ${formatDuration(Math.max(0, Math.ceil((ms(card.block.start) - nowMs) / 60_000)))}` }
    : card.kind === "between" ? { tag: "Between blocks", title: `Free until ${when(card.block.start)}`, line: `Then ${client ? name : "an open block"}, ${when(card.block.start)}–${when(card.block.end)}` }
    : { tag: "Today", title: "Day done", line: "Nothing else is scheduled today." };
  const meeting = card.kind === "after" ? null : card.meeting;
  return (
    <section className={`ph-now ph-now-${card.kind}`} data-tour="today-next" aria-label="Now" style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
      <p className="ph-now-tag">{head.tag}</p>
      <h2 className="ph-now-title">{head.title}</h2>
      <p className="ph-now-line">{head.line}</p>
      {meeting && (
        <p className={`ph-now-meet${meeting.underWay ? " on" : ""}`}>
          <span className="pnm-tag">{meeting.underWay ? "In a meeting" : "Next meeting"}</span>
          <span className="pnm-title">{meeting.title}</span>
          <span className="pnm-when">{meeting.underWay ? `until ${when(meeting.end)} · ${formatDuration(meeting.minutes)} left` : `${when(meeting.start)} · in ${formatDuration(meeting.minutes)}`}</span>
        </p>
      )}
      {card.kind !== "after" && (running && t ? (
        <div className="ph-now-todo">
          {pick && <p className="pnt-title">{pick.title}</p>}
          <div className="pnt-acts">
            <button type="button" className="pnt-count" onClick={onFocusScreen} aria-label="Open the focus screen">
              {t.ended ? "Time's up" : countdown(timerLeft(t, nowMs))}
            </button>
            <button type="button" className="primary big" onClick={() => onTimer("timer.done")}>
              Done
            </button>
            <button type="button" className="big" onClick={() => onTimer("timer.extend")} aria-label="Add 15 minutes">
              +15
            </button>
          </div>
        </div>
      ) : pick ? (
        <div className="ph-now-todo">
          <p className="pnt-label">{card.kind === "block" ? "Up next in this block" : "First to-do"}</p>
          <p className="pnt-title">{pick.title}</p>
          <div className="pnt-acts">
            <button type="button" className="primary big" onClick={() => onStart(pick)}>
              Start
            </button>
            {committed && (
              <button type="button" className="big" onClick={() => onDone(pick)}>
                Done
              </button>
            )}
          </div>
        </div>
      ) : card.kind === "block" ? (
        <p className="ph-now-none muted">Nothing planned for this block.</p>
      ) : null)}
    </section>
  );
}

/** Today's to-dos, grouped by block: a checkbox, the title on its own line (two at most), then time, size and client. */
export function PhoneTodos({ blocks, picks, data, nameOf, committed, now, onTick }: { blocks: readonly Slot[]; picks: readonly Pick[]; data: WeekLoadData; nameOf: (k: string) => string; committed: boolean; now: string; onTick: (p: Pick, done: boolean) => void }): ReactNode {
  const sheet = useTodoSheet();
  const tz = userZone(data);
  const start = (p: Pick) => data.timeboxes.find((t) => t.pickId === p.id && !t.removedAt)?.start ?? null;
  if (!blocks.length) return null;
  return (
    <section className="ph-todos" aria-label="Today's to-dos">
      <h2 className="section-label">To-dos</h2>
      {blocks.map((s) => {
        const client = s.focus[0]?.clientKey ?? null;
        const mine = picks
          .filter((p) => p.half === s.half && live(p))
          .sort((a, b) => (start(a) && start(b) ? ms(start(a)!) - ms(start(b)!) : start(a) ? -1 : start(b) ? 1 : a.id - b.id));
        const over = ms(s.end) <= ms(now);
        return (
          <div key={s.half} className={`ph-block${over ? " over" : ""}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
            <h3 className="ph-block-head">
              <span className="swatch" aria-hidden="true" />
              {client ? nameOf(client) : "Open"}
              <span className="muted"> · {startClock(s.start, tz)}–{startClock(s.end, tz)}</span>
            </h3>
            {mine.length ? (
              <ul className="ph-todo-list">
                {mine.map((p) => (
                  <li key={p.id} className={`ph-todo ${p.status}`}>
                    <input type="checkbox" checked={p.status === "done"} disabled={!committed && p.status !== "done"} onChange={(e) => onTick(p, e.target.checked)} aria-label={`Done: ${p.title}`} />
                    <button type="button" className="ph-todo-main" aria-haspopup="dialog" onClick={() => sheet?.(p)} aria-label={`${p.title}. ${todoLine(p, data, { client: false })}. Actions`}>
                      <span className="ph-todo-title">{p.title}</span>
                      <span className="ph-todo-line">{todoLine(p, data)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ph-block-none muted">Nothing planned.</p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The rest of today: meetings and events still to start and the blocks after this one, compact, titles on two lines at most. */
export function PhoneNextUp({ blocks, events, data, nameOf, now }: { blocks: readonly Slot[]; events: readonly DayEvent[]; data: WeekLoadData; nameOf: (k: string) => string; now: string }): ReactNode {
  const tz = userZone(data);
  const t = ms(now);
  const rows = [
    ...events.filter((e) => ms(e.start) > t).map((e) => ({ key: `e-${e.event.id}`, at: e.start, end: e.end, title: e.event.title, kind: e.kind as string })),
    ...blocks.filter((s) => ms(s.start) > t).map((s) => ({ key: `b-${s.half}`, at: s.start, end: s.end, title: `${s.focus[0] ? nameOf(s.focus[0].clientKey) : "Open"} block`, kind: "block" })),
  ].sort((a, b) => ms(a.at) - ms(b.at));
  if (!rows.length) return null;
  return (
    <section className="ph-next" aria-label="Next up">
      <h2 className="section-label">Next up</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className={`ph-next-row ${r.kind}`}>
            <span className="pn-time">{startClock(r.at, tz)}–{startClock(r.end, tz)}</span>
            <span className="pn-title">{r.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
