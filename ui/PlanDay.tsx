// Plan the day (step 15, D263 to D266): its own view with two panes, one job each. Left: each block with its picks as
// rows and its fit said once. Right, "Add to <Client> <morning>": this week's musts with their stories, the client's
// follow-ups, then everything else, and a type box at the bottom. One "+" per row; every other action is in a row's ⋯
// menu. U4 (D396 to D399): the U3 type scale; rows without a checkbox (ticking is Today's), the size chip always; the
// agenda open only on the selected block; Enter in the type box makes a draft story under the chosen feature and plans
// it, Shift+Enter a plain intention ("not in DevOps"); features aren't picks, so they offer Draft stories instead.
// Everything here is local: the actions only write FocusTime's plan store.
import { CloseButton } from "./CloseButton.tsx";
import { countsFor } from "../plan/process.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import { planDayTitle } from "./nav.ts";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps } from "./DevOpsWrite.tsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { blockClient, isPickable } from "../plan/rules.ts";
import { dayCalendar, splitByBlocks, type DayEventWhen } from "../plan/todaycal.ts";
import { AllDayRow, OutsideLine } from "./DayCalendar.tsx";
import { agendaOf, offerAfterTimebox, planMyDay, smallerSize, type DayPlacement, type DidntFit, type Unplaced } from "../plan/agenda.ts";
import { addSections, defaultBlock, doneAction, type PriorityRow } from "../plan/addpane.ts";
import { blockFitWords, dayHeadline, fitWords, planFit, planMinutes, trimCandidates } from "../plan/fit.ts";
import { freeMinutes } from "../week/free.ts";
import { weekList } from "../plan/weeklist.ts";
import type { PlanDayState, Pick } from "../plan/types.ts";
import type { Day, Half, Slot, WorkItem } from "../week/types.ts";
import { clientColor, halfName, halfTag, longDate, shortDate, shortRange } from "./labels.ts";
import { cardHalves, slotOf } from "./halves.ts";
import { DevOpsWork } from "./work.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { PlanCtx, useFocused } from "./planview.ts";
import { focusLabel } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { WorkLink } from "./WorkLink.tsx";
import { call } from "./api.ts";
import { DueBadge } from "./FollowUps.tsx";
import { BreakDown } from "./DetailPanel.tsx";
import { dueOrder } from "../plan/due.ts";
import { isTypingTarget, topOverlay } from "./keys.ts";
import { halfLabel, itemMenu, openCoopBrief, pickMenu, possessive, spanText, weekTargets } from "./menu.ts";
import { MenuCtx, MenuRow, useMenu } from "./Menus.tsx";
import { TimeboxDetails, useTimeboxes } from "./Timeboxes.tsx";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { PickRow, PICK_DRAG } from "./PickRow.tsx";
import { PlanFrame } from "./plan/PlanFrame.tsx";
import { PlanHeader } from "./plan/PlanHeader.tsx";
import { UnitCard, PlanLabel } from "./plan/UnitCard.tsx";
import { CarryCtx, SuggestedCards } from "./Carry.tsx";
import { carryListed } from "../plan/suggest.ts";
import { AddPane, AddSection, BoxHint } from "./plan/AddPane.tsx";
import { moreLabel, moreOpenByDefault, NOTHING_PLANNED, rememberFold, sessionFold } from "./plan/more.ts";
import { FoldLine } from "./plan/FoldLine.tsx";
import { agendaNowIndex, nowClock, ownsNow } from "../plan/nowline.ts";
import { NowRow } from "./NowLine.tsx";

import type { FollowUpView } from "../actions/types.ts";

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
  /** Step 16.2: Today's mode switch, at the right of this view's header. */
  switcher?: ReactNode;
  /** Today's date, for the title ("Plan today" or "Plan Tuesday, Nov 3"). */
  today: string;
  /** Step 15.2: the selected block, so ⋯ menus add to it (null when the view closes). */
  onSelectBlock?: (half: Half | null) => void;
  /** fix/planday-pane: "plan the week" in the right pane's nothing-planned line: Plan the week on that client. */
  onPlanWeek?: (clientKey: string) => void;
};

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";
const pickedKey = (p: Pick) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : `t${p.clientKey}:${p.title}`);
const weekdayOf = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long" });

export function PlanDay({ day, state, which, now, tz, colors, clients, error, act, onCommit, onClose, onStep, nextDay = null, start, justCommitted = false, onCommitSeen, switcher, today, onSelectBlock, onPlanWeek }: Props) {
  const past = state.access === "past";
  const off = day.pto;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const pv = useContext(PlanCtx);
  const tbEnv = useTimeboxes();
  const timing = tbEnv?.settings.enabled !== false;
  const nowI = Temporal.Instant.from(now);
  const dayPicks = state.picks.filter((p) => p.date === day.date);
  const counts = countsFor(useContext(DevOpsWork).values());
  const picked = new Set(dayPicks.filter(inPlay).map(pickedKey));
  // S1 (D453): a PTO half isn't a block to plan (a pick already there stays visible, to move).
  const halves = cardHalves(day).filter((h) => ((!slotOf(day, h)!.off || day.kind === "overflow") && !slotOf(day, h)!.pto) || dayPicks.some((p) => p.half === h && inPlay(p)));
  const blocks = halves.map((h) => {
    const slot = slotOf(day, h)!;
    const picks = dayPicks.filter((p) => p.half === h && inPlay(p));
    // WT-1: a background type (Settings' background_types) doesn't count against the block's hours.
    const counted = picks.filter((p) => counts(p.clientKey, p.itemType));
    const fit = planFit(counted, pv.sizes, pv.timeboxes, slot);
    return { half: h, slot, picks, fit, words: fitWords(fit), ended: Temporal.Instant.compare(nowI, Temporal.Instant.from(slot.end)) >= 0, planned: planMinutes(counted, pv.sizes, pv.timeboxes, slot), free: freeMinutes(slot) };
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
  /** U6: bumped by /, so the right pane opens its list and focuses the search. */
  const [slash, setSlash] = useState(0);
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
    } else if ((e.key === "j" || e.key === "k") && !past) {
      // U6: J and K move between blocks, as they move between clients in Plan the week.
      const i = blocks.findIndex((b) => b.half === sel);
      const to = blocks[Math.max(0, Math.min(blocks.length - 1, i + (e.key === "j" ? 1 : -1)))];
      if (to) (e.preventDefault(), setSel(to.half));
    } else if (e.key === "/" && !past) {
      // U6: / goes to the right pane's search.
      e.preventDefault();
      setSlash((n) => n + 1);
    }
  };
  // Step 15.2: when focus falls to the page (a "+" became a check, a dialog closed), ← → C Esc still reach this view.
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const lost = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || (document.activeElement && document.activeElement !== document.body) || topOverlay(document) !== "none") return;
      if (!["ArrowLeft", "ArrowRight", "Escape", "c", "C", "j", "k", "/"].includes(e.key)) return;
      ref.current?.focus({ preventScroll: true });
      keyRef.current(e as unknown as KeyboardEvent);
    };
    window.addEventListener("keydown", lost);
    return () => window.removeEventListener("keydown", lost);
  }, []);
  const inner = { ...pv, focused: { ...pv.focused, ...state.focused }, resumeNotes: state.resumeNotes };
  const selBlock = blocks.find((b) => b.half === sel) ?? blocks[0];
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const badge = past ? null : which;
  // Step 17.6: the day's meetings: each block's agenda shows its own (open by default), with Now and Next on today;
  // all-day events and meetings outside the blocks in slim lines around them.
  const cal = dayCalendar(day, isTodayIn(day.date, now, tz) ? now : undefined);
  const split = splitByBlocks(cal.timed, blocks.filter((b) => !b.slot.off).map((b) => ({ key: b.half, start: b.slot.start, end: b.slot.end })));
  const whens = new Map(cal.timed.map((e) => [e.event.id, e.when]));

  const header = (
    <PlanHeader
      className="pd2-head"
      titleClass="pd2-title"
      summaryClass="pd2-status"
      step={{ prev: () => onStep(-1), next: () => onStep(1), prevLabel: "Previous day (←)", nextLabel: "Next day (→)", label: "Day", className: "pd-step" }}
      title={planDayTitle(day.date, today)}
      badge={badge && <span className={`pd-which ${badge === "Past" ? "past" : "next"}`}>{badge}</span>}
      summary={off ? "Day off" : past ? "Tick what got done, or drop the rest" : <Headline h={dayHeadline(blocks.filter((b) => !b.slot.off))} />}
      secondary={
        !past && !off && committed && timing && unboxed > 0 ? (
          <button type="button" className="pd2-secondary" onClick={() => setMyDay(true)} title="Give every planned pick a time in its block's free time">
            Timebox my day
          </button>
        ) : null
      }
      // NV-1: on Week's Board; Commit today (C) saves the plan, then back to the whole week.
      mode={<ModeArea done={{ onClick: done, label: past || committed ? "Back to the week" : `Confirm ${day.date === today ? "today" : weekdayOf(day.date)}`, title: past ? "Back to the week (Esc)" : committed ? "Back to the week (C)" : "Save this plan for the day, then back to the week (C)" }}>{switcher}</ModeArea>}
    />
  );
  const notices = (
    <>
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
                      {u.title} <span className="muted">({u.size ?? "not sized, 2h"})</span>
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
    </>
  );
  const plannable = !off && !past;
  // HK-3: a pick the Board suggests in a block this week is its dashed card there (this day's, or none here when it is
  // another day's); only picks with no block left this week, or from an earlier week, stay in the list.
  const carry = useContext(CarryCtx);
  const listedCarry = carry ? carryListed(state.carryOver, carry.suggested) : state.carryOver;
  const left = off ? (
    <p className="pd-pto full" role="note">
      <strong>Day off</strong> · {off.titles.join(", ")}. Nothing to plan.
    </p>
  ) : past ? (
    <PastDay halves={[...new Set<Half>(["AM", "PM", ...dayPicks.filter((p) => p.half === "EVE").map((p) => p.half)])]} picks={dayPicks.filter((p) => p.status !== "moved")} act={act} />
  ) : (
    <>
      <AllDayRow events={cal.allDay} />
      {day.ptoHalf && (
        <p className="pd-pto half" role="note">
          <strong>PTO this {day.ptoHalf.half === "AM" ? "morning" : "afternoon"}</strong> · {day.ptoHalf.titles.join(", ")}
        </p>
      )}
      <OutsideLine label="Before your blocks" events={split.before} tz={tz} />
      {listedCarry.length > 0 && selBlock && <CarryOver picks={listedCarry} date={day.date} to={selBlock.half} act={act} />}
      {blocks.map((b) => (
        <DayBlock key={b.half} b={b} selected={b.half === sel} onSelect={() => setSel(b.half)} overflow={day.kind !== "work" && b.half !== "EVE"} tz={tz} now={now} colors={colors} name={name} act={act} hintPick={hintPick} weekFeatures={state.weekFeatures} whens={whens} />
      ))}
      <OutsideLine label="After your blocks" events={split.after} tz={tz} />
    </>
  );
  const right =
    plannable && selBlock ? (
      <AddPaneDay key={`${day.date}${selBlock.half}`} slot={selBlock.slot} picks={selBlock.picks} overflow={day.kind !== "work" && selBlock.half !== "EVE"} state={state} picked={picked} here={new Set(selBlock.picks.map(pickedKey))} clients={clients} colors={colors} act={act} focus={focusItem} clearFocus={() => setFocusItem(null)} slash={slash} onPlanWeek={onPlanWeek} />
    ) : undefined;

  return (
    <PlanCtx.Provider value={inner}>
      <AddDragCtx.Provider value={setDragging}>
        <PlanFrame
          frameRef={ref}
          className="planday pd2"
          label={`Plan ${longDate(day.date)}`}
          onKeyDown={onKey}
          header={header}
          notices={notices}
          leftClass={`pd2-left${past ? " past" : ""}`}
          leftLabel={plannable ? `Your ${weekdayOf(day.date)}` : undefined}
          left={left}
          right={right}
          after={
            <>
              {dragging && plannable && <WeekDropStrip drag={dragging} planDate={day.date} colors={colors} name={name} act={act} onDone={() => setDragging(null)} />}
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
            </>
          }
        />
      </AddDragCtx.Provider>
    </PlanCtx.Provider>
  );
}

type BlockView = { half: Half; slot: Slot; picks: Pick[]; fit: ReturnType<typeof planFit>; words: ReturnType<typeof fitWords>; ended: boolean };

/** One block in the left pane: name, time, one fit line, its picks as rows. Click selects it; drop a pick to move it here. */
function DayBlock({ b, selected, onSelect, overflow, tz, now, colors, name, act, hintPick, weekFeatures, whens }: { whens: ReadonlyMap<string, DayEventWhen>; b: BlockView; selected: boolean; onSelect: () => void; overflow: boolean; tz: string; now: string; colors: Record<string, string>; name: (k: string | null) => string; act: PlanDayAct; hintPick: number | null; weekFeatures: PlanDayState["weekFeatures"] }) {
  const menus = useContext(MenuCtx);
  const { slot, picks } = b;
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork);
  const focus = overflow ? null : (slot.focus[0] ?? null);
  const bc = blockClient(focus?.clientKey ?? null, picks);
  const [trim, setTrim] = useState(false);
  // U4: the agenda is open on the selected block and folded on the others; its fold line toggles it.
  const [calToggle, setCalToggle] = useState<boolean | null>(null);
  useEffect(() => setCalToggle(null), [selected]);
  const cal = calToggle ?? selected;
  const fw = blockFitWords(b.fit);
  const dues = pv.followUps ?? [];
  const [over, setOver] = useState(false);
  const env = useTimeboxes();
  const start = new Map((env?.timeboxes ?? []).filter((t) => !t.removedAt && t.date === slot.date && t.pickId !== null).map((t) => [t.pickId!, t.start]));
  const ordered = [...picks].sort((x, y) => {
    const a = start.get(x.id), c = start.get(y.id);
    if (a && c) return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(c));
    return a ? -1 : c ? 1 : x.position - y.position;
  });
  const carry = useContext(CarryCtx);
  const suggestedHere = slot.half !== "EVE" && (carry?.cardsAt(slot.date, slot.half).length ?? 0) > 0;
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
    <UnitCard
      className={`pd2-block${selected ? " selected" : ""}${b.ended ? " ended" : ""}${over ? " drop" : ""}`}
      color={clientColor(bc.clientKey ?? undefined, colors)}
      label={`${halfName(slot.half)}: ${title}`}
      onClick={onSelect}
      onDragOver={(e) => (e.dataTransfer.types.includes(PICK_DRAG) || e.dataTransfer.types.includes(ADD_DRAG)) && (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      headClass="pd2-block-head"
      name={
        <button type="button" className="pd2-block-name" aria-pressed={selected} onClick={onSelect} title={`${halfName(slot.half)}: add work to this block on the right`}>
          <span className="swatch" />
          <span className="pd2-client">{title}</span>
        </button>
      }
      detail={<span className="pd2-when">{shortRange(slot, tz)}</span>}
      tone={fw.kind === "over" ? "over" : "fits"}
      fitClass={`pd2-fit ${fw.kind}`}
      fit={
        fw.text && (
          <>
            {fw.text}
            {fw.kind === "over" && (
              <>
                {" · "}
                <button type="button" className="link-btn" aria-pressed={trim} onClick={(e) => (e.stopPropagation(), setTrim((t) => !t))} title="Show picks you could shrink or move">
                  Trim
                </button>
              </>
            )}
          </>
        )
      }
    >
      {note && <p className="pd2-note">Left off: {note.note}</p>}
      {ordered.length > 0 ? (
        <ul className="pd2-picks">
          {ordered.map((p) => (
            <PickRow key={p.id} pick={p} density="plan" toggle={(id, d) => void act("pick.mark_done", { id, done: d })} link draggable highlight={marked.has(p.id)} hint={p.id === hintPick} extra={<RowNote p={p} bc={bc.clientKey} name={name} />} badge={dueOf(p, dues)} />
          ))}
        </ul>
      ) : suggestedHere ? null : (
        <p className="pd2-empty">{b.ended ? "Nothing planned." : selected ? "Nothing yet. Add from the right." : ""}</p>
      )}
      {slot.half !== "EVE" && <SuggestedCards date={slot.date} half={slot.half} tabIndex={0} />}
      {trim && marked.size > 0 && <p className="pd2-trim-hint">Highlighted: make one smaller (click its size) or move it with ⋯.</p>}
      {(meetings > 0 || personal > 0 || slot.freeGaps.length > 0) && !slot.off && (
        <div className="pd2-cal">
          <FoldLine className="pd2-fold" open={cal} onToggle={() => setCalToggle(!cal)} label="Agenda" count={cal ? undefined : [meetings ? `${meetings} meeting${meetings === 1 ? "" : "s"}` : "", personal ? `${personal} personal` : "", `${formatDuration(freeMinutes(slot))} free`].filter(Boolean).join(" · ")} />
          {cal && <Agenda slot={slot} now={now} tz={tz} clientName={name} pickRow={() => null} whens={whens} />}
        </div>
      )}
    </UnitCard>
  );
}

/** The day's free time, and how far over the blocks are in amber only when they are (U4). */
function Headline({ h }: { h: { free: string; over: string | null } }) {
  return (
    <>
      {h.free}
      {h.over && (
        <>
          {" · "}
          <span className="pd2-over">{h.over}</span>
        </>
      )}
    </>
  );
}

/** A follow-up pick's due badge on its row. */
function dueOf(p: Pick, followUps: readonly FollowUpView[]): ReactNode {
  if (p.followUpId === null) return undefined;
  const f = followUps.find((x) => x.id === p.followUpId);
  return f ? <DueBadge l={f} /> : undefined;
}

/** A short note after a pick's title: another client's pick, carried from an earlier day, focused time. */
function RowNote({ p, bc, name }: { p: Pick; bc: string | null; name: (k: string | null) => string }) {
  const focused = focusLabel(useFocused()(p.id), p.size);
  const bits = [p.kind === "intention" && p.followUpId === null ? "not in DevOps" : "", p.clientKey !== bc ? name(p.clientKey) : "", p.carriedFromDate ? `from ${shortDate(p.carriedFromDate)}` : "", focused ? `${focused} focused` : ""].filter(Boolean);
  return bits.length ? <span className="pr-note">{bits.join(" · ")}</span> : null;
}

/**
 * The right pane: "Add to <Client> <morning>". This week's musts (each feature with its stories, or Needs stories),
 * the client's follow-ups when there are any, everything else folded, and the type box at the bottom (U4).
 */
function AddPaneDay({ slot, picks, overflow, state, picked, here, clients, colors, act, focus, clearFocus, slash, onPlanWeek }: { slot: Slot; picks: Pick[]; overflow: boolean; state: PlanDayState; picked: Set<string>; here: Set<string>; clients: { clientKey: string; clientName: string }[]; colors: Record<string, string>; act: PlanDayAct; focus: number | null; clearFocus: () => void; slash: number; onPlanWeek?: ((clientKey: string) => void) | undefined }) {
  const block = overflow ? null : (slot.focus[0] ?? null);
  const bc = blockClient(block?.clientKey ?? null, picks);
  const [chosen, setChosen] = useState<string | null>(null);
  const clientKey = block?.clientKey ?? chosen ?? bc.clientKey ?? null;
  const allWork = useContext(DevOpsWork);
  const pv = useContext(PlanCtx);
  const work = clientKey ? allWork.get(clientKey) : undefined;
  const clientKeyRef = useRef(clientKey);
  clientKeyRef.current = clientKey;
  const [query, setQuery] = useState("");
  // fix/planday-pane: "More from <client>'s DevOps" opens on its own when nothing is above it (no musts, no
  // follow-ups); a fold or unfold by hand is kept per client for the session.
  const [restFold, setRestFold] = useState<Record<string, boolean>>({});
  const search = useRef<HTMLInputElement>(null);
  const slashSeen = useRef(slash);
  useEffect(() => {
    if (slash === slashSeen.current) return;
    slashSeen.current = slash;
    if (clientKeyRef.current) setRestFold((f) => ({ ...f, [clientKeyRef.current!]: true }));
    setTimeout(() => search.current?.focus(), 0);
  }, [slash]);
  // U4: the feature a typed story goes under (Enter in the type box); none means the client, no parent yet.
  const [feature, setFeature] = useState<number | null>(focus);
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const listed = useMemo(() => weekList(state.weekFeatures, work ? [work] : null).items.map((f) => ({ ...f, clientKey: f.clientKey, done: !!f.done })), [state.weekFeatures, work]);
  const fus = clientKey ? dueOrder((pv.followUps ?? []).filter((f) => f.clientKey === clientKey), slot.date, (f) => f.due, (f) => f.openedAt) : [];
  const s = clientKey ? addSections({ clientKey, date: slot.date, half: slot.half, work, week: listed, followUps: fus, drafts: state.drafts, picked, here, focus, query }) : null;
  const add = (input: Record<string, unknown>) => act("pick.add", { date: slot.date, half: slot.half, clientKey, ...input });
  const loose = clientKey ? state.drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !picked.has(`d${d.id}`)) : [];
  const chosenTitle = s?.priorities.find((p) => p.level === "feature" && p.ref.itemId === feature)?.ref.title ?? null;
  const musts = s?.priorities.filter((p) => p.tier === "must") ?? [];
  const restOpen = clientKey ? (restFold[clientKey] ?? sessionFold(clientKey) ?? moreOpenByDefault(musts.length, s?.followUps.length ?? 0)) : false;
  const setRestOpen = (open: boolean) => {
    if (!clientKey) return;
    setRestFold((f) => ({ ...f, [clientKey]: open }));
    rememberFold(clientKey, open);
  };
  const label = musts.length === (s?.priorities.length ?? 0) ? "This week's musts" : "This week";
  return (
    <HereCtx.Provider value={here}>
      <AddPane
        className="pd2-right"
        color={clientColor(clientKey ?? undefined, colors)}
        titleClass="pd2-pane-title"
        client={clientKey ? <span className="pd2-pane-client">{name(clientKey)}</span> : "this block"}
        suffix={halfName(slot.half).toLowerCase()}
        scrollClass="pd2-scroll"
        top={
          !block && clients.length > 0 ? (
            <div className="client-chooser" role="group" aria-label="Which client">
              {clients.map((c) => (
                <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={clientKey === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
                  <span className="swatch" />
                  {c.clientName}
                </button>
              ))}
            </div>
          ) : undefined
        }
        box={clientKey ? <StoryBox clientKey={clientKey} clientName={name(clientKey)} half={slot.half} date={slot.date} parent={feature} parentTitle={chosenTitle} act={act} /> : undefined}
      >
        {!clientKey ? (
          <p className="muted pd-note">Choose a client for this block first.</p>
        ) : (
          <>
            {s!.priorities.length > 0 ? (
              <AddSection className="pd2-sec" label={label}>
                {focus !== null && (
                  <p className="pd2-explain">
                    One feature. <button type="button" className="link-btn" onClick={clearFocus}>Show all</button>
                  </p>
                )}
                <ul className="pd2-list">
                  {s!.priorities.map((p) => (
                    <Priority key={p.ref.itemId} p={p} clientKey={clientKey} date={slot.date} add={add} chosen={feature === p.ref.itemId} onChoose={() => setFeature((f) => (f === p.ref.itemId ? null : p.ref.itemId))} />
                  ))}
                </ul>
              </AddSection>
            ) : (
              !work && <p className="muted pd-note">DevOps isn't loaded for this client right now.</p>
            )}
            {s!.followUps.length > 0 && (
              <AddSection className="pd2-sec" label="Follow-ups">
                <ul className="pd2-list">
                  {s!.followUps.map((f) => (
                    <AddRow key={f.id} k={`f${f.id}`} drag={{ clientKey, title: f.what, input: { followUpId: f.id } }} onAdd={() => add({ followUpId: f.id })} label={`Add follow-up: ${f.what}`}>
                      <span className="pr-title">{f.hasWho ? `${f.who}: ` : ""}{f.what}</span>
                      <DueBadge l={f} />
                    </AddRow>
                  ))}
                </ul>
              </AddSection>
            )}
            <AddSection className="pd2-sec" label={moreLabel(name(clientKey))} title={null}>
              <FoldLine className="pd2-fold pd2-more" open={restOpen || !!query} onToggle={() => setRestOpen(!restOpen)} label={moreLabel(name(clientKey))} count={work ? s!.rest.length + loose.length : undefined} title="In DevOps order" />
              {(restOpen || query) && (
                <>
                  {s!.priorities.length === 0 && (
                    <p className="muted pd-note pd2-none">
                      {NOTHING_PLANNED[0](name(clientKey))}
                      {onPlanWeek ? (
                        <button type="button" className="link-btn" onClick={() => onPlanWeek(clientKey)}>
                          {NOTHING_PLANNED[1]}
                        </button>
                      ) : (
                        NOTHING_PLANNED[1]
                      )}
                      {NOTHING_PLANNED[2]}
                    </p>
                  )}
                  <input ref={search} className="pd2-search pl-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setQuery(""))} placeholder="Search by title or #id" aria-label={`Search ${name(clientKey)}'s work`} />
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
                          <span className="pd2-group-title"><TypeIcon clientKey={clientKey} type={r.item.type} /> {r.item.title}</span>
                          <ul>
                            {r.kids.map((k) => <ItemAdd key={k.id} item={k} clientKey={clientKey} add={add} tag />)}
                          </ul>
                        </li>
                      ) : (
                        <ItemAdd key={r.item.id} item={r.item} clientKey={clientKey} add={add} tag />
                      ),
                    )}
                  </ul>
                  {query && !s!.rest.length && <p className="muted pd-note">Nothing matches "{query}".</p>}
                </>
              )}
            </AddSection>
          </>
        )}
      </AddPane>
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
export const ADD_DRAG = "application/x-focustime-add";
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
      {menu?.button(`More for ${label}`)}
    </li>
  );
}

/** A DevOps item to add, with its type's icon (WT-1) and, when DevOps has resolved it, the Resolved marker. */
function ItemAdd({ item, clientKey, add, after }: { item: WorkItem; clientKey: string; add: (i: Record<string, unknown>) => Promise<boolean>; tag?: boolean; after?: ReactNode }) {
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <AddRow k={`i${clientKey}:${item.id}`} drag={{ clientKey, title: item.title, input: { itemId: item.id } }} onAdd={() => void add({ itemId: item.id })} label={`Add ${item.title}`} menu={menu}>
      <TypeIcon clientKey={clientKey} type={item.type} />
      <span className="pr-title" title={`${item.type} ${item.id} · ${item.state}`}>
        <WorkLink clientKey={clientKey} url={item.url}>{item.title}</WorkLink>
      </span>
      {after}
    </AddRow>
  );
}

/**
 * One priority (U4). A story: one row with "+". A feature: its title with "2 of 3 stories planned" (a click chooses it
 * for the type box), then its stories, each "+" or ✓ when planned here. A feature with no stories is one amber row:
 * Needs stories · Draft stories · Coop brief. Features aren't picks, so a feature row can't be added or dragged.
 */
function Priority({ p, clientKey, date, add, chosen, onChoose }: { p: PriorityRow; clientKey: string; date: string; add: (i: Record<string, unknown>) => Promise<boolean>; chosen: boolean; onChoose: () => void }) {
  const nice = p.tier === "nice" ? <span className="pd2-nice">nice to have</span> : null;
  if (p.level === "story")
    return p.item ? (
      <ItemAdd item={p.item} clientKey={clientKey} add={add} after={nice} />
    ) : (
      <li className="pd2-add static"><span className="pr-title">{p.ref.title}</span>{nice}<span className="muted">DevOps isn't loaded</span></li>
    );
  return (
    <li className={`pd2-feature${p.breakDown ? " needs" : ""}${chosen ? " chosen" : ""}`} data-feature={p.ref.itemId}>
      <div className="pd2-feat-head">
        {p.item && <TypeIcon clientKey={clientKey} type={p.item.type} />}
        <button type="button" className="pd2-feat-name" aria-pressed={chosen} onClick={onChoose} title={chosen ? "Chosen: a story typed below goes under it. Click to unchoose" : "Choose it: a story typed below goes under it"}>
          {p.ref.title}
        </button>
        {nice}
        {p.breakDown ? <NeedsStories clientKey={clientKey} date={date} feature={{ itemId: p.ref.itemId, title: p.ref.title, ...(p.item ? { type: p.item.type } : {}) }} /> : <span className="pd2-count">{p.planned} of {p.total} {p.total === 1 ? "story" : "stories"} planned</span>}
      </div>
      {(p.stories.length > 0 || p.drafts.length > 0) && (
        <ul>
          {p.stories.map((k) => <ItemAdd key={k.id} item={k} clientKey={clientKey} add={add} />)}
          {p.drafts.map((d) => (
            <AddRow key={`d${d.id}`} k={`d${d.id}`} drag={{ clientKey, title: d.title, input: { draftId: d.id, size: d.size } }} onAdd={() => void add({ draftId: d.id, size: d.size })} label={`Add draft: ${d.title}`}>
              <DraftTitle draft={d} className="pr-title" />
              <span className="pd2-size">{d.size} · draft</span>
              <CreateInDevOps drafts={[d]} label="Create in DevOps" />
            </AddRow>
          ))}
        </ul>
      )}
    </li>
  );
}

/** "Needs stories · Draft stories · Coop brief" on a feature with no stories (U4). */
function NeedsStories({ clientKey, date, feature }: { clientKey: string; date: string; feature: { itemId: number; title: string; type?: string } }) {
  // NV-1: the Coop brief opens Break down's side panel (it copies there).
  const brief = () => openCoopBrief(clientKey, { id: feature.itemId, title: feature.title, ...(feature.type ? { type: feature.type } : {}) }, date);
  return (
    <span className="pd2-needs">
      <span className="pd2-needs-word">Needs stories</span>
      <BreakDown clientKey={clientKey} item={{ id: feature.itemId, title: feature.title }} />
      <button type="button" className="link-btn" onClick={brief}>
        Coop brief
      </button>
    </span>
  );
}

/**
 * The type box (U4, D398): "Type a story for <client>, then Enter". Enter makes a draft story under the chosen feature
 * (or under none yet) and plans it here; Shift+Enter keeps it a plain intention, shown as "not in DevOps". Choosing a
 * search result still adds that DevOps item.
 */
function StoryBox({ clientKey, clientName, half, date, parent, parentTitle, act }: { clientKey: string; clientName: string; half: Half; date: string; parent: number | null; parentTitle: string | null; act: PlanDayAct }) {
  const [value, setValue] = useState<ItemValue>(NO_ITEM);
  const here = useContext(HereCtx);
  const only = useCallback((i: WorkItem) => isPickable(i) && !here.has(`i${clientKey}:${i.id}`), [here, clientKey]);
  const story = async (title: string) => {
    try {
      const r = await call<{ draft: { id: number } }>("draft.add_story", { clientKey, parentItemId: parent, title });
      return act("pick.add", { date, half, clientKey, draftId: r.draft.id });
    } catch (e) {
      window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: e instanceof Error ? e.message : "Couldn't save the draft story" }));
      return false;
    }
  };
  return (
    <div className="intention pd2-type">
      <ItemLookup
        clientKey={clientKey}
        value={value}
        label={`A story for ${halfName(half).toLowerCase()}`}
        placeholder={`Type a story for ${clientName}, then Enter`}
        only={only}
        onChange={(v) => {
          if (v.itemId !== null) {
            setValue(NO_ITEM);
            void act("pick.add", { date, half, clientKey, itemId: v.itemId });
          } else setValue(v);
        }}
        onEnterText={async (text, how) => {
          const ok = how.shift ? await act("pick.add", { date, half, clientKey, intention: text }) : await story(text);
          if (ok) setValue(NO_ITEM);
        }}
      />
      <BoxHint className="pd2-type-hint">Enter adds a draft story{parentTitle ? ` under ${parentTitle}` : ""}. Shift+Enter adds a plain note.</BoxHint>
    </div>
  );
}

/** Unfinished from earlier days: one "+" brings a pick into the selected block; ⋯ has the rest. */
function CarryOver({ picks, date, to, act }: { picks: Pick[]; date: string; to: Half; act: PlanDayAct }) {
  // UI-B: "From last week" only when every pick is from an earlier week.
  const d = Temporal.PlainDate.from(date);
  const monday = d.subtract({ days: d.dayOfWeek - 1 }).toString();
  const label = picks.every((p) => p.date < monday) ? "From last week" : "Unfinished from earlier days";
  return (
    <section className="pd2-carry" aria-label={label}>
      <PlanLabel>{label}</PlanLabel>
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
    <>
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
    </>
  );
}

// ---------- step 13.6: the block agenda, Timebox and Timebox my day ----------

const isTodayIn = (date: string, now: string, tz: string) => Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString() === date;

/**
 * A block's agenda (D244): meetings, personal events, unavailable time and timeboxes in time order, with the free gaps
 * between ("Free 9:00–11:00 · 2h"). A timebox row opens its details (show as, Put on Outlook, Removed in Outlook).
 */
export function Agenda({ slot, now, tz, clientName, pickRow, whens }: { whens?: ReadonlyMap<string, DayEventWhen>; slot: Slot; now: string; tz: string; clientName: (k: string | null) => string; pickRow: (pickId: number) => ReactNode }) {
  const env = useTimeboxes();
  const [open, setOpen] = useState<number | null>(null);
  if (!env) return null;
  // With timeboxing off (D261), timeboxes stay but the agenda shows only the calendar and free time.
  const rows = agendaOf(slot, env.settings.enabled ? env.timeboxes : [], isTodayIn(slot.date, now, tz) ? now : undefined);
  if (!rows.length) return null;
  const sel = open !== null ? env.timeboxes.find((t) => t.id === open && !t.removedAt) ?? null : null;
  const row = (r: (typeof rows)[number]): ReactNode => {
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
    const w = r.eventId ? whens?.get(r.eventId) : undefined;
    return (
      <li key={`e${r.eventId}${r.start}`} className={`ag-${r.kind} show-${r.showAs ?? "busy"}${r.free ? " shown-free" : ""}${w ? ` when-${w}` : ""}`}>
        <span className="ag-time">{when}</span>
        <span className="ag-title" title={r.title}>
          {r.title}
        </span>
        {w === "now" && <span className="cal-tag now">Now</span>}
        {w === "next" && <span className="cal-tag next">Next</span>}
        {r.free && <span className="muted">shown as free</span>}
      </li>
    );
  };
  // UI-B: the now row, in the block under way (or the morning before the day starts), in the person's zone.
  const nowAt = ownsNow(slot.view, slot.half, now) ? agendaNowIndex(rows.map((r) => r.start), now, slot.date, tz) : null;
  return (
    <div className="pd-agenda">
      <ol aria-label={`${halfTag(slot.half)} agenda`}>
        {rows.flatMap((r, i) => (i === nowAt ? [<NowRow key="now" label={nowClock(now, tz)} />, row(r)] : [row(r)]))}
        {nowAt === rows.length && <NowRow key="now" label={nowClock(now, tz)} />}
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
          <CloseButton onClose={onClose} disabled={busy} />
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
            {env.access.access === "not_set_up" ? "Outlook isn't set up, so these stay in FocusTime." : env.access.message}{" "}
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
