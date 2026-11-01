// Today (step 10): the default view. What's now and next, today's picks by block with the week's committed
// features as context, one large Start focus, and anything urgent. Everything else is a click away.
import { useCallback, useContext, useEffect, useState } from "react";
import type { LoopView, WeekLoadData } from "../actions/types.ts";
import { blockStatus } from "../plan/blockstatus.ts";
import type { NowStrip } from "../plan/now.ts";
import { capacityMinutes, fitOf, plannedMinutes } from "../plan/rules.ts";
import { focusPick, urgentLoops } from "../plan/today.ts";
import type { Pick } from "../plan/types.ts";
import type { Day, Half, Slot } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor, halfName, longDate, slotRange } from "./labels.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { featuresOn, PlanCtx } from "./planview.ts";
import { causeLines } from "./status.ts";
import { WorkLink } from "./WorkLink.tsx";

type Props = {
  data: WeekLoadData;
  strip: NowStrip | null;
  /** The next day to plan (today, or the next workday). */
  target: { date: string; isToday: boolean };
  now: string;
  nowMs: number;
  /** Starts focus on a pick (null: a plain focus timer). */
  onStart: (pick: Pick | null) => void;
  onFocusScreen: () => void;
  onPlan: (date?: string) => void;
  onInbox: () => void;
  onWeek: () => void;
  onFix: () => void;
};

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};

export function Today({ data, strip, target, now, nowMs, onStart, onFocusScreen, onPlan, onInbox, onWeek, onFix }: Props) {
  const date = data.planDay.date;
  const day = data.week.days.find((d) => d.date === date) ?? null;
  const plan = data.plan?.[date];
  const picks = plan?.picks ?? [];
  const committed = !!plan?.committedAt;
  const names = new Map(data.planClients.map((c) => [c.clientKey, c.clientName]));
  const nameOf = (k: string) => names.get(k) ?? k;
  const [loops, setLoops] = useState<LoopView[]>([]);
  const loadLoops = useCallback(() => void call<{ loops: LoopView[] }>("loops.list", {}).then((r) => setLoops(r.loops), () => setLoops([])), []);
  useEffect(loadLoops, [loadLoops, data.openLoops]);

  const due = urgentLoops(loops, date);
  const down = causeLines(data.sources, data.devops);
  const pick = focusPick(picks, strip?.half ?? null);
  const t = data.timer;
  const workday = data.planDay.workday && !!day && !day.pto;

  return (
    <main className="today-view" aria-label="Today">
      <header className="today-head">
        <h1>{longDate(date)}</h1>
        <p className="today-now">{nowLine(strip, workday, target)}</p>
      </header>

      {(due.length > 0 || down.length > 0) && (
        <section className="today-urgent" aria-label="Needs attention">
          {due.map((l) => (
            <button key={`l${l.id}`} type="button" className="today-alert" onClick={onInbox}>
              <span className="today-alert-tag">{l.due! < date ? "Overdue" : "Due today"}</span>
              <span>
                {l.who ? `${l.who}: ` : ""}
                {l.what}
              </span>
            </button>
          ))}
          {down.map((c) => (
            <button key={c.key} type="button" className="today-alert source" onClick={onFix}>
              <span className="today-alert-tag">Source</span>
              <span>{c.text}</span>
            </button>
          ))}
        </section>
      )}

      <section className="today-focus" aria-label="Focus">
        {t ? (
          <button type="button" className="today-start running" onClick={onFocusScreen}>
            <span className="today-start-main">{t.ended ? "Time's up" : `${countdown(timerLeft(t, nowMs))} left`}</span>
            <span className="today-start-sub">
              {t.kind === "break" ? "Break" : t.label} · back to the focus screen
            </span>
          </button>
        ) : workday && pick ? (
          <button type="button" className="today-start" onClick={() => onStart(pick)} style={{ "--c": clientColor(pick.clientKey, data.clients) } as React.CSSProperties}>
            <span className="today-start-main">Start focus</span>
            <span className="today-start-sub">
              {pick.title} · {nameOf(pick.clientKey)}
            </span>
          </button>
        ) : workday && !committed ? (
          <button type="button" className="today-start plan" onClick={() => onPlan(date)}>
            <span className="today-start-main">Plan today</span>
            <span className="today-start-sub">Pick the stories for each block, then start focus</span>
          </button>
        ) : workday ? (
          <div className="today-done">
            <p>Nothing left planned today.</p>
            <button type="button" className="primary" onClick={() => onStart(null)}>
              Start a plain focus timer
            </button>
          </div>
        ) : (
          <button type="button" className="today-start plan" onClick={() => onPlan(target.date)}>
            <span className="today-start-main">Plan {longDate(target.date).replace(/,\s*\d{4}$/, "")}</span>
            <span className="today-start-sub">No work today</span>
          </button>
        )}
      </section>

      {workday && day && (
        <section className="today-blocks" aria-label="Today's blocks">
          {slotsOf(day).map((s) => (
            <TodayBlock key={s.half} slot={s} data={data} picks={picks.filter((p) => p.half === s.half && (p.status === "planned" || p.status === "done"))} committed={committed} now={now} nameOf={nameOf} onStart={onStart} onPlan={() => onPlan(date)} running={t?.pickId ?? null} />
          ))}
        </section>
      )}

      <p className="today-foot">
        <button type="button" className="link-btn" onClick={onWeek}>
          See the whole week
        </button>
        {data.weekNudge.badge && <span className="muted"> · The week of {longDate(data.weekNudge.badge).replace(/,\s*\d{4}$/, "")} isn't planned yet</span>}
      </p>
    </main>
  );
}

function nowLine(s: NowStrip | null, workday: boolean, target: { date: string; isToday: boolean }): string {
  if (!workday) return target.isToday ? "" : `No work today. Next workday is ${longDate(target.date).replace(/,\s*\d{4}$/, "")}.`;
  if (!s) return "";
  const parts: string[] = [s.title + (s.until && (s.kind === "slot" || s.kind === "lunch") ? ` until ${hm(s.until)}` : s.until && s.kind === "before" ? ` at ${hm(s.until)}` : "")];
  if (s.event) parts.push(s.event.now ? `In ${s.event.title} until ${hm(s.event.at)}` : `Next: ${s.event.title} at ${hm(s.event.at)}`);
  return parts.join(". ") + ".";
}

/** The day's slots that have a focus block, an Open half-day or picks. */
function slotsOf(day: Day): Slot[] {
  return [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => !s.off && (s.focus.length > 0 || s.open || s.half === "EVE"));
}

function TodayBlock({ slot, data, picks, committed, now, nameOf, onStart, onPlan, running }: { slot: Slot; data: WeekLoadData; picks: Pick[]; committed: boolean; now: string; nameOf: (k: string) => string; onStart: (p: Pick) => void; onPlan: () => void; running: number | null }) {
  const view = useContext(PlanCtx);
  const client = slot.focus[0]?.clientKey ?? null;
  const ended = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.end)) >= 0;
  const left = picks.filter((p) => p.status === "planned");
  const fit = committed && left.length && !ended ? fitOf(plannedMinutes(left, data.planning.sizes), capacityMinutes(slot, now)) : null;
  const status = blockStatus(fit, slot.risks);
  const features = slot.half === "EVE" ? [] : featuresOn(data.weekFeatures, slot.date, slot.half as Half, client);
  const title = client ? nameOf(client) : slot.open ? "Open" : halfName(slot.half);
  return (
    <article className={`today-block${ended ? " ended" : ""}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as React.CSSProperties}>
      <header>
        <span className="today-block-when">
          {halfName(slot.half)} · {slotRange(slot, data.hours.timeZone)}
        </span>
        <h2>{title}</h2>
        {status.kind !== "none" && (
          <span className={`status-pill ${status.kind}`} title={status.detail ?? undefined}>
            {status.label}
          </span>
        )}
      </header>
      {features.length > 0 && (
        <p className="today-week">
          This week:{" "}
          {features.map((f, i) => (
            <span key={f.itemId}>
              {i > 0 && ", "}
              <WorkLink clientKey={f.clientKey} url={f.url}>
                #{f.itemId} {f.title}
              </WorkLink>
            </span>
          ))}
        </p>
      )}
      {picks.length ? (
        <ul className="today-picks">
          {picks.map((p) => (
            <li key={p.id} className={p.status === "done" ? "done" : undefined}>
              <input type="checkbox" checked={p.status === "done"} onChange={(e) => view.toggle(p.id, e.target.checked)} aria-label={`Done: ${p.title}`} disabled={!committed} />
              <span className="today-pick-title">{p.itemUrl ? <WorkLink clientKey={p.clientKey} url={p.itemUrl}>{p.title}</WorkLink> : p.title}</span>
              {!committed && <span className="draft-tag">draft</span>}
              {p.status === "planned" && running !== p.id && (
                <button type="button" className="mini" onClick={() => onStart(p)} title="Start focus on this pick">
                  Start focus
                </button>
              )}
              {running === p.id && <span className="today-running">Focusing</span>}
            </li>
          ))}
        </ul>
      ) : (
        !ended && (
          <p className="today-empty">
            Nothing planned.{" "}
            <button type="button" className="link-btn" onClick={onPlan}>
              Plan it
            </button>
          </p>
        )
      )}
      {data.resumeNotes[client ?? ""] && <p className="today-resume" title="Resume note from the last session">Left off: {data.resumeNotes[client!]!.note}</p>}
    </article>
  );
}
