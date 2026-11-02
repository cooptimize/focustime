// Plan the day (step 15, D263 to D266): its own view with two panes, one job each. Left, "Your <Weekday>": each block
// with its picks as clean rows and one calm fit line. Right, "Add to <Client> <Morning>": this week's priorities, the
// client's follow-ups, then everything else. One "+" per row; every other action is in a row's ⋯ menu. Everything
// here is local: the actions only write Coopilot's plan store.
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps } from "./DevOpsWrite.tsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { blockClient, draftOffer, isPickable } from "../plan/rules.ts";
import { agendaOf, offerAfterTimebox, planMyDay, smallerSize, type DayPlacement, type DidntFit, type Unplaced } from "../plan/agenda.ts";
import { addSections, defaultBlock, doneAction, type PriorityRow } from "../plan/addpane.ts";
import { dayTotals, fitWords, planFit, planMinutes, trimCandidates } from "../plan/fit.ts";
import { freeMinutes } from "../week/free.ts";
import { weekList } from "../plan/weeklist.ts";
import { dayLabel } from "../plan/days.ts";
import { SIZES, type PlanDayState, type Pick, type Size } from "../plan/types.ts";
import type { Day, Half, Slot, WorkItem } from "../week/types.ts";
import { clientColor, halfName, halfTag, longDate, shortDate, slotRange } from "./labels.ts";
import { cardHalves, slotOf } from "./halves.ts";
import { DevOpsWork, typeTag } from "./work.ts";
import { PlanCtx, useFocused } from "./planview.ts";
import { focusLabel } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { WorkLink } from "./WorkLink.tsx";
import { call } from "./api.ts";
import { copy, DueBadge } from "./FollowUps.tsx";
import { dueOrder } from "../plan/due.ts";
import { isTypingTarget, topOverlay } from "./keys.ts";
import { halfLabel, itemMenu, pickMenu, possessive, spanText, weekTargets } from "./menu.ts";
import { MenuCtx, MenuRow, useMenu } from "./Menus.tsx";
import { TimeboxDetails, useTimeboxes } from "./Timeboxes.tsx";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { PickRow, PICK_DRAG } from "./PickRow.tsx";

export type PlanDayAct = (action: string, input: Record<string, unknown>) => Promise<boolean>;

type Props = {
  day: Day;
  state: PlanDayState;
  /** "Today" or "Next workday" when it's one of those, so it's clear which day is planned. */
  which: string | null;
  /** Friday of the same week, when it is not this day (kept for callers; moves live in the pick's ⋯ menu). */
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  /** Clients an Open half-day can take. */
  clients: { clientKey: string; clientName: string }[];
  error: string | null;
  act: PlanDayAct;
  onCommit: () => void;
  /** Step 14 (D254): set right after the first Done, so the view offers Timebox my day once. */
  justCommitted?: boolean;
  onCommitSeen?: () => void;
  onClose: () => void;
  /** ← → and the ‹ › buttons: the previous or next day that can be planned. */
  onStep: (dir: 1 | -1) => void;
  /** Step 15.1 (D274): the next day that can be planned, for "Move to <day>" on picks that didn't fit. */
  nextDay?: { date: string; label: string } | null;
  /** "+ Add work" or A on a block, or a card's "This week: <feature>" (focus): open on that block. */
  start?: { half: Half; n: number; focus?: number | null } | null;
  /** The ritual chips (Plan the day, Check-in, Close out, Plan the week), shown in this view's header (D268). */
  rituals?: ReactNode;
  /** Step 15.2: the selected block, so ⋯ menus add to it (null when the view closes). */
  onSelectBlock?: (half: Half | null) => void;
};

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";
const pickedKey = (p: Pick) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : `t${p.clientKey}:${p.title}`);
const weekdayOf = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long" });
const titleDate = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });

export function PlanDay({ day, state, which, now, tz, colors, clients, error, act, onCommit, onClose, onStep, nextDay = null, start, justCommitted = false, onCommitSeen, rituals, onSelectBlock }: Props) {
  const past = state.access === "past";
  const off = day.pto;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const pv = useContext(PlanCtx);
  const tbEnv = useTimeboxes();
  const timing = tbEnv?.settings.enabled !== false;
  const nowI = Temporal.Instant.from(now);
  const dayPicks = state.picks.filter((p) => p.date === day.date);
  const picked = new Set(dayPicks.filter(inPlay).map(pickedKey));
  const halves = cardHalves(day).filter((h) => !slotOf(day, h)!.off || day.kind === "overflow" || dayPicks.some((p) => p.half === h && inPlay(p)));
  const blocks = halves.map((h) => {
    const slot = slotOf(day, h)!;
    const picks = dayPicks.filter((p) => p.half === h && inPlay(p));
    const fit = planFit(picks, pv.sizes, pv.timeboxes, slot);
    return { half: h, slot, picks, fit, words: fitWords(fit), ended: Temporal.Instant.compare(nowI, Temporal.Instant.from(slot.end)) >= 0, planned: planMinutes(picks, pv.sizes, pv.timeboxes, slot), free: freeMinutes(slot) };
  });
  const firstSel = () => defaultBlock(blocks.map((b) => ({ half: b.half, ended: b.ended, fit: b.words.kind })), start?.half) ?? halves[0] ?? "AM";
  const [sel, setSel] = useState<Half>(firstSel);
  const [focusItem, setFocusItem] = useState<number | null>(start?.focus ?? null);
  const [dragging, setDragging] = useState<AddDrag | null>(null);
  useEffect(() => setSel(firstSel()), [day.date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!start) return;
    if (halves.includes(start.half)) setSel(start.half);
    setFocusItem(start.focus ?? null);
  }, [start?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onSelectBlock?.(sel), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSelectBlock?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [myDay, setMyDay] = useState(false);
  /** Step 15.1 (D274): what didn't fit after Timebox my day ran, until it's acted on or closed. */
  const [didntFit, setDidntFit] = useState<{ text: string; picks: DidntFit[] } | null>(null);
  const settle = (pickId: number) => setDidntFit((d) => {
    const picks = d?.picks.filter((x) => x.pickId !== pickId) ?? [];
    return picks.length ? { ...offerAfterTimebox({ placed: 0, unplaced: picks }).summary! } : null;
  });
  const boxed = new Set((tbEnv?.timeboxes ?? []).filter((t) => t.date === day.date && !t.removedAt).map((t) => t.pickId));
  const unboxed = dayPicks.filter((p) => p.status === "planned" && !boxed.has(p.id)).length;
  const hintPick = dayPicks.find((p) => p.status === "planned" && !boxed.has(p.id))?.id ?? null;
  const committed = state.plan.committedAt;
  const done = () => {
    if (past || doneAction(committed) === "close") return onClose();
    onCommit();
  };

  const onKey = (e: KeyboardEvent) => {
    if (topOverlay(document) === "modal") return;
    const typing = isTypingTarget(e.target as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (typing) ref.current?.focus({ preventScroll: true });
      else onClose();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === "c" || e.key === "C") && !past) {
      e.preventDefault();
      done();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  // Step 15.2: when focus falls to the page (a "+" became a check, a dialog closed), ← → C Esc still reach this view.
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const lost = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || (document.activeElement && document.activeElement !== document.body) || topOverlay(document) !== "none") return;
      if (!["ArrowLeft", "ArrowRight", "Escape", "c", "C"].includes(e.key)) return;
      ref.current?.focus({ preventScroll: true });
      keyRef.current(e as unknown as KeyboardEvent);
    };
    window.addEventListener("keydown", lost);
    return () => window.removeEventListener("keydown", lost);
  }, []);
  const inner = { ...pv, focused: { ...pv.focused, ...state.focused }, resumeNotes: state.resumeNotes };
  const selBlock = blocks.find((b) => b.half === sel) ?? blocks[0];
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const badge = past ? "Past" : which;

  return (
    <PlanCtx.Provider value={inner}>
      <section ref={ref} className="planday pd2" tabIndex={-1} aria-label={`Plan ${longDate(day.date)}`} onKeyDown={onKey}>
        <header className="pd2-head">
          {rituals}
          <div className="pd2-title">
            <h2>
              {past ? "Review" : "Plan"} {titleDate(day.date)}
              {badge && <span className={`pd-which ${badge === "Today" ? "today" : badge === "Past" ? "past" : "next"}`}>{badge}</span>}
              {committed && !past && <span className="pd-planned">Planned</span>}
            </h2>
            <p className="pd2-status">{off ? "Day off" : past ? "Tick what got done, or drop the rest" : dayTotals(blocks.filter((b) => !b.slot.off))}</p>
          </div>
          <div className="pd2-actions">
            <span className="pd-step" role="group" aria-label="Day">
              <button type="button" onClick={() => onStep(-1)} aria-label="Previous day (←)" title="Previous day (←)">‹</button>
              <button type="button" onClick={() => onStep(1)} aria-label="Next day (→)" title="Next day (→)">›</button>
            </span>
            {!past && !off && committed && timing && unboxed > 0 && (
              <button type="button" onClick={() => setMyDay(true)} title="Give every planned pick a time in its block's free time">
                Timebox my day
              </button>
            )}
            <button type="button" className="primary pd2-done" onClick={done} title={past ? "Close (Esc)" : committed ? "Close (C)" : "Save this plan for the day (C)"}>
              Done
            </button>
            <button type="button" className="quiet" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>
        {didntFit && !past && (
          <div className="pd-didnt-fit" role="status" aria-label="Picks that didn't fit">
            <p>
              <strong>{didntFit.text}</strong>
            </p>
            <ul>
              {didntFit.picks.map((u) => {
                const smaller = smallerSize(u.size);
                return (
                  <li key={u.pickId}>
                    <span className="df-title">
                      {u.title} <span className="muted">({u.size})</span>
                    </span>
                    {nextDay && (
                      <button type="button" className="mini" onClick={() => void act("pick.move", { id: u.pickId, date: nextDay.date, half: dayPicks.find((p) => p.id === u.pickId)?.half ?? "AM" }).then((ok) => ok && settle(u.pickId))}>
                        Move to {nextDay.label}
                      </button>
                    )}
                    {smaller && (
                      <button type="button" className="mini" onClick={() => void act("pick.set_size", { id: u.pickId, size: smaller }).then((ok) => ok && settle(u.pickId))} title={`Make it ${smaller}, then run Timebox my day again`}>
                        Make smaller
                      </button>
                    )}
                    <button type="button" className="mini quiet" onClick={() => settle(u.pickId)}>
                      Leave untimed
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="mini quiet df-close" onClick={() => setDidntFit(null)}>
              Got it
            </button>
          </div>
        )}
        {justCommitted && !didntFit && !past && timing && unboxed > 0 && !off && (
          <div className="pd-committed" role="status">
            <p>
              <strong>Planned.</strong> {unboxed} pick{unboxed === 1 ? " has" : "s have"} no time yet.
            </p>
            <button type="button" className="primary" onClick={() => (onCommitSeen?.(), setMyDay(true))}>
              Timebox my day
            </button>
            <button type="button" onClick={() => onCommitSeen?.()}>Not now</button>
          </div>
        )}
        {error && <p className="pd-error" role="alert">{error}</p>}
        {off ? (
          <p className="pd-pto full" role="note">
            <strong>Day off</strong> · {off.titles.join(", ")}. Nothing to plan.
          </p>
        ) : past ? (
          <div className="pd2-panes single">
            <PastDay halves={[...new Set<Half>(["AM", "PM", ...dayPicks.filter((p) => p.half === "EVE").map((p) => p.half)])]} picks={dayPicks.filter((p) => p.status !== "moved")} act={act} />
          </div>
        ) : (
          <AddDragCtx.Provider value={setDragging}>
          <div className="pd2-panes">
            <div className="pd2-left" aria-label={`Your ${weekdayOf(day.date)}`}>
              <h3 className="pd2-pane-title">Your {weekdayOf(day.date)}</h3>
              {state.carryOver.length > 0 && selBlock && <CarryOver picks={state.carryOver} date={day.date} to={selBlock.half} act={act} />}
              {state.carryTarget && state.carryTarget < day.date && <p className="muted pd-note">Unfinished work from earlier days shows on {dayLabel(state.carryTarget)}.</p>}
              {blocks.map((b) => (
                <DayBlock key={b.half} b={b} selected={b.half === sel} onSelect={() => setSel(b.half)} overflow={day.kind !== "work" && b.half !== "EVE"} tz={tz} now={now} colors={colors} name={name} act={act} hintPick={hintPick} weekFeatures={state.weekFeatures} />
              ))}
            </div>
            {selBlock && (
              <AddPane key={`${day.date}${selBlock.half}`} slot={selBlock.slot} picks={selBlock.picks} overflow={day.kind !== "work" && selBlock.half !== "EVE"} state={state} picked={picked} here={new Set(selBlock.picks.map(pickedKey))} clients={clients} colors={colors} act={act} focus={focusItem} clearFocus={() => setFocusItem(null)} />
            )}
          </div>
          {dragging && <WeekDropStrip drag={dragging} planDate={day.date} colors={colors} name={name} act={act} onDone={() => setDragging(null)} />}
          </AddDragCtx.Provider>
        )}
        {myDay && (
          <TimeboxMyDay
            day={day}
            picks={dayPicks}
            weekFeatures={state.weekFeatures}
            now={now}
            tz={tz}
            onClose={() => setMyDay(false)}
            onRan={(r) => {
              // Step 15.1 (D274): the "no time yet" offer is done once this summary is shown.
              const after = offerAfterTimebox(r);
              onCommitSeen?.();
              setDidntFit(after.summary);
              if (after.notice) window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: after.notice }));
            }}
          />
        )}
      </section>
    </PlanCtx.Provider>
  );
}

type BlockView = { half: Half; slot: Slot; picks: Pick[]; fit: ReturnType<typeof planFit>; words: ReturnType<typeof fitWords>; ended: boolean };

/** One block in the left pane: name, time, one fit line, its picks as rows. Click selects it; drop a pick to move it here. */
function DayBlock({ b, selected, onSelect, overflow, tz, now, colors, name, act, hintPick, weekFeatures }: { b: BlockView; selected: boolean; onSelect: () => void; overflow: boolean; tz: string; now: string; colors: Record<string, string>; name: (k: string | null) => string; act: PlanDayAct; hintPick: number | null; weekFeatures: PlanDayState["weekFeatures"] }) {
  const menus = useContext(MenuCtx);
  const { slot, picks, words } = b;
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork);
  const focus = overflow ? null : (slot.focus[0] ?? null);
  const bc = blockClient(focus?.clientKey ?? null, picks);
  const [trim, setTrim] = useState(false);
  const [cal, setCal] = useState(false);
  const [over, setOver] = useState(false);
  const env = useTimeboxes();
  const start = new Map((env?.timeboxes ?? []).filter((t) => !t.removedAt && t.date === slot.date && t.pickId !== null).map((t) => [t.pickId!, t.start]));
  const ordered = [...picks].sort((x, y) => {
    const a = start.get(x.id), c = start.get(y.id);
    if (a && c) return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(c));
    return a ? -1 : c ? 1 : x.position - y.position;
  });
  const marked = new Set(trim && b.fit.kind === "over" ? trimCandidates(picks, b.fit.by, pv.sizes, { musts: mustPicks(picks, weekFeatures, work), timed: new Set(start.keys()) }) : []);
  const title = focus ? focus.clientName : overflow ? "Catch-up" : slot.half === "EVE" ? (slot.flex.length ? `Flex · ${slot.flex.map((f) => name(f.clientKey)).join(", ")}` : "Evening") : bc.clientKey ? `Open · ${name(bc.clientKey)}` : "Open";
  const note = (focus?.clientKey ?? bc.clientKey) ? pv.resumeNotes?.[(focus?.clientKey ?? bc.clientKey)!] : undefined;
  const meetings = slot.events.filter((e) => !e.event.isPersonal && e.event.showAs !== "free").length;
  const personal = slot.events.filter((e) => e.event.isPersonal).length;
  const onDrop = (e: DragEvent) => {
    setOver(false);
    // Step 15.2: a row dragged from the right pane adds it here; another client's block asks first.
    const raw = e.dataTransfer.getData(ADD_DRAG);
    if (raw) {
      e.preventDefault();
      const d = JSON.parse(raw) as AddDrag;
      const input = { date: slot.date, half: slot.half, clientKey: d.clientKey, ...d.input };
      const owner = focus?.clientKey ?? null;
      if (owner && owner !== d.clientKey)
        menus.open({ x: e.clientX, y: e.clientY }, {
          title: `Add ${name(d.clientKey)} work to ${possessive(name(owner))} block?`,
          items: [
            { id: "yes", label: `Add "${d.title}" anyway`, hint: "Different client", run: () => act("pick.add", input) },
            { id: "no", label: "Cancel", run: () => undefined },
          ],
        });
      else void act("pick.add", input);
      return;
    }
    const id = Number(e.dataTransfer.getData(PICK_DRAG));
    if (!id) return;
    e.preventDefault();
    void act("pick.move", { id, date: slot.date, half: slot.half });
  };
  return (
    <section
      className={`pd2-block${selected ? " selected" : ""}${b.ended ? " ended" : ""}${over ? " drop" : ""}`}
      style={{ "--c": clientColor(bc.clientKey ?? undefined, colors) } as CSSProperties}
      aria-label={`${halfName(slot.half)}: ${title}`}
      onClick={onSelect}
      onDragOver={(e) => (e.dataTransfer.types.includes(PICK_DRAG) || e.dataTransfer.types.includes(ADD_DRAG)) && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <header className="pd2-block-head">
        <button type="button" className="pd2-block-name" aria-pressed={selected} onClick={onSelect} title="Add work to this block on the right">
          <span className="swatch" />
          <span className="pd2-client">{title}</span>
          <span className="muted">{halfName(slot.half)} · {slotRange(slot, tz)}</span>
        </button>
        {words.text && (
          <span className={`pd2-fit ${words.kind}`}>
            {words.text}
            {words.kind === "over" && (
              <button type="button" className="link-btn" aria-pressed={trim} onClick={(e) => (e.stopPropagation(), setTrim((t) => !t))} title="Show picks you could shrink or move">
                trim
              </button>
            )}
          </span>
        )}
      </header>
      {note && <p className="pd2-note">Left off: {note.note}</p>}
      {ordered.length > 0 ? (
        <ul className="pd2-picks">
          {ordered.map((p) => (
            <PickRow key={p.id} pick={p} toggle={(id, d) => void act("pick.mark_done", { id, done: d })} link draggable highlight={marked.has(p.id)} hint={p.id === hintPick} extra={<RowNote p={p} bc={bc.clientKey} name={name} />} />
          ))}
        </ul>
      ) : (
        <p className="pd2-empty">{b.ended ? "Nothing planned." : selected ? "Nothing yet. Add from the right." : "Nothing yet."}</p>
      )}
      {trim && marked.size > 0 && <p className="pd2-trim-hint">Highlighted: make one smaller (click its size) or move it with ⋯.</p>}
      {(meetings > 0 || personal > 0 || slot.freeGaps.length > 0) && !slot.off && (
        <div className="pd2-cal">
          <button type="button" className="link-btn" aria-expanded={cal} onClick={(e) => (e.stopPropagation(), setCal((c) => !c))}>
            {[meetings ? `${meetings} meeting${meetings === 1 ? "" : "s"}` : "", personal ? `${personal} personal` : "", `${formatDuration(freeMinutes(slot))} free`].filter(Boolean).join(" · ")}
          </button>
          {cal && <Agenda slot={slot} now={now} tz={tz} clientName={name} pickRow={() => null} />}
        </div>
      )}
    </section>
  );
}

/** A short note after a pick's title: another client's pick, carried from an earlier day, focused time. */
function RowNote({ p, bc, name }: { p: Pick; bc: string | null; name: (k: string | null) => string }) {
  const focused = focusLabel(useFocused()(p.id), p.size);
  const bits = [p.clientKey !== bc ? name(p.clientKey) : "", p.carriedFromDate ? `from ${shortDate(p.carriedFromDate)}` : "", focused ? `${focused} focused` : ""].filter(Boolean);
  return bits.length ? <span className="pr-note">{bits.join(" · ")}</span> : null;
}

/** The right pane: "Add to <Client> <Morning>". Priorities, follow-ups, everything else; one "+" per row. */
function AddPane({ slot, picks, overflow, state, picked, here, clients, colors, act, focus, clearFocus }: { slot: Slot; picks: Pick[]; overflow: boolean; state: PlanDayState; picked: Set<string>; here: Set<string>; clients: { clientKey: string; clientName: string }[]; colors: Record<string, string>; act: PlanDayAct; focus: number | null; clearFocus: () => void }) {
  const block = overflow ? null : (slot.focus[0] ?? null);
  const bc = blockClient(block?.clientKey ?? null, picks);
  const [chosen, setChosen] = useState<string | null>(null);
  const clientKey = block?.clientKey ?? chosen ?? bc.clientKey ?? null;
  const allWork = useContext(DevOpsWork);
  const pv = useContext(PlanCtx);
  const work = clientKey ? allWork.get(clientKey) : undefined;
  const [query, setQuery] = useState("");
  const [restOpen, setRestOpen] = useState(false);
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const listed = useMemo(() => weekList(state.weekFeatures, work ? [work] : null).items.map((f) => ({ ...f, clientKey: f.clientKey, done: !!f.done })), [state.weekFeatures, work]);
  const fus = clientKey ? dueOrder((pv.followUps ?? []).filter((f) => f.clientKey === clientKey), slot.date, (f) => f.due, (f) => f.openedAt) : [];
  const s = clientKey ? addSections({ clientKey, date: slot.date, half: slot.half, work, week: listed, followUps: fus, drafts: state.drafts, picked, here, focus, query }) : null;
  const add = (input: Record<string, unknown>) => act("pick.add", { date: slot.date, half: slot.half, clientKey, ...input });
  const loose = clientKey ? state.drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !picked.has(`d${d.id}`)) : [];
  const features = s?.priorities.filter((p) => p.level === "feature" && p.item) ?? [];
  return (
    <HereCtx.Provider value={here}>
    <div className="pd2-right" style={{ "--c": clientColor(clientKey ?? undefined, colors) } as CSSProperties} aria-label="Add work">
      <h3 className="pd2-pane-title">
        Add to {clientKey ? name(clientKey) : "this block"} <span className="muted">{halfName(slot.half)}</span>
      </h3>
      {!block && clients.length > 0 && (
        <div className="client-chooser" role="group" aria-label="Which client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={clientKey === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
        </div>
      )}
      {!clientKey ? (
        <p className="muted pd-note">Choose a client for this block first.</p>
      ) : (
        <>
          <section className="pd2-sec" aria-label="This week's priorities">
            <h4>This week's priorities</h4>
            <p className="pd2-explain">From your week plan.{focus !== null && <> Showing one feature. <button type="button" className="link-btn" onClick={clearFocus}>Show all</button></>}</p>
            {s!.priorities.length === 0 ? (
              <p className="muted pd-note">{work ? `No priorities for ${name(clientKey)} this week yet. Plan the week sets them.` : "DevOps isn't loaded for this client right now."}</p>
            ) : (
              <ul className="pd2-list">
                {s!.priorities.map((p) => (
                  <Priority key={p.ref.itemId} p={p} clientKey={clientKey} date={slot.date} add={add} act={act} startOpen={p.pinnedHere || s!.priorities.length === 1 || focus === p.ref.itemId || p.tier === "must"} picked={picked} />
                ))}
              </ul>
            )}
            {features.length > 0 && <DraftLink label="+ Draft a story" clientKey={clientKey} parents={features.map((f) => ({ id: f.ref.itemId, title: f.ref.title }))} act={act} />}
          </section>
          <section className="pd2-sec" aria-label="Follow-ups">
            <h4>Follow-ups</h4>
            {s!.followUps.length === 0 ? (
              <p className="muted pd-note">Nothing owed to {name(clientKey)}.</p>
            ) : (
              <ul className="pd2-list">
                {s!.followUps.map((f) => (
                  <AddRow key={f.id} k={`f${f.id}`} drag={{ clientKey, title: f.what, input: { followUpId: f.id } }} onAdd={() => add({ followUpId: f.id })} label={`Add follow-up: ${f.what}`}>
                    <span className="pr-title">{f.hasWho ? `${f.who}: ` : ""}{f.what}</span>
                    <DueBadge l={f} />
                  </AddRow>
                ))}
              </ul>
            )}
          </section>
          <section className="pd2-sec" aria-label="Everything else">
            <h4>
              <button type="button" className="pd2-toggle" aria-expanded={restOpen || !!query} onClick={() => setRestOpen((o) => !o)}>
                <span aria-hidden="true">{restOpen || query ? "▾" : "▸"}</span> Everything else <span className="muted">{work ? `${s!.rest.length + loose.length} more, in DevOps order` : ""}</span>
              </button>
            </h4>
            {(restOpen || query) && (
              <>
                <input className="pd2-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or #id" aria-label={`Search ${name(clientKey)}'s work`} />
                <ul className="pd2-list">
                  {loose.map((d) => (
                    <AddRow key={`d${d.id}`} k={`d${d.id}`} drag={{ clientKey, title: d.title, input: { draftId: d.id, size: d.size } }} onAdd={() => add({ draftId: d.id, size: d.size })} label={`Add draft: ${d.title}`}>
                      <span className="pr-type">Draft</span>
                      <DraftTitle draft={d} className="pr-title" />
                    </AddRow>
                  ))}
                  {s!.rest.map((r) =>
                    r.kids.length ? (
                      <li key={r.item.id} className="pd2-group">
                        <span className="pd2-group-title"><span className="pr-type">{typeTag(r.item.type)}</span> {r.item.title}</span>
                        <ul>
                          {r.kids.map((k) => <ItemAdd key={k.id} item={k} clientKey={clientKey} add={add} />)}
                        </ul>
                      </li>
                    ) : (
                      <ItemAdd key={r.item.id} item={r.item} clientKey={clientKey} add={add} />
                    ),
                  )}
                </ul>
                {query && !s!.rest.length && <p className="muted pd-note">Nothing matches "{query}".</p>}
                <DraftLink label="+ Draft a story" clientKey={clientKey} parents={[]} act={act} />
              </>
            )}
          </section>
          <Intention clientKey={clientKey} clientName={name(clientKey)} half={slot.half} date={slot.date} act={act} />
        </>
      )}
    </div>
    </HereCtx.Provider>
  );
}

/** Step 15.2: keys of what is planned in the selected block, so its rows say "Already planned here". */
const HereCtx = createContext<ReadonlySet<string>>(new Set());
/** Step 15.3: the row being dragged from the right pane, so the week's other blocks can show as drop targets. */
const AddDragCtx = createContext<(d: AddDrag | null) => void>(() => {});

/**
 * Step 15.3: while a right-pane row is dragged, the week's other days as small cards (Plan the day and the Week view
 * are never on screen together, D263). Dropping on one adds it there: the 15.2 targets, so a day off, a full block or
 * one that already has it says why, and another client's block asks first.
 */
function WeekDropStrip({ drag, planDate, colors, name, act, onDone }: { drag: AddDrag; planDate: string; colors: Record<string, string>; name: (k: string | null) => string; act: PlanDayAct; onDone: () => void }) {
  const menus = useContext(MenuCtx);
  const env = menus.env;
  const [over, setOver] = useState<string | null>(null);
  if (!env) return null;
  const inp = drag.input as { itemId?: number; draftId?: number; followUpId?: number };
  const ref = inp.itemId ? { itemId: inp.itemId } : inp.draftId ? { draftId: inp.draftId } : inp.followUpId ? { followUpId: inp.followUpId } : {};
  const targets = weekTargets(env, drag.clientKey, ref).filter((t) => t.date !== planDate);
  const days = [...new Set(targets.map((t) => t.date))].sort();
  const owner = (t: (typeof targets)[number]) => t.otherClient ?? (t.group === "open" ? null : drag.clientKey);
  const drop = (e: DragEvent, t: (typeof targets)[number]) => {
    e.preventDefault();
    setOver(null);
    onDone();
    const input = { date: t.date, half: t.half, clientKey: drag.clientKey, ...drag.input };
    if (t.otherClient)
      menus.open({ x: e.clientX, y: e.clientY }, {
        title: `Add ${name(drag.clientKey)} work to ${possessive(name(t.otherClient))} block?`,
        items: [
          { id: "yes", label: `Add "${drag.title}" anyway`, hint: "Different client", run: () => act("pick.add", input) },
          { id: "no", label: "Cancel", run: () => undefined },
        ],
      });
    else void act("pick.add", input);
  };
  return (
    <div className="pd2-weekstrip" role="group" aria-label="Drop on another day this week">
      <span className="pd2-weekstrip-label">Or drop on another day</span>
      {days.length === 0 && <span className="muted">No other block this week can take it</span>}
      {days.map((d) => (
        <div key={d} className="pd2-weekday">
          <span className="pd2-weekday-name">{Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", day: "numeric" })}</span>
          {targets
            .filter((t) => t.date === d)
            .map((t) => {
              const k = `${t.date}${t.half}`;
              const o = owner(t);
              return (
                <span
                  key={k}
                  className={`pd2-weekcard${t.disabled ? " disabled" : ""}${over === k ? " drop" : ""}${t.otherClient ? " other" : ""}`}
                  style={{ "--c": clientColor(o ?? undefined, colors) } as CSSProperties}
                  title={t.disabled ?? (t.otherClient ? `${name(t.otherClient)}'s block: asks first` : `Add to ${halfLabel(t.half)}`)}
                  aria-disabled={!!t.disabled}
                  data-drop={k}
                  onDragOver={(e) => !t.disabled && e.dataTransfer.types.includes(ADD_DRAG) && (e.preventDefault(), setOver(k))}
                  onDragLeave={() => setOver((x) => (x === k ? null : x))}
                  onDrop={(e) => !t.disabled && drop(e, t)}
                >
                  {halfLabel(t.half)} <span className="muted">{o ? name(o) : env.week.days.find((x) => x.date === t.date)?.kind === "overflow" ? "Catch-up" : "Open"}</span>
                </span>
              );
            })}
        </div>
      ))}
    </div>
  );
}
/** A right-pane row dragged onto a block on the left (step 15.2). */
export const ADD_DRAG = "application/x-coopilot-add";
type AddDrag = { clientKey: string; title: string; input: Record<string, unknown> };

/** A row with one "+" that adds it to the selected block; drag it onto any block instead. Once added: a check. */
function AddRow({ onAdd, label, children, menu, k, drag }: { onAdd: () => void; label: string; children: ReactNode; menu?: ReturnType<typeof useMenu> | undefined; k?: string; drag?: AddDrag }) {
  const here = useContext(HereCtx);
  const setDragging = useContext(AddDragCtx);
  const planned = !!k && here.has(k);
  const canDrag = !!drag && !planned;
  return (
    <li
      className={`pd2-add${planned ? " planned" : ""}`}
      onContextMenu={menu?.onContextMenu}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => (e.dataTransfer.setData(ADD_DRAG, JSON.stringify(drag)), (e.dataTransfer.effectAllowed = "copy"), setTimeout(() => setDragging(drag!), 0)) : undefined}
      onDragEnd={canDrag ? () => setDragging(null) : undefined}
      title={canDrag ? "Drag onto a block to add it there" : undefined}
    >
      {planned ? (
        <span className="pd2-plus done" role="img" aria-label="Already planned here" title="Already planned here">✓</span>
      ) : (
        <button type="button" className="pd2-plus" onClick={onAdd} aria-label={label} title="Add to this block">+</button>
      )}
      {children}
      {planned && <span className="pd2-here">Already planned here</span>}
      {menu?.button(`More for ${label}`)}
    </li>
  );
}

function ItemAdd({ item, clientKey, add }: { item: WorkItem; clientKey: string; add: (i: Record<string, unknown>) => Promise<boolean> }) {
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <AddRow k={`i${clientKey}:${item.id}`} drag={{ clientKey, title: item.title, input: { itemId: item.id } }} onAdd={() => void add({ itemId: item.id })} label={`Add ${item.title}`} menu={menu}>
      <span className="pr-type">{typeTag(item.type)}</span>
      <span className="pr-title" title={`${item.type} ${item.id} · ${item.state}`}>
        <WorkLink clientKey={clientKey} url={item.url}>{item.title}</WorkLink>
      </span>
    </AddRow>
  );
}

/** One priority: a story to add, or a feature that opens into its stories (or one "Break it down" row). */
function Priority({ p, clientKey, date, add, act, startOpen, picked }: { p: PriorityRow; clientKey: string; date: string; add: (i: Record<string, unknown>) => Promise<boolean>; act: PlanDayAct; startOpen: boolean; picked: Set<string> }) {
  const [open, setOpen] = useState(startOpen);
  const tier = <span className={`pd2-tier ${p.tier}`}>{p.tier === "must" ? "Must" : "Nice to have"}</span>;
  if (p.level === "story")
    return p.item ? (
      <ItemRowWithTier item={p.item} clientKey={clientKey} add={add} tier={tier} />
    ) : (
      <li className="pd2-add static"><span className="pr-title">{p.ref.title}</span>{tier}<span className="muted">DevOps isn't loaded</span></li>
    );
  const here = useContext(HereCtx);
  const left = p.stories.filter((x) => !here.has(`i${clientKey}:${x.id}`)).length + p.drafts.filter((d) => !here.has(`d${d.id}`)).length;
  const count = p.allPicked ? "all on the plan" : p.breakDown ? "no stories yet" : `${left} to add`;
  return (
    <li className="pd2-feature">
      <button type="button" className="pd2-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="pr-title">{p.ref.title}</span>
        {tier}
        <span className="muted">{count}</span>
      </button>
      {open && (
        <ul>
          {p.stories.map((k) => <ItemAdd key={k.id} item={k} clientKey={clientKey} add={add} />)}
          {p.drafts.map((d) => (
            <AddRow key={`d${d.id}`} k={`d${d.id}`} drag={{ clientKey, title: d.title, input: { draftId: d.id, size: d.size } }} onAdd={() => void add({ draftId: d.id, size: d.size })} label={`Add draft: ${d.title}`}>
              <span className="pr-type">Draft</span>
              <DraftTitle draft={d} className="pr-title" />
              <CreateInDevOps drafts={[d]} label="Create in DevOps" />
            </AddRow>
          ))}
          {p.breakDown && <BreakDown clientKey={clientKey} date={date} feature={{ itemId: p.ref.itemId, title: p.ref.title }} picked={picked} add={add} act={act} epic={p.item ? draftOffer(p.item).kind === "feature" : false} />}
        </ul>
      )}
    </li>
  );
}

function ItemRowWithTier({ item, clientKey, add, tier }: { item: WorkItem; clientKey: string; add: (i: Record<string, unknown>) => Promise<boolean>; tier: ReactNode }) {
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <AddRow k={`i${clientKey}:${item.id}`} drag={{ clientKey, title: item.title, input: { itemId: item.id } }} onAdd={() => void add({ itemId: item.id })} label={`Add ${item.title}`} menu={menu}>
      <span className="pr-type">{typeTag(item.type)}</span>
      <span className="pr-title"><WorkLink clientKey={clientKey} url={item.url}>{item.title}</WorkLink></span>
      {tier}
    </AddRow>
  );
}

/** One "+ Draft a story" link that opens an inline field only when clicked. With parents, a feature to put it under. */
function DraftLink({ label, clientKey, parents, act, parent: fixed }: { label: string; clientKey: string; parents: { id: number; title: string }[]; act: PlanDayAct; parent?: number }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<Size>("M");
  const [parent, setParent] = useState<number | null>(fixed ?? parents[0]?.id ?? null);
  if (!open)
    return (
      <button type="button" className="link-btn pd2-draft-link" onClick={(e) => (e.stopPropagation(), setOpen(true))}>
        {label}
      </button>
    );
  return (
    <form
      className="draft-form pd2-draft"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        if (await act("draft.add_story", { clientKey, parentItemId: parent, title, size })) {
          setTitle("");
          setOpen(false);
        }
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Story title (a local draft until it's in DevOps)" aria-label="Draft story title" maxLength={200} />
      {fixed === undefined && parents.length > 0 && (
        <select value={parent ?? ""} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)} aria-label="Under feature">
          {parents.map((f) => <option key={f.id} value={f.id}>Under {f.title}</option>)}
        </select>
      )}
      <span className="sizes" role="group" aria-label="Draft size">
        {SIZES.map((s) => (
          <button key={s} type="button" className="size" aria-pressed={size === s} onClick={() => setSize(s)}>{s}</button>
        ))}
      </span>
      <button type="submit" className="mini">Add draft</button>
      <button type="button" className="mini quiet" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

/**
 * "Or type what you'll do" (step 15.3: the shared lookup). Choosing a result adds that DevOps item; Enter on text that
 * matches nothing adds it as a plain intention.
 */
function Intention({ clientKey, clientName, half, date, act }: { clientKey: string; clientName: string; half: Half; date: string; act: PlanDayAct }) {
  const [value, setValue] = useState<ItemValue>(NO_ITEM);
  // Pickable items not already planned in this block.
  const here = useContext(HereCtx);
  const only = useCallback((i: WorkItem) => isPickable(i) && !here.has(`i${clientKey}:${i.id}`), [here, clientKey]);
  return (
    <div className="intention">
      <ItemLookup
        clientKey={clientKey}
        value={value}
        label={`Something else for ${halfName(half)}`}
        placeholder={`Or type what you'll do for ${clientName}, then Enter`}
        only={only}
        onChange={(v) => {
          if (v.itemId !== null) {
            setValue(NO_ITEM);
            void act("pick.add", { date, half, clientKey, itemId: v.itemId });
          } else setValue(v);
        }}
        onEnterText={async (text) => {
          if (await act("pick.add", { date, half, clientKey, intention: text })) setValue(NO_ITEM);
        }}
      />
    </div>
  );
}

/** The pick title for breaking a feature down (step 10). */
export const breakDownTitle = (f: { itemId: number; title: string }) => `Break down #${f.itemId} ${f.title}`.replace(/\s+/g, " ").trim().slice(0, 200);

/** A feature with no stories: one row, "Break it down": add it as a pick, copy the Coop brief, or draft a story. */
function BreakDown({ clientKey, date, feature, picked, add, act, epic }: { clientKey: string; date: string; feature: { itemId: number; title: string }; picked: Set<string>; add: (i: Record<string, unknown>) => Promise<boolean>; act: PlanDayAct; epic: boolean }) {
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
      setNote(ok ? "Coop brief copied" : "Copy didn't work: the brief is selected below, press Ctrl+C");
      if (ok) setBrief(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't build the brief");
    }
  };
  const already = picked.has(`t${clientKey}:${title}`);
  return (
    <li className="pd2-add pd2-breakdown">
      {already ? <span className="pd2-plus done" aria-hidden="true">✓</span> : <button type="button" className="pd2-plus" onClick={() => void add({ intention: title, size: "M" })} aria-label="Add Break it down as a pick" title="Add to this block (size M)">+</button>}
      <span className="pr-title">Break it down</span>
      <button type="button" className="mini" onClick={() => void copyBrief()}>Copy Coop brief</button>
      {!epic && <DraftLink label="Draft a story" clientKey={clientKey} parents={[]} parent={feature.itemId} act={act} />}
      {note && <span className="muted" role="status">{note}</span>}
      {brief && <textarea ref={area} readOnly value={brief} rows={6} aria-label={`Coop brief for #${feature.itemId}`} />}
    </li>
  );
}

/** Unfinished from earlier days: one "+" brings a pick into the selected block; ⋯ has the rest. */
function CarryOver({ picks, date, to, act }: { picks: Pick[]; date: string; to: Half; act: PlanDayAct }) {
  return (
    <section className="pd2-carry" aria-label="Unfinished from earlier">
      <h4>Unfinished from earlier</h4>
      <ul className="pd2-list">
        {picks.map((p) => (
          <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`More for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }} className="pd2-add">
            <button type="button" className="pd2-plus" onClick={() => void act("pick.move", { id: p.id, date, half: to })} aria-label={`Bring ${p.title} to the ${halfName(to).toLowerCase()}`} title={`Bring to the ${halfName(to).toLowerCase()}`}>+</button>
            <span className="pr-title">{p.title}</span>
            <span className="pr-note">{p.clientKey} · {shortDate(p.date)}</span>
          </MenuRow>
        ))}
      </ul>
    </section>
  );
}

/** A past day: its picks per block, tick done or drop. No sizes, moves, candidates or commit (server enforces it too). */
function PastDay({ halves, picks, act }: { halves: Half[]; picks: Pick[]; act: PlanDayAct }) {
  return (
    <div className="pd2-left past">
      {halves.map((half) => {
        const mine = picks.filter((p) => p.half === half);
        return (
          <section key={half} className="pd2-block past" aria-label={halfName(half)}>
            <header className="pd2-block-head">
              <span className="pd2-client">{halfName(half)}</span>
            </header>
            {mine.length === 0 ? (
              <p className="muted pd-note">Nothing was planned.</p>
            ) : (
              <ul className="pd2-picks">
                {mine.map((p) => (
                  <PickRow key={p.id} pick={p} toggle={(id, d) => void act("pick.mark_done", { id, done: d })} readOnly extra={p.status === "dropped" ? <span className="pr-note">dropped</span> : <span className="pr-note">{p.clientKey}</span>} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- step 13.6: the block agenda, Timebox and Timebox my day ----------

const isTodayIn = (date: string, now: string, tz: string) => Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString() === date;

/**
 * A block's agenda (D244): meetings, personal events, unavailable time and timeboxes in time order, with the free gaps
 * between ("Free 9:00–11:00 · 2h"). A timebox row opens its details (show as, Put on Outlook, Removed in Outlook).
 */
function Agenda({ slot, now, tz, clientName, pickRow }: { slot: Slot; now: string; tz: string; clientName: (k: string | null) => string; pickRow: (pickId: number) => ReactNode }) {
  const env = useTimeboxes();
  const [open, setOpen] = useState<number | null>(null);
  if (!env) return null;
  // With timeboxing off (D261), timeboxes stay but the agenda shows only the calendar and free time.
  const rows = agendaOf(slot, env.settings.enabled ? env.timeboxes : [], isTodayIn(slot.date, now, tz) ? now : undefined);
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
          // Step 14.5 (D259): a pick's timebox is the pick's own row, at its time.
          const asPick = tb && tb.pickId !== null ? pickRow(tb.pickId) : null;
          if (asPick) return asPick;
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
function TimeboxMyDay({ day, picks, weekFeatures, now, tz, onClose, onRan }: { day: Day; picks: Pick[]; weekFeatures: PlanDayState["weekFeatures"]; now: string; tz: string; onClose: () => void; onRan: (r: { placed: number; unplaced: DidntFit[] }) => void }) {
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
    return planMyDay(picks, blocks, env?.timeboxes ?? [], pv.sizes, mustPicks(picks, weekFeatures, work), isTodayIn(day.date, now, tz) ? now : undefined, pv.minSizes);
  });
  const [outlook, setOutlook] = useState<Record<number, boolean>>(() => Object.fromEntries(plan.placed.map((p) => [p.pickId, !!env?.settings.outlookDefault])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!env) return null;
  const canWrite = env.access?.access === "write";
  const anyOutlook = plan.placed.some((p) => outlook[p.pickId]);
  const allOutlook = plan.placed.length > 0 && plan.placed.every((p) => outlook[p.pickId]);
  const apply = async () => {
    // Nothing fits: no write, only the summary of what didn't.
    if (plan.placed.length === 0) {
      onClose();
      onRan({ placed: 0, unplaced: plan.unplaced });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ timeboxes: { uid: string }[]; sync: string[] }>("timebox.add_many", { date: day.date, items: plan.placed.map((p) => ({ pickId: p.pickId, start: p.start, end: p.end, outlook: !!outlook[p.pickId] })) });
      env.changed();
      onClose();
      onRan({ placed: r.timeboxes.length, unplaced: plan.unplaced });
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
          <button ref={first} type="button" className="commit" disabled={busy || (plan.placed.length === 0 && plan.unplaced.length === 0)} onClick={() => void apply()}>
            {busy ? "Saving…" : plan.placed.length === 0 ? "OK" : `Timebox ${plan.placed.length} pick${plan.placed.length === 1 ? "" : "s"}`}
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
          {u.title} ({u.size}): {u.reason}. After this you can move it, make it smaller or leave it untimed.
        </p>
      ))}
    </section>
  );
}
