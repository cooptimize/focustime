// Today (step 10): the default view. What's now and next, today's picks by block with the week's committed
// features as context, one large Start focus, and anything urgent. Everything else is a click away.
import { ModeArea } from "./ModeSwitch.tsx";
import type React from "react";
import { VmToday } from "./Account.tsx";
import { DueBadge } from "./FollowUps.tsx";
import { useContext, useState } from "react";
import type { FollowUpView, WeekLoadData } from "../actions/types.ts";
import { blockStatus } from "../plan/blockstatus.ts";
import type { NowStrip } from "../plan/now.ts";
import { planFit } from "../plan/fit.ts";
import { PickRow } from "./PickRow.tsx";
import { focusPick, urgentFollowUps } from "../plan/today.ts";
import type { Pick } from "../plan/types.ts";
import type { Day, Half, Slot } from "../week/types.ts";
import { clientColor, halfName, longDate, slotRange } from "./labels.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { featuresOn, PlanCtx } from "./planview.ts";
import { causeLines } from "./status.ts";
import { WorkLink } from "./WorkLink.tsx";
import { WeekMusts } from "./WeekMusts.tsx";
import { mondayOf } from "../week/dates.ts";

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
  /** Step 15 (D269): "This week: <feature>" opens Plan the day on that block, filtered to the feature. */
  onPlanFeature?: (date: string, half: Half, itemId: number) => void;
  onInbox: () => void;
  onWeek: () => void;
  onFix: () => void;
  /** Opens Settings at a section (an expiring PAT or secret). */
  onSettings: (section: string) => void;
  /** Step 16.2: Today's mode switch (Now · Plan · Check-in · Close out), at the right of the header. */
  switcher?: React.ReactNode;
};

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};

export function Today({ data, strip, target, now, nowMs, onStart, onFocusScreen, onPlan, onPlanFeature, onInbox, onWeek, onFix, onSettings, switcher }: Props) {
  const date = data.planDay.date;
  const day = data.week.days.find((d) => d.date === date) ?? null;
  const plan = data.plan?.[date];
  const picks = plan?.picks ?? [];
  const committed = !!plan?.committedAt;
  const names = new Map(data.planClients.map((c) => [c.clientKey, c.clientName]));
  const nameOf = (k: string) => names.get(k) ?? k;
  // Step 13.5: due today and overdue follow-ups at the top, with the same badge words as everywhere.
  const due: FollowUpView[] = urgentFollowUps(data.followUps, date);
  const down = causeLines(data.sources, data.devops);
  const pick = focusPick(picks, strip?.half ?? null);
  const t = data.timer;
  const workday = data.planDay.workday && !!day && !day.pto;
  // Step 14.5 (D260): the one-time hint goes on the first planned pick with no time yet.
  const hintPick = committed ? picks.find((p) => p.status === "planned" && !data.timeboxes.some((t) => t.pickId === p.id && !t.removedAt))?.id ?? null : null;

  return (
    <main className="today-view" aria-label="Today">
      <header className="today-head">
        <div className="ph-title">
          <h1>
            Today <span className="muted">{longDate(date)}</span>
          </h1>
          <p className="today-now">{nowLine(strip, workday, target)}</p>
        </div>
        <ModeArea>{switcher}</ModeArea>
      </header>
      <FlowHint />

      {(due.length > 0 || down.length > 0 || data.expiring.length > 0) && (
        <section className="today-urgent" aria-label="Needs attention">
          {due.map((l) => (
            <button key={`l${l.id}`} type="button" className="today-alert" onClick={onInbox}>
              <DueBadge l={l} />
              <span>
                {l.hasWho ? `${l.who}: ` : ""}
                {l.what}
              </span>
            </button>
          ))}
          {data.expiring.map((x) => (
            <button key={x.key} type="button" className={`today-alert expiry${x.days < 0 ? " expired" : ""}`} onClick={() => onSettings(x.section)}>
              <span className="today-alert-tag">{x.days < 0 ? "Expired" : "Expires"}</span>
              <span>{x.text}</span>
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

      <VmToday />
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
            <TodayBlock key={s.half} slot={s} data={data} picks={picks.filter((p) => p.half === s.half && (p.status === "planned" || p.status === "done"))} committed={committed} now={now} nameOf={nameOf} onStart={onStart} onPlan={() => onPlan(date)} onFeature={onPlanFeature ? (half, itemId) => onPlanFeature(date, half, itemId) : undefined} running={t?.pickId ?? null} hintPick={hintPick} />
          ))}
        </section>
      )}

      <WeekMusts data={data} weekStart={mondayOf(workday ? date : target.date)} now={null} title={workday || mondayOf(target.date) === mondayOf(date) ? "This week" : "Next week"} />

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

function TodayBlock({ slot, data, picks, committed, now, nameOf, onStart, onPlan, onFeature, running, hintPick }: { onFeature?: ((half: Half, itemId: number) => void) | undefined; slot: Slot; data: WeekLoadData; picks: Pick[]; committed: boolean; now: string; nameOf: (k: string) => string; onStart: (p: Pick) => void; onPlan: () => void; running: number | null; hintPick: number | null }) {
  const view = useContext(PlanCtx);
  const client = slot.focus[0]?.clientKey ?? null;
  const ended = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.end)) >= 0;
  const left = picks.filter((p) => p.status === "planned");
  // Step 15 (D266): the plan's fit against the block's whole free time, in the same words as Plan the day.
  const fit = committed && left.length && !ended ? planFit(picks, data.planning.sizes, view.timeboxes, slot) : null;
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
              {onFeature && !ended ? (
                <button type="button" className="link-btn" onClick={() => onFeature(slot.half, f.itemId)} title="Plan this block from that feature">
                  {f.title}
                </button>
              ) : (
                <WorkLink clientKey={f.clientKey} url={f.url}>
                  {f.title}
                </WorkLink>
              )}
            </span>
          ))}
        </p>
      )}
      {picks.length ? (
        <ul className="today-picks">
          {picks.map((p) => (
            <PickRow
              key={p.id}
              pick={p}
              toggle={view.toggle}
              link
              canTick={committed}
              timeEditable={committed && !ended}
              hint={p.id === hintPick}
              extra={
                <>
                  {!committed && <span className="draft-tag">draft</span>}
                  {p.status === "planned" && running !== p.id && (
                    <button type="button" className="mini" onClick={() => onStart(p)} title="Start focus on this pick">
                      Start focus
                    </button>
                  )}
                  {running === p.id && <span className="today-running">Focusing</span>}
                </>
              }
            />
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

const HINT_KEY = "coopilot.hint.flow";
/** A first-run hint (step 10), dismissed for good in this browser profile. Storage can fail; the hint then just shows. */
export function FlowHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === "dismissed";
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(HINT_KEY, "dismissed");
    } catch {
      /* shows again next time */
    }
    setHidden(true);
  };
  return (
    <aside className="flow-hint" aria-label="How Coopilot fits together">
      <p>
        <strong>Week</strong> is each client's musts and nice to haves, from DevOps. <strong>Day</strong> is for stories: what you pick for each block. <strong>Focus</strong> is one story at a time.
      </p>
      <button type="button" className="mini" onClick={dismiss}>Got it</button>
    </aside>
  );
}
