// Plan the day: the planned day's column becomes a short planning panel. Each half-day shows its real capacity,
// picks come from that client's DevOps items in board order (story level only) or a typed intention, and one
// key commits. Everything here is local: the actions only write Coopilot's plan store.
import { CreateInDevOps } from "./DevOpsWrite.tsx";
import { useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { blockClient, capacityMinutes, draftOffer, fitOf, isPickable, pickableChildren, weekFirst } from "../plan/rules.ts";
import { agendaOf, planMyDay, type DayPlacement, type Unplaced } from "../plan/agenda.ts";
import { scrollKeyDelta, wheelEscapes } from "./scroll.ts";
import { slotPlanned } from "../plan/timebox.ts";
import { pinLabel, weekList } from "../plan/weeklist.ts";
import { dayLabel } from "../plan/days.ts";
import { SIZES, type DraftStory, type PlanDayState, type Pick, type Size } from "../plan/types.ts";
import type { Day, Half, Slot, WorkItem } from "../week/types.ts";
import { fitLabel, formatMinutes } from "./planday.ts";
import { clientColor, halfTag, longDate, shortDate, slotRange, startClock } from "./labels.ts";
import { cardHalves, slotOf } from "./halves.ts";
import { DevOpsWork, typeTag, workStatusLabel } from "./work.ts";
import { PlanCtx, useFocused } from "./planview.ts";
import { dayFocus, focusLabel, liveFocused } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { WorkLink } from "./WorkLink.tsx";
import { call } from "./api.ts";
import { copy, DueBadge } from "./FollowUps.tsx";
import { dueOrder } from "../plan/due.ts";
import { isTypingTarget, ITEM_ATTRS, topOverlay } from "./keys.ts";
import { itemMenu, pickMenu, spanText, timeboxStep } from "./menu.ts";
import { MenuRow, useMenu } from "./Menus.tsx";
import { TimeboxDetails, useTimeboxes } from "./Timeboxes.tsx";
import { NOTICE_EVENT } from "./WorkLink.tsx";

export type PlanDayAct = (action: string, input: Record<string, unknown>) => Promise<boolean>;

type Props = {
  day: Day;
  state: PlanDayState;
  /** "Today" or "Next workday" when it's one of those, so it's clear which day is planned. */
  which: string | null;
  /** Friday of the same week, when it is not this day (for "move to Friday"). */
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  /** Clients that can be picked from in an Open half-day (this week's DevOps clients, Cooptimize included). */
  clients: { clientKey: string; clientName: string }[];
  error: string | null;
  act: PlanDayAct;
  onCommit: () => void;
  /** Step 14 (D254): set right after a commit, so the panel offers Timebox my day. */
  justCommitted?: boolean;
  onCommitSeen?: () => void;
  onClose: () => void;
  /** ← → and the ‹ › buttons: the previous or next day that can be planned. */
  onStep: (dir: 1 | -1) => void;
  /** Step 13.6: "+ Add work" or A on a block opens the panel on that block's picker (n changes on each request). */
  start?: { half: Half; n: number } | null;
};

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";

export function PlanDay({ day, state, which, friday, now, tz, colors, clients, error, act, onCommit, onClose, onStep, start, justCommitted = false, onCommitSeen }: Props) {
  const past = state.access === "past";
  const off = day.pto;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  // Adding a candidate removes its button; keep keyboard focus in the panel instead of dropping it to the page.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) ref.current?.focus({ preventScroll: true });
  }, [state]);
  const picked = new Set(state.picks.filter(inPlay).map((p) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : `t${p.clientKey}:${p.title}`)));
  // Step 13.5: follow-ups due on this day or overdue, at the top.
  const pv = useContext(PlanCtx);
  const dueTop = (pv.followUps ?? []).filter((f) => f.due !== null && f.due <= day.date && !picked.has(`f${f.id}`));
  // Step 10: one block at a time shows what can be picked (its client's work); the others show their picks. It starts
  // on the half-day under way (or the first one) and moves when another block is clicked.
  const halves = cardHalves(day).filter((half) => !slotOf(day, half)!.off || day.kind === "overflow" || state.picks.some((p) => p.half === half && p.date === day.date && inPlay(p)));
  const nowI = Temporal.Instant.from(now);
  const firstHalf = halves.find((h) => Temporal.Instant.compare(Temporal.Instant.from(slotOf(day, h)!.end), nowI) > 0) ?? halves[0] ?? "AM";
  const [active, setActive] = useState<Half>(start && halves.includes(start.half) ? start.half : firstHalf);
  useEffect(() => setActive(firstHalf), [day.date]);
  // Step 13.6 (D241): open on the block "+ Add work" was clicked on, scrolled into view with its picker.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!start || !halves.includes(start.half)) return;
    setActive(start.half);
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-half="${start.half}"]`)?.scrollIntoView({ block: "start" }));
  }, [start?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Step 13.6 (D242): the lists scroll inside the panel; a wheel or trackpad at an edge never reaches the page.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // A nested scroller (a long textarea) that can still move takes it; otherwise the panel's list does or nothing.
      if (wheelEscapes(el, e.deltaY)) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const [myDay, setMyDay] = useState(false);
  const tbEnv = useTimeboxes();
  const boxed = new Set((tbEnv?.timeboxes ?? []).filter((t) => t.date === day.date && !t.removedAt).map((t) => t.pickId));
  const unboxed = state.picks.filter((p) => p.date === day.date && p.status === "planned" && !boxed.has(p.id)).length;
  const committed = state.plan.committedAt;

  const onKey = (e: KeyboardEvent) => {
    // Step 13.5: keys from a dialog or menu (React bubbles them through portals) are theirs alone.
    if (topOverlay(document) === "modal") return;
    const typing = isTypingTarget(e.target as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // Leaving a text box keeps focus in the panel, so the next Esc closes it.
      if (typing) ref.current?.focus({ preventScroll: true });
      else onClose();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    // Scroll keys move the panel's list, never the page behind (D242). Buttons keep Space and Enter.
    const d = scrollKeyDelta(e.key, scroller.current?.clientHeight ?? 0, typing);
    if (d !== null && scroller.current && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      const el = scroller.current;
      el.scrollTo({ top: d === Infinity ? el.scrollHeight : d === -Infinity ? 0 : el.scrollTop + d });
      return;
    }
    if ((e.key === "c" || e.key === "C") && !past) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const badge = past ? "Past" : which;

  // This day's focused time (step 6d): its own log, on top of the week's, live while a session runs.
  const view = useContext(PlanCtx);
  const inner = { ...view, focused: { ...view.focused, ...state.focused }, resumeNotes: state.resumeNotes };
  const totals = dayFocus(state.picks.filter((p) => p.date === day.date && p.status !== "moved"), (id) => liveFocused(id, inner.focused, inner.timer, inner.nowMs), inner.sizes);

  return (
    <PlanCtx.Provider value={inner}>
    <section ref={ref} className="planday" tabIndex={-1} aria-label={`Plan ${longDate(day.date)}`} onKeyDown={onKey}>
      <header className="pd-head">
        <div>
          <h2>
            {past ? "Review" : "Plan"} {longDate(day.date)}
            {badge && <span className={`pd-which ${badge === "Today" ? "today" : badge === "Past" ? "past" : "next"}`}>{badge}</span>}
          </h2>
          <p className="muted">
            {past
              ? `This day is past: tick picks done or drop them. Nothing else changes here.${state.carryTarget ? ` Unfinished picks are offered to carry over on ${dayLabel(state.carryTarget)}.` : ""}`
              : committed
                ? `Committed at ${startClock(committed.replace(/\[.*\]$/, ""), tz)}. Changes are saved as you go; commit again when done.`
                : "About two minutes: pick story-level work for each block, then commit."}
          </p>
          {totals.plannedMinutes > 0 && (
            <p className="pd-focus">
              <strong>{formatDuration(totals.focusedMinutes)}</strong> focused of {formatDuration(totals.plannedMinutes)} planned
            </p>
          )}
        </div>
        <div className="pd-actions">
          <span className="pd-step" role="group" aria-label="Day">
            <button type="button" onClick={() => onStep(-1)} aria-label="Previous day (←)" title="Previous day (←)">
              ‹
            </button>
            <button type="button" onClick={() => onStep(1)} aria-label="Next day (→)" title="Next day (→)">
              ›
            </button>
          </span>
          {!past && !off && committed && !justCommitted && (
            <button type="button" onClick={() => setMyDay(true)} title="Place every planned pick without a timebox into its block's free time">
              Timebox my day
            </button>
          )}
          {!past && (
            <button type="button" className="commit" onClick={onCommit} title="Commit (C)">
              <kbd>c</kbd> {committed ? "Commit again" : "Commit"}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close planning">
            Esc
          </button>
        </div>
      </header>
      {justCommitted && !past && (
        <div className="pd-committed" role="status">
          <p>
            <strong>Committed.</strong>{" "}
            {unboxed > 0 && !off ? `${unboxed} planned pick${unboxed === 1 ? " has" : "s have"} no time yet. Timebox them into the free gaps now?` : "Every planned pick has its time."}
          </p>
          {unboxed > 0 && !off && (
            <button type="button" className="primary" onClick={() => (onCommitSeen?.(), setMyDay(true))}>
              Timebox my day
            </button>
          )}
          <button type="button" onClick={() => onCommitSeen?.()}>
            Keep planning
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {error && (
        <p className="pd-error" role="alert">
          {error}
        </p>
      )}
      <div ref={scroller} className="pd-scroll" tabIndex={-1}>

      {off && (
        <p className="pd-pto full" role="note">
          <strong>PTO</strong> · {off.titles.join(", ")}. This day is off, so nothing can be planned on it.
        </p>
      )}

      {!off && !past && dueTop.length > 0 && (
        <section className="pd-due" aria-label="Follow-ups due">
          <h3>Follow-ups due</h3>
          <ul>
            {dueTop.map((f) => (
              <li key={f.id}>
                <DueBadge l={f} /> <span className="fu-what">{f.hasWho ? `${f.who}: ` : ""}{f.what}</span>
                {f.clientName && <span className="muted"> · {f.clientName}</span>}
              </li>
            ))}
          </ul>
          <p className="muted pd-note">Pick one into a block below (under its client), or close it in the Inbox.</p>
        </section>
      )}

      {!off && !past && state.carryOver.length > 0 && <CarryOver picks={state.carryOver} date={day.date} act={act} />}
      {!off && !past && state.carryTarget && state.carryTarget < day.date && (
        <p className="muted pd-note">Unfinished picks from earlier days are offered on {dayLabel(state.carryTarget)}, the first day not committed yet.</p>
      )}

      {!off && past && <PastDay halves={[...new Set<Half>(["AM", "PM", ...state.picks.filter((p) => p.date === day.date && p.half === "EVE").map((p) => p.half)])]} picks={state.picks.filter((p) => p.date === day.date && p.status !== "moved")} act={act} />}

      {!off && !past && <div className="pd-blocks">
        {halves.map((half) => (
          <Block
            key={half}
            dataHalf={half}
            active={active === half}
            onActivate={() => setActive(half)}
            slot={slotOf(day, half)!}
            overflow={day.kind !== "work" && half !== "EVE"}
            picks={state.picks.filter((p) => p.half === half && p.date === day.date && inPlay(p))}
            drafts={state.drafts}
            weekFeatures={state.weekFeatures}
            picked={picked}
            other={half === "AM" ? "PM" : half === "PM" ? "AM" : day.pm.off ? "AM" : "PM"}
            friday={friday}
            now={now}
            tz={tz}
            colors={colors}
            clients={clients}
            act={act}
          />
        ))}
      </div>}
      </div>
      {myDay && <TimeboxMyDay day={day} picks={state.picks.filter((p) => p.date === day.date)} weekFeatures={state.weekFeatures} now={now} tz={tz} onClose={() => setMyDay(false)} />}
    </section>
    </PlanCtx.Provider>
  );
}

/** "45m of M" when a pick has a minute or more of focused time (step 6d); the size alone otherwise. */
/** "9:30" when a pick is timeboxed today (its time counts instead of its size). */
function TimeboxChip({ pickId }: { pickId: number }) {
  const env = useTimeboxes();
  const mine = env?.timeboxes.filter((t) => t.pickId === pickId && !t.removedAt) ?? [];
  if (!env || !mine.length) return null;
  const f = (s: string) => Temporal.Instant.from(s).toZonedDateTimeISO(env.tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return <span className="tb-chip" title="Timeboxed: its timebox counts as planned time instead of its size">{mine.map((t) => f(t.start)).join(", ")}</span>;
}

function SizeTag({ pick }: { pick: Pick }) {
  const label = focusLabel(useFocused()(pick.id), pick.size);
  return <span className={`size-tag${label ? " focused" : ""}`}>{label ?? pick.size}</span>;
}

/** Focused time beside the S/M/L buttons of a pick being planned; nothing until a minute is logged. */
function FocusNote({ pick }: { pick: Pick }) {
  const label = focusLabel(useFocused()(pick.id), pick.size);
  return label ? <span className="focus-note">{label}</span> : null;
}

/** A past day: its picks per block, tick done or drop. No sizes, moves, candidates or commit (server enforces it too). */
function PastDay({ halves, picks, act }: { halves: Half[]; picks: Pick[]; act: PlanDayAct }) {
  return (
    <div className="pd-blocks past">
      {halves.map((half) => {
        const mine = picks.filter((p) => p.half === half);
        return (
          <section key={half} className="pd-block past" aria-label={`${half} block`}>
            <header className="pd-block-head">
              <div className="pd-title">
                <span className="half-tag">{halfTag(half)}</span>
              </div>
            </header>
            {mine.length === 0 ? (
              <p className="muted pd-note">Nothing was planned.</p>
            ) : (
              <ol className="pd-picks">
                {mine.map((p) => (
                  <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }} className={p.status === "dropped" ? "dropped" : ""}>
                    <label className="pd-tick">
                      <input type="checkbox" checked={p.status === "done"} disabled={p.status === "dropped"} onChange={(e) => act("pick.mark_done", { id: p.id, done: e.target.checked })} />
                      <span className="pick-title" title={p.title}>
                        {p.title}
                        <span className="muted"> · {p.clientKey}</span>
                      </span>
                    </label>
                    <SizeTag pick={p} />
                    {p.status === "dropped" ? (
                      <span className="muted">dropped</span>
                    ) : (
                      p.status === "planned" && (
                        <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })} aria-label={`Drop ${p.title}`}>
                          Drop
                        </button>
                      )
                    )}
                  </MenuRow>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CarryOver({ picks, date, act }: { picks: Pick[]; date: string; act: PlanDayAct }) {
  return (
    <section className="pd-carry" aria-label="Unfinished from earlier days">
      <h3>Carry over · unfinished from earlier</h3>
      <ul>
        {picks.map((p) => (
          <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }}>
            <span className="carry-when">{shortDate(p.date)} {p.half}</span>
            <span className="carry-client">{p.clientKey}</span>
            <span className="pick-title">{p.title}</span>
            <SizeTag pick={p} />
            <span className="row-actions">
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "AM" })}>
                To AM
              </button>
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "PM" })}>
                To PM
              </button>
              <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })}>
                Drop
              </button>
            </span>
          </MenuRow>
        ))}
      </ul>
    </section>
  );
}

type BlockProps = {
  dataHalf: Half;
  /** Shows the candidates (step 10: one block at a time). */
  active: boolean;
  onActivate: () => void;
  slot: Slot;
  overflow: boolean;
  picks: Pick[];
  drafts: DraftStory[];
  weekFeatures: PlanDayState["weekFeatures"];
  picked: Set<string>;
  other: Half;
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  clients: { clientKey: string; clientName: string }[];
  act: PlanDayAct;
};

function Block({ dataHalf, slot, active, onActivate, overflow, picks, drafts, weekFeatures, picked, other, friday, now, tz, colors, clients, act }: BlockProps) {
  const focus = overflow ? null : slot.focus[0] ?? null;
  const bc = blockClient(focus?.clientKey ?? null, picks);
  const [chosen, setChosen] = useState<string | null>(null);
  const source = focus?.clientKey ?? chosen ?? bc.clientKey ?? clients[0]?.clientKey ?? null;
  const capacity = capacityMinutes(slot, now);
  const pv = useContext(PlanCtx);
  const fit = fitOf(slotPlanned(picks, pv.sizes, pv.timeboxes, slot), capacity);
  const started = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.start)) > 0;
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const style = { "--c": clientColor(bc.clientKey ?? undefined, colors) } as CSSProperties;
  // Where I left off with this block's client (step 7): the latest resume note up to this day.
  const notes = useContext(PlanCtx).resumeNotes;
  const note = (focus?.clientKey ?? bc.clientKey) ? notes?.[(focus?.clientKey ?? bc.clientKey)!] : undefined;

  return (
    <section className={`pd-block fit-${fit.kind} ${focus ? "focus" : "open"}${active ? " active" : " idle"}`} style={style} aria-label={`${slot.half} block`} data-half={dataHalf}>
      <header className="pd-block-head" onClick={active ? undefined : onActivate}>
        <div className="pd-title">
          <span className="half-tag">{halfTag(slot.half)}</span>
          <span className="muted">{slotRange(slot, tz)}</span>
          <span className="pd-client">
            <span className="swatch" />
            {focus ? focus.clientName : overflow ? "Overflow" : slot.half === "EVE" ? (slot.flex.length ? `Flex · ${slot.flex.map((f) => name(f.clientKey)).join(", ")}` : bc.clientKey ? `Evening · ${name(bc.clientKey)}` : "Evening") : bc.clientKey ? `Open · ${name(bc.clientKey)}` : "Open"}
          </span>
        </div>
        {note && (
          <p className="resume-note" title={`Resume note from ${shortDate(note.date)}`}>
            <span className="resume-tag">Left off {shortDate(note.date)}</span> {note.note}
          </p>
        )}
        <div className="pd-capacity">
          <span>
            <strong>{formatMinutes(capacity)}</strong> free{started ? " from now" : ""}
          </span>
          <span className={`fit ${fit.kind}`}>{fitLabel(fit)}</span>
        </div>
      </header>
      {!slot.off && <Agenda slot={slot} now={now} tz={tz} clientName={name} />}
      {bc.mixed && <p className="pd-flag">Mixed clients in one block: {bc.clients.map(name).join(", ")}</p>}
      {fit.kind === "over" && (
        <p className="pd-flag over">
          About {formatMinutes(fit.by)} more than the free time. Drop a pick, make one smaller, or move one to the {other === "AM" ? "morning" : "afternoon"}
          {friday ? " or to Friday" : ""}.
        </p>
      )}

      {picks.length > 0 && (
        <ol className="pd-picks">
          {picks.map((p) => (
            <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }} className={p.clientKey !== bc.clientKey ? "other-client" : ""}>
              <span className="wi-type">{p.kind === "intention" ? "Note" : typeTag(p.itemType ?? "")}</span>
              <TimeboxChip pickId={p.id} />
              <span className="pick-title" title={p.title}>
                {p.kind === "item" && p.itemUrl ? (
                  <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="pick-link">
                    {p.title}
                  </WorkLink>
                ) : (
                  p.title
                )}
                {p.clientKey !== bc.clientKey && <span className="muted"> · {name(p.clientKey)}</span>}
                {p.carriedFromDate && <span className="muted"> · from {shortDate(p.carriedFromDate)}</span>}
              </span>
              <FocusNote pick={p} />
              <span className="sizes" role="group" aria-label="Size">
                {SIZES.map((s) => (
                  <button key={s} type="button" className="size" aria-pressed={p.size === s} onClick={() => p.size !== s && act("pick.set_size", { id: p.id, size: s })}>
                    {s}
                  </button>
                ))}
              </span>
              <span className="row-actions">
                {p.status === "planned" && !slot.off && <TimeboxButton pick={p} />}
                <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: p.date, half: other })} aria-label={`Move to ${halfTag(other)}`}>
                  To {halfTag(other)}
                </button>
                {friday && (
                  <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: friday, half: "AM" })} aria-label="Move to Friday">
                    To Fri
                  </button>
                )}
                <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })} aria-label={`Drop ${p.title}`}>
                  Drop
                </button>
              </span>
            </MenuRow>
          ))}
        </ol>
      )}

      {!active && (
        <button type="button" className="mini pd-add-picks" onClick={onActivate}>
          {picks.length ? "Add more to this block" : "Pick work for this block"}
        </button>
      )}
      {active && !focus && clients.length > 0 && (
        <div className="client-chooser" role="group" aria-label="Pick from client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={source === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
        </div>
      )}

      {active && source && <Candidates clientKey={source} half={slot.half} date={slot.date} drafts={drafts} weekFeatures={weekFeatures} picked={picked} act={act} />}
      {active && source && <Intention clientKey={source} clientName={name(source)} half={slot.half} date={slot.date} act={act} />}
    </section>
  );
}

const SHOWN = 6;

function Candidates({ clientKey, half, date, drafts, weekFeatures, picked, act }: { clientKey: string; half: Half; date: string; drafts: DraftStory[]; weekFeatures: PlanDayState["weekFeatures"]; picked: Set<string>; act: PlanDayAct }) {
  const work = useContext(DevOpsWork).get(clientKey);
  const [all, setAll] = useState(false);
  const free = (i: WorkItem) => !picked.has(`i${clientKey}:${i.id}`);
  const draftsUnder = (id: number) => drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === id && !picked.has(`d${d.id}`));
  const add = (input: Record<string, unknown>) => act("pick.add", { date, half, clientKey, ...input });
  // Step 13.5: the client's open follow-ups, pickable like stories (size S by default).
  const fus = dueOrder((useContext(PlanCtx).followUps ?? []).filter((f) => f.clientKey === clientKey && !picked.has(`f${f.id}`)), date, (f) => f.due, (f) => f.openedAt);
  const fuList = fus.length > 0 && (
    <div className="candidates">
      <h4>Follow-ups <span className="muted">what you owe people</span></h4>
      <ul>
        {fus.map((f) => (
          <li key={`f${f.id}`}>
            <button type="button" className="cand" onClick={() => add({ followUpId: f.id })} title={`Follow-up${f.hasWho ? ` to ${f.who}` : ""}: ${f.what} (S)`}>
              <span className="plus" aria-hidden="true">+</span>
              <span className="wi-type">Follow-up</span>
              <span className="wi-title">{f.what}</span>
              <DueBadge l={f} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  // Step 11: the client's week list first: unfinished musts, then nice to haves (pinned to today first), then the
  // rest in board order. A must feature with no stories offers "Break down #id" with the Coop brief.
  const listed = weekList(weekFeatures, work ? [work] : null).items.map((f) => ({ ...f, done: !!f.done }));
  const first = half === "EVE" ? { musts: [], nice: [], rest: work?.items ?? [] } : weekFirst(work, listed, clientKey, date, half);
  const entry = (c: (typeof first.musts)[number]) => {
    const pin = c.pinnedToday ? <span className="muted pd-pin">{c.feature.slots.filter((s) => s.date === date).map(pinLabel).join(", ")}</span> : null;
    if (c.level === "story") {
      if (c.item && isPickable(c.item) && free(c.item))
        return (
          <MenuRow key={c.feature.itemId} build={(env) => itemMenu(env, clientKey, c.item!)} label={`Actions for ${c.item.type} ${c.item.id}`} item={{ clientKey, url: c.item.url }}>
            <button type="button" className="cand" onClick={() => add({ itemId: c.item!.id })} title={`${c.item.type} ${c.item.id}: ${c.item.title} (${c.item.state})`}>
              <span className="plus" aria-hidden="true">+</span>
              <span className="wi-type">{typeTag(c.item.type)}</span>
              <span className="wi-title">{c.item.title}</span>
              {pin}
            </button>
            <OpenItem clientKey={clientKey} item={c.item} />
          </MenuRow>
        );
      return (
        <li key={c.feature.itemId}>
          <span className="cand static">
            <span className="wi-type">Story</span>
            <span className="wi-title">{c.feature.title}</span>
            <span className="muted">{!work ? "DevOps not loaded" : c.item ? "picked" : "not open in DevOps"}</span>
          </span>
        </li>
      );
    }
    const breakDown = c.tier === "must" ? <BreakDown clientKey={clientKey} date={date} feature={c.feature} picked={picked} add={add} /> : null;
    return c.item ? (
      <Portfolio key={c.feature.itemId} item={c.item} clientKey={clientKey} kids={c.kids.filter(free)} drafts={draftsUnder(c.feature.itemId)} add={add} act={act} startOpen={c.placedHere || first.musts.length + first.nice.length === 1}
        extra={<>{pin}{!c.kids.length && !draftsUnder(c.feature.itemId).length ? breakDown : null}</>} />
    ) : (
      <li key={c.feature.itemId} className="portfolio">
        <div className="portfolio-row">
          <span className="cand parent static">
            <span className="wi-type">Feature</span>
            <span className="wi-title">{c.feature.title}</span>
            <span className="needs">{work ? "Needs breakdown" : "DevOps not loaded"}</span>
          </span>
        </div>
        {breakDown}
      </li>
    );
  };
  const group = (title: string, list: typeof first.musts) =>
    list.length > 0 && (
      <div className="candidates committed-first">
        <h4>{title}</h4>
        <ul>{list.map(entry)}</ul>
      </div>
    );
  const committedList = (first.musts.length > 0 || first.nice.length > 0) && (
    <>
      {group("Musts this week", first.musts)}
      {group("Nice to have", first.nice)}
    </>
  );
  // Step 9: draft stories captured for this client without a feature yet.
  const loose = drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === null && !picked.has(`d${d.id}`));
  const looseList = loose.length > 0 && (
    <div className="candidates">
      <h4>Draft stories <span className="muted">local, no feature yet</span></h4>
      <ul>
        {loose.map((d) => (
          <li key={`d${d.id}`}>
            <button type="button" className="cand" onClick={() => add({ draftId: d.id, size: d.size })} title={`Draft story: ${d.title} (${d.size})`}>
              <span className="plus" aria-hidden="true">+</span>
              <span className="wi-type">Draft</span>
              <span className="wi-title">{d.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  if (!work) return <>{fuList}{committedList}{looseList}<p className="muted pd-note">No DevOps items for {clientKey} this week. Type an intention instead.</p></>;
  // Board order: my story-level items, and my epics and features (which open into their children).
  const rows = first.rest.filter((i) => (isPickable(i) && free(i)) || i.level === "portfolio");
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
    {fuList}
    {committedList}
    {looseList}
    <div className="candidates">
      <h4>
        {first.musts.length + first.nice.length ? `The rest of ${work.clientName}, in board order` : `${work.clientName} in board order`}
        {work.status !== "ok" && <span className="muted"> · {workStatusLabel(work)}</span>}
      </h4>
      {rows.length === 0 && <p className="muted pd-note">Nothing left to pick for {work.clientName}. Type an intention instead.</p>}
      <ul>
        {shown.map((i) =>
          i.level === "portfolio" ? (
            <Portfolio key={i.id} item={i} clientKey={clientKey} kids={pickableChildren(i.id, work.children).filter(free)} drafts={draftsUnder(i.id)} add={add} act={act} />
          ) : (
            <MenuRow key={i.id} build={(env) => itemMenu(env, clientKey, i)} label={`Actions for ${i.type} ${i.id}`} item={{ clientKey, url: i.url }}>
              <button type="button" className="cand" onClick={() => add({ itemId: i.id })} title={`${i.type} ${i.id}: ${i.title} (${i.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(i.type)}</span>
                <span className="wi-title">{i.title}</span>
              </button>
              <OpenItem clientKey={clientKey} item={i} />
            </MenuRow>
          ),
        )}
      </ul>
      {rows.length > SHOWN && (
        <button type="button" className="mini quiet" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
    </>
  );
}

/** A small open link next to a candidate, so the row itself still adds the pick. */
function OpenItem({ clientKey, item }: { clientKey: string; item: WorkItem }) {
  return (
    <WorkLink clientKey={clientKey} url={item.url} className="open-item" title={`Open ${item.type} ${item.id} in DevOps`}>
      <span aria-hidden="true">↗</span>
      <span className="sr-only">Open {item.id} in DevOps</span>
    </WorkLink>
  );
}

function Portfolio({ item, clientKey, kids: children, drafts, add, act, startOpen = false, extra = null }: { item: WorkItem; clientKey: string; kids: WorkItem[]; drafts: DraftStory[]; add: (i: Record<string, unknown>) => Promise<boolean>; act: PlanDayAct; startOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<Size>("M");
  // Step 13.6 (D243): an epic with no features offers a draft feature; a feature with no stories a draft story.
  const offer = draftOffer(item);
  const kids = offer.kind === "feature" ? [] : children;
  const needs = kids.length === 0 && drafts.length === 0;
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <li className="portfolio" onContextMenu={menu.onContextMenu}>
      <div className="portfolio-row" {...ITEM_ATTRS(clientKey, item.url)}>
        <button type="button" className="cand parent" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${item.type} ${item.id}: ${item.title}`}>
          <span className="plus" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="wi-type">{typeTag(item.type)}</span>
          <span className="wi-title">{item.title}</span>
          <span className={needs ? "needs" : "muted kids"}>{needs ? (offer.kind === "feature" ? "Needs features" : "Needs breakdown") : offer.kind === "feature" ? `${drafts.length} draft feature${drafts.length === 1 ? "" : "s"}` : `${kids.length + drafts.length} to pick`}</span>
        </button>
        <OpenItem clientKey={clientKey} item={item} />
        {menu.button(`Actions for ${item.type} ${item.id}`)}
      </div>
      {extra}
      {open && (
        <ul className="kids-list">
          {kids.map((c) => (
            <MenuRow key={c.id} build={(env) => itemMenu(env, clientKey, c)} label={`Actions for ${c.type} ${c.id}`} item={{ clientKey, url: c.url }}>
              <button type="button" className="cand" onClick={() => add({ itemId: c.id })} title={`${c.type} ${c.id}: ${c.title} (${c.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(c.type)}</span>
                <span className="wi-title">{c.title}</span>
              </button>
              <OpenItem clientKey={clientKey} item={c} />
            </MenuRow>
          ))}
          {drafts.map((d) =>
            d.level === "feature" ? (
              <li key={`d${d.id}`}>
                <span className="cand static" title="A local draft feature: add it in DevOps, then break it into stories">
                  <span className="wi-type">Draft feature</span>
                  <span className="wi-title">{d.title}</span>
                </span>
                <CreateInDevOps drafts={[d]} />
              </li>
            ) : (
              <li key={`d${d.id}`}>
                <button type="button" className="cand" onClick={() => add({ draftId: d.id, size: d.size })}>
                  <span className="plus" aria-hidden="true">+</span>
                  <span className="wi-type">Draft</span>
                  <span className="wi-title">{d.title}</span>
                </button>
                <CreateInDevOps drafts={[d]} label="Create" />
              </li>
            ),
          )}
          <li>
            <form
              className="draft-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!title.trim()) return;
                if (await act(offer.action, offer.kind === "feature" ? { clientKey, parentItemId: item.id, title } : { clientKey, parentItemId: item.id, title, size })) setTitle("");
              }}
            >
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${offer.label} (local only)`} aria-label={`${offer.label} under ${item.title}`} maxLength={200} />
              {offer.kind === "story" && (
                <span className="sizes" role="group" aria-label="Draft size">
                  {SIZES.map((s) => (
                    <button key={s} type="button" className="size" aria-pressed={size === s} onClick={() => setSize(s)}>
                      {s}
                    </button>
                  ))}
                </span>
              )}
              <button type="submit" className="mini">{offer.kind === "feature" ? "Add draft feature" : "Add draft"}</button>
            </form>
          </li>
        </ul>
      )}
    </li>
  );
}

function Intention({ clientKey, clientName, half, date, act }: { clientKey: string; clientName: string; half: Half; date: string; act: PlanDayAct }) {
  const [text, setText] = useState("");
  return (
    <form
      className="intention"
      onSubmit={async (e) => {
        e.preventDefault();
        if (text.trim() && (await act("pick.add", { date, half, clientKey, intention: text }))) setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Or type an intention for ${clientName}, Enter to add`} aria-label={`Intention for ${half}`} maxLength={200} />
    </form>
  );
}

/** The pick title for breaking a feature down (step 10). */
export const breakDownTitle = (f: { itemId: number; title: string }) => `Break down #${f.itemId} ${f.title}`.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * A committed feature with no stories to pick (step 10): offer one pick to break it down (an intention, size M by
 * default) and the Coop brief beside it. Nothing is written to DevOps.
 */
function BreakDown({ clientKey, date, feature, picked, add }: { clientKey: string; date: string; feature: { itemId: number; title: string }; picked: Set<string>; add: (i: Record<string, unknown>) => Promise<boolean> }) {
  const title = breakDownTitle(feature);
  const [brief, setBrief] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const copyBrief = async () => {
    try {
      const r = await call<{ markdown: string; descriptionRead: boolean }>("feature.brief", { weekStart: date, clientKey, itemId: feature.itemId });
      setBrief(r.markdown);
      await new Promise((res) => setTimeout(res, 0));
      const ok = await copy(r.markdown, area.current);
      setNote(ok ? `Coop brief copied${r.descriptionRead ? "" : " (the description couldn't be read)"}` : "Copy didn't work: the brief is selected below, press Ctrl+C");
      if (ok) setBrief(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not build the brief");
    }
  };
  return (
    <div className="pd-breakdown">
      {picked.has(`t${clientKey}:${title}`) ? (
        <span className="muted">Break down #{feature.itemId} is planned</span>
      ) : (
        <button type="button" className="cand" onClick={() => void add({ intention: title, size: "M" })} title="Adds a pick (size M) to break this feature into stories">
          <span className="plus" aria-hidden="true">+</span>
          <span className="wi-title">Break down #{feature.itemId}</span>
        </button>
      )}
      <button type="button" className="mini" onClick={() => void copyBrief()}>Copy Coop brief</button>
      {note && <span className="muted" role="status">{note}</span>}
      {brief && <textarea ref={area} readOnly value={brief} rows={6} aria-label={`Coop brief for #${feature.itemId}`} />}
    </div>
  );
}

// ---------- step 13.6: the block agenda, Timebox and Timebox my day ----------

const isTodayIn = (date: string, now: string, tz: string) => Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString() === date;

/**
 * A block's agenda (D244): meetings, personal events, unavailable time and timeboxes in time order, with the free gaps
 * between ("Free 9:00–11:00 · 2h"). A timebox row opens its details (show as, Put on Outlook, Removed in Outlook).
 */
function Agenda({ slot, now, tz, clientName }: { slot: Slot; now: string; tz: string; clientName: (k: string | null) => string }) {
  const env = useTimeboxes();
  const [open, setOpen] = useState<number | null>(null);
  if (!env) return null;
  const rows = agendaOf(slot, env.timeboxes, isTodayIn(slot.date, now, tz) ? now : undefined);
  if (!rows.length) return null;
  const sel = open !== null ? env.timeboxes.find((t) => t.id === open && !t.removedAt) ?? null : null;
  return (
    <div className="pd-agenda">
      <ol aria-label={`${halfTag(slot.half)} agenda`}>
        {rows.map((r) => {
          const tb = r.kind === "timebox" ? env.timeboxes.find((t) => t.id === r.timeboxId) : undefined;
          const when = spanText(r.start, r.end, tz);
          if (r.kind === "free")
            return (
              <li key={`f${r.start}`} className="ag-free">
                <span className="ag-time">{when}</span>
                <span className="ag-title">Free · {formatDuration(r.minutes)}</span>
              </li>
            );
          if (tb)
            return (
              <li key={`t${tb.id}`} className={`ag-timebox${tb.outlookNote ? " noted" : ""}${tb.conflict ? " conflict" : ""}`} style={{ "--c": clientColor(tb.clientKey, env.colors) } as CSSProperties}>
                <button type="button" className="ag-open" aria-expanded={open === tb.id} onClick={() => setOpen(open === tb.id ? null : tb.id)} title="Timebox details: show as, Put on Outlook, remove">
                  <span className="ag-time">{when}</span>
                  <span className="ag-title">
                    {tb.conflict ? "⚠ " : ""}
                    {tb.title}
                  </span>
                  {tb.onOutlook && <span className="tb-ol" title="On Outlook">O</span>}
                  {tb.outlookNote && <span className="tb-note">{tb.outlookNote}</span>}
                </button>
              </li>
            );
          return (
            <li key={`e${r.eventId}${r.start}`} className={`ag-${r.kind}${r.free ? " shown-free" : ""}`}>
              <span className="ag-time">{when}</span>
              <span className="ag-title" title={r.title}>
                {r.title}
              </span>
              {r.free && <span className="muted">shown as free</span>}
            </li>
          );
        })}
      </ol>
      {sel && <TimeboxDetails tb={sel} env={env} clientName={clientName(sel.clientKey)} today={isTodayIn(sel.date, now, tz)} onRemoved={() => setOpen(null)} />}
    </div>
  );
}

/** A pick's Timebox (D245): its block's free gaps (one click places it), then Custom time. Hidden once it has one. */
function TimeboxButton({ pick }: { pick: Pick }) {
  const env = useTimeboxes();
  const menu = useMenu((m) => timeboxStep(m, pick));
  if (!env || env.timeboxes.some((t) => t.pickId === pick.id && !t.removedAt)) return null;
  return (
    <button type="button" className="mini" aria-haspopup="menu" onClick={menu.onContextMenu} title="Place it in a free gap of this block">
      Timebox
    </button>
  );
}

/** Musts on this day's picks: the item is a must on the week list, or its parent feature is. */
function mustPicks(picks: readonly Pick[], weekFeatures: PlanDayState["weekFeatures"], work: ReadonlyMap<string, { items: WorkItem[] }>): Set<number> {
  const musts = new Set(weekFeatures.filter((f) => f.tier === "must").map((f) => `${f.clientKey}:${f.itemId}`));
  const out = new Set<number>();
  for (const p of picks) {
    if (p.itemId === null) continue;
    const parent = work.get(p.clientKey)?.items.find((i) => i.id === p.itemId)?.parentId ?? null;
    if (musts.has(`${p.clientKey}:${p.itemId}`) || (parent !== null && musts.has(`${p.clientKey}:${parent}`))) out.add(p.id);
  }
  return out;
}

/**
 * Timebox my day (D246): every planned pick without a timebox, musts first, then larger sizes, into its block's free
 * gaps. Shows the resulting agenda first; each new timebox has its own Put on Outlook. Apply adds them all at once,
 * then any Outlook events go through one combined preview.
 */
function TimeboxMyDay({ day, picks, weekFeatures, now, tz, onClose }: { day: Day; picks: Pick[]; weekFeatures: PlanDayState["weekFeatures"]; now: string; tz: string; onClose: () => void }) {
  const env = useTimeboxes();
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork);
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    env?.loadAccess();
    first.current?.focus();
    return () => back.current?.focus?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [plan] = useState(() => {
    const blocks: Partial<Record<Half, Slot>> = {};
    for (const h of ["AM", "PM", "EVE"] as Half[]) {
      const sl = slotOf(day, h);
      if (sl && !sl.off) blocks[h] = sl;
    }
    return planMyDay(picks, blocks, env?.timeboxes ?? [], pv.sizes, mustPicks(picks, weekFeatures, work), isTodayIn(day.date, now, tz) ? now : undefined);
  });
  const [outlook, setOutlook] = useState<Record<number, boolean>>(() => Object.fromEntries(plan.placed.map((p) => [p.pickId, !!env?.settings.outlookDefault])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!env) return null;
  const canWrite = env.access?.access === "write";
  const anyOutlook = plan.placed.some((p) => outlook[p.pickId]);
  const allOutlook = plan.placed.length > 0 && plan.placed.every((p) => outlook[p.pickId]);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ timeboxes: { uid: string }[]; sync: string[] }>("timebox.add_many", { date: day.date, items: plan.placed.map((p) => ({ pickId: p.pickId, start: p.start, end: p.end, outlook: !!outlook[p.pickId] })) });
      env.changed();
      onClose();
      window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: `Timeboxed ${r.timeboxes.length} pick${r.timeboxes.length === 1 ? "" : "s"}` }));
      if (r.sync.length && canWrite) await env.syncMany(r.sync);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  const halvesShown = (["AM", "PM", "EVE"] as Half[]).filter((h) => plan.placed.some((p) => p.half === h) || plan.unplaced.some((u) => u.half === h));
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog write-dialog myday"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Timebox my day"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>Timebox my day</h2>
          <span className="muted">{longDate(day.date)} · musts first, then larger picks, each in its own block</span>
        </div>
        {plan.placed.length === 0 && plan.unplaced.length === 0 && <p className="muted">Every planned pick already has a timebox.</p>}
        {halvesShown.map((h) => (
          <MyDayBlock key={h} slot={slotOf(day, h)!} placed={plan.placed.filter((p) => p.half === h)} unplaced={plan.unplaced.filter((u) => u.half === h)} outlook={outlook} setOutlook={(id, v) => setOutlook((o) => ({ ...o, [id]: v }))} now={isTodayIn(day.date, now, tz) ? now : undefined} tz={tz} colors={env.colors} />
        ))}
        {plan.placed.length > 1 && (
          <label className="myday-all">
            <input type="checkbox" checked={allOutlook} onChange={(e) => setOutlook(Object.fromEntries(plan.placed.map((p) => [p.pickId, e.target.checked])))} /> Put all on Outlook
          </label>
        )}
        {anyOutlook && env.access && !canWrite && (
          <p className="tb-explain" role="note">
            {env.access.access === "not_set_up" ? "Outlook isn't set up, so these stay in Coopilot." : env.access.message}{" "}
            {(env.access.access === "read_only" || env.access.access === "not_connected") && (
              <button type="button" className="mini" onClick={env.connectWrite}>
                Reconnect Outlook
              </button>
            )}
          </p>
        )}
        {error && (
          <p className="set-problem" role="alert">
            {error}
          </p>
        )}
        <div className="wd-actions">
          <button ref={first} type="button" className="commit" disabled={busy || plan.placed.length === 0} onClick={() => void apply()}>
            {busy ? "Saving…" : `Timebox ${plan.placed.length} pick${plan.placed.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {anyOutlook && canWrite && <span className="muted">You'll see every Outlook event in one preview before anything is written.</span>}
        </div>
      </div>
    </div>
  );
}

function MyDayBlock({ slot, placed, unplaced, outlook, setOutlook, now, tz, colors }: { slot: Slot; placed: DayPlacement[]; unplaced: Unplaced[]; outlook: Record<number, boolean>; setOutlook: (id: number, v: boolean) => void; now: string | undefined; tz: string; colors: Record<string, string> }) {
  const env = useTimeboxes()!;
  // The resulting agenda: what is there now plus the new timeboxes (marked New).
  const proposed = placed.map((p) => ({ id: -p.pickId, date: slot.date, start: p.start, end: p.end, title: p.title, clientKey: p.clientKey, pickId: p.pickId, removedAt: null }));
  const rows = agendaOf(slot, [...env.timeboxes, ...proposed], now);
  return (
    <section className="myday-block" aria-label={`${halfTag(slot.half)} after timeboxing`}>
      <h3>
        <span className="half-tag">{halfTag(slot.half)}</span> {slot.focus[0]?.clientName ?? (slot.half === "EVE" ? "Evening" : "Open")}
      </h3>
      <ol className="pd-agenda-list">
        {rows.map((r) => {
          const when = spanText(r.start, r.end, tz);
          const p = r.kind === "timebox" && r.timeboxId !== undefined && r.timeboxId < 0 ? placed.find((x) => x.pickId === -r.timeboxId!) : undefined;
          if (p)
            return (
              <li key={`n${p.pickId}`} className="ag-timebox new" style={{ "--c": clientColor(p.clientKey, colors) } as CSSProperties}>
                <span className="ag-time">{when}</span>
                <span className="ag-title">
                  <span className="ag-new">New</span> {p.title}
                  {p.trimmed && <span className="muted"> · trimmed to {formatDuration(p.minutes)}</span>}
                </span>
                <label className="ag-ol">
                  <input type="checkbox" checked={!!outlook[p.pickId]} onChange={(e) => setOutlook(p.pickId, e.target.checked)} aria-label={`Put ${p.title} on Outlook`} /> Outlook
                </label>
              </li>
            );
          return (
            <li key={`${r.kind}${r.start}${r.timeboxId ?? r.eventId ?? ""}`} className={`ag-${r.kind}`}>
              <span className="ag-time">{when}</span>
              <span className="ag-title">{r.kind === "free" ? `Free · ${formatDuration(r.minutes)}` : r.title}</span>
            </li>
          );
        })}
      </ol>
      {unplaced.map((u) => (
        <p key={u.pickId} className="pd-flag">
          {u.title}: {u.reason}. Move it, make it smaller, or use Custom time.
        </p>
      ))}
    </section>
  );
}
