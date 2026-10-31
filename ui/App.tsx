import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWeeks, mondayOf } from "../week/dates.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { ActionRefusal, call, connectSource, disconnectSource, planAction, SessionError, setThemeAction, weekLoad } from "./api.ts";
import { dayEndOf, hoursOn, VIEW_RANGE_NAMES, VIEW_RANGES, type ViewRange } from "../week/hours.ts";
import { applyTheme, initialTheme } from "./theme.ts";
import type { Theme } from "../config/schema.ts";
import { NOTICE_EVENT, openWorkItem } from "./WorkLink.tsx";
import type { PlanDayState } from "../plan/types.ts";
import { planTarget } from "../plan/target.ts";
import { stepDay } from "../plan/days.ts";
import { PlanDay } from "./PlanDay.tsx";
import { autoOpenDue, dayRolledOver } from "./planday.ts";
import { PlanCtx } from "./planview.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { Details } from "./Details.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { causeLines, SOURCE_NAMES, sourceActions, stateOf } from "./status.ts";
import { WeekGrid, type Selection } from "./WeekGrid.tsx";
import { NowStrip, countdown, timerLeft } from "./NowStrip.tsx";
import { Loops } from "./Loops.tsx";
import { PopupMenu } from "./Menus.tsx";
import { timerStep } from "./menu.ts";
import { nowStrip } from "../plan/now.ts";
import { cardHalves, slotOf, validHalf } from "./halves.ts";
import { Settings, SETTINGS_SECTIONS, type SettingsSectionId } from "./Settings.tsx";
import { SampleSources, weekLabel } from "./labels.ts";
import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import { useLayout } from "./viewport.ts";
import { commandList, type MenuEnv, type View } from "./menu.ts";
import { CommandMenu, MenuHost } from "./Menus.tsx";
import { KeyLegend } from "./KeyLegend.tsx";
import { nextRegion, openTarget, regionOf, regionsAvailable, type Region } from "./keys.ts";

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
  /** The Loops view (step 6c) takes the week's place too. */
  const [loopsOpen, setLoopsOpen] = useState(false);
  /** The focus timer menu (F or the top bar Focus button), anchored where it was opened. */
  const [timerMenuAt, setTimerMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** A per-second clock while a timer runs, for its countdown. */
  const [secondMs, setSecondMs] = useState(() => Date.now());
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

  /** The view range is saved in config; the week is rebuilt with it (the server widens it around planned time). */
  const setViewRange = useCallback(
    async (r: ViewRange) => {
      try {
        await call("ui.set_view_range", { range: r });
        setNotice(`Timelines: ${VIEW_RANGE_NAMES[r]}`);
        reloadRef.current();
      } catch (e) {
        setNotice(`View range not saved: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    },
    [],
  );
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
  /** Timer actions (step 6c): the server keeps the state; reload to show it. */
  const runTimer = useCallback(async (action: string, input: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const r = await call<{ notice?: string }>(action, input);
      if (r?.notice) setNotice(r.notice);
      reloadRef.current();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  }, []);

  /** Loads a week. Data on screen stays put until the new data arrives; a failure keeps it (afterLoad). */
  const load = useCallback(
    async (input: { weekStart?: string; refresh?: boolean }, opts: { selectToday?: boolean; quiet?: boolean } = {}) => {
      const id = ++seq.current;
      if (input.weekStart) weekRef.current = input.weekStart;
      if (!opts.quiet) setLoading(true);
      try {
        const d = await weekLoad({ ...input, ...(now ? { now } : {}) });
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
      setPd(null);
      reloadQuiet();
    } catch (e) {
      setPdError(e instanceof Error ? e.message : "Could not commit");
    }
  }, [pd, reloadQuiet]);

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

  const setView = useCallback(
    (v: View) => {
      if (v === "week") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setLoopsOpen(false);
      } else if (v === "settings") {
        setLoopsOpen(false);
        setSettingsAt("you");
      } else if (v === "loops") {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setLoopsOpen(true);
      } else {
        setSettingsAt(null);
        setLoopsOpen(false);
        void openPlanDay();
      }
    },
    [closePlanDay, openPlanDay],
  );

  // A per-second tick only while a timer runs; when it reaches zero locally, reload shortly after so the server's end shows.
  const timerRunning = !!data?.timer?.running;
  useEffect(() => {
    if (!timerRunning) return;
    setSecondMs(Date.now());
    const id = setInterval(() => setSecondMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);
  const timerEndsAt = data?.timer?.running ? data.timer.endsAt : null;
  useEffect(() => {
    if (!timerEndsAt) return;
    const wait = Date.parse(timerEndsAt) - Date.now() + 6000;
    const id = setTimeout(() => reloadRef.current(), Math.max(1000, wait));
    return () => clearTimeout(id);
  }, [timerEndsAt]);

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
      if (e.ctrlKey || e.metaKey || e.altKey || cmdOpen || !data) return;
      const t = e.target as HTMLElement | null;
      const typing = t instanceof HTMLInputElement && t.type !== "checkbox" ? true : t instanceof HTMLTextAreaElement || !!t?.isContentEditable;
      if (t?.closest?.(".popup-menu")) return;
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
      if (cmdOpen || keysOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      const inMenu = !!(e.target as HTMLElement | null)?.closest?.(".popup-menu");
      if ((settingsAt !== null || loopsOpen) && e.key === "Escape" && !inMenu) {
        e.preventDefault();
        setSettingsAt(null);
        setLoopsOpen(false);
      } else if (settingsAt === null && e.key === "," && !typing && !pd && !detailsOpen) {
        e.preventDefault();
        setLoopsOpen(false);
        setSettingsAt("you");
      } else if ((e.key === "l" || e.key === "L") && !typing && !pd && !detailsOpen && settingsAt === null && !inMenu) {
        e.preventDefault();
        setLoopsOpen((o) => !o);
      } else if ((e.key === "f" || e.key === "F") && !typing && !detailsOpen && !inMenu) {
        e.preventDefault();
        // Under the Focus button when it is on screen (it hides on narrow widths).
        const r = document.querySelector(".top-btn.timer-btn")?.getBoundingClientRect();
        setTimerMenuAt(r && r.width ? { x: r.right, y: r.bottom + 4 } : { x: Math.round(window.innerWidth / 2) + 160, y: 96 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsAt, loopsOpen, cmdOpen, keysOpen, pd, detailsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsAt !== null || loopsOpen || detailsOpen || pd || cmdOpen || keysOpen || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (e.target instanceof HTMLInputElement) return;
      if ((e.target as HTMLElement | null)?.closest?.(".popup-menu")) return;
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
        case "Enter":
        case " ":
          e.preventDefault();
          return setDetailsOpen(true);
        case "t": return goToday();
        case "p":
        case "i": // the old key, kept as an alias
          e.preventDefault();
          void openPlanDay();
          return;
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
  }, [sel, detailsOpen, data, goToday, changeWeek, auto, pd, cmdOpen, keysOpen, openPlanDay, setViewRange, settingsAt, loopsOpen]);

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
      selection: { date: day.date, half: sel.half },
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
      hours: data.hours,
      runTime,
      planning: data.planning,
      timer: data.timer,
      runTimer,
      openLoops: () => {
        closePlanDay();
        setDetailsOpen(false);
        setSettingsAt(null);
        setLoopsOpen(true);
      },
      resetPlan: () => {
        setLoopsOpen(false);
        closePlanDay();
        setSettingsAt("data");
      },
      openSettings: (section) => {
        closePlanDay();
        setDetailsOpen(false);
        setLoopsOpen(false);
        setSettingsAt(SETTINGS_SECTIONS.some(([id]) => id === section) ? (section as SettingsSectionId) : "you");
      },
      exportPlan: () =>
        void call<{ path: string }>("data.export", {}).then(
          (r) => setNotice(`Plan exported to ${r.path}`),
          (e: unknown) => setNotice(e instanceof Error ? e.message : "Export failed"),
        ),
    };
  }, [data, target, sel, pd, work, runPlan, openPlanDay, commit, closePlanDay, changeWeek, goToday, auto, connect, disconnect, setView, moveRegion, cmdOpen, theme, setTheme, setViewRange, runTime, runTimer]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const view: View = settingsAt !== null ? "settings" : loopsOpen ? "loops" : pd ? "planday" : "week";

  const samples = new Set(data.sources.filter((s) => s.sample).map((s) => s.source));

  return (
    <SampleSources.Provider value={samples}>
    <DevOpsWork.Provider value={work}>
    <PlanCtx.Provider value={{ week: data.plan, toggle, sizes: data.planning.sizes }}>
    <MenuHost env={env}>
    <div className={`app ${layout}${compact ? " compact" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span className="name">Coopilot</span>
        </div>
        <nav className="views" aria-label="Views">
          <button type="button" className="view-tab" aria-current={view === "week" ? "page" : undefined} onClick={() => setView("week")} title="Week (Esc closes other views)">
            Week
          </button>
          <button type="button" className="view-tab" aria-current={view === "planday" ? "page" : undefined} onClick={() => setView("planday")} title={`Plan ${shortDay(target.date)} (P)`}>
            Plan the day <kbd>P</kbd>
          </button>
          <button type="button" className="view-tab" aria-current={view === "loops" ? "page" : undefined} onClick={() => setView(view === "loops" ? "week" : "loops")} title="What you owe people (L)">
            Loops{data.openLoops > 0 && <span className="count">{data.openLoops}</span>} <kbd>L</kbd>
          </button>
          {["Plan the week", "Check-in", "Close out"].map((v) => (
            <button key={v} type="button" className="view-tab soon" disabled title="Coming soon">
              {v}
              <span className="soon-tag">soon</span>
            </button>
          ))}
        </nav>
        <nav className="weeknav" aria-label="Week">
          <button type="button" onClick={() => changeWeek(-1)} aria-label="Previous week" title="Previous week ([)">
            ‹
          </button>
          <h1>Week of {weekLabel(week.days[0]!.date, week.days[4]!.date)}</h1>
          <button type="button" onClick={() => changeWeek(1)} aria-label="Next week" title="Next week (])">
            ›
          </button>
          <button type="button" className="today-btn" onClick={goToday} title="Go to today (T)">
            Today
          </button>
          {weekendNote && <span className="weekend-note">{weekendNote}</span>}
        </nav>
        <div className="top-actions">
          <button
            type="button"
            className={`top-btn timer-btn${data.timer ? " timer-on" : ""}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setTimerMenuAt({ x: r.right, y: r.bottom + 4 });
            }}
            title="Focus timer (F)"
          >
            {data.timer ? (data.timer.ended ? "Time's up" : countdown(timerLeft(data.timer, secondMs))) : "Focus"} <kbd>F</kbd>
          </button>
          <button type="button" className="top-btn" onClick={() => auto.trigger("button")} disabled={loading} title="Refresh all sources (R)">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="top-btn cmd-btn" onClick={openCommands} title="Every command, with its shortcut">
            Commands <kbd>Ctrl K</kbd>
          </button>
          <button type="button" className="top-btn" aria-current={view === "settings" ? "page" : undefined} onClick={() => (settingsAt === null ? setSettingsAt("you") : setSettingsAt(null))} title="Settings (,)">
            Settings <kbd>,</kbd>
          </button>
        </div>
      </header>
      {strip && <NowStrip strip={strip} onSelect={selectNow} timer={data.timer} nowMs={secondMs} onTimer={(a) => void runTimer(a)} />}

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

      {loopsOpen && settingsAt === null ? (
        <Loops
          clientName={(k) => data.planClients.find((c) => c.clientKey === k)?.clientName ?? k}
          timeZone={data.hours.timeZone}
          onClose={() => setLoopsOpen(false)}
          onChanged={reloadQuiet}
        />
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
          viewRange={data.week.range.mode}
          setViewRange={(r) => void setViewRange(r)}
          runTime={runTime}
        />
      ) : (
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
        planDay={
          pd
            ? (() => {
                const dayIndex = week.days.findIndex((d) => d.date === pd.date);
                if (dayIndex < 0) return undefined;
                const fri = week.days[4]!.date;
                return {
                  dayIndex,
                  node: (
                    <PlanDay
                      key={pd.date}
                      day={week.days[dayIndex]!}
                      state={pd}
                      which={pd.date === localToday ? "Today" : pd.date === target.date && !target.isToday ? "Next workday" : null}
                      friday={fri === pd.date ? null : fri}
                      now={now ?? new Date(clock).toISOString()}
                      tz={week.timeZone}
                      colors={data.clients}
                      clients={data.planClients}
                      error={pdError}
                      act={runPlan}
                      onCommit={() => void commit()}
                      onClose={closePlanDay}
                      onStep={(dir) => void stepPlanDay(dir)}
                    />
                  ),
                };
              })()
            : undefined
        }
        onSelect={(s) => setSel(s)}
        onOpen={(s) => {
          setSel(s);
          setDetailsOpen(true);
        }}
      />
      )}

      <StatusBar
        sources={data.sources}
        devops={data.devops}
        sampleWeek={SAMPLE_WEEK}
        isSampleWeek={data.weekStart === SAMPLE_WEEK}
        hours={data.hours}
        range={data.week.range}
        onRange={(r) => void setViewRange(r)}
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
      {keysOpen && <KeyLegend onClose={() => setKeysOpen(false)} />}
    </div>
    </MenuHost>
    </PlanCtx.Provider>
    </DevOpsWork.Provider>
    </SampleSources.Provider>
  );
}
