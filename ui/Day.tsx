// WD-2: Day, the first tab: any date, built from Week's parts. One header row (‹ › the date, a Today chip or a Today
// button, Cards | Timeline, Timebox my day, + Add, ⋯); above the blocks, in this order and nothing else, the urgent
// strip, one line of chips (promises due today, the VM, a secret about to expire) and the card for the moment (nothing
// on today yet, check in, close out); then the day's blocks as Week's block cards (ui/BlockCard.tsx, AM and PM side by
// side when there's room, the Evening band when it has work), or the timeline (TY-1). The block panel opens on the
// right the same ways as on Week (App draws it). Midday check-in (ui/Checkin.tsx) and Close out (ui/CloseOut.tsx) are
// flows over the same page. Was ui/Today.tsx with its own block card, "This week" chips and a 3840 day timeline.
import { DaySuggestLine, useMorningSuggestions } from "./Suggest.tsx";
import type { SetupStep } from "../plan/setup.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import { DueBadge, Fading } from "./FollowUps.tsx";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CloseOutState, FollowUpView, UrgentAsk, WeekLoadData } from "../actions/types.ts";
import type { NowStrip } from "../plan/now.ts";
import { PickRow } from "./PickRow.tsx";
import { urgentFollowUps } from "../plan/today.ts";
import type { Pick } from "../plan/types.ts";
import type { Half, IsoDate, Slot } from "../week/types.ts";
import { clientColor, longDate } from "./labels.ts";
import { wasDueText } from "../plan/due.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { clientNames, PlanCtx, useFocused } from "./planview.ts";
import { causeLines } from "./status.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import { stepWeekday, weekendStops } from "./nav.ts";
import { nextWorkingDay, todayShape } from "../plan/todayday.ts";
import { hoursOn } from "../week/hours.ts";
import { dayCalendar } from "../plan/todaycal.ts";
import type { DayPromise } from "../plan/conversation-views.ts";
import { checkIn, type CheckSlot } from "../plan/checkin.ts";
import { boxedMinutes } from "../plan/timebox.ts";
import { formatDuration } from "../week/format.ts";
import { call, planAction } from "./api.ts";
import { TimeboxCheckin } from "./TimeboxCheckin.tsx";
import { FlexOfferBar, type FlexOffer, type MakeUpResult } from "./PickReview.tsx";
import { MoreButton, PopupMenu } from "./Menus.tsx";
import { planMyDay } from "../plan/agenda.ts";
import { DayTimeline, type Proposals } from "./DayTimeline.tsx";
import { useTimeboxes } from "./Timeboxes.tsx";
import { updatedAgo } from "./refresh.ts";
import { usePhone } from "./viewport.ts";
import { PhoneFollowUps } from "./Phone.tsx";
import { PhoneNextUp, PhoneNowCard, PhoneTodos, phoneNowOf } from "./PhoneDay.tsx";
import { WeekDnd } from "./WeekStories.tsx";
import { VmCtx, VmToday, vmNeedsToday } from "./Account.tsx";
import { WeekGrid } from "./WeekGrid.tsx";
import { NextTodoCtx, type NextTodo, type PanelFocus, type Selection } from "./weekctx.ts";
import { userZone } from "../week/zone.ts";
import type { Moment } from "../plan/modes.ts";
import { inboxSource, moreInInbox, dueTodayNotUrgent, urgentLines, type UrgentLine, type UrgentSource } from "../plan/urgent.ts";
import { railItems, type InboxItemView } from "../plan/inbox-items.ts";
import { canAddWork } from "../plan/days.ts";
import { aboveBlocks, dayHeadline, nextTodo } from "../plan/dayview.ts";
import { CheckinBlock, CheckinFoot, checkLeft } from "./Checkin.tsx";
import { CloseOutBlock, CloseOutPanel } from "./CloseOut.tsx";
import { WeekendDay } from "./DayWeekend.tsx";

export type DayMode = "now" | "checkin" | "closeout";

type Props = {
  /** QF-1: the day shown (#/day/<date>); null is today. WD-2: any day takes the block panel; today and later take work. */
  viewDate?: IsoDate | null;
  /** QF-1: ‹ › and Today (null: today). */
  onDay?: (date: IsoDate | null) => void;
  /** WK-3: Show weekend (‹ › step onto Saturday and Sunday always, not only when something is on them). */
  showWeekend?: boolean;
  /** QF-1: Timebox my day. */
  onTimebox?: (date: IsoDate) => void;
  /** TY-1: Timebox my day was asked for (from here or anywhere else): show its placeholders on this day's timeline. */
  timeboxAsk?: { date: IsoDate; n: number } | null;
  /** TY-1: the Cards | Timeline switch (saved for the person). */
  timeline?: boolean;
  onTimeline?: (show: boolean) => void;
  /** QF-1: a past day's Close out. */
  onCloseOutOn?: (date: IsoDate) => void;
  data: WeekLoadData;
  strip: NowStrip | null;
  /** The next day that can take work (today, or the next workday). */
  target: { date: string; isToday: boolean };
  now: string;
  nowMs: number;
  /** CV-3: more urgent strip sources after the Inbox's own lines. */
  urgentSources?: readonly UrgentSource[];
  /** IB-1 slice 4: the Inbox's rows for Day (inbox.today): the urgent strip, and the promises due on the cards. */
  inbox?: readonly InboxItemView[] | null;
  /** The badge's number, shown at the strip's foot. */
  needsYou?: number | null;
  /** Opens one Inbox item (#/inbox/item/<key>). */
  onItem?: (key: string) => void;
  /** Opens Inbox › Needs you. */
  onNeedsYou?: () => void;
  /** UI-9: a card's "N late" chip with several: the Inbox's Promises, late ones, for that client. */
  onLate?: (clientKey: string | null) => void;
  /** U2: Now, Check-in or Close out: states of this one page. */
  mode: DayMode;
  /** Close out's day (today by default; any earlier day). */
  closeOutDate: IsoDate | null;
  /** U5.1 (D408): personal events shown, and the switch (Day's ⋯ and G). */
  showPersonal: boolean;
  /** SG-1: Suggestions on or off (the person's setting), and its switch in ⋯. */
  suggestOn?: boolean;
  onSuggest?: (on: boolean) => void;
  onShowPersonal: (show: boolean) => void;
  /** Starts focus on a to-do (null: a plain focus timer). */
  onStart: (pick: Pick | null) => void;
  onFocusScreen: () => void;
  /** The running timer's Done and +15. */
  onTimer: (action: "timer.done" | "timer.extend") => void;
  onInbox: () => void;
  /** AP-2: Inbox › Requests (Check-in's "Walked in, not resolved"). */
  onAsks?: (conversationId?: number) => void;
  /** CV-1: opens Inbox › My promises. */
  onPromises?: (promiseId?: number) => void;
  onCaptures: () => void;
  onRetry: () => void;
  onFix: () => void;
  /** Opens Settings at a section (an expiring PAT or secret, working hours). */
  onSettings: (section: string) => void;
  onChanged: () => void;
  /** Back to Day (Check-in's and Close out's Done), with an optional notice. */
  onLeave: (notice?: string) => void;
  onCloseOutDate: (d: IsoDate) => void;
  /** Step 17.5: after Close out's Done commits (the reverse unroll). */
  onClosedOut: (st: CloseOutState) => void;
  /** NV-1: the card for the moment of the day (nothing on today yet, Midday check-in or Close out), or none. */
  moment?: Moment | null;
  onCheckIn?: () => void;
  onCloseOut?: () => void;
  /** S1 (D451): "2 setup steps left", opening setup at the first step not done; null when nothing is left. */
  setupLine?: { text: string; step: SetupStep } | null;
  onSetup?: (step: SetupStep) => void;
  /** WD-2: the block the panel is on (App draws the panel), for the marked card and the room it needs. */
  panelAt: { date: IsoDate; half: Half } | null;
  /** WD-2: opens the block panel on a block (`add`: the cursor in its Add box; `focus`: a promise's due badge). */
  onOpenBlock: (date: IsoDate, half: Half, o?: { add?: boolean; focus?: PanelFocus | null }) => void;
  /** WD-2: "+ Add" in the header (and the moment card's Add work): the panel on the day's block under way or its next. */
  onAdd: (date: IsoDate) => void;
  /** The selected block (the loaded week's, as on Week), its cards' elements, and the arrow keys' move. */
  selection: Selection;
  cellRefs: Map<string, HTMLDivElement>;
  onSelect: (s: Selection) => void;
};

const clock = (iso: string, tz: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const live = (p: Pick) => p.status === "planned" || p.status === "done";

export function Day(props: Props) {
  const { data, target, now, nowMs, mode } = props;
  const realToday = data.planDay.date;
  const date = props.viewDate ?? realToday;
  const isToday = date === realToday;
  const past = date < realToday;
  // WK-3: a Saturday or Sunday is a "Weekend" day: its calendar and to-dos as plain rows, no planning prompts.
  const weekendDay = Temporal.PlainDate.from(date).dayOfWeek >= 6;
  const tz = userZone(data);
  const phone = usePhone();
  const view = useContext(PlanCtx);
  // MB-1: today on the phone: the Now card, Needs you, the to-dos by block and Next up (other days and the flows use the cards).
  const phoneToday = phone && mode === "now" && isToday;
  const dnd = useContext(WeekDnd);
  const tickWithUndo = (p: Pick, done = true) => {
    view.toggle(p.id, done);
    dnd?.note(`${done ? "Done" : "Not done"}: ${p.title}`, async () => view.toggle(p.id, !done));
  };
  const dayIndex = data.week.days.findIndex((d) => d.date === date);
  const day = dayIndex >= 0 ? data.week.days[dayIndex]! : null;
  const plan = data.plan?.[date];
  const picks = useMemo(() => plan?.picks ?? [], [plan]);
  // CF-1: no confirm; to-dos tick on today and past days.
  const tickable = date <= realToday;
  const nameOf = clientNames(data);
  // QF-1 (plan/todayday.ts): a PTO day shows only the blocks that still hold a to-do; nothing nags on it or on any day but today.
  const shape = todayShape(day, { date, today: realToday, todayWorkday: data.planDay.workday, picked: new Set(picks.filter(live).map((p) => p.half)) });
  const { ptoDay, workday, nudges, readOnly } = shape;
  const blocks = shape.blocks.map((b) => b.slot);
  const cal = day ? dayCalendar(day, now) : null;
  const onPromise = props.onPromises ?? props.onInbox;
  // CV-3: the strip's sources, and what the chips carry: promises due today with no time, until their last 2 working
  // hours (the end of today's last block).
  const todayPromises = target.isToday && nudges ? (data.promises ?? []) : [];
  const dayEnd = blocks.length ? blocks.map((s) => s.end).sort().at(-1)! : null;
  const clockNow = new Date(nowMs).toISOString();
  // IB-1 slice 4: the strip reads the Inbox's rows; the chips leave out whatever the strip already shows.
  const urgentSources: UrgentSource[] = [inboxSource(target.isToday && nudges ? (props.inbox ?? []) : [], { today: date, dayEnd }), ...(props.urgentSources ?? [])];
  const inStrip = new Set(urgentLines(urgentSources, clockNow, tz).map((l) => l.key));
  const tbEnv = useTimeboxes();
  const dueChips = dueTodayNotUrgent(todayPromises, { now: clockNow, today: date, dayEnd }).filter((p) => !inStrip.has(`c${p.id}`));
  const focused = useFocused();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [offer, setOffer] = useState<{ offer: FlexOffer; pick: Pick } | null>(null);
  // TY-1: Timebox my day's placeholders; they show the timeline for this visit even with the switch on Cards.
  const [proposals, setProposals] = useState<Proposals | null>(null);
  const [tlForced, setTlForced] = useState(false);
  const clearNotice = useCallback(() => setNotice(null), []);
  const nextDay = data.week.days.find((d) => d.date > date && d.hours.segments.length > 0 && !d.pto)?.date ?? null;

  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        await planAction(action, input);
        setError(null);
        props.onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [props.onChanged], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const makeUp = useCallback(
    async (p: Pick, input: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => {
      try {
        const r = await call<MakeUpResult>("pick.make_up", { id: p.id, ...input });
        window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: `Borrowed ${formatDuration(r.borrowed.minutes)} to make up` }));
        if (r.flexOffer) setOffer({ offer: r.flexOffer, pick: p });
        props.onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [props.onChanged], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // AP-2: Start focus on an urgent ask: a walk-on to-do (the AI's title) in the block under way, then focus on it.
  const startAsk = useCallback(
    async (u: UrgentAsk) => {
      if (!workday || !blocks.length) return props.onStart(null);
      const half = props.strip?.half ?? blocks[0]!.half;
      const had = picks.find((p) => p.clientKey === u.clientKey && p.title === u.title && p.status === "planned");
      try {
        const pick = had ?? (await call<{ pick: Pick }>("pick.add", { date, half, clientKey: u.clientKey, intention: u.title })).pick;
        props.onChanged();
        props.onStart(pick);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
      }
    },
    [workday, blocks, picks, date, props.strip, props.onStart, props.onChanged], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const ended = (s: Slot) => ms(now) >= ms(s.end);
  // The next to-do (today only): the one being timed, else the first planned one in the first block that hasn't ended.
  const nextPick = readOnly || !isToday ? null : nextTodo(blocks.map((s) => ({ half: s.half, ended: ended(s) })), picks, data.timer?.pickId ?? null);
  const t = data.timer;
  const next: NextTodo | null = mode === "now" && nextPick
    ? {
        id: nextPick.id,
        actions: (p) =>
          t && t.pickId === p.id ? (
            <span className="next-timer">
              <button type="button" className="next-count" onClick={props.onFocusScreen} title="Back to the focus screen">
                {t.ended ? "Time's up" : countdown(timerLeft(t, nowMs))}
              </button>
              <button type="button" className="mini" onClick={() => props.onTimer("timer.done")} title="End the session and tick the to-do done">
                Done
              </button>
              <button type="button" className="mini" onClick={() => props.onTimer("timer.extend")} title="Add 15 minutes">
                +15
              </button>
            </span>
          ) : t ? undefined : (
            <button type="button" className="start-focus" onClick={() => props.onStart(p)} title="Start focus on this to-do">
              Start focus
            </button>
          ),
      }
    : null;

  const check: CheckSlot[] =
    mode === "checkin" && day
      ? checkIn(
          blocks.map((s) => ({ half: s.half, slot: { ...s, pto: !!day.pto } })),
          picks,
          focused,
          data.planning.sizes,
          now,
          boxedMinutes(data.timeboxes),
        )
      : [];

  // Close out: that day's state from the server (focused time, carry-over day, notes, promises).
  const closeDate = mode === "closeout" ? (props.closeOutDate ?? date) : null;
  const [st, setSt] = useState<CloseOutState | null>(null);
  const loadClose = useCallback(async () => {
    if (!closeDate) return;
    try {
      setSt(await call<CloseOutState>("closeout.load", { date: closeDate }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Close out");
    }
  }, [closeDate]);
  useEffect(() => {
    if (!closeDate) return setSt(null);
    void loadClose();
  }, [closeDate, loadClose, data]);

  // WK-3: ‹ › step onto a weekend day that has something (or any, with Show weekend on).
  const stops = weekendStops({ showWeekend: !!props.showWeekend, days: data.week.days });
  const nextWorkday = ptoDay ? nextWorkingDay(date, (d) => hoursOn(data.hours, d).segments.length > 0, (d) => data.ptoAhead.includes(d) || !!data.week.days.find((x) => x.date === d)?.pto) : null;
  const dayWord = isToday ? "today" : Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" });
  // QF-1: Timebox my day, beside the day's plan.
  const boxedIds = new Set(data.timeboxes.filter((b) => b.date === date && !b.removedAt).map((b) => b.pickId));
  const unboxed = picks.filter((p) => p.status === "planned" && !boxedIds.has(p.id)).length;
  const canTimebox = !past && workday && !ptoDay && data.timeboxSettings.enabled !== false;
  // WD-2: today and every later day with working time takes work; a past day, PTO and a day off take none.
  const canAdd = mode === "now" && !!day && !weekendDay && !ptoDay && workday && blocks.some((s) => canAddWork({ date, today: realToday, pto: !!day.pto || s.pto, off: s.off }));

  // TY-1: the timeline shows on a day with blocks or PTO (a weekend day stays its plain list; so do the flows).
  const timelineShown = mode === "now" && !weekendDay && !!day && (!!props.timeline || tlForced) && (workday || ptoDay);
  const startTimebox = () => {
    if (!day || !canTimebox) return;
    const slots: Partial<Record<Half, Slot>> = {};
    for (const s of blocks) if (!s.off && !s.pto) slots[s.half] = s;
    const r = planMyDay(picks, slots, data.timeboxes, view.sizes, isToday ? now : undefined, view.minSizes);
    tbEnv?.loadAccess();
    setTlForced(true);
    if (!r.placed.length && !r.unplaced.length) return setNotice("Every planned to-do already has a timebox");
    setProposals({ date, items: r.placed, unplaced: r.unplaced, outlook: !!tbEnv?.settings.outlookDefault });
  };
  // Timebox my day was asked for (this button, the day menu, the block panel, the command menu): once per ask, once the day is here.
  const askedRef = useRef(0);
  useEffect(() => {
    const ask = props.timeboxAsk;
    if (ask && ask.n !== askedRef.current && ask.date === date && day) {
      askedRef.current = ask.n;
      startTimebox();
    }
  }, [props.timeboxAsk?.n, date, !!day]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setProposals((p) => (p && p.date !== date ? null : p)), [date]);

  // RF-1: on a computer a source that needs reconnecting is in the status bar only; the phone has no status bar, so it keeps the chip.
  const chips = mode === "now" && nudges ? <Attention noDue={phone} sources={phone} promises={dueChips} inStrip={inStrip} onItem={props.onItem} onPromises={onPromise} data={data} date={date} clockMs={nowMs} onInbox={props.onInbox} onRetry={props.onRetry} onFix={props.onFix} onSettings={props.onSettings} /> : null;
  const toggleTimeline = () => {
    const show = !timelineShown;
    setTlForced(false);
    if (!show) setProposals(null);
    props.onTimeline?.(show);
  };
  const openBlock = (half: Half, o?: { add?: boolean; focus?: PanelFocus | null }) => props.onOpenBlock(date, half, o);
  const panelHere = props.panelAt?.date === date ? props.panelAt : null;
  const head = dayHeadline(date, realToday);
  // SG-1: the morning card says when suggestions wait in today's blocks, with Keep all beside + Add.
  const morning = useMorningSuggestions(date);

  return (
    <main className={`today-view day-view u2 mode-${mode}${panelHere && !phone ? " with-panel" : ""}`} aria-label="Day">
      <header className="today-head day-bar">
        <div className="ph-title">
          {mode === "checkin" ? (
            <h1>
              Midday check-in <span className="muted">{clock(now, tz)} · {checkLeft(check)}</span>
            </h1>
          ) : (
            <>
              {mode === "now" && props.onDay && (
                <span className="pd-step today-step" data-tour="today-days" role="group" aria-label="Day">
                  <button type="button" onClick={() => props.onDay!(stepWeekday(date, -1, stops))} aria-label="Previous day" title="Previous day ([)">‹</button>
                  <button type="button" onClick={() => props.onDay!(stepWeekday(date, 1, stops))} aria-label="Next day" title="Next day (])">›</button>
                </span>
              )}
              <h1 title={longDate(date)}>{head.date}</h1>
              {isToday ? (
                <span className="today-pill day-today">Today</span>
              ) : (
                mode === "now" && props.onDay && (
                  <button type="button" className="mini today-back" onClick={() => props.onDay!(null)} title="Back to today">
                    Today
                  </button>
                )
              )}
              {!isToday && <span className="muted day-when">{head.when}</span>}
              {/* SG-1: the day's suggestions, in the header row. */}
              {mode === "now" && !weekendDay && <DaySuggestLine date={date} className="sug-day-head" />}
            </>
          )}
        </div>
        <ModeArea
          done={
            mode === "checkin"
              ? {
                  title: data.checkIn.done ? "Back to Day (Esc)" : "Midday check-in done: back to Day",
                  onClick: async () => {
                    // Done marks today checked in, then back to Day.
                    if (!data.checkIn.done && !(await act("checkin.done", { date }))) return;
                    props.onLeave();
                  },
                }
              : null
          }
        >
          {mode === "now" && !weekendDay && props.onTimeline && (
            <span className="day-switch" role="group" aria-label="Cards or timeline" data-tour="wk-timeline">
              <button type="button" aria-pressed={!timelineShown} onClick={() => timelineShown && toggleTimeline()} title="The day's blocks as cards (B)">Cards</button>
              <button type="button" aria-pressed={timelineShown} onClick={() => !timelineShown && toggleTimeline()} title="The day on an hour timeline (B)">Timeline</button>
            </span>
          )}
          {mode === "now" && canTimebox && unboxed > 0 && props.onTimebox && !proposals && (
            <button type="button" className="mini today-timebox" onClick={() => props.onTimebox!(date)} title="Suggest a time for every planned to-do, on the timeline, to accept or change">
              Timebox my day
            </button>
          )}
          {canAdd && (
            <button type="button" className="mini add-work-head" data-tour="wk-add" aria-pressed={!!panelHere} onClick={() => props.onAdd(date)} title="Add to a block (A)">
              + Add
            </button>
          )}
          <MoreButton
            label="View options for Day"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMoreAt({ x: r.left, y: r.bottom + 4 });
            }}
          />
        </ModeArea>
      </header>
      {moreAt && (
        <PopupMenu
          at={moreAt}
          step={{ title: "Day", items: [
            { id: "personal", label: "Personal events", group: "Show", checked: props.showPersonal, hint: "G", run: () => props.onShowPersonal(!props.showPersonal) },
            ...(props.onSuggest ? [{ id: "suggestions", label: "Suggestions", group: "Show", checked: props.suggestOn !== false, hint: props.suggestOn !== false ? "on" : "off", run: () => props.onSuggest!(props.suggestOn === false) }] : []),
            ...(mode === "now" && !weekendDay && props.onTimeline ? [{ id: "timeline", label: "Timeline", group: "Show", checked: timelineShown, hint: "B", run: () => toggleTimeline() }] : []),
            ...(mode === "now" && past && props.onCloseOutOn ? [{ id: "closeout", label: `Close out ${dayWord}`, run: () => props.onCloseOutOn!(date) }] : []),
          ] }}
          onClose={() => setMoreAt(null)}
        />
      )}
      {mode === "now" && nudges && phoneToday && (
        <PhoneNowCard card={phoneNowOf(blocks, cal?.timed ?? [], clockNow)} data={data} pick={nextPick} nowMs={nowMs} nameOf={nameOf} tickable={tickable} onStart={props.onStart} onDone={tickWithUndo} onTimer={props.onTimer} onFocusScreen={props.onFocusScreen} />
      )}
      {/* MB-1: on the phone one heading over the strip (its 3 lines and "N more in Inbox"). */}
      {mode === "now" && nudges && phoneToday && urgentLines(urgentSources, clockNow, tz).length > 0 && <h2 className="section-label ph-urgent-head">Needs you</h2>}
      {/* WD-2: above the blocks, in this order and nothing else: the urgent strip, one line of chips, the card for the moment. */}
      {aboveBlocks({ mode, today: nudges, urgent: urgentLines(urgentSources, clockNow, tz).length, chips: !!chips, moment: props.moment ?? null }).map((part) =>
        part === "urgent" ? (
          <UrgentStrip key={part} sources={urgentSources} now={clockNow} today={date} tz={tz} clientName={(k) => data.planClients.find((c) => c.clientKey === k)?.clientName ?? k} onItem={props.onItem ?? (() => props.onInbox())} needsYou={props.needsYou ?? null} onNeedsYou={props.onNeedsYou} onAskFocus={(u) => void startAsk(u)} />
        ) : part === "chips" ? (
          <div key={part} className="day-chips">{chips}</div>
        ) : (
          <MomentCard key={part} phone={phoneToday} m={props.moment!} onPlan={() => props.onAdd(date)} onCheckIn={props.onCheckIn} onCloseOut={props.onCloseOut} suggested={morning} />
        ),
      )}
      {mode === "now" && nudges && props.setupLine && props.onSetup && (
        <p className="setup-line">
          <button type="button" className="link-btn" onClick={() => props.onSetup!(props.setupLine!.step)} title="Finish setting up FocusTime">
            {props.setupLine.text}
          </button>
        </p>
      )}
      {error && <p className="set-problem" role="alert">{error}</p>}
      <Fading text={notice} onGone={clearNotice} />
      {offer && <FlexOfferBar offer={offer.offer} clientKey={offer.pick.clientKey} clientName={nameOf(offer.pick.clientKey)} title={offer.pick.title} onDone={(m) => { setOffer(null); setNotice(m); props.onChanged(); }} />}
      {mode === "checkin" && <TimeboxCheckin date={date} moment="midday" color={(k) => clientColor(k, data.clients)} onChanged={props.onChanged} onError={setError} />}

      {mode === "now" && ptoDay && (
        <p className="today-pto" role="status">
          <strong>You're off {dayWord}.</strong>{" "}
          {picks.some(live) ? "What was planned is below, read only." : "Nothing is planned."}{" "}
          {nextWorkday && props.onDay && (
            <button type="button" className="link-btn" onClick={() => props.onDay!(nextWorkday === realToday ? null : nextWorkday)}>
              {longDate(nextWorkday).replace(/,\s*\d{4}$/, "")}, your next working day
            </button>
          )}
        </p>
      )}
      {weekendDay && mode === "now" ? (
        <WeekendDay day={day} date={date} past={past} data={data} picks={picks} />
      ) : !day ? (
        <p className="muted today-loading">Opening {longDate(date)}…</p>
      ) : ptoDay && !blocks.length && !timelineShown ? null : !workday && !ptoDay ? (
        <p className="today-off">
          {!isToday ? `Nothing scheduled ${dayWord}.` : target.isToday ? "Nothing scheduled today." : `No work today. Next workday is ${longDate(target.date).replace(/,\s*\d{4}$/, "")}.`}{" "}
          {(isToday || !past) && (
            <button type="button" className="link-btn" onClick={() => props.onAdd(target.date)}>
              Add work to {longDate(target.date).replace(/,\s*\d{4}$/, "")}
            </button>
          )}
        </p>
      ) : phoneToday && !timelineShown ? (
        <div className="today-body ph-today">
          <PhoneTodos blocks={blocks} picks={picks} data={data} nameOf={nameOf} tickable={tickable} now={now} onTick={(p, d) => tickWithUndo(p, d)} onAdd={(half) => openBlock(half, { add: true })} />
          <PhoneNextUp blocks={blocks} events={cal?.timed ?? []} data={data} nameOf={nameOf} now={clockNow} />
        </div>
      ) : mode === "now" && timelineShown ? (
        <div className="today-body with-tl">
          <div className="today-main">
            <DayTimeline
              day={day}
              blocks={blocks}
              data={data}
              picks={picks}
              now={now}
              tz={tz}
              editable={!past && !ptoDay && workday}
              readOnly={!!readOnly}
              phone={phone}
              proposals={proposals}
              setProposals={setProposals}
              inbox={props.inbox ?? []}
              onPromise={props.onItem ?? (() => props.onInbox())}
              onLate={() => (props.onNeedsYou ?? props.onInbox)()}
              onOpen={(half, focus) => openBlock(half, { focus: focus ?? null })}
              onAdd={canAdd ? (half) => openBlock(half, { add: true }) : undefined}
              nameOf={nameOf}
            />
            {phone && nudges && <PhoneFollowUps data={data} date={date} onChanged={(m) => (m && setNotice(m), props.onChanged())} />}
          </div>
        </div>
      ) : mode === "now" ? (
        <div className="today-body day-cards" data-tour="today-blocks">
          <NextTodoCtx.Provider value={next}>
            <WeekGrid
              only={dayIndex}
              week={data.week}
              colors={data.clients}
              minFocusWindow={data.thresholds.minFocusWindowMinutes}
              today={realToday}
              now={now}
              selection={props.selection}
              cellRefs={props.cellRefs}
              layout="medium"
              compact
              timeline={false}
              promises={railItems(props.inbox ?? [])}
              onPromise={props.onItem}
              onLate={props.onLate}
              onAddWork={(d, half) => props.onOpenBlock(d, half, { add: true })}
              onAddHours={() => props.onSettings("hours")}
              onSelect={props.onSelect}
              onOpen={(s, focus) => {
                props.onSelect(s);
                openBlock(s.half, { focus: focus ?? null });
              }}
            />
          </NextTodoCtx.Provider>
          {ptoDay && picks.some(live) && (
            <ul className="checklist day-pto-todos" aria-label={`Planned on ${dayWord}, read only`}>
              {picks.filter(live).map((p) => <PickRow key={p.id} pick={p} toggle={view.toggle} density="today" readOnly canTick={false} timeEditable={false} />)}
            </ul>
          )}
        </div>
      ) : (
        <div className="today-body">
          <div className="today-main">
            <section className={`today-blocks${blocks.length === 1 ? " one" : ""}`} style={{ "--blocks": blocks.length } as CSSProperties} aria-label="The day's blocks">
              {blocks.map((s) =>
                mode === "checkin" ? (
                  (() => {
                    const c = check.find((x) => x.half === s.half);
                    return c ? (
                      <CheckinBlock key={s.half} slot={s} data={data} check={c} picks={picks.filter((p) => p.half === s.half)} tickable={tickable} ended={ended(s)} later={blocks.filter((b) => b.half !== s.half && !ended(b) && ms(b.start) > ms(s.start)).map((b) => ({ half: b.half, clientKey: b.focus[0]?.clientKey ?? null }))} carryTo={nextDay} nameOf={nameOf} act={act} makeUp={makeUp} />
                    ) : null;
                  })()
                ) : (
                  <CloseOutBlock key={s.half} slot={s} data={data} picks={picks.filter((p) => p.half === s.half)} tickable={tickable} ended={ended(s)} carryTo={st?.carryTo ?? null} nameOf={nameOf} act={act} />
                ),
              )}
            </section>
            {mode === "checkin" && <CheckinFoot data={data} date={date} blocks={blocks.filter((s) => !ended(s))} picks={picks} act={act} onAsks={props.onAsks ?? props.onInbox} />}
          </div>
        </div>
      )}

      {mode === "now" && past && !ptoDay && day && !weekendDay && (
        <p className="today-other muted">
          A past day: tick what got done, or move what didn't forward.{" "}
          {props.onCloseOutOn && (
            <button type="button" className="link-btn" onClick={() => props.onCloseOutOn!(date)}>
              Close out {dayWord}
            </button>
          )}
        </p>
      )}

      {mode === "closeout" && (
        <CloseOutPanel date={closeDate ?? date} st={st} data={data} nameOf={nameOf} reload={loadClose} onChanged={props.onChanged} onError={setError} onDate={props.onCloseOutDate} onLeave={props.onLeave} onClosedOut={props.onClosedOut} onInbox={props.onInbox} onCaptures={props.onCaptures} act={act} onShown={date !== (closeDate ?? date)} />
      )}
    </main>
  );
}

/**
 * The attention line: only when something needs it. Follow-ups due collapse to one chip that opens into rows; a source
 * that failed shows with how old its data is and Retry; an expiring secret links to its setting. Nothing when healthy.
 */
function Attention({ noDue = false, sources = true, promises = [], soon = [], inStrip, onItem, onPromises, data, date, clockMs, onInbox, onRetry, onFix, onSettings }: { noDue?: boolean; /** RF-1: show sources that need a fix (the phone only; a computer has the status bar). */ sources?: boolean; promises?: DayPromise[]; soon?: DayPromise[]; inStrip?: ReadonlySet<string>; onItem?: ((key: string) => void) | undefined; onPromises?: () => void; data: WeekLoadData; date: IsoDate; clockMs: number; onInbox: () => void; onRetry: () => void; onFix: () => void; onSettings: (s: string) => void}) {
  const [open, setOpen] = useState(false);
  // P1: the phone lists due follow-ups at the foot of Today instead.
  // IB-1 slice 4: a late promise I added is in the urgent strip now (the Inbox's rows), so it isn't listed twice.
  const due: FollowUpView[] = noDue ? [] : urgentFollowUps(data.followUps, date).filter((l) => !inStrip?.has(`f${l.id}`));
  const down = sources ? causeLines(data.sources, data.devops) : [];
  const vm = vmNeedsToday(useContext(VmCtx).status);
  // NV-1: urgent requests and my promises due are in the urgent strip above this line.
  if (!due.length && !promises.length && !soon.length && !down.length && !data.expiring.length && !vm) return null;
  const dueCount = due.length + promises.length;
  const names = [...new Set(due.map((l) => (l.hasWho ? l.who : l.clientName ?? "")).filter(Boolean))];
  return (
    <section className="attention" aria-label="Needs attention">
      <div className="attention-line">
        {dueCount > 0 && (
          <button type="button" className="att-chip due" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="att-tag">
              {[due.length ? `${due.length} promise${due.length === 1 ? "" : "s"}` : "", promises.length ? `${promises.length} promise${promises.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} due
            </span>
            {names.length > 0 && <span className="att-names">{names.join(" · ")}</span>}
            <span aria-hidden="true">{open ? "⌃" : "›"}</span>
          </button>
        )}
        {soon.map((p) => (
          <button key={`promise-${p.id}`} type="button" className={`att-chip promise${p.overdue ? " overdue" : ""}`} onClick={onPromises} title="Open it in Inbox › Promises">
            <span className="att-tag">{p.overdue ? `Promise · ${wasDueText(p, date, userZone(data)).replace(/^Was/, "was")}` : "Promise"}</span>
            <span className="att-names">{Temporal.Instant.from(p.dueAt!).toZonedDateTimeISO(userZone(data)).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
            <span>{p.what}</span>
          </button>
        ))}
        {down.map((c) => (
          <span key={c.key} className="att-chip source" title={c.step ?? ""}>
            <span className="att-tag">{c.affected.join(", ")}</span>
            <span>{c.missing ? "no data yet" : c.since ? `showing data ${updatedAgo(c.since, clockMs, userZone(data)).replace(/^updated /, "from ")}` : c.text}</span>
            {c.fixes.some((f) => f.kind === "retry") ? (
              <button type="button" className="mini" onClick={onRetry}>
                Retry
              </button>
            ) : (
              <button type="button" className="mini" onClick={onFix}>
                Reconnect
              </button>
            )}
          </span>
        ))}
        {vm && <VmToday />}
        {data.expiring.map((x) => (
          <button key={x.key} type="button" className={`att-chip expiry${x.days < 0 ? " expired" : ""}`} onClick={() => onSettings(x.section)}>
            <span className="att-tag">{x.days < 0 ? "Expired" : "Expires"}</span>
            <span>{x.text}</span>
          </button>
        ))}
      </div>
      {open && (
        <ul className="att-rows">
          {due.map((l) => (
            <li key={l.id}>
              <button type="button" className="att-row" onClick={() => (onItem ? onItem(`f${l.id}`) : onInbox())}>
                <DueBadge l={l} />
                <span className="att-who">{l.hasWho ? l.who : l.clientName ?? ""}</span>
                <span className="what">{l.what}</span>
              </button>
            </li>
          ))}
          {promises.map((p) => (
            <li key={`promise-${p.id}`}>
              <button type="button" className="att-row" onClick={() => (onItem ? onItem(`c${p.id}`) : (onPromises ?? onInbox)())}>
                <span className={`due-badge${p.overdue ? " overdue-amber" : ""}`}>{p.overdue ? `Promise · ${wasDueText(p, date, userZone(data)).replace(/^Was/, "was")}` : p.dueAt ? `Promise · ${clock(p.dueAt, userZone(data))}` : "Promise"}</span>
                <span className="att-who">{p.toName ?? p.clientName}</span>
                <span className="what">{p.what}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * NV-1: the urgent strip, under what's next: what needs me now, mine only. IB-1 slice 4: its lines are the Inbox's own
 * items (plan/inbox-items.ts `todayLines`): conversations with a request needed now, my promises late or due soon, sends
 * to me waiting for my answer; each opens its item in the Inbox's detail pane. At most 3 lines, the most urgent first;
 * "N more in Inbox" opens Needs you for the rest (the badge's number less the lines shown). An urgent request keeps its Start focus. Hidden when there is nothing.
 */
export function UrgentStrip({ sources, now, today, tz, clientName, onItem, needsYou, onNeedsYou, onAskFocus }: { sources: readonly UrgentSource[]; now: string; today: IsoDate; tz: string; clientName: (k: string) => string; onItem: (key: string) => void; needsYou?: number | null; onNeedsYou?: (() => void) | undefined; onAskFocus: (u: UrgentAsk) => void }) {
  const lines = urgentLines(sources, now, tz);
  if (!lines.length) return null;
  const more = moreInInbox(lines, needsYou);
  return (
    <section className="urgent-strip" data-tour="today-urgent" aria-label="Urgent">
      <ul>
        {lines.map((l) => {
          const v = stripLine(l, { today, tz, clientName });
          return (
            <li key={l.key} className={`us-item us-${v.cls}${v.late ? " overdue" : ""}`}>
              <button type="button" className="us-line" onClick={() => (l.kind === "item" ? onItem(l.key) : l.open?.())} title={l.kind === "item" ? "Open it in the Inbox" : undefined}>
                <span className="us-tag">{v.tag}</span>
                {v.who && <span className="us-who">{v.who}</span>}
                <span className="us-what">{v.what}</span>
                <span className="us-go" aria-hidden="true">›</span>
              </button>
              {l.kind === "item" && l.row.urgent && (
                <button type="button" className="mini" onClick={() => onAskFocus(l.row.urgent!)} title="Add it to the block under way and start focus on it">
                  Start focus
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {more !== null && onNeedsYou && (
        <button type="button" className="link-btn us-all" onClick={onNeedsYou}>
          {more} more in Inbox
        </button>
      )}
    </section>
  );
}

/** One strip line's tag, who and what, in plain words. */
export function stripLine(l: UrgentLine, o: { today: IsoDate; tz: string; clientName: (k: string) => string }): { cls: string; tag: string; who: string | null; what: string; late: boolean } {
  if (l.kind === "other") return { cls: l.source, tag: l.tag, who: l.who || null, what: l.what, late: !!l.overdue };
  const r = l.row;
  const client = r.clientKey ? o.clientName(r.clientKey) : null;
  if (r.kind === "conversation") return { cls: "conversation", tag: "Needs you now", who: client, what: r.urgent?.title ?? r.title, late: false };
  if (r.kind === "send") return { cls: "sends sent-line", tag: r.must ? "Sent to you · Must" : "Sent to you", who: r.who, what: r.title, late: false };
  const tag = r.late ? `Promise · ${wasDueText({ dueAt: r.dueAt, dueDate: r.due }, o.today, o.tz).replace(/^Was/, "was")}` : r.dueAt ? `Promise · ${clock(r.dueAt, o.tz)}` : "Promise due today";
  return { cls: "promise", tag, who: r.who ?? client, what: r.title, late: r.late };
}

const MOMENTS = {
  plan: { title: "Nothing on today yet", body: "Put this week's stories into today's blocks.", button: "+ Add" },
  checkin: { title: "Midday check-in", body: "What still fits this afternoon, with one suggested move each.", button: "Check in" },
  closeout: { title: "Close out", body: "What got done, where you left off, DevOps updates and promises.", button: "Close out" },
} as const;

/** NV-1: the card for the moment of the day. Plan today opens Week's Board on today; the others open their flow here. Done is one small line, reopenable. */
export function MomentCard({ m, onPlan, onCheckIn, onCloseOut, phone = false, suggested = null }: { /** SG-1: suggestions waiting in today's blocks (the plan card only). */ suggested?: { body: string; keepAll: () => void } | null; /** MB-1: on the phone, Close out's card reads "Wrap up the day". */ phone?: boolean; m: Moment; onPlan: () => void; onCheckIn?: (() => void) | undefined; onCloseOut?: (() => void) | undefined }) {
  const open = m.kind === "plan" ? onPlan : m.kind === "checkin" ? onCheckIn : onCloseOut;
  const base = phone && m.kind === "closeout" ? { ...MOMENTS.closeout, title: "Wrap up the day" } : MOMENTS[m.kind];
  const sg = m.kind === "plan" ? suggested : null;
  const t = sg ? { ...base, body: sg.body } : base;
  if (m.done)
    return (
      <p className="moment-done" role="status">
        {m.kind === "checkin" ? "Midday check-in done" : "Closed out"} <span aria-hidden="true">✓</span>{" "}
        {open && (
          <button type="button" className="link-btn" onClick={open}>
            Reopen
          </button>
        )}
      </p>
    );
  return (
    <section className={`moment-card moment-${m.kind}`} data-tour="today-moment" aria-label={t.title}>
      <div className="mc-text">
        <h2>{t.title}</h2>
        <p>{t.body}</p>
      </div>
      {sg && (
        <button type="button" className="sug-morning-keep" onClick={sg.keepAll} title="Keep every suggestion in today's blocks">
          Keep all
        </button>
      )}
      {open && (
        <button type="button" className="primary" onClick={open}>
          {t.button}
        </button>
      )}
    </section>
  );
}
