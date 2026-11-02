import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWeeks, mondayOf } from "../week/dates.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { ActionRefusal, call, connectSource, disconnectSource, planAction, SessionError, setThemeAction, takeOpenRequest, weekLoad } from "./api.ts";
import { dayEndOf, hoursOn, VIEW_RANGE_NAMES, VIEW_RANGES, type ViewRange } from "../week/hours.ts";
import { applyTheme, initialTheme } from "./theme.ts";
import type { Theme } from "../config/schema.ts";
import { NOTICE_EVENT, openWorkItem } from "./WorkLink.tsx";
import { DevOpsWriteCtx, useDevOpsWriteFlow } from "./DevOpsWrite.tsx";
import { TimeboxCtx, TimeboxDialog, timeboxChange as tbChange, useWriteFlow, type TimeboxEnv } from "./Timeboxes.tsx";
import { HelpFinder } from "./HelpFinder.tsx";
import type { HelpTarget } from "./menu.ts";
import type { TimeboxTarget } from "./menu.ts";
import type { WriteState } from "../actions/types.ts";
import type { PlanDayState } from "../plan/types.ts";
import { planTarget } from "../plan/target.ts";
import { canAddWork, stepDay } from "../plan/days.ts";
import { PlanDay } from "./PlanDay.tsx";
import { autoOpenDue, dayRolledOver } from "./planday.ts";
import { PlanCtx, resumeSlots } from "./planview.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { Details } from "./Details.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { causeLines, SOURCE_NAMES, sourceActions, stateOf } from "./status.ts";
import { WeekGrid, type Selection } from "./WeekGrid.tsx";
import { ContextLine, TopTimer } from "./NowStrip.tsx";
import { FocusScreen, SoundControl } from "./FocusScreen.tsx";
import { sound } from "./sound.ts";
import type { TimerView } from "../actions/types.ts";
import { soundStep, type SoundKind } from "../plan/focussound.ts";
import { focusPick } from "../plan/today.ts";
import { Inbox } from "./Inbox.tsx";
import { Today } from "./Today.tsx";
import { ritualFor, RITUAL_NAMES, type Ritual } from "../plan/ritual.ts";
import type { Pick } from "../plan/types.ts";
import { CloseOut } from "./CloseOut.tsx";
import { CheckIn } from "./CheckIn.tsx";
import { PlanWeek } from "./PlanWeek.tsx";
import { weekMusts } from "./WeekMusts.tsx";
import { CaptureDialog } from "./Capture.tsx";
import { borrowedSummary } from "../plan/borrow.ts";
import { formatDuration } from "../week/format.ts";
import { PopupMenu } from "./Menus.tsx";
import { borrowStep, timerStep } from "./menu.ts";
import { nowStrip } from "../plan/now.ts";
import { cardHalves, slotOf, validHalf } from "./halves.ts";
import { Settings, SETTINGS_SECTIONS, type SettingsSectionId } from "./Settings.tsx";
import { clientColor, SampleSources, weekLabel } from "./labels.ts";
import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import { useLayout } from "./viewport.ts";
import { commandList, type MenuEnv, type View } from "./menu.ts";
import { CommandMenu, MenuHost } from "./Menus.tsx";
import { NoHoursPrompt } from "./NoHoursPrompt.tsx";
import { KeyLegend } from "./KeyLegend.tsx";
import { commandKeyAllowed, globalKeyAllowed, isTypingTarget, nextRegion, openTarget, regionOf, regionsAvailable, topOverlay, type Region } from "./keys.ts";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** ?now=ISO pins the clock (used for screenshots and checks). */
function nowOverride(): string | undefined {
  const p = new URLSearchParams(location.search).get("now");
  if (!p) return undefined;
  try {
    return Temporal.Instant.from(p).toString();
  } catch {
    return undefined;
  }
}

const shortDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function App() {
  const now = useRef(nowOverride()).current;
  const { layout, compact } = useLayout();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  /** Settings (step 6b): the section shown, or null when closed. It takes the week's place. */
  const [settingsAt, setSettingsAt] = useState<SettingsSectionId | null>(null);
  /** The base view (step 10): Today (the default) or the Week. Other views sit on top and Esc returns here. */
  const [base, setBase] = useState<"today" | "week">("today");
  /** The Inbox (step 10): open follow-ups and unsorted captures, in the base view's place. Replaces Follow-ups and Capture. */
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  /** Close out (step 7) for a day, and Check-in for today, take the week's place too. */
  const [closeOutAt, setCloseOutAt] = useState<IsoDate | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  /** Plan the week (step 8) for a week (its Monday), or null when closed. It takes the week's place too. */
  const [planWeekAt, setPlanWeekAt] = useState<IsoDate | null>(null);
  /** Bumped when something outside Plan the week (the command menu) changes its plan, so it reloads. */
  const [planWeekVersion, setPlanWeekVersion] = useState(0);
  /** Quick capture (step 9): the box over any view, and the Capture view (inbox and notes) in the week's place. */
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureVersion, setCaptureVersion] = useState(0);
  /** The focus screen (step 10): a calm full view while focus runs. Esc goes back; the timer keeps running. */
  const [focusOpen, setFocusOpen] = useState(false);
  const [borrowMenuAt, setBorrowMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** The focus timer menu (F or the top bar Focus button), anchored where it was opened. */
  const [timerMenuAt, setTimerMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** A per-second clock while a timer runs, for its countdown. */
  // With ?now= pinned (screenshots, verification), the countdown follows the pinned clock too.
  const skew = useRef(now ? Date.parse(now) - Date.now() : 0).current;
  const [secondMs, setSecondMs] = useState(() => Date.now() + skew);
  // The element focused in each region, so F6 returns to it; and the work item focused when the command menu opened.
  const lastInRegion = useRef(new Map<Region, HTMLElement>());
  const focusedItem = useRef<{ clientKey: string; url: string } | null>(null);
  const openCommands = useCallback(() => {
    focusedItem.current = openTarget(document.activeElement);
    setDetailsOpen(false); // the details dialog is modal and would sit above the menu
    setCmdOpen(true);
  }, []);
  const [busy, setBusy] = useState<"outlook" | "google" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Notices from work item links (e.g. "No Edge profile set for W&C"), shown for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setNotice((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 6000);
    };
    window.addEventListener(NOTICE_EVENT, on);
    return () => {
      window.removeEventListener(NOTICE_EVENT, on);
      clearTimeout(timer);
    };
  }, []);
  const [clock, setClock] = useState(() => Date.now());
  const [pd, setPd] = useState<PlanDayState | null>(null);
  const [justCommitted, setJustCommitted] = useState(false);
  useEffect(() => setJustCommitted(false), [pd?.date]);
  // Step 13.6: "+ Add work" and A open Plan the day on one block's picker.
  const [pdStart, setPdStart] = useState<{ half: Half; n: number; focus?: number | null } | null>(null);
  const [pdError, setPdError] = useState<string | null>(null);
  const autoTried = useRef<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  // The week the window is on (or moving to), and a counter so a slow older response never overwrites a newer one.
  const weekRef = useRef<string | undefined>(undefined);
  const seq = useRef(0);
  const data = state.kind === "ready" ? state.data : null;

  // Theme: the config's value once loaded; a change applies at once and is saved, and reverts if saving fails.
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const configTheme = data?.ui.theme;
  useEffect(() => {
    if (configTheme) setThemeState(configTheme);
  }, [configTheme]);
  useEffect(() => applyTheme(theme), [theme]);
  const setTheme = useCallback(
    async (t: Theme) => {
      const before = theme;
      setThemeState(t);
      try {
        await setThemeAction(t);
      } catch (e) {
        setThemeState(before);
        setNotice(`Theme not saved: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    },
    [theme],
  );

  /**
   * Step 15 (D271): H, the menu and the status bar change the view range for this session only; Settings > Display
   * saves the default (saveViewRange). The week is rebuilt with it (the server widens it around planned time).
   */
  const rangeRef = useRef<ViewRange | null>(null);
  const setViewRange = useCallback(async (r: ViewRange) => {
    rangeRef.current = r;
    setNotice(`Timelines: ${VIEW_RANGE_NAMES[r]} for now. Settings > Display sets the default`);
    reloadRef.current();
  }, []);
  const saveViewRange = useCallback(async (r: ViewRange) => {
    try {
      await call("ui.set_view_range", { range: r });
      rangeRef.current = null;
      setNotice(`Timelines default: ${VIEW_RANGE_NAMES[r]}`);
      reloadRef.current();
    } catch (e) {
      setNotice(`Default not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  /** Step 15.1 (D276): compact timelines on medium cards. V and the status bar switch them for the session; Settings saves the default. */
  const [timelinesNow, setTimelinesNow] = useState<boolean | null>(null);
  const timelines = timelinesNow ?? data?.ui.showTimelines ?? true;
  const switchTimelines = useCallback((on: boolean) => {
    setTimelinesNow(on);
    setNotice(`Timelines on cards ${on ? "on" : "off"} for now. Settings > Display sets the default`);
  }, []);
  const saveTimelines = useCallback(async (on: boolean) => {
    try {
      await call("ui.set_timelines", { on });
      setTimelinesNow(on);
      setNotice(`Timelines on cards: ${on ? "on" : "off"} by default`);
      reloadRef.current();
    } catch (e) {
      setNotice(`Default not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  /** Time model actions (hours for a day, unavailable time, flex sessions): run, then reload the week quietly. */
  const runTime = useCallback(async (action: string, input: Record<string, unknown>): Promise<boolean> => {
    try {
      await call(action, input);
      reloadRef.current();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  }, []);
  const reloadRef = useRef<() => void>(() => {});
  const openFocusRef = useRef<() => void>(() => {});
  /** Timer actions (step 6c): the server keeps the state; reload to show it. */
  const runTimer = useCallback(async (action: string, input: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const r = await call<{ notice?: string }>(action, input);
      if (r?.notice) setNotice(r.notice);
      // Step 10: starting focus (or the next pick) switches to the focus screen, from wherever it was started.
      if ((action === "timer.start" && input.kind !== "break") || action === "timer.next") openFocusRef.current();
      reloadRef.current();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  }, []);

  /** Start focus (step 10): on a pick (its size's length), or a plain focus timer. */
  const startFocus = useCallback((p: Pick | null) => void runTimer("timer.start", p ? { pickId: p.id } : { kind: "focus" }), [runTimer]);

  /** Loads a week. Data on screen stays put until the new data arrives; a failure keeps it (afterLoad). */
  const load = useCallback(
    async (input: { weekStart?: string; refresh?: boolean }, opts: { selectToday?: boolean; quiet?: boolean } = {}) => {
      const id = ++seq.current;
      if (input.weekStart) weekRef.current = input.weekStart;
      if (!opts.quiet) setLoading(true);
      try {
        const d = await weekLoad({ ...input, ...(now ? { now } : {}), ...(rangeRef.current ? { viewRange: rangeRef.current } : {}) });
        if (id !== seq.current) return undefined;
        weekRef.current = d.weekStart;
        setState((prev) => afterLoad(prev, { kind: "ok", data: d }));
        if (opts.selectToday) setSel({ dayIndex: d.today.dayIndex, half: d.today.half });
        return d;
      } catch (e) {
        if (id !== seq.current) return undefined;
        setState((prev) => afterLoad(prev, e instanceof SessionError ? { kind: "session" } : { kind: "error" }));
        return undefined;
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [now],
  );
  const reloadQuiet = useCallback(() => void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}) }, { quiet: true }), [load]);
  // Timeboxes (step 12): the Timebox… dialog, Outlook write access (read when first needed), and the write flow.
  const [tbTarget, setTbTarget] = useState<TimeboxTarget | null>(null);
  // Step 13: the collaboration finder's target, and the timebox env for menus built before render.
  const [helpTarget, setHelpTarget] = useState<HelpTarget | null>(null);
  const tbEnvRef = useRef<TimeboxEnv | null>(null);
  const [writeAccess, setWriteAccess] = useState<WriteState | null>(null);
  const accessAsked = useRef(false);
  const loadAccess = useCallback(() => {
    if (accessAsked.current) return;
    accessAsked.current = true;
    call<WriteState>("write.status", {}).then(setWriteAccess, () => (accessAsked.current = false));
  }, []);
  const writes = useWriteFlow(reloadQuiet);
  // Step 14: DevOps writes (preview, confirm, read back) and the way to Settings > Clients for a write PAT.
  const openSettingsRef = useRef<((section?: string) => void) | null>(null);
  const devopsWrites = useDevOpsWriteFlow({ allowed: data?.devopsWrite ?? [], onDone: reloadQuiet, openSettings: () => openSettingsRef.current?.("clients") });
  const connectWrite = useCallback(async () => {
    setNotice("Finish signing in to Microsoft in your browser, and allow calendar changes");
    try {
      const r = await call<{ status: string; message?: string }>("auth.connect_outlook_write", {});
      setNotice(r.status === "connected" ? "Outlook reconnected" : (r.message ?? "Sign-in did not finish"));
    } catch {
      setNotice("Sign-in did not finish");
    } finally {
      accessAsked.current = false;
      setWriteAccess(null);
      loadAccess();
      reloadQuiet();
    }
  }, [loadAccess, reloadQuiet]);
  reloadRef.current = reloadQuiet;
  // The week can lose a column (a weekend day emptied) or a slot (an evening removed): keep the selection valid.
  useEffect(() => {
    if (!data) return;
    const days = data.week.days;
    const i = Math.min(sel.dayIndex, days.length - 1);
    const half = validHalf(days[i]!, sel.half);
    if (i !== sel.dayIndex || half !== sel.half) setSel({ dayIndex: i, half });
  }, [data, sel]);

  useEffect(() => {
    void load({}, { selectToday: true });
  }, [load]);

  // Freshness: refetch on window focus (at most once a minute), quietly every 5 minutes, and on "r" or Refresh.
  const auto = useMemo(
    () =>
      createAutoRefresh({
        isHidden: () => document.hidden,
        refresh: async (t: RefreshTrigger) => void (await load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true }, { quiet: t === "focus" || t === "interval" })),
      }),
    [load],
  );
  useEffect(() => {
    auto.start();
    const onFocus = () => auto.trigger("focus");
    const onVisible = () => document.visibilityState === "visible" && auto.trigger("focus");
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      auto.stop();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [auto]);

  const changeWeek = useCallback((n: number) => data && void load({ weekStart: addWeeks(data.weekStart, n) }), [data, load]);
  const goToday = useCallback(() => {
    if (!data) return;
    if (data.today.weekStart === data.weekStart) setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
    else void load({ weekStart: data.today.weekStart }, { selectToday: true });
  }, [data, load]);

  /** The clock in the configured zone (pinned by ?now= for checks). */
  const zonedNow = useCallback(
    (tz: string) => (now ? Temporal.Instant.from(now).toZonedDateTimeISO(tz) : Temporal.Now.zonedDateTimeISO(tz)),
    [now],
  );
  /**
   * Days with working hours (the time model) or a flex session on the week shown (D127). A flex-only day in another
   * week is found by the server, which refuses or opens it; the stepper below tries the next one on a refusal.
   */
  const hasHours = useCallback(
    (d: IsoDate) => !!data && (hoursOn(data.hours, d).segments.length > 0 || data.week.days.some((x) => x.date === d && x.flexMinutes > 0)),
    [data],
  );
  /** Default day to plan: today on a day with hours before its end, else the next such day (D97, D127). */
  // PTO days are skipped (D106): the ones ahead of today from the server, plus any on the week shown.
  const target = useMemo(() => {
    if (!data) return null;
    const pto = new Set([...data.ptoAhead, ...data.week.days.filter((d) => d.pto).map((d) => d.date)]);
    const now = zonedNow(data.hours.timeZone);
    return planTarget(now, dayEndOf(data.hours, now.toPlainDate().toString()) ?? "24:00", pto, hasHours);
  }, [data, zonedNow, clock, hasHours]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The Now strip (slice 4): from the loaded week and today's picks, recomputed on the 30 s clock. */
  const strip = useMemo(() => {
    if (!data || !target) return null;
    const now = zonedNow(data.hours.timeZone);
    const date = now.toPlainDate().toString();
    const names = new Map(data.planClients.map((c) => [c.clientKey, c.clientName]));
    return nowStrip({
      now,
      day: data.week.days.find((d) => d.date === date) ?? null,
      picks: data.plan?.[date]?.picks ?? [],
      committed: !!data.plan?.[date]?.committedAt,
      pto: data.ptoAhead.includes(date),
      nextWorkday: target.date !== date ? target.date : null,
      clientName: (k) => names.get(k) ?? k,
      noHoursToday: !hasHours(date),
      sizes: data.planning.sizes,
      timeboxes: data.timeboxes,
    });
  }, [data, target, zonedNow, clock, hasHours]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opens Plan the day for a date (default: today or the next workday). Moves to that date's week when it isn't
   * on screen. The automatic open is for today only, once per day.
   */
  const showPlanDay = useCallback(
    async (st: PlanDayState) => {
      if (!data) return;
      setPdError(null);
      setDetailsOpen(false);
      const monday = mondayOf(st.date);
      const w = monday !== data.weekStart ? ((await load({ weekStart: monday })) ?? null) : data;
      const dayIndex = Math.max(0, (w ?? data).week.days.findIndex((d) => d.date === st.date));
      const first = (w ?? data).week.days[dayIndex];
      const firstHalf: Half = first ? cardHalves(first)[0]! : "AM";
      setSel((s) => ({ dayIndex, half: s.dayIndex === dayIndex ? s.half : firstHalf }));
      setPd(st);
    },
    [data, load],
  );
  const openPlanDay = useCallback(
    async (date?: IsoDate, automatic = false) => {
      if (!data || !data.planDay.available || !target) return;
      const day = automatic ? data.planDay.date : (date ?? target.date);
      try {
        const st = await planAction("planday.start", automatic ? { date: day, auto: true } : { date: day });
        if (automatic && !st.opened) return;
        await showPlanDay(st);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not open planning");
      }
    },
    [data, target, showPlanDay],
  );

  const addWork = useCallback(
    (date: IsoDate, half: Half, focus: number | null = null) => {
      setPdStart((s) => ({ half, n: (s?.n ?? 0) + 1, focus }));
      void openPlanDay(date);
    },
    [openPlanDay],
  );

  /**
   * ← → in Plan the day: the previous or next day that can be planned. Days without working hours and known PTO
   * are skipped here; a PTO day only the server knows of is skipped too (it refuses with 422), up to a few times.
   */
  const stepPlanDay = useCallback(
    async (dir: 1 | -1) => {
      if (!data || !pd) return;
      const pto = new Set([...data.ptoAhead, ...data.week.days.filter((d) => d.pto).map((d) => d.date)]);
      let from = pd.date;
      for (let tries = 0; tries < 5; tries++) {
        const next = stepDay(from, dir, pto, hasHours);
        if (!next) return setPdError(`No day to plan ${dir > 0 ? "after" : "before"} ${shortDay(from)} within a month`);
        try {
          return await showPlanDay(await planAction("planday.start", { date: next }));
        } catch (e) {
          if (!(e instanceof ActionRefusal && e.status === 422)) return setPdError(e instanceof Error ? e.message : "Could not open that day");
          from = next;
        }
      }
    },
    [data, pd, showPlanDay, hasHours],
  );

  /**
   * Runs a plan action from anywhere (the panel, a "⋯" menu, the command menu). The panel shows its own day's
   * new state; the week view reloads quietly so its checklist matches. False, with a message, on refusal.
   */
  const runPlan = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        const r = await planAction(action, input);
        setPdError(null);
        if (pd) setPd(r.state?.date === pd.date ? r.state : await planAction("planday.start", { date: pd.date }));
        reloadQuiet();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "That did not work";
        if (pd) setPdError(msg);
        else setNotice(msg);
        return false;
      }
    },
    [pd, reloadQuiet],
  );

  const closePlanDay = useCallback(() => {
    setPd(null);
    setPdError(null);
  }, []);

  const commit = useCallback(async () => {
    if (!pd) return;
    try {
      await planAction("planday.commit", { date: pd.date });
      // Step 15 (D265): the first Done commits. When planned picks still have no time (and timeboxing is on), the view
      // stays open once to offer Timebox my day (D254); otherwise it closes.
      const st = await planAction("planday.start", { date: pd.date });
      const boxed = new Set((data?.timeboxes ?? []).filter((t) => t.date === pd.date && !t.removedAt).map((t) => t.pickId));
      const unboxed = st.picks.some((p) => p.date === pd.date && p.status === "planned" && !boxed.has(p.id));
      reloadQuiet();
      if (unboxed && data?.timeboxSettings.enabled !== false) {
        setPd(st);
        setJustCommitted(true);
      } else {
        setPd(null);
        setNotice(`Planned ${shortDay(pd.date)}`);
      }
    } catch (e) {
      setPdError(e instanceof Error ? e.message : "Couldn't save the plan");
    }
  }, [pd, data, reloadQuiet]);

  /** Step 15 (D272): demo mode on or off; the server swaps every source and the plan store, then the week reloads. */
  const switchDemo = useCallback(async (on: boolean) => {
    try {
      await call("demo.set", { on });
      setPd(null);
      setNotice(on ? "Demo data on: fictional clients and work. Nothing leaves Coopilot" : "Demo data off: your own data again");
      reloadRef.current();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't switch demo mode");
    }
  }, []);

  /** Tick a committed pick done or not; local status only. Shown at once, put back if the store refuses. */
  const toggle = useCallback(
    (id: number, done: boolean) => {
      setState((prev) => {
        if (prev.kind !== "ready" || !prev.data.plan) return prev;
        const plan = Object.fromEntries(Object.entries(prev.data.plan).map(([d, v]) => [d, { ...v, picks: v.picks.map((p) => (p.id === id ? { ...p, status: done ? ("done" as const) : ("planned" as const) } : p)) }]));
        return { ...prev, data: { ...prev.data, plan } };
      });
      planAction("pick.mark_done", { id, done }).catch(reloadQuiet);
    },
    [reloadQuiet],
  );

  const connect = useCallback(
    async (src: "outlook" | "google") => {
      setBusy(src);
      setNotice(`Finish signing in to ${src === "outlook" ? "Microsoft" : "Google"} in your browser`);
      try {
        const r = await connectSource(src);
        setNotice(r.status === "connected" ? null : (r.message ?? "Sign-in did not finish"));
      } catch {
        setNotice("Sign-in did not finish");
      } finally {
        setBusy(null);
        void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true });
      }
    },
    [load],
  );
  const disconnect = useCallback(
    async (src: "outlook" | "google") => {
      const name = src === "outlook" ? "Outlook" : "Google";
      if (!window.confirm(`Disconnect ${name}? Coopilot forgets its sign-in and cached ${name} events. Nothing changes in ${name}.`)) return;
      await disconnectSource(src).catch(() => setNotice(`Could not disconnect ${name}`));
      void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true });
    },
    [load],
  );

  /** Plan the week for a week; the week view loads that week too, since fit and readiness use it. */
  const openPlanWeek = useCallback(
    (w: IsoDate) => {
      closePlanDay();
      setDetailsOpen(false);
      setSettingsAt(null);
      setFollowUpsOpen(false);
      setCloseOutAt(null);
      setCheckInOpen(false);
      setPlanWeekAt(w);
      if (w !== weekRef.current) void load({ weekStart: w });
    },
    [closePlanDay, load],
  );

  const setView = useCallback(
    (v: View) => {
      setCloseOutAt(null);
      setCheckInOpen(false);
      setPlanWeekAt(null);
      setFocusOpen(false);
      if (v === "inbox" || v === "follow_ups" || v === "capture") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setFollowUpsOpen(true);
      } else if (v === "planweek") {
        // The week a nudge asked for, else next week.
        if (data) openPlanWeek(data.weekNudge.badge ?? addWeeks(mondayOf(data.planDay.date), 1));
      } else if (v === "week" || v === "today") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setFollowUpsOpen(false);
        setBase(v);
        // Both start on today's week, the Week view with the current half-day selected.
        if (data && data.weekStart !== data.today.weekStart) void load({ weekStart: data.today.weekStart }, { selectToday: true });
        else if (data && v === "week") setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
      } else if (v === "focus") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setFollowUpsOpen(false);
        setFocusOpen(true);
      } else if (v === "settings") {
        setFollowUpsOpen(false);
        setSettingsAt("you");
      } else if (v === "closeout" || v === "checkin") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setFollowUpsOpen(false);
        if (v === "closeout") setCloseOutAt(data?.planDay.date ?? null);
        if (v === "checkin") {
          setCheckInOpen(true);
          // Check-in is about today: show today's week (on a weekend there is nothing to check in on).
          const monday = data ? mondayOf(data.planDay.date) : null;
          if (data && monday && monday !== data.weekStart) void load({ weekStart: monday });
        }
      } else {
        setSettingsAt(null);
        setFollowUpsOpen(false);
        void openPlanDay();
      }
    },
    [closePlanDay, openPlanDay, data, load, openPlanWeek],
  );

  /** The ritual the Plan button opens now (step 10): Plan the day, Check-in, Close out or Plan the week. */
  const ritualNow = useCallback((): Ritual => {
    if (!data) return "planday";
    const zn = zonedNow(data.hours.timeZone);
    const today = zn.toPlainDate().toString();
    const h = hoursOn(data.hours, today);
    return ritualFor({
      time: zn.toPlainTime().toString({ smallestUnit: "minute" }),
      today: { workday: data.planDay.workday, amEnd: h.am?.end ?? null, end: dayEndOf(data.hours, today), committed: data.planDay.committed, closedOut: data.closeOut.done },
      weekNudge: !!data.weekNudge.badge,
      closeoutLeadMinutes: data.planning.closeoutReminderMinutes,
    }).ritual;
  }, [data, zonedNow]);
  const openRitual = useCallback((r: Ritual = ritualNow()) => setView(r), [ritualNow, setView]);
  openFocusRef.current = () => setView("focus");

  // Focus sounds (step 10): the session's choice (else Settings > Focus) plays only while focus runs; a soft chime
  // marks a break when asked for. The choice and volume reset when the timer is cleared.
  const [sessionSound, setSessionSound] = useState<SoundKind | null>(null);
  const [sessionVolume, setSessionVolume] = useState<number | null>(null);
  const prevTimer = useRef<TimerView | null>(null);
  const focusCfg = data?.focus;
  const timerNow = data?.timer ?? null;
  useEffect(() => {
    if (!focusCfg) return;
    sound.setVolume(sessionVolume ?? focusCfg.volume);
    const step = soundStep(prevTimer.current, timerNow, sessionSound ?? focusCfg.sound, focusCfg.onBreak);
    if (step.play) sound.play(step.play, focusCfg.fadeSeconds);
    else sound.stop(focusCfg.fadeSeconds);
    if (step.chime) sound.chime();
    prevTimer.current = timerNow;
    if (!timerNow) {
      setSessionSound(null);
      setSessionVolume(null);
    }
  }, [focusCfg, timerNow, sessionSound, sessionVolume]);

  // A per-second tick only while a timer runs; when it reaches zero locally, reload shortly after so the server's end shows.
  const timerRunning = !!data?.timer?.running;
  useEffect(() => {
    if (!timerRunning) return;
    setSecondMs(Date.now() + skew);
    const id = setInterval(() => setSecondMs(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [timerRunning, skew]);
  const timerEndsAt = data?.timer?.running ? data.timer.endsAt : null;
  useEffect(() => {
    if (!timerEndsAt) return;
    const wait = Date.parse(timerEndsAt) - (Date.now() + skew) + 6000;
    const id = setTimeout(() => reloadRef.current(), Math.max(1000, wait));
    return () => clearTimeout(id);
  }, [timerEndsAt, skew]);

  // Step 9: coopilot-open --capture leaves a request; take it on load, when the window gains focus, and every few
  // seconds while it has focus (the global key may be pressed while Coopilot is already in front).
  const hasData = !!data;
  useEffect(() => {
    if (!hasData) return;
    const check = () => void takeOpenRequest().then((v) => v === "capture" && setCaptureOpen(true));
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => document.hasFocus() && check(), 2000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [hasData]);

  /** Clicking the Now strip: back to the week with the current half-day selected (today's week if another is shown). */
  const selectNow = useCallback(() => {
    if (!data || !strip) return;
    setView("week");
    const i = data.week.days.findIndex((d) => d.date === data.planDay.date);
    if (i >= 0 && strip.half) setSel({ dayIndex: i, half: strip.half });
    else goToday();
  }, [data, strip, setView, goToday]);

  // First focus of a workday after 05:00 opens Plan the day once (the server remembers it was offered).
  const tryAuto = useCallback(() => {
    if (!data || pd || detailsOpen || cmdOpen || !document.hasFocus()) return;
    if (!autoOpenDue(zonedNow(data.hours.timeZone), data.planDay)) return;
    if (autoTried.current === data.planDay.date) return;
    autoTried.current = data.planDay.date;
    void openPlanDay(undefined, true);
  }, [data, pd, detailsOpen, cmdOpen, zonedNow, openPlanDay]);
  useEffect(() => {
    tryAuto();
    window.addEventListener("focus", tryAuto);
    return () => window.removeEventListener("focus", tryAuto);
  }, [tryAuto]);

  // Running for days: on a new local day, move to it (when showing the week that was current) and re-check Plan the day.
  useEffect(() => {
    if (!data) return;
    if (dayRolledOver(zonedNow(data.hours.timeZone), data.planDay.date)) {
      const onTodaysWeek = data.today.weekStart === data.weekStart;
      void load(onTodaysWeek ? {} : { weekStart: data.weekStart }, { selectToday: onTodaysWeek, quiet: true });
    } else tryAuto();
  }, [clock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detailsOpen && !pd && !cmdOpen && !keysOpen) cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel, detailsOpen, data?.weekStart, layout, pd, cmdOpen, keysOpen]);

  useEffect(() => {
    const on = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const r = regionOf(el);
      if (r && r !== "grid") lastInRegion.current.set(r, el);
    };
    document.addEventListener("focusin", on);
    return () => document.removeEventListener("focusin", on);
  }, []);

  /** Focus a region: the selected half-day for the week, else where focus last was there, else its first control. */
  const focusRegion = useCallback(
    (r: Region) => {
      if (r === "grid") return cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus();
      const root = document.querySelector<HTMLElement>(r === "panel" ? (detailsOpen ? "dialog.details" : ".planday") : r === "top" ? ".topbar" : ".statusbar");
      if (!root) return;
      const last = lastInRegion.current.get(r);
      if (last?.isConnected && root.contains(last) && !last.matches(":disabled")) return last.focus();
      if (r === "panel" && !detailsOpen) return root.focus();
      root.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    },
    [sel, detailsOpen],
  );
  const moveRegion = useCallback(
    (dir: 1 | -1) => focusRegion(nextRegion(regionOf(document.activeElement), regionsAvailable({ planOpen: !!pd, detailsOpen }), dir)),
    [focusRegion, pd, detailsOpen],
  );

  // F6, O and ? work everywhere (capture phase: the ⋯ buttons keep other keys to themselves), except while typing
  // and inside the command menu, the legend and popup menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cmdOpen || !data) return;
      const t = e.target as HTMLElement | null;
      // Step 13.5: nothing while typing (but F6), nothing behind a dialog or menu (only F6 behind the details).
      if (!globalKeyAllowed(e, t, topOverlay(document))) return;
      const typing = isTypingTarget(t);
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setDetailsOpen(false);
        setKeysOpen((o) => !o);
        return;
      }
      if (keysOpen) return;
      if (e.key === "F6") {
        e.preventDefault();
        moveRegion(e.shiftKey ? -1 : 1);
      } else if ((e.key === "o" || e.key === "O") && !e.shiftKey && !typing) {
        e.preventDefault();
        const target = openTarget(document.activeElement);
        if (target) void openWorkItem(target.clientKey, target.url);
        else setNotice("Focus a work item first (Tab to it), then press O");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cmdOpen, keysOpen, data, moveRegion]);

  // Ctrl+K (or Cmd+K) opens the command menu from anywhere, even while Plan the day or details are open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        if (!commandKeyAllowed(topOverlay(document), cmdOpen)) return;
        e.preventDefault();
        setKeysOpen(false);
        if (cmdOpen) setCmdOpen(false);
        else openCommands();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cmdOpen, openCommands]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cmdOpen || keysOpen) return;
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document))) return;
      const typing = isTypingTarget(e.target as HTMLElement | null);
      if ((settingsAt !== null || followUpsOpen || closeOutAt !== null || checkInOpen || planWeekAt !== null || focusOpen) && e.key === "Escape" && !captureOpen) {
        e.preventDefault();
        if (focusOpen) setBase("today");
        setPlanWeekAt(null);
        setFocusOpen(false);
        setSettingsAt(null);
        setFollowUpsOpen(false);
        setCloseOutAt(null);
        setCheckInOpen(false);
      } else if (settingsAt === null && e.key === "," && !typing && !pd && !detailsOpen) {
        e.preventDefault();
        setFollowUpsOpen(false);
        setCloseOutAt(null);
        setCheckInOpen(false);
        setPlanWeekAt(null);
        setSettingsAt("you");
      } else if (["1", "2", "3", "4", "t", "T"].includes(e.key) && !typing && !detailsOpen && !captureOpen) {
        // Step 10: the four places in the top bar. T keeps going to Today.
        e.preventDefault();
        if (e.key === "1" || e.key === "t" || e.key === "T") setView("today");
        else if (e.key === "2") setView("week");
        else if (e.key === "3") openRitual();
        else setView(followUpsOpen ? base : "inbox");
      } else if ((e.key === "p" || e.key === "P" || e.key === "i" || e.key === "I") && !typing && !pd && !detailsOpen && settingsAt === null && !captureOpen) {
        e.preventDefault();
        setView("planday");
      } else if ((e.key === "l" || e.key === "L") && !typing && !pd && !detailsOpen && settingsAt === null) {
        e.preventDefault();
        setView(followUpsOpen ? base : "inbox");
      } else if ((e.key === "n" || e.key === "N") && !typing && !detailsOpen && !captureOpen) {
        e.preventDefault();
        setCaptureOpen(true);
      } else if ((e.key === "w" || e.key === "W") && !typing && !pd && !detailsOpen && settingsAt === null) {
        e.preventDefault();
        if (planWeekAt !== null) setPlanWeekAt(null);
        else setView("planweek");
      } else if ((e.key === "e" || e.key === "E") && !typing && !pd && !detailsOpen && settingsAt === null) {
        e.preventDefault();
        if (closeOutAt !== null) setCloseOutAt(null);
        else setView("closeout");
      } else if ((e.key === "m" || e.key === "M") && !typing && !pd && !detailsOpen && settingsAt === null) {
        e.preventDefault();
        if (checkInOpen) setCheckInOpen(false);
        else setView("checkin");
      } else if ((e.key === "f" || e.key === "F") && !typing && !detailsOpen) {
        e.preventDefault();
        // Under the Focus button when it is on screen (it hides on narrow widths).
        const r = document.querySelector(".top-btn.timer-btn")?.getBoundingClientRect();
        setTimerMenuAt(r && r.width ? { x: r.right, y: r.bottom + 4 } : { x: Math.round(window.innerWidth / 2) + 160, y: 96 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsAt, followUpsOpen, closeOutAt, checkInOpen, planWeekAt, focusOpen, captureOpen, cmdOpen, keysOpen, pd, detailsOpen, setView, openRitual, base]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (base !== "week" || focusOpen || settingsAt !== null || followUpsOpen || closeOutAt !== null || checkInOpen || planWeekAt !== null || captureOpen || detailsOpen || pd || cmdOpen || keysOpen || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
      const days = data.week.days;
      const halvesOf = (i: number): Half[] => (days[i] ? cardHalves(days[i]) : ["AM", "PM"]);
      const move = (dayIndex: number, half: Half) => {
        e.preventDefault();
        const i = Math.max(0, Math.min(days.length - 1, dayIndex));
        setSel({ dayIndex: i, half: validHalf(days[i]!, half) });
      };
      const step = (dir: 1 | -1) => {
        const hs = halvesOf(sel.dayIndex);
        return move(sel.dayIndex, hs[Math.max(0, Math.min(hs.length - 1, hs.indexOf(sel.half) + dir))]!);
      };
      switch (e.key) {
        case "ArrowLeft": return move(sel.dayIndex - 1, sel.half);
        case "ArrowRight": return move(sel.dayIndex + 1, sel.half);
        case "ArrowUp": return step(-1);
        case "ArrowDown": return step(1);
        case "h":
          e.preventDefault();
          void setViewRange(VIEW_RANGES[(VIEW_RANGES.indexOf(data.week.range.mode) + 1) % VIEW_RANGES.length]!);
          return;
        case "v":
        case "V":
          // Step 15.1 (D276): only where the compact timelines exist (medium layout).
          if (layout !== "medium") return;
          e.preventDefault();
          switchTimelines(!timelines);
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          return setDetailsOpen(true);
        case "a":
        case "A": {
          // Step 13.6 (D241): add work to the selected block (its picker in Plan the day).
          e.preventDefault();
          const d = days[sel.dayIndex];
          const sl = d ? slotOf(d, sel.half) : undefined;
          if (!d || !sl) return;
          if (!canAddWork({ date: d.date, today: data.planDay.date, pto: !!d.pto, off: sl.off })) return setNotice(d.date < data.planDay.date ? "That day is past: its picks can only be ticked done or dropped" : d.pto ? "That's a PTO day" : "That block has no working hours");
          return addWork(d.date, sel.half);
        }
        case "r":
          e.preventDefault();
          auto.trigger("key");
          return;
        case "[": return changeWeek(-1);
        case "]": return changeWeek(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, detailsOpen, data, goToday, changeWeek, auto, pd, cmdOpen, keysOpen, openPlanDay, addWork, setViewRange, settingsAt, followUpsOpen, closeOutAt, checkInOpen, planWeekAt, focusOpen, base, captureOpen, layout, timelines, switchTimelines]);

  const work = useMemo(() => workByClient(data?.devops ?? null), [data?.devops]);

  const env = useMemo<MenuEnv | null>(() => {
    if (!data || !target) return null;
    const day = data.week.days[Math.min(sel.dayIndex, data.week.days.length - 1)]!;
    // The command menu offers Disconnect exactly where the status bar does (live calendars only).
    const cal = (src: "outlook" | "google") => {
      const s = data.sources.find((x) => x.source === src);
      return !!s && sourceActions(s).includes("disconnect");
    };
    return {
      week: data.week,
      selection: { date: day.date, half: sel.half, clientKey: (sel.half === "AM" ? day.am : sel.half === "PM" ? day.pm : day.eve)?.focus[0]?.clientKey ?? null },
      planWeek: data.plan,
      planState: pd,
      planTarget: target,
      today: data.planDay.date,
      work,
      calendars: { outlook: cal("outlook"), google: cal("google") },
      runPlan,
      openPlanDay: (d) => void openPlanDay(d),
      commitPlan: () => void commit(),
      openDetails: (date, half) => {
        const i = data.week.days.findIndex((x) => x.date === date);
        if (i < 0) return;
        closePlanDay();
        setSel({ dayIndex: i, half });
        setDetailsOpen(true);
      },
      openLink: (k, u) => void openWorkItem(k, u),
      changeWeek,
      goToday,
      refresh: () => auto.trigger("button"),
      showSourceStatus: () => {
        const states = data.sources.map((s) => `${SOURCE_NAMES[s.source]}: ${stateOf(s).label}`).join(" · ");
        const causes = causeLines(data.sources, data.devops).map((l) => l.text).join(". ");
        setNotice(causes ? `${states}. ${causes}.` : states);
      },
      connect: (c) => void connect(c),
      disconnect: (c) => void disconnect(c),
      setView,
      // Run after the command menu has closed and handed focus back.
      moveRegion: (dir) => setTimeout(() => moveRegion(dir), 0),
      focusedItem: focusedItem.current,
      showKeys: () => setKeysOpen(true),
      theme,
      setTheme: (t) => void setTheme(t),
      viewRange: data.week.range.mode,
      setViewRange: (r) => void setViewRange(r),
      timelines,
      saveTimelines: (on) => void saveTimelines(on),
      hours: data.hours,
      runTime,
      planning: data.planning,
      timer: data.timer,
      runTimer,
      openFollowUps: () => setView("inbox"),
      openCloseOut: (d) => {
        setView("closeout");
        if (d) setCloseOutAt(d);
      },
      openCheckIn: () => setView("checkin"),
      openPlanWeek: (w) => (w ? openPlanWeek(w) : setView("planweek")),
      planWeekOpen: planWeekAt,
      openCapture: () => setCaptureOpen(true),
      openCaptures: () => setView("inbox"),
      openRitual: () => openRitual(),
      commitWeek: () => {
        if (planWeekAt)
          void call("weekplan.commit", { weekStart: planWeekAt }).then(
            () => { setNotice("Week committed"); setPlanWeekVersion((n) => n + 1); reloadQuiet(); },
            (e: unknown) => setNotice(e instanceof Error ? e.message : "Couldn't save the week plan"),
          );
      },
      closeOutDate: closeOutAt,
      commitCloseOut: () => {
        if (closeOutAt) void call("closeout.commit", { date: closeOutAt }).then(() => { setNotice("Closed out"); reloadQuiet(); }, (e: unknown) => setNotice(e instanceof Error ? e.message : "Couldn't save Close out"));
      },
      makeUp: async (pickId, input) => {
        try {
          const r = await call<{ flexOffer: { date: string; start: string; end: string } | null; pick: { clientKey: string; title: string }; borrowed: { minutes: number } }>("pick.make_up", { id: pickId, ...input });
          setNotice(`Borrowed ${formatDuration(r.borrowed.minutes)} to make up`);
          const o = r.flexOffer;
          if (o && window.confirm(`Add a flex session ${shortDay(o.date)}, ${o.start} to ${o.end} for ${r.pick.clientKey}? Local only; nothing goes on your calendar.`))
            await call("flex.add", { date: o.date, clientKey: r.pick.clientKey, start: o.start, end: o.end, note: `Make up: ${r.pick.title}`.slice(0, 500) }).catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Could not add the flex session"));
          if (pd) setPd(await planAction("planday.start", { date: pd.date }));
          reloadQuiet();
          return true;
        } catch (e) {
          setNotice(e instanceof Error ? e.message : "That didn't work");
          return false;
        }
      },
      runFollowUps: async (action, input) => {
        try {
          await call(action, input);
          reloadQuiet();
          return true;
        } catch (e) {
          setNotice(e instanceof Error ? e.message : "That didn't work");
          return false;
        }
      },
      borrowed: data.borrowed,
      resetPlan: () => {
        setFollowUpsOpen(false);
        setCloseOutAt(null);
        setCheckInOpen(false);
        closePlanDay();
        setSettingsAt("data");
      },
      openSettings: (section) => {
        closePlanDay();
        setDetailsOpen(false);
        setFollowUpsOpen(false);
        setCloseOutAt(null);
        setCheckInOpen(false);
        setSettingsAt(SETTINGS_SECTIONS.some(([id]) => id === section) ? (section as SettingsSectionId) : "you");
      },
      openTimebox: (t) => {
        setCmdOpen(false);
        setTbTarget(t);
      },
      connectWrite: () => void connectWrite(),
      eventEdit: data.eventEdit ?? {},
      canWrite: !!data.canWrite,
      editEvent: (input) => void writes.edit(input),
      openOutlook: (url) => void call("outlook.open", { url }).catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Could not open Outlook")),
      timeboxChange: (action, input) => void (tbEnvRef.current && tbChange(tbEnvRef.current, action, input)),
      startTimeboxFocus: (tb) => void runTimer("timer.start", { timeboxId: tb.id }).then((ok) => ok && setFocusOpen(true)),
      openHelp: (t) => {
        setCmdOpen(false);
        setHelpTarget(t);
      },
      invites: data.invites ?? [],
      undoWrite: (id) => void writes.undo(id),
      tz: data.week.timeZone,
      timeboxes: data.timeboxes,
      now: now ?? new Date(clock).toISOString(),
      addWork,
      planFeature: (date: IsoDate, half: Half, itemId: number) => addWork(date, half, itemId),
      demo: data.demo,
      setDemo: (on: boolean) => void switchDemo(on),
      exportPlan: () =>
        void call<{ path: string }>("data.export", {}).then(
          (r) => setNotice(`Plan exported to ${r.path}`),
          (e: unknown) => setNotice(e instanceof Error ? e.message : "Export failed"),
        ),
    };
  }, [data, target, sel, pd, work, runPlan, openPlanDay, commit, closePlanDay, changeWeek, goToday, auto, connect, disconnect, setView, moveRegion, cmdOpen, theme, setTheme, setViewRange, runTime, runTimer, closeOutAt, reloadQuiet, planWeekAt, openPlanWeek, openRitual, connectWrite, addWork]); // eslint-disable-line react-hooks/exhaustive-deps
  openSettingsRef.current = env?.openSettings ?? null;

  if (state.kind === "session") {
    return (
      <div className="center-note">
        <h1>Coopilot needs a fresh launch link</h1>
        <p>The server was restarted, so this window's access token is no longer valid. Open Coopilot again from the launcher or with Super + Alt + C. It replaces this window.</p>
      </div>
    );
  }
  if (!data || !env || !target) {
    return <div className="center-note">{state.kind === "failed" ? <p>{state.message}. Is <code>npm start</code> still running?</p> : <p>Loading your week…</p>}</div>;
  }

  const { week } = data;
  const day = week.days[Math.min(sel.dayIndex, week.days.length - 1)]!;
  const slot = slotOf(day, validHalf(day, sel.half)) ?? day.am;
  // Weekend: "Today" shows the coming week (D36), so say so.
  const localToday = data.planDay.date;
  // The real date only: on a weekend the Today key shows next week, but no day there is badged "Today".
  const today = week.days.some((d) => d.date === localToday) ? localToday : "";
  const weekendNote = Temporal.PlainDate.from(localToday).dayOfWeek >= 6 && data.weekStart === data.today.weekStart ? `Today is ${shortDay(localToday)} · showing next week` : null;
  const view: View = settingsAt !== null ? "settings" : focusOpen ? "focus" : planWeekAt !== null ? "planweek" : followUpsOpen ? "inbox" : closeOutAt !== null ? "closeout" : checkInOpen ? "checkin" : pd ? "planday" : base;
  const ritualOpen: Ritual | null = view === "planday" || view === "checkin" || view === "closeout" || view === "planweek" ? view : null;
  const suggested = ritualNow();
  const inboxCount = data.openFollowUps + data.captures;
  const showWeekNav = view === "week" || view === "planday";
  const borrowWeek = borrowedSummary(data.borrowed, week.days[0]!.date, week.days.at(-1)!.date);
  // The running timer's pick and client, for the top bar timer and the focus screen (client color).
  const timerPick = data.timer?.pickId != null ? Object.values(data.plan ?? {}).flatMap((d) => d.picks).find((p) => p.id === data.timer!.pickId) ?? null : null;
  const timerClient = timerPick ? (data.planClients.find((c) => c.clientKey === timerPick.clientKey)?.clientName ?? timerPick.clientKey) : null;
  const timerColor = timerPick ? clientColor(timerPick.clientKey, data.clients) : "var(--accent)";

  const samples = new Set(data.sources.filter((s) => s.sample).map((s) => s.source));
  // Step 15 (D268): the ritual chips live in each Plan view's own header.
  const ritualChips = (
    <nav className="ritual-bar" aria-label="Rituals">
      {(["planday", "checkin", "closeout", "planweek"] as const).map((r) => (
        <button key={r} type="button" className="ritual-chip" aria-current={ritualOpen === r ? "page" : undefined} onClick={() => openRitual(r)}>
          {RITUAL_NAMES[r]}
          {r === suggested && ritualOpen !== r && <span className="ritual-now">now</span>}
        </button>
      ))}
    </nav>
  );
  const tbEnv: TimeboxEnv = {
    timeboxes: data.timeboxes,
    settings: data.timeboxSettings,
    colors: data.clients,
    tz: week.timeZone,
    access: writeAccess,
    loadAccess,
    changed: reloadQuiet,
    sync: writes.sync,
    syncMany: writes.syncMany,
    undo: writes.undo,
    retry: writes.retry,
    open: (t) => setTbTarget(t),
    startFocus: (tb) => void runTimer("timer.start", { timeboxId: tb.id }).then((ok) => ok && setFocusOpen(true)),
    connectWrite: () => void connectWrite(),
    help: (t) => setHelpTarget(t),
    invites: data.invites ?? [],
  };
  tbEnvRef.current = tbEnv;

  return (
    <SampleSources.Provider value={samples}>
    <DevOpsWork.Provider value={work}>
    <PlanCtx.Provider value={{ week: data.plan, toggle, sizes: data.planning.sizes, minSizes: data.planning.minSizes, focused: data.focused, timer: data.timer, nowMs: secondMs, resumeNotes: data.resumeNotes, resumeOn: resumeSlots(week.days, data.resumeNotes, data.planDay.date), weekFeatures: data.weekFeatures, timeboxes: data.timeboxes, followUps: data.followUps, today: data.planDay.date }}>
    <TimeboxCtx.Provider value={tbEnv}>
    <DevOpsWriteCtx.Provider value={devopsWrites.env}>
    <MenuHost env={env}>
    <div className={`app ${layout}${compact ? " compact" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span className="name">Coopilot</span>
          {data.demo && (
            <button type="button" className="demo-tag" onClick={() => setSettingsAt("display")} title="Demo mode: fictional data, nothing leaves Coopilot. Turn it off in Settings > Display">
              Demo data
            </button>
          )}
        </div>
        <nav className="views" aria-label="Views">
          <button type="button" className="view-tab" aria-current={view === "today" ? "page" : undefined} onClick={() => setView("today")} title="Today: now, next and Start focus (1 or T)">
            Today
          </button>
          <button type="button" className="view-tab" aria-current={view === "week" ? "page" : undefined} onClick={() => setView("week")} title="The week, half-day by half-day (2)">
            Week
          </button>
          <button type="button" className={`view-tab${ritualOpen ? "" : " plan-tab"}`} aria-current={ritualOpen ? "page" : undefined} onClick={() => openRitual()} title={`Plan: ${RITUAL_NAMES[suggested]} now (3)`}>
            Plan{!ritualOpen && <span className="plan-now">{RITUAL_NAMES[suggested]}</span>}
          </button>
          <button type="button" className="view-tab" aria-current={view === "inbox" ? "page" : undefined} onClick={() => setView(view === "inbox" ? base : "inbox")} title="Follow-ups you owe and captures to sort (4 or L)">
            Inbox{inboxCount > 0 && <span className="count" aria-label={`${inboxCount} waiting`}>{inboxCount}</span>}
          </button>
        </nav>
        <nav className="weeknav" aria-label="Week" hidden={!showWeekNav}>
          {showWeekNav && (
            <>
              <button type="button" onClick={() => changeWeek(-1)} aria-label="Previous week" title="Previous week ([)">
                ‹
              </button>
              <h1>Week of {weekLabel(week.days[0]!.date, week.days[4]!.date)}</h1>
              <button type="button" onClick={() => changeWeek(1)} aria-label="Next week" title="Next week (])">
                ›
              </button>
              {data.weekStart !== data.today.weekStart && (
                <button type="button" className="today-btn" onClick={goToday} title="Back to this week">
                  This week
                </button>
              )}
              {weekendNote && <span className="weekend-note">{weekendNote}</span>}
              {(borrowWeek.totalMinutes > 0 || borrowWeek.unpaid > 0) && (
                <button
                  type="button"
                  className="borrow-chip"
                  title="Borrowed time: slipped focus you said you'd make up"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setBorrowMenuAt({ x: r.left, y: r.bottom + 4 });
                  }}
                >
                  {borrowWeek.unpaid ? `${formatDuration(borrowWeek.unpaidMinutes)} to make up` : `Borrowed ${formatDuration(borrowWeek.totalMinutes)}, paid`}
                </button>
              )}
            </>
          )}
        </nav>
        <div className="top-actions">
          {data.timer && (
            <TopTimer
              t={data.timer}
              nowMs={secondMs}
              color={timerColor}
              client={timerClient}
              onClick={() => setView("focus")}
            />
          )}
          <button type="button" className="top-btn capture-btn" onClick={() => setCaptureOpen(true)} title="Quick capture: one line, saved at once (N)">
            Capture <kbd>N</kbd>
          </button>
          <button type="button" className="top-btn cmd-btn" onClick={openCommands} title="Every command, with its shortcut (Ctrl K)">
            Commands <kbd>Ctrl K</kbd>
          </button>
          <button type="button" className="top-btn" aria-current={view === "settings" ? "page" : undefined} onClick={() => (settingsAt === null ? setSettingsAt("you") : setSettingsAt(null))} title="Settings (,)">
            Settings <kbd>,</kbd>
          </button>
        </div>
      </header>
      {view !== "today" && view !== "focus" && (
        <ContextLine
          strip={strip}
          onSelect={selectNow}
          onStartFocus={strip && !data.timer && (strip.kind === "slot" || strip.kind === "before" || strip.kind === "lunch") ? () => startFocus(focusPick(data.plan?.[data.planDay.date]?.picks ?? [], strip.half ?? null)) : null}
          borrowed={borrowWeek.unpaid ? { unpaid: borrowWeek.unpaid, minutes: borrowWeek.unpaidMinutes } : null}
          musts={weekMusts(data, pd ? mondayOf(pd.date) : data.weekStart, null).rows}
          colors={data.clients}
          onPlanWeek={() => openPlanWeek(pd ? mondayOf(pd.date) : data.weekStart)}
        />
      )}

      {!data.config.ok && (
        <div className="config-banner" role="alert">
          <strong>{data.config.created ? "Coopilot created a starter config. Fill it in to show your focus blocks." : "Config needs attention. Focus blocks are hidden until it is fixed."}</strong>
          <span className="muted"> {data.config.path}</span>
          <ul>
            {data.config.errors.map((e) => (
              <li key={e.field}>
                <code>{e.field}</code> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}


      {focusOpen && settingsAt === null ? (
        <FocusScreen
          t={data.timer}
          nowMs={secondMs}
          pick={timerPick}
          client={timerClient}
          color={timerColor}
          event={strip?.event ?? null}
          onTimer={(a) => {
            // Done and Stop end focus: back to Today (the next step is there).
            void runTimer(a).then((ok) => ok && (a === "timer.done" || a === "timer.stop") && setView("today"));
          }}
          onStart={() => startFocus(focusPick(data.plan?.[data.planDay.date]?.picks ?? [], strip?.half ?? null))}
          onClose={() => setView("today")}
          sound={
            <SoundControl
              settings={data.focus}
              media={data.media}
              choice={sessionSound ?? data.focus.sound}
              onChoice={(k) => {
                void sound.unlock();
                setSessionSound(k);
              }}
              volume={sessionVolume ?? data.focus.volume}
              onVolume={setSessionVolume}
              onPlaylist={(name) => void runTimer("playlist.open", { name })}
              blocked={sound.blocked}
              onUnlock={() => void sound.unlock()}
            />
          }
        />
      ) : planWeekAt !== null && settingsAt === null ? (
        <PlanWeek rituals={ritualChips} weekStart={planWeekAt} data={data} version={planWeekVersion} now={now ?? new Date(clock).toISOString()} onWeek={openPlanWeek} onClose={() => setPlanWeekAt(null)} onChanged={reloadQuiet} onCaptures={() => setView("capture")} />
      ) : followUpsOpen && settingsAt === null ? (
        <Inbox data={data} version={captureVersion} onClose={() => setFollowUpsOpen(false)} onChanged={reloadQuiet} />
      ) : closeOutAt !== null && settingsAt === null ? (
        <CloseOut rituals={ritualChips} key={closeOutAt} date={closeOutAt} data={data} onDate={setCloseOutAt} onClose={() => setCloseOutAt(null)} onChanged={reloadQuiet} onCaptures={() => setView("capture")} />
      ) : checkInOpen && settingsAt === null ? (
        <CheckIn rituals={ritualChips} data={data} now={now ?? new Date(clock).toISOString()} onClose={() => setCheckInOpen(false)} onChanged={reloadQuiet} />
      ) : settingsAt !== null ? (
        <Settings
          section={settingsAt}
          onSection={setSettingsAt}
          onClose={() => setSettingsAt(null)}
          onSaved={reloadQuiet}
          sources={data.sources}
          devops={data.devops}
          busy={busy}
          loading={loading}
          onRefresh={() => auto.trigger("button")}
          onConnect={(src) => void connect(src)}
          onDisconnect={(src) => void disconnect(src)}
          theme={theme}
          setTheme={(t) => void setTheme(t)}
          viewRange={data.ui.viewRange}
          setViewRange={(r) => void saveViewRange(r)}
          showTimelines={data.ui.showTimelines}
          setShowTimelines={(on) => void saveTimelines(on)}
          demo={data.demo}
          setDemo={(on) => void switchDemo(on)}
          runTime={runTime}
        />
      ) : base === "today" && !pd ? (
        <Today
          data={data}
          strip={strip}
          target={target}
          now={now ?? new Date(clock).toISOString()}
          nowMs={secondMs}
          onStart={startFocus}
          onPlanFeature={(d, h, id) => addWork(d, h, id)}
          onFocusScreen={() => setView("focus")}
          onPlan={(d) => void openPlanDay(d)}
          onInbox={() => setView("inbox")}
          onWeek={() => setView("week")}
          onFix={() => setSettingsAt("connections")}
          onSettings={(section) => setSettingsAt(section as never)}
        />
      ) : (
      pd && week.days.some((d) => d.date === pd.date) ? (
        (() => {
          const dayIndex = week.days.findIndex((d) => d.date === pd.date);
          const fri = week.days[4]!.date;
          return (
                    <PlanDay
                      rituals={ritualChips}
                      key={pd.date}
                      day={week.days[dayIndex]!}
                      state={pd}
                      which={pd.date === localToday ? "Today" : pd.date === target.date && !target.isToday ? "Next workday" : null}
                      friday={fri === pd.date ? null : fri}
                      nextDay={(() => {
                        const next = stepDay(pd.date, 1, new Set([...data.ptoAhead, ...week.days.filter((d) => d.pto).map((d) => d.date)]), hasHours);
                        if (!next) return null;
                        const label = Temporal.PlainDate.from(pd.date).add({ days: 1 }).toString() === next ? "tomorrow" : Temporal.PlainDate.from(next).toLocaleString("en-US", { weekday: "short" });
                        return { date: next, label };
                      })()}
                      now={now ?? new Date(clock).toISOString()}
                      tz={week.timeZone}
                      colors={data.clients}
                      clients={data.planClients}
                      error={pdError}
                      act={runPlan}
                      onCommit={() => void commit()}
                      justCommitted={justCommitted}
                      onCommitSeen={() => setJustCommitted(false)}
                      onClose={closePlanDay}
                      onStep={(dir) => void stepPlanDay(dir)}
                      start={pdStart}
                    />
          );
        })()
      ) : (
      <>
      <WeekGrid
        week={week}
        colors={data.clients}
        minFocusWindow={data.thresholds.minFocusWindowMinutes}
        today={today}
        now={now ?? new Date(clock).toISOString()}
        selection={sel}
        cellRefs={cellRefs.current}
        layout={layout}
        compact={compact}
        timelines={timelines}
        onPlanDay={(d) => void openPlanDay(d)}
        onAddWork={addWork}
        onAddHours={() => {
          closePlanDay();
          setDetailsOpen(false);
          setSettingsAt("hours");
        }}
        onSelect={(s) => setSel(s)}
        onOpen={(s) => {
          setSel(s);
          setDetailsOpen(true);
        }}
      />
      </>
      )
      )}

      <StatusBar
        sources={data.sources}
        devops={data.devops}
        sampleWeek={SAMPLE_WEEK}
        isSampleWeek={data.weekStart === SAMPLE_WEEK}
        hours={data.hours}
        range={data.week.range}
        onRange={(r) => void setViewRange(r)}
        timelines={layout === "medium" ? { on: timelines, toggle: () => switchTimelines(!timelines) } : null}
        loading={loading}
        busy={busy}
        notice={notice ?? (state.kind === "ready" ? state.refreshError ?? null : null)}
        clock={clock}
        onRefresh={() => auto.trigger("button")}
        onConnect={(src) => void connect(src)}
        onDisconnect={(src) => void disconnect(src)}
      />

      <Details open={detailsOpen} day={day} slot={slot} timeZone={week.timeZone} colors={data.clients} now={now ?? new Date(clock).toISOString()} onClose={() => setDetailsOpen(false)} />
      {cmdOpen && <CommandMenu commands={commandList(env)} onClose={() => setCmdOpen(false)} />}
      {timerMenuAt && <PopupMenu at={timerMenuAt} step={timerStep(env)} onClose={() => setTimerMenuAt(null)} />}
      {borrowMenuAt && <PopupMenu at={borrowMenuAt} step={borrowStep(env, data.borrowed)} onClose={() => setBorrowMenuAt(null)} />}
      {keysOpen && <KeyLegend onClose={() => setKeysOpen(false)} />}
      <NoHoursPrompt
        onAddHours={() => {
          closePlanDay();
          setDetailsOpen(false);
          setFollowUpsOpen(false);
          setCloseOutAt(null);
          setCheckInOpen(false);
          setSettingsAt("hours");
        }}
      />
      {tbTarget && (() => {
        const pick = "pickId" in tbTarget ? Object.values(data.plan ?? {}).flatMap((d) => d.picks).concat(pd?.picks ?? []).find((p) => p.id === tbTarget.pickId) : null;
        return <TimeboxDialog target={tbTarget} env={tbEnv} title={pick ? pick.title : "title" in tbTarget ? tbTarget.title : "Pick"} defaultMinutes={pick ? data.planning.sizes[pick.size] : 60} onClose={() => setTbTarget(null)} />;
      })()}
      {helpTarget && (
        <HelpFinder
          target={helpTarget}
          clientName={data.planClients.find((c) => c.clientKey === helpTarget.clientKey)?.clientName ?? helpTarget.clientKey}
          settings={data.collab}
          tz={week.timeZone}
          onPreview={(p) => writes.show(p)}
          onClose={() => setHelpTarget(null)}
        />
      )}
      {writes.dialog}
      {devopsWrites.dialog}
      {captureOpen && <CaptureDialog data={data} onClose={() => setCaptureOpen(false)} onOpenView={() => { setCaptureOpen(false); setView("inbox"); }} onChanged={() => { setCaptureVersion((n) => n + 1); reloadQuiet(); }} />}
    </div>
    </MenuHost>
    </DevOpsWriteCtx.Provider>
    </TimeboxCtx.Provider>
    </PlanCtx.Provider>
    </DevOpsWork.Provider>
    </SampleSources.Provider>
  );
}
