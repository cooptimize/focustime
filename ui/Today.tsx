// Today (step 10, U2, NV-1): the default tab. One page, no modes. Now, from the top: what's next with the one Start
//        focus, the urgent strip (mine only, hidden when empty), the attention line (sources, VM, secrets, follow-ups
//        due), the card for the moment of the day (Plan today, Midday check-in or Close out), one card per block with
//        the day's meetings and picks in time order, After your blocks, and the week's features at the bottom.
//   The moment cards open two flows over the same page:
//   Midday check-in: the same cards, changed: ended blocks dim, done picks are a count, each pick that won't fit gets one
//        suggested move, one amber line per block, walk-on work and the musts line once at the bottom.
//   Close out: a side panel over the dimmed cards (numbers, where you left off, DevOps updates owed, follow-ups due).
// At 3840 wide a day timeline sits on the left (drop a pick onto a free gap to timebox it) and a detail panel under
// the cards. Lumen never appears here.
import { SentToYouLine } from "./Team.tsx";
import type { SetupStep } from "../plan/setup.ts";
import { useTextScale } from "./textsize.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import type React from "react";
import { DueBadge, Fading, FollowUpRow } from "./FollowUps.tsx";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { CloseOutState, FollowUpView, UrgentAsk, WeekLoadData } from "../actions/types.ts";
import { blockStatus } from "../plan/blockstatus.ts";
import type { NowStrip } from "../plan/now.ts";
import { aboutHours, planFit } from "../plan/fit.ts";
import { PICK_DRAG, PickRow } from "./PickRow.tsx";
import { urgentFollowUps } from "../plan/today.ts";
import type { Pick } from "../plan/types.ts";
import type { Day, FreeGap, Half, IsoDate, Slot } from "../week/types.ts";
import { clientColor, halfName, longDate, slotRange } from "./labels.ts";
import { wasDueText } from "../plan/due.ts";
import { countdown, timerLeft } from "./NowStrip.tsx";
import { clientNames, featuresOn, PlanCtx, useFocused } from "./planview.ts";
import { causeLines } from "./status.ts";
import { NOTICE_EVENT, WorkLink } from "./WorkLink.tsx";
import { weekMusts } from "./WeekMusts.tsx";
import { mondayOf } from "../week/dates.ts";
import { dayCalendar, placePromises, splitByBlocks, type DayEvent } from "../plan/todaycal.ts";
import type { DayPromise } from "../plan/conversation-views.ts";
import { AllDayRow, DayEventRow, OutsideLine, PromiseRow } from "./DayCalendar.tsx";
import { blockRows } from "../plan/todayorder.ts";
import { checkIn, type CheckSlot } from "../plan/checkin.ts";
import { suggestedMove } from "../plan/checkinmove.ts";
import { boxedMinutes } from "../plan/timebox.ts";
import { blockClient, isPickable } from "../plan/rules.ts";
import { dayFocus } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { call, planAction } from "./api.ts";
import { captureClients } from "./Capture.tsx";
import { DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { DevOpsWork } from "./work.ts";
import { dayName, FlexOfferBar, type FlexOffer, type MakeUpResult } from "./PickReview.tsx";
import { spanText } from "./menu.ts";
import { MenuCtx, MoreButton, PopupMenu } from "./Menus.tsx";
import { DEFAULT_MIN_SIZES, openGaps } from "../plan/agenda.ts";
import { timeChoices } from "../plan/picktime.ts";
import { updatedAgo } from "./refresh.ts";
import { usePhone } from "./viewport.ts";
import { PhoneFollowUps, PhoneNow } from "./Phone.tsx";
import { VmCtx, VmToday, vmNeedsToday } from "./Account.tsx";
import { DetailPanel, BreakDown, interactive } from "./DetailPanel.tsx";
import type { PanelFocus } from "./WeekGrid.tsx";
import { userZone } from "../week/zone.ts";
import type { Moment } from "../plan/modes.ts";
import { urgentLines } from "../plan/urgent.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { openCoopBrief } from "./menu.ts";

export type TodayMode = "now" | "checkin" | "closeout";

type Props = {
  data: WeekLoadData;
  strip: NowStrip | null;
  /** The next day to plan (today, or the next workday). */
  target: { date: string; isToday: boolean };
  now: string;
  nowMs: number;
  /** U2: Now, Check-in or Close out: states of this one page. */
  mode: TodayMode;
  /** Close out's day (today by default; any earlier day). */
  closeOutDate: IsoDate | null;
  /** U2: the 3840 layout: day timeline on the left, detail panel under the cards. */
  wide: boolean;
  /** U5.1 (D408): personal events shown, and the switch (Today's ⋯ and G). */
  showPersonal: boolean;
  onShowPersonal: (show: boolean) => void;
  /** Starts focus on a pick (null: a plain focus timer). */
  onStart: (pick: Pick | null) => void;
  onFocusScreen: () => void;
  /** The running timer's Done and +15. */
  onTimer: (action: "timer.done" | "timer.extend") => void;
  onPlan: (date?: string) => void;
  onPlanWeek: () => void;
  /** SW-1: Today's line for work sent to me opens Commit on its week. */
  onSent?: (weekStart: string) => void;
  /** SW-1: reloads Today's sent line when the plan changes. */
  sentVersion?: unknown;
  onInbox: () => void;
  /** AP-2: Inbox › Requests (an urgent request's chip, Check-in's "Walked in, not resolved"). */
  onAsks?: (conversationId?: number) => void;
  /** CV-1: opens Inbox › My promises (CV-2: with one promise selected). */
  onPromises?: (promiseId?: number) => void;
  onCaptures: () => void;
  onRetry: () => void;
  onFix: () => void;
  /** Opens Settings at a section (an expiring PAT or secret). */
  onSettings: (section: string) => void;
  onChanged: () => void;
  /** Back to Now (Check-in's and Close out's Done), with an optional notice. */
  onLeave: (notice?: string) => void;
  onCloseOutDate: (d: IsoDate) => void;
  /** Step 17.5: after Close out's Done commits (the reverse unroll and the musts moment). */
  onClosedOut: (st: CloseOutState) => void;
  /** NV-1: Today has no mode switch; kept for callers that pass none. */
  switcher?: React.ReactNode;
  /** NV-1: the card for the moment of the day (Plan today, Midday check-in or Close out), or none. */
  moment?: Moment | null;
  /** NV-1: the Midday check-in and Close out cards open their flows. */
  onCheckIn?: () => void;
  onCloseOut?: () => void;
  /** S1 (D451): "2 setup steps left", opening setup at the first step not done; null when nothing is left. */
  setupLine?: { text: string; step: SetupStep } | null;
  onSetup?: (step: SetupStep) => void;
};

const clock = (iso: string, tz: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
const live = (p: Pick) => p.status === "planned" || p.status === "done";

/** The day's slots that have a focus block, an Open half-day or an evening slot. */
function slotsOf(day: Day): Slot[] {
  return [day.am, day.pm, ...(day.eve ? [day.eve] : [])].filter((s) => !s.off && (s.focus.length > 0 || s.open || s.half === "EVE"));
}

export function Today(props: Props) {
  const { data, target, now, nowMs, mode, wide, switcher } = props;
  const date = data.planDay.date;
  const tz = userZone(data);
  // P1: on the phone, Now leads with one card (the block under way, its next pick, Start focus or the timer).
  const phone = usePhone();
  const view = useContext(PlanCtx);
  const day = data.week.days.find((d) => d.date === date) ?? null;
  const plan = data.plan?.[date];
  const picks = useMemo(() => plan?.picks ?? [], [plan]);
  const committed = !!plan?.committedAt;
  const nameOf = clientNames(data);
  const workday = data.planDay.workday && !!day && !day.pto;
  const blocks = workday && day ? slotsOf(day) : [];
  const cal = day ? dayCalendar(day, now) : null;
  const split = cal ? splitByBlocks(cal.timed, blocks.map((s) => ({ key: s.half, start: s.start, end: s.end }))) : null;
  // CV-1: my promises at their time (before, in a block, after), the rest in the follow-ups row; today only.
  const spots = placePromises(target.isToday ? (data.promises ?? []) : [], blocks.map((s) => ({ key: s.half, start: s.start, end: s.end })), date);
  const onPromise = props.onPromises ?? props.onInbox;
  const focused = useFocused();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [offer, setOffer] = useState<{ offer: FlexOffer; pick: Pick } | null>(null);
  // U3: the shared detail panel, opened from a block card (the pick it opened on, if any).
  const [panel, setPanel] = useState<{ half: Half; focus: PanelFocus | null } | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
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
        // U5.1: in the status bar with the other notices, never as a line under it.
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

  // AP-2: Start focus on an urgent ask: a walk-on pick (the AI's title) in the block under way, then focus on it.
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

  // Each block's rows in time order, and the next pick: the first planned one in the first block that hasn't ended.
  const rowsBy = new Map(
    blocks.map((s) => {
      const mine = picks.filter((p) => p.half === s.half && live(p));
      const rows = blockRows(split?.within.get(s.half) ?? [], mine, {
        start: s.start,
        end: s.end,
        freeGaps: s.freeGaps,
        now,
        sizes: data.planning.sizes,
        boxStart: (id) => data.timeboxes.find((t) => t.pickId === id && !t.removedAt)?.start ?? null,
      });
      return [s.half, rows] as const;
    }),
  );
  const ended = (s: Slot) => ms(now) >= ms(s.end);
  const running = data.timer?.pickId ?? null;
  const nextPick =
    (running !== null ? picks.find((p) => p.id === running && p.status === "planned") : null) ??
    blocks
      .filter((s) => !ended(s))
      .flatMap((s) => rowsBy.get(s.half) ?? [])
      .map((r) => (r.kind === "pick" && r.pick.status === "planned" ? r.pick : null))
      .find((p): p is Pick => !!p) ??
    null;
  // "Left off" shows on the current and the next block only.
  const leftOffOn = new Set(blocks.filter((s) => !ended(s)).slice(0, 2).map((s) => s.half));

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

  // Close out: that day's state from the server (focused time, carry-over day, notes, follow-ups).
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

  const headTitle =
    mode === "checkin" ? (
      <h1>
        Midday check-in <span className="muted">{clock(now, tz)} · {checkLeft(check)}</span>
      </h1>
    ) : (
      <h1>
        Today <span className="muted">{longDate(date)}</span>
      </h1>
    );

  const attention = mode === "now" ? <Attention noDue={phone}  onPromises={onPromise} data={data} date={date} clockMs={nowMs} onInbox={props.onInbox} onRetry={props.onRetry} onFix={props.onFix} onSettings={props.onSettings} /> : null;
  const panelSlot = panel ? blocks.find((s) => s.half === panel.half) ?? null : null;

  return (
    <main className={`today-view u2 mode-${mode}${wide ? " wide" : ""}`} aria-label="Today">
      <header className="today-head">
        <div className="ph-title">{headTitle}</div>
        {wide && attention}
        <MoreButton
          label="View options for Today"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMoreAt({ x: r.left, y: r.bottom + 4 });
          }}
        />
        <ModeArea
          done={
            mode === "checkin"
              ? {
                  title: data.checkIn.done ? "Back to Today (Esc)" : "Midday check-in done: back to Today",
                  onClick: async () => {
                    // Done marks today checked in (the ✓ on the switch), then back to Now.
                    if (!data.checkIn.done && !(await act("checkin.done", { date }))) return;
                    props.onLeave();
                  },
                }
              : null
          }
        >
          {switcher}
        </ModeArea>
      </header>
      {moreAt && (
        <PopupMenu
          at={moreAt}
          step={{ title: "Today", items: [{ id: "personal", label: "Personal events", group: "Show", checked: props.showPersonal, hint: "G", run: () => props.onShowPersonal(!props.showPersonal) }] }}
          onClose={() => setMoreAt(null)}
        />
      )}
      {mode === "now" && (
        <PhoneNow
          data={data}
          block={blocks.find((s) => !ended(s)) ?? null}
          pick={nextPick}
          nowMs={nowMs}
          nameOf={nameOf}
          onStart={props.onStart}
          onTimer={props.onTimer}
          onFocusScreen={props.onFocusScreen}
          onDone={committed ? (p) => view.toggle(p.id, true) : null}
        />
      )}
      {mode === "now" && <UrgentStrip urgent={data.requests?.urgent ?? []} promises={target.isToday ? (data.promises ?? []) : []} today={date} tz={tz} onAsks={props.onAsks ?? props.onInbox} onPromises={onPromise} onAskFocus={(u) => void startAsk(u)} />}
      {mode === "now" && props.onSent && <SentToYouLine version={props.sentVersion} onOpen={props.onSent} />}
      {!wide && attention}
      {mode === "now" && props.moment && <MomentCard m={props.moment} onPlan={() => props.onPlan(date)} onCheckIn={props.onCheckIn} onCloseOut={props.onCloseOut} />}
      {mode === "now" && props.setupLine && props.onSetup && (
        <p className="setup-line">
          <button type="button" className="link-btn" onClick={() => props.onSetup!(props.setupLine!.step)} title="Finish setting up FocusTime">
            {props.setupLine.text}
          </button>
        </p>
      )}
      {error && <p className="set-problem" role="alert">{error}</p>}
      <Fading text={notice} onGone={clearNotice} />
      {offer && <FlexOfferBar offer={offer.offer} clientKey={offer.pick.clientKey} clientName={nameOf(offer.pick.clientKey)} title={offer.pick.title} onDone={(m) => { setOffer(null); setNotice(m); props.onChanged(); }} />}
      {mode === "checkin" && !committed && workday && <p className="co-notice">Today isn't planned yet. Plan (P) to make the most of the afternoon.</p>}

      {!workday ? (
        <p className="today-off">
          {target.isToday ? "Nothing scheduled today." : `No work today. Next workday is ${longDate(target.date).replace(/,\s*\d{4}$/, "")}.`}{" "}
          <button type="button" className="link-btn" onClick={() => props.onPlan(target.date)}>
            Plan {longDate(target.date).replace(/,\s*\d{4}$/, "")}
          </button>
        </p>
      ) : (
        <div className="today-body">
          {wide && day && mode !== "closeout" && <DayTimeline day={day} blocks={blocks} data={data} picks={picks} now={now} nowMs={nowMs} events={cal?.timed ?? []} onNotice={setNotice} />}
          <div className="today-main">
            {mode !== "checkin" && cal && <AllDayRow events={cal.allDay} />}
            {mode !== "checkin" && split && <OutsideLine label="Before your blocks" events={wide ? [] : split.before} tz={tz} promises={spots.before} onPromise={onPromise} />}
            {mode === "now" && phone && blocks.length > 0 && <h2 className="section-label phone-agenda">Agenda</h2>}
            <section className={`today-blocks${blocks.length === 1 ? " one" : ""}`} style={{ "--blocks": blocks.length } as CSSProperties} aria-label="Today's blocks">
              {blocks.map((s) => (
                <BlockCard
                  key={s.half}
                  slot={s}
                  mode={mode}
                  data={data}
                  rows={rowsBy.get(s.half) ?? []}
                  picks={picks.filter((p) => p.half === s.half)}
                  promises={spots.within.get(s.half) ?? []}
                  check={check.find((c) => c.half === s.half) ?? null}
                  committed={committed}
                  now={now}
                  nowMs={nowMs}
                  nameOf={nameOf}
                  nextPick={nextPick?.id ?? null}
                  startOnCard={mode !== "now"}
                  phone={phone}
                  leftOff={leftOffOn.has(s.half)}
                  ended={ended(s)}
                  later={blocks.filter((b) => b.half !== s.half && !ended(b) && ms(b.start) > ms(s.start)).map((b) => ({ half: b.half, clientKey: b.focus[0]?.clientKey ?? null }))}
                  carryTo={mode === "closeout" ? (st?.carryTo ?? null) : nextDay}
                  selected={panel?.half === s.half && panel.focus?.kind === "pick" ? panel.focus.id : null}
                  onOpen={mode === "closeout" ? undefined : (focus) => setPanel({ half: s.half, focus: focus ?? null })}
                  act={act}
                  makeUp={makeUp}
                  props={props}
                />
              ))}
            </section>
            {mode !== "checkin" && split && <OutsideLine label="After your blocks" events={wide ? [] : split.after} tz={tz} promises={spots.after} onPromise={onPromise} />}
            {mode === "now" && phone && <PhoneFollowUps data={data} date={date} onChanged={(m) => (m && setNotice(m), props.onChanged())} />}
            {mode === "now" && !phone && <ThisWeek data={data} blocks={blocks} picks={picks} nameOf={nameOf} />}
            {mode === "checkin" && <CheckinFoot data={data} date={date} blocks={blocks.filter((s) => !ended(s))} picks={picks} now={now} act={act} onReview={props.onPlanWeek} onAsks={props.onAsks ?? props.onInbox} />}
          </div>
        </div>
      )}

      {panel && panelSlot && day && mode !== "closeout" && (
        <DetailPanel data={data} day={day} slot={panelSlot} focus={panel.focus} now={now} onClose={closePanel} onStart={props.onStart} onChanged={props.onChanged} onNotice={setNotice} />
      )}
      {mode === "closeout" && (
        <CloseOutPanel
          date={closeDate ?? date}
          st={st}
          data={data}
          nameOf={nameOf}
          reload={loadClose}
          onChanged={props.onChanged}
          onError={setError}
          onDate={props.onCloseOutDate}
          onLeave={props.onLeave}
          onClosedOut={props.onClosedOut}
          onInbox={props.onInbox}
          onCaptures={props.onCaptures}
          act={act}
          onShown={date !== (closeDate ?? date)}
        />
      )}
    </main>
  );
}

/** "about 4 hours left today", from the blocks that haven't ended. */
function checkLeft(check: readonly CheckSlot[]): string {
  const left = check.reduce((n, c) => n + (c.ended ? 0 : c.leftMinutes), 0);
  return left > 0 ? `${aboutHours(left)} left today` : "no time left today";
}

/**
 * The attention line: only when something needs it. Follow-ups due collapse to one chip that opens into rows; a source
 * that failed shows with how old its data is and Retry; an expiring secret links to its setting. Nothing when healthy.
 */
function Attention({ noDue = false, promises = [], soon = [], onPromises, data, date, clockMs, onInbox, onRetry, onFix, onSettings }: { noDue?: boolean; promises?: DayPromise[]; soon?: DayPromise[]; onPromises?: () => void; data: WeekLoadData; date: IsoDate; clockMs: number; onInbox: () => void; onRetry: () => void; onFix: () => void; onSettings: (s: string) => void}) {
  const [open, setOpen] = useState(false);
  // P1: the phone lists due follow-ups at the foot of Today instead.
  const due: FollowUpView[] = noDue ? [] : urgentFollowUps(data.followUps, date);
  const down = causeLines(data.sources, data.devops);
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
              {[due.length ? `${due.length} follow-up${due.length === 1 ? "" : "s"}` : "", promises.length ? `${promises.length} promise${promises.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} due
            </span>
            {names.length > 0 && <span className="att-names">{names.join(" · ")}</span>}
            <span aria-hidden="true">{open ? "⌃" : "›"}</span>
          </button>
        )}
        {soon.map((p) => (
          <button key={`promise-${p.id}`} type="button" className={`att-chip promise${p.overdue ? " overdue" : ""}`} onClick={onPromises} title="Open it in Inbox › My promises">
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
              <button type="button" className="att-row" onClick={onInbox}>
                <DueBadge l={l} />
                <span className="att-who">{l.hasWho ? l.who : l.clientName ?? ""}</span>
                <span className="what">{l.what}</span>
              </button>
            </li>
          ))}
          {promises.map((p) => (
            <li key={`promise-${p.id}`}>
              <button type="button" className="att-row" onClick={onPromises ?? onInbox}>
                <span className={`due-badge${p.overdue ? " overdue-amber" : ""}`}>{p.overdue ? `Promise · ${wasDueText(p, date, userZone(data)).replace(/^Was/, "was")}` : "Promise"}</span>
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
 * NV-1: the urgent strip, under what's next: what needs me now, mine only. Urgent requests from client chats (AI
 * urgency "now") and my promises due today or overdue, one short line each, linking to Inbox › Conversations or
 * My promises. An urgent request keeps its Start focus. Hidden when there is nothing.
 */
export function UrgentStrip({ urgent, promises, today, tz, onAsks, onPromises, onAskFocus }: { urgent: readonly UrgentAsk[]; promises: readonly DayPromise[]; today: IsoDate; tz: string; onAsks: (conversationId?: number) => void; onPromises: (promiseId?: number) => void; onAskFocus: (u: UrgentAsk) => void }) {
  const lines = urgentLines(urgent, promises, today);
  if (!lines.length) return null;
  return (
    <section className="urgent-strip" aria-label="Urgent">
      <ul>
        {lines.map((l) => (
          <li key={l.key} className={`us-item us-${l.kind}${l.kind === "promise" && l.overdue ? " overdue" : ""}`}>
            <button type="button" className="us-line" onClick={() => (l.kind === "conversation" ? onAsks(l.ask.conversationId ?? undefined) : onPromises(l.promise.id))} title={l.kind === "conversation" ? "Open it in Inbox › Conversations" : "Open it in Inbox › My promises"}>
              <span className="us-tag">{l.kind === "conversation" ? "Needs you now" : l.overdue ? `Promise · ${wasDueText(l.promise, today, tz).replace(/^Was/, "was")}` : l.dueAt ? `Promise · ${clock(l.dueAt, tz)}` : "Promise due today"}</span>
              <span className="us-who">{l.who}</span>
              <span className="us-what">{l.what}</span>
              <span className="us-go" aria-hidden="true">›</span>
            </button>
            {l.kind === "conversation" && (
              <button type="button" className="mini" onClick={() => onAskFocus(l.ask)} title="Add it to the block under way and start focus on it">
                Start focus
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const MOMENTS = {
  plan: { title: "Plan today", body: "Today isn't planned yet. Put this week's stories into today's blocks.", button: "Plan today" },
  checkin: { title: "Midday check-in", body: "What still fits this afternoon, with one suggested move each.", button: "Check in" },
  closeout: { title: "Close out", body: "What got done, where you left off, DevOps updates and follow-ups.", button: "Close out" },
} as const;

/** NV-1: the card for the moment of the day. Plan today opens Week's Board on today; the others open their flow here. Done is one small line, reopenable. */
export function MomentCard({ m, onPlan, onCheckIn, onCloseOut }: { m: Moment; onPlan: () => void; onCheckIn?: (() => void) | undefined; onCloseOut?: (() => void) | undefined }) {
  const open = m.kind === "plan" ? onPlan : m.kind === "checkin" ? onCheckIn : onCloseOut;
  const t = MOMENTS[m.kind];
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
    <section className={`moment-card moment-${m.kind}`} aria-label={t.title}>
      <div className="mc-text">
        <h2>{t.title}</h2>
        <p>{t.body}</p>
      </div>
      {open && (
        <button type="button" className="primary" onClick={open}>
          {t.button}
        </button>
      )}
    </section>
  );
}

type BlockProps = {
  slot: Slot;
  mode: TodayMode;
  data: WeekLoadData;
  rows: ReturnType<typeof blockRows<DayEvent, Pick>>;
  picks: Pick[];
  check: CheckSlot | null;
  committed: boolean;
  now: string;
  nowMs: number;
  nameOf: (k: string) => string;
  nextPick: number | null;
  /** NV-1: in Now, Start focus and the timer sit at the top; the card only highlights the next pick. */
  startOnCard?: boolean;
  leftOff: boolean;
  ended: boolean;
  later: { half: Half; clientKey: string | null }[];
  /** P1: on the phone a card has no planning links. */
  phone?: boolean;
  carryTo: IsoDate | null;
  selected: number | null;
  /** U3: opens the detail panel on this block (a click on the card body; on a pick row, focused on that pick). */
  onOpen: ((focus?: PanelFocus) => void) | undefined;
  act: (a: string, i: Record<string, unknown>) => Promise<boolean>;
  makeUp: (p: Pick, i: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => Promise<boolean>;
  props: Props;
  /** CV-1: my promises due during this block. */
  promises?: DayPromise[];
};

/** One block card (density "today"): header with client, time and the one status, then rows, then "Left off". */
function BlockCard(b: BlockProps) {
  const { slot, mode, data, committed, nameOf, ended } = b;
  const view = useContext(PlanCtx);
  const tz = userZone(data);
  const client = slot.focus[0]?.clientKey ?? null;
  const planned = b.picks.filter((p) => p.status === "planned");
  const done = b.picks.filter((p) => p.status === "done");
  const dropped = b.picks.filter((p) => p.status === "dropped");
  const fit = committed && planned.length && !ended ? planFit(b.picks, data.planning.sizes, view.timeboxes, slot) : null;
  const status = blockStatus(fit, slot.risks);
  const title = client ? nameOf(client) : slot.open ? "Open" : halfName(slot.half);
  const followUp = (p: Pick) => (p.followUpId !== null ? data.followUps.find((f) => f.id === p.followUpId) ?? null : null);
  const t = data.timer;
  const cls = `today-block${ended ? " ended" : ""}${status.kind === "at_risk" && mode === "now" ? " at-risk" : ""}`;
  const style = { "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties;
  const open = b.onOpen;
  const onCardClick = open
    ? (e: React.MouseEvent) => {
        if (interactive(e)) return;
        const li = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
        open(li ? { kind: "pick", id: Number(li.dataset.pick) } : undefined);
      }
    : undefined;

  const row = (p: Pick, extra: Partial<React.ComponentProps<typeof PickRow>> = {}) => (
    <PickRow
      key={p.id}
      pick={p}
      toggle={view.toggle}
      link
      density="today"
      canTick={committed}
      timeEditable={committed && !ended}
      draggable={committed && p.status === "planned"}
      className={b.selected === p.id ? "selected" : ""}
      extra={!committed && p.status === "planned" ? <span className="draft-tag">draft</span> : undefined}
      badge={followUp(p) ? <DueBadge l={followUp(p)!} /> : undefined}
      {...extra}
    />
  );

  if (mode === "checkin" && b.check) {
    const c = b.check;
    const left = c.picks.filter((x) => x.pick.status === "planned");
    const head = ended ? `${halfName(slot.half)} · ended` : c.leftMinutes > 0 ? `${halfName(slot.half)} · ${aboutHours(c.leftMinutes)} left after meetings` : `${halfName(slot.half)} · no time left`;
    const owed = (p: Pick) => {
      const f = followUp(p);
      return !!f && f.due !== null && f.due <= data.planDay.date;
    };
    return (
      <article className={`${cls} ci`} style={style} aria-label={title} onClick={onCardClick}>
        <header>
          <h2>{title}</h2>
          <span className="tb-when">{head}</span>
          <span className="tb-count">{done.length} done</span>
        </header>
        <ul className="today-picks">
          {left.map(({ pick: p, fits, focusedMinutes }) => {
            const move = !fits || ended ? suggestedMove(p, { owedToday: owed(p), later: b.later, carryTo: b.carryTo }) : null;
            return row(p, {
              className: !fits && !ended ? "nofit" : "",
              badge: (
                <>
                  {followUp(p) && <DueBadge l={followUp(p)!} />}
                  {focusedMinutes > 0 && <span className="pr-note">{formatDuration(focusedMinutes)} focused</span>}
                  {!ended && <span className={`pr-fit${fits ? "" : " watch"}`}>{p.size} · {fits ? "fits" : "doesn't fit"}</span>}
                </>
              ),
              actions: move ? (
                <button type="button" className="mini ci-move" onClick={() => void (move.kind === "move" ? b.act("pick.move", { id: p.id, date: move.date, half: move.half }) : b.makeUp(p, { when: "tonight" }))} title={move.kind === "move" ? `Move to ${dayName(move.date)}, ${halfName(move.half).toLowerCase()}` : "Make it up tonight (borrowed time)"}>
                  {move.label}
                </button>
              ) : undefined,
            });
          })}
        </ul>
        {!left.length && <p className="tb-empty">{done.length ? "All done here." : "Nothing planned here."}</p>}
        {ended && left.length > 0 && <p className="tb-line watch">{left.length} not done. Move {left.length === 1 ? "it" : "them"}, or leave {left.length === 1 ? "it" : "them"} for Close out.</p>}
        {!ended && c.overBy > 0 && <p className="tb-line watch">{c.overBy < 45 ? "A little over" : `${cap(aboutHours(c.overBy))} over`}. Move one?</p>}
      </article>
    );
  }

  if (mode === "closeout") {
    const moved = b.picks.filter((p) => p.status === "moved");
    const counts = [`${done.length} done`, ...(dropped.length ? [`${dropped.length} dropped`] : []), ...(moved.length ? [`${moved.length} moved`] : [])].join(" · ");
    const carry = b.carryTo ? Temporal.PlainDate.from(b.carryTo).toLocaleString("en-US", { weekday: "short" }) : null;
    return (
      <article className={`${cls} co`} style={style} aria-label={title}>
        <header>
          <h2>{title}</h2>
          <span className="tb-when">{halfName(slot.half)}</span>
          <span className="tb-count">{counts}</span>
        </header>
        <ul className="today-picks">
          {planned.map((p) =>
            row(p, {
              actions: carry ? (
                <button type="button" className="carry-chip" onClick={() => void b.act("pick.move", { id: p.id, date: b.carryTo!, half: p.half === "EVE" ? "AM" : p.half })} title={`Carry over to ${dayName(b.carryTo!)} now`}>
                  → {carry}
                </button>
              ) : undefined,
            }),
          )}
        </ul>
      </article>
    );
  }

  // Now.
  const note = client ? data.resumeNotes[client] : undefined;
  const pill = status.kind === "at_risk" ? `At risk${status.short ? ` · ${status.short}` : ""}` : status.label;
  return (
    <article className={cls} style={style} aria-label={title} onClick={onCardClick}>
      <header>
        <h2>{title}</h2>
        <span className="tb-when">{slotRange(slot, tz)}</span>
        {status.kind !== "none" && (
          <span className={`status-pill ${status.kind}`} title={status.detail ?? undefined}>
            {pill}
          </span>
        )}
      </header>
      <ul className="today-picks today-rows">
        {b.rows.map((r) =>
          r.kind === "event" ? (
            <DayEventRow key={`e${r.event.event.id}${r.event.start}`} e={r.event} tz={tz} />
          ) : r.pick.id === b.nextPick ? (
            row(r.pick, {
              next: true,
              actions: !b.startOnCard ? undefined :
                t && t.pickId === r.pick.id ? (
                  <span className="next-timer">
                    <button type="button" className="next-count" onClick={b.props.onFocusScreen} title="Back to the focus screen">
                      {t.ended ? "Time's up" : countdown(timerLeft(t, b.nowMs))}
                    </button>
                    <button type="button" className="mini" onClick={() => b.props.onTimer("timer.done")} title="End the session and tick the pick done">
                      Done
                    </button>
                    <button type="button" className="mini" onClick={() => b.props.onTimer("timer.extend")} title="Add 15 minutes">
                      +15
                    </button>
                  </span>
                ) : t ? undefined : (
                  <button type="button" className="start-focus" onClick={() => b.props.onStart(r.pick)} title="Start focus on this pick">
                    Start focus
                  </button>
                ),
            })
          ) : (
            row(r.pick)
          ),
        )}
        {(b.promises ?? []).map((p) => (
          <PromiseRow key={`p${p.id}`} p={p} tz={tz} onOpen={b.props.onPromises ?? b.props.onInbox} />
        ))}
      </ul>
      {!b.picks.some(live) && !ended && (
        <p className="tb-empty">
          Nothing planned.
          {!b.phone && (
            <>
              {" "}
              <button type="button" className="link-btn" onClick={() => b.props.onPlan(slot.date)}>
                Plan it
              </button>
            </>
          )}
        </p>
      )}
      {b.leftOff && note && <p className="today-resume" title={`Where you left off: ${note.note}`}>Left off: {note.note}</p>}
    </article>
  );
}

/**
 * "This week": one chip per feature for the clients with a block today. Stories planned out of the feature's open
 * stories, or "Needs stories" with Draft stories and Coop brief. Features never show above stories.
 */
function ThisWeek({ data, blocks, picks: _today, nameOf }: { data: WeekLoadData; blocks: Slot[]; picks: Pick[]; nameOf: (k: string) => string }) {
  const work = useContext(DevOpsWork);
  const weekStart = mondayOf(data.planDay.date);
  const seen = new Set<string>();
  const feats = blocks.flatMap((s) => (s.half === "EVE" ? [] : featuresOn(data.weekFeatures.filter((f) => f.weekStart === weekStart && f.level === "feature"), s.date, s.half as Half, s.focus[0]?.clientKey ?? null))).filter((f) => {
    const k = `${f.clientKey}:${f.itemId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!feats.length) return null;
  const weekPicks = Object.values(data.plan ?? {}).flatMap((d) => d.picks).filter(live);
  return (
    <section className="this-week" aria-label="This week">
      <span className="tw-label">This week</span>
      <ul>
        {feats.map((f) => {
          const w = work.get(f.clientKey);
          const item = w ? [...w.items, ...w.children].find((i) => i.id === f.itemId) ?? null : null;
          const stories = w ? [...w.items, ...w.children].filter((i) => i.parentId === f.itemId && isPickable(i)) : [];
          const planned = stories.filter((s) => weekPicks.some((p) => p.clientKey === f.clientKey && p.itemId === s.id)).length;
          return (
            <li key={`${f.clientKey}:${f.itemId}`} className={`tw-chip${stories.length ? "" : " needs"}`} style={{ "--c": clientColor(f.clientKey, data.clients) } as CSSProperties} title={`${nameOf(f.clientKey)} · ${f.title}`}>
              <span className="swatch" aria-hidden="true" />
              {item?.type && <TypeIcon clientKey={f.clientKey} type={item.type} decorative />}
              <WorkLink clientKey={f.clientKey} url={f.url} className="feat-link">
                {f.title}
              </WorkLink>
              {stories.length ? (
                <span className="tw-count">
                  {planned} of {stories.length} {stories.length === 1 ? "story" : "stories"} planned
                </span>
              ) : (
                <>
                  <span className="tw-needs">Needs stories</span>
                  {item && <BreakDown clientKey={f.clientKey} item={item} />}
                  <button type="button" className="link-btn tw-brief" onClick={() => openCoopBrief(f.clientKey, { id: f.itemId, title: f.title, ...(item?.type ? { type: item.type } : {}) }, weekStart)}>
                    Coop brief
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Check-in's foot, once: walk-on work for a block, and the week's musts in one line. */
function CheckinFoot({ data, date, blocks, picks, now, act, onReview, onAsks }: { data: WeekLoadData; date: IsoDate; blocks: Slot[]; picks: Pick[]; now: string; act: (a: string, i: Record<string, unknown>) => Promise<boolean>; onReview: () => void; onAsks: () => void }) {
  const { rows } = weekMusts(data, mondayOf(date), now);
  const musts = rows.filter((r) => r.musts > 0);
  const tight = musts.filter((r) => r.track?.kind === "at_risk").map((r) => r.name);
  return (
    <div className="ci-foot">
      {blocks.length > 0 && <WalkOn data={data} date={date} blocks={blocks} picks={picks} act={act} />}
      {(data.requests?.pastUrgency ?? 0) > 0 && (
        <p className="ci-asks">
          <button type="button" className="link-btn" onClick={onAsks} title="Requests still open after their urgency (now: 2 hours; this week: Friday)">
            Walked in, not resolved ({data.requests.pastUrgency})
          </button>
        </p>
      )}
      {musts.length > 0 && (
        <p className="ci-musts">
          Musts this week: {musts.length} {musts.length === 1 ? "client" : "clients"}
          {tight.length ? (
            <>
              , <span className="watch">{tight.join(", ")} tight</span>
            </>
          ) : (
            ", all look doable"
          )}{" "}
          <button type="button" className="link-btn" onClick={onReview}>
            Review ›
          </button>
        </p>
      )}
    </div>
  );
}

/** Walk-on work: a DevOps item of the block's client, or a typed intention, added to a block that hasn't ended. */
function WalkOn({ data, date, blocks, picks, act }: { data: WeekLoadData; date: IsoDate; blocks: Slot[]; picks: readonly Pick[]; act: (a: string, i: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [half, setHalf] = useState<Half>(blocks[0]!.half);
  const [choice, setChoice] = useState("");
  const [intention, setIntention] = useState("");
  const slot = blocks.find((s) => s.half === half) ?? blocks[0]!;
  const client = blockClient(slot.focus[0]?.clientKey ?? null, picks.filter((p) => p.half === slot.half)).clientKey ?? data.planClients[0]?.clientKey ?? "";
  const work = useContext(DevOpsWork).get(client);
  const taken = new Set(picks.filter(live).map((p) => p.itemId));
  const items = work ? [...work.items, ...work.children].filter((i) => isPickable(i) && !taken.has(i.id)) : [];
  if (!open)
    return (
      <p className="ci-walkon">
        <span className="tw-label">Walked in</span>
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          + Add walk-on work
        </button>
      </p>
    );
  return (
    <form
      className="slip-form ci-walkon-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = choice ? { itemId: Number(choice) } : { intention };
        if (await act("pick.add", { date, half: slot.half, clientKey: client, ...input })) {
          setOpen(false);
          setChoice("");
          setIntention("");
        }
      }}
    >
      {blocks.length > 1 && (
        <select value={half} onChange={(e) => setHalf(e.target.value as Half)} aria-label="Block">
          {blocks.map((s) => (
            <option key={s.half} value={s.half}>
              {halfName(s.half)}
            </option>
          ))}
        </select>
      )}
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="DevOps item">
        <option value="">Typed intention</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            #{i.id} {i.title}
          </option>
        ))}
      </select>
      {!choice && <input required maxLength={200} value={intention} placeholder="What walked in" onChange={(e) => setIntention(e.target.value)} aria-label="Intention" />}
      <button type="submit" className="mini primary">
        Add
      </button>
      <button type="button" className="mini" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

/**
 * Close out as a side panel (U2): the numbers, where you left off, DevOps updates owed and follow-ups due, then Done.
 * Done closes the day exactly as before (closeout.commit), then the reverse unroll. Dropped picks are a count only.
 */
function CloseOutPanel({ date, st, data, nameOf, reload, onChanged, onError, onDate, onLeave, onClosedOut, onInbox, onCaptures, act, onShown }: {
  date: IsoDate;
  st: CloseOutState | null;
  data: WeekLoadData;
  nameOf: (k: string) => string;
  reload: () => Promise<void>;
  onChanged: () => void;
  onError: (m: string) => void;
  onDate: (d: IsoDate) => void;
  onLeave: (m?: string) => void;
  onClosedOut: (st: CloseOutState) => void;
  onInbox: () => void;
  onCaptures: () => void;
  act: (a: string, i: Record<string, unknown>) => Promise<boolean>;
  /** A past day: the cards behind show today, so the panel lists that day's open picks itself. */
  onShown: boolean;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const work = useContext(DevOpsWork);
  useEffect(() => setExtra([]), [date]);
  useEffect(() => head.current?.focus(), [date]);
  const tz = userZone(data);
  const prev = Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
  const done = async () => {
    if (!st) return;
    // Step 15.1 (D275): once closed out, Done just goes back; nothing is saved again.
    if (st.closedOutAt) return onLeave();
    try {
      const after = await call<CloseOutState>("closeout.commit", { date });
      onClosedOut(after);
      onChanged();
      onLeave("Closed out. Nice work.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save Close out");
    }
  };
  const body = () => {
    if (!st) return <p className="muted">Loading…</p>;
    const totals = dayFocus(st.picks, st.focused, data.planning.sizes);
    const n = (s: string) => st.picks.filter((p) => p.status === s).length;
    const day = data.week.days.find((d) => d.date === date);
    const blockClients = day ? [...day.am.focus, ...day.pm.focus].map((b) => b.clientKey) : [];
    const worked = [...new Set([...st.worked.map((w) => w.clientKey), ...blockClients, ...Object.keys(st.notes), ...extra])];
    const others = data.planClients.filter((c) => !worked.includes(c.clientKey));
    const stillOpen = (clientKey: string, id: number) => !!work.get(clientKey)?.items.some((i) => i.id === id);
    const followUpFor = (id: number) => st.followUps.find((f) => f.kind === "devops_update" && f.itemId === id && !f.closedAt)?.id ?? null;
    const owedDone = st.picks.filter((p) => p.status === "done" && p.itemId !== null && stillOpen(p.clientKey, p.itemId));
    const owedComment = st.picks.filter((p) => p.status === "planned" && p.itemId !== null && (st.focused[p.id] ?? 0) >= 60);
    const dueBy = st.followUps.filter((l) => l.due !== null && l.due <= date);
    const more = st.followUps.length - dueBy.length;
    const clients = captureClients(data);
    const rowDone = () => {
      void reload();
      onChanged();
    };
    return (
      <>
        <p className="cp-numbers">
          <span><strong>{n("done")}</strong> done</span>
          <span><strong>{n("planned")}</strong> carry over</span>
          <span><strong>{n("dropped")}</strong> dropped</span>
          <span><strong>{formatDuration(totals.focusedMinutes) || "0m"}</strong> focused</span>
        </p>
        {st.closedOutAt && <p className="co-done">Closed out {clock(st.closedOutAt, tz)}</p>}
        {onShown && st.picks.some((p) => p.status === "planned") && (
          <section className="cp-section" aria-label="Not done">
            <h3>Not done</h3>
            <ul className="today-picks">
              {st.picks.filter((p) => p.status === "planned").map((p) => (
                <PickRow key={p.id} pick={p} toggle={(id, d) => void act("pick.mark_done", { id, done: d }).then(() => reload())} density="today" timeEditable={false} readOnly actions={st.carryTo ? <button type="button" className="carry-chip" onClick={() => void act("pick.move", { id: p.id, date: st.carryTo!, half: p.half === "EVE" ? "AM" : p.half }).then(() => reload())}>→ {Temporal.PlainDate.from(st.carryTo).toLocaleString("en-US", { weekday: "short" })}</button> : undefined} />
              ))}
            </ul>
          </section>
        )}
        <section className="cp-section" aria-label="Where you left off">
          <h3>Where you left off</h3>
          <ul className="cp-notes">
            {worked.map((k) => (
              <NoteRow key={`${date}:${k}`} clientKey={k} clientName={nameOf(k)} color={clientColor(k, data.clients)} date={date} saved={st.notes[k]?.note ?? ""} previous={st.previous[k]?.note ?? null} onSaved={() => void reload()} onError={onError} />
            ))}
          </ul>
          {others.length > 0 &&
            (adding ? (
              <select autoFocus value="" onChange={(e) => (e.target.value && setExtra((x) => [...x, e.target.value]), setAdding(false))} onBlur={() => setAdding(false)} aria-label="Another client">
                <option value="">Choose a client</option>
                {others.map((c) => (
                  <option key={c.clientKey} value={c.clientKey}>
                    {nameOf(c.clientKey)}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="link-btn" onClick={() => setAdding(true)}>
                + Another client
              </button>
            ))}
        </section>
        {(owedDone.length > 0 || owedComment.length > 0) && (
          <section className="cp-section" aria-label="DevOps updates owed">
            <h3>DevOps updates owed</h3>
            <ul className="cp-owed">
              {owedDone.map((p) => (
                <li key={p.id}>
                  <span className="cp-owed-what">
                    <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="co-title">#{p.itemId} {p.title}</WorkLink> <span className="muted">done here, still open in DevOps</span>
                  </span>
                  <DevOpsAction clientKey={p.clientKey} label="Mark done in DevOps" onRun={(w) => w.markDone({ clientKey: p.clientKey, itemId: p.itemId!, title: p.title, ...(followUpFor(p.itemId!) ? { followUpId: followUpFor(p.itemId!)! } : {}) })} />
                </li>
              ))}
              {owedComment.map((p) => (
                <li key={p.id}>
                  <span className="cp-owed-what">
                    <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="co-title">#{p.itemId} {p.title}</WorkLink> <span className="muted">{formatDuration(Math.floor((st.focused[p.id] ?? 0) / 60))} focused, not done</span>
                  </span>
                  <CommentOwed clientKey={p.clientKey} itemId={p.itemId!} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {dueBy.length > 0 && (
          <section className="cp-section" aria-label="Follow-ups due">
            <h3>Follow-ups due</h3>
            <ul className="follow-up-list compact">
              {dueBy.map((l) => (
                <FollowUpRow key={l.id} l={l} timeZone={tz} today={st.today} clients={clients} onChanged={rowDone} compact />
              ))}
            </ul>
          </section>
        )}
        {(more > 0 || st.captures > 0) && (
          <p className="cp-more">
            {more > 0 && (
              <button type="button" className="link-btn" onClick={onInbox}>
                {more} more in Inbox
              </button>
            )}
            {more > 0 && st.captures > 0 && " · "}
            {st.captures > 0 && (
              <button type="button" className="link-btn" onClick={onCaptures}>
                {st.captures} {st.captures === 1 ? "capture" : "captures"} to sort
              </button>
            )}
          </p>
        )}
      </>
    );
  };
  return (
    <aside className="closeout-panel" aria-label="Close out">
      <div className="cp-head">
        <h2 ref={head} tabIndex={-1}>
          Close out <span className="muted">{date === st?.today ? Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" }) : dayName(date)}</span>
        </h2>
        <span className="co-step">
          <button type="button" className="mini quiet" onClick={() => onDate(prev)} aria-label="Previous day" title="Previous day">‹</button>
          <button type="button" className="mini quiet" onClick={() => onDate(next)} disabled={!st || next > st.today} aria-label="Next day" title="Next day">›</button>
        </span>
        <button type="button" className="done-btn" disabled={!st} onClick={() => void done()} title={st?.closedOutAt ? "Back to Today (Esc)" : "Close out this day, then back to Today"}>
          Done
        </button>
      </div>
      <div className="cp-body">{body()}</div>
      <p className="cp-foot muted">Done closes the day and plays the week back into the ring.</p>
    </aside>
  );
}

function NoteRow({ clientKey, clientName, color, date, saved, previous, onSaved, onError }: { clientKey: string; clientName: string; color: string; date: IsoDate; saved: string; previous: string | null; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  const save = async () => {
    if (v.trim() === saved) return;
    try {
      await call("note.set", { clientKey, date, note: v });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the note");
    }
  };
  return (
    <li className="co-note" style={{ "--c": color } as CSSProperties}>
      <label>
        <span className="co-client">
          <span className="swatch" aria-hidden="true" />
          {clientName}
        </span>
        <input value={v} maxLength={200} placeholder={previous ? `Last: ${previous}` : `Next step for ${clientName}…`} onChange={(e) => setV(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && void save()} />
      </label>
    </li>
  );
}

/** "Comment" on an item focused on but not done: one line, then the DevOps write preview (write framework). */
function CommentOwed({ clientKey, itemId }: { clientKey: string; itemId: number }) {
  const env = useDevOpsWrite();
  const [text, setText] = useState<string | null>(null);
  if (!env) return null;
  if (!env.can(clientKey)) return <DevOpsAction clientKey={clientKey} label="Comment" onRun={() => {}} />;
  if (text === null)
    return (
      <button type="button" className="mini" onClick={() => setText("Worked on this today; not done yet.")}>
        Comment
      </button>
    );
  return (
    <form
      className="cp-comment"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void env.begin(clientKey, [{ kind: "comment", itemId, text: text.trim() }]).then(() => setText(null));
      }}
    >
      <input autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label={`Comment on #${itemId}`} />
      <button type="submit" className="mini primary">Preview</button>
      <button type="button" className="mini" onClick={() => setText(null)}>Cancel</button>
    </form>
  );
}

const PX_PER_MIN_BASE = 2.2;

/**
 * 3840: the day as one timeline (like Week's rail): hours, meetings, timeboxes with the focus timer, the free gaps.
 * Drop a pick onto a gap to timebox it there, with Plan the day's rules: only into its own block's free time, from
 * now on, never below its shortest useful time.
 */
function DayTimeline({ day, blocks, data, picks, now, nowMs, events, onNotice }: { day: Day; blocks: Slot[]; data: WeekLoadData; picks: Pick[]; now: string; nowMs: number; events: DayEvent[]; onNotice: (m: string) => void }) {
  const PX_PER_MIN = PX_PER_MIN_BASE * useTextScale();
  const { env } = useContext(MenuCtx);
  const [over, setOver] = useState<string | null>(null);
  const tz = userZone(data);
  if (!blocks.length) return null;
  const start = Math.min(...blocks.map((s) => ms(s.start)));
  const end = Math.max(...blocks.map((s) => ms(s.end)));
  const y = (iso: string) => Math.max(0, Math.min(end, ms(iso)) - start) / 60_000 * PX_PER_MIN;
  const h = (a: string, b: string) => Math.max(14, y(b) - y(a));
  const boxes = data.timeboxes.filter((t) => t.date === day.date && !t.removedAt);
  const gaps: { slot: Slot; gap: FreeGap }[] = blocks.flatMap((s) => openGaps(s, boxes, now).map((g) => ({ slot: s, gap: g })));
  const hours: number[] = [];
  for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t <= end; t += 3_600_000) hours.push(t);
  const timer = data.timer;
  const nowY = ms(now) >= start && ms(now) <= end ? y(now) : null;
  const drop = (e: DragEvent, slot: Slot, gap: FreeGap) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData(PICK_DRAG));
    const p = picks.find((x) => x.id === id);
    if (!p || !env) return;
    if (p.half !== slot.half) return onNotice(`That gap is in the ${halfName(slot.half).toLowerCase()} block. Move the pick there first`);
    const c = timeChoices(slot, data.timeboxes, p, data.planning.sizes, now, data.planning.minSizes ?? DEFAULT_MIN_SIZES).find((x) => x.kind === "gap" && ms(x.gapStart) === ms(gap.start));
    if (!c) return onNotice(`That gap is too short for "${p.title}"`);
    env.timeboxChange("timebox.add", { pickId: p.id, date: day.date, start: c.start, end: c.end });
  };
  return (
    <section className="day-timeline" aria-label="Timeline">
      <header>
        <h2>Timeline</h2>
        <span className="muted">
          {spanText(blocks[0]!.start, blocks[blocks.length - 1]!.end, tz).replace("–", " to ")} · drag a story onto a gap to timebox it
        </span>
      </header>
      <div className="dt-grid" style={{ height: `${(end - start) / 60_000 * PX_PER_MIN}px` }}>
        {hours.map((t) => {
          const iso = Temporal.Instant.fromEpochMilliseconds(t).toString();
          const z = Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(tz);
          return (
            <span key={t} className="dt-hour" style={{ top: `${y(iso)}px` }}>
              {z.hour % 12 || 12}
            </span>
          );
        })}
        {blocks.map((s) => (
          <span key={s.half} className="dt-band" style={{ top: `${y(s.start)}px`, height: `${h(s.start, s.end)}px`, "--c": clientColor(s.focus[0]?.clientKey, data.clients) } as CSSProperties} title={`${halfName(s.half)} · ${slotRange(s, tz)}`} />
        ))}
        {gaps.map(({ slot, gap }) => (
          <div
            key={gap.start}
            className={`dt-item dt-free${over === gap.start ? " over" : ""}`}
            style={{ top: `${y(gap.start)}px`, height: `${h(gap.start, gap.end)}px` }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(PICK_DRAG)) return;
              e.preventDefault();
              setOver(gap.start);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, slot, gap)}
          >
            Free · {formatDuration(gap.minutes)}
          </div>
        ))}
        {events.map((e) => (
          <div key={`${e.event.id}${e.start}`} className={`dt-item dt-ev ${e.kind} when-${e.when}`} style={{ top: `${y(e.start)}px`, height: `${h(e.start, e.end)}px` }} title={`${e.event.title}\n${spanText(e.start, e.end, tz)}`}>
            <span className="ev-title">{e.event.title}</span> <span className="muted">{spanText(e.start, e.end, tz)}</span>
            {e.when === "next" && <span className="cal-tag next">Next</span>}
          </div>
        ))}
        {boxes.map((b) => {
          const p = picks.find((x) => x.id === b.pickId);
          const runs = timer && b.pickId !== null && timer.pickId === b.pickId;
          return (
            <div key={b.id} className={`dt-item dt-box${p?.status === "done" ? " done" : ""}${runs ? " running" : ""}`} style={{ top: `${y(b.start)}px`, height: `${h(b.start, b.end)}px`, "--c": clientColor(b.clientKey, data.clients) } as CSSProperties} title={`${b.title}\n${spanText(b.start, b.end, tz)}`}>
              <span className="ev-title">{p?.title ?? b.title}</span>
              {runs ? <strong className="dt-count">{timer.ended ? "Time's up" : countdown(timerLeft(timer, nowMs))}</strong> : <span className="muted">{spanText(b.start, b.end, tz)}</span>}
            </div>
          );
        })}
        {nowY !== null && <span className="dt-now" style={{ top: `${nowY}px` }} aria-label="Now"><span>now</span></span>}
      </div>
    </section>
  );
}

const HINT_KEY = "focustime.hint.flow";
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
    <aside className="flow-hint" aria-label="How FocusTime fits together">
      <p>
        <strong>Week</strong> is each client's musts and nice to haves, from DevOps. <strong>Day</strong> is for stories: what you pick for each block. <strong>Focus</strong> is one story at a time.
      </p>
      <button type="button" className="mini" onClick={dismiss}>Got it</button>
    </aside>
  );
}
