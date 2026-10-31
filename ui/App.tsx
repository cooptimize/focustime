import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWeeks, mondayOf } from "../week/dates.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { connectSource, disconnectSource, planAction, SessionError, weekLoad } from "./api.ts";
import { NOTICE_EVENT, openWorkItem } from "./WorkLink.tsx";
import type { PlanDayState } from "../plan/types.ts";
import { planTarget } from "../plan/target.ts";
import { PlanDay } from "./PlanDay.tsx";
import { autoOpenDue, dayRolledOver } from "./planday.ts";
import { PlanCtx } from "./planview.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { Details } from "./Details.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { WeekGrid, type Selection } from "./WeekGrid.tsx";
import { SampleSources, weekLabel } from "./labels.ts";
import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import { useLayout } from "./viewport.ts";
import { commandList, type MenuEnv, type View } from "./menu.ts";
import { CommandMenu, MenuHost } from "./Menus.tsx";

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

const SOURCE_NAMES: Record<string, string> = { dataverse: "Dataverse", pto: "PTO", outlook: "Outlook", google: "Google" };
const dayOfWeekIndex = (d: IsoDate) => Temporal.PlainDate.from(d).dayOfWeek - 1;
const shortDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function App() {
  const now = useRef(nowOverride()).current;
  const { layout, compact } = useLayout();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
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

  /** Loads a week. Data on screen stays put until the new data arrives; a failure keeps it (afterLoad). */
  const load = useCallback(
    async (input: { weekStart?: string; refresh?: boolean }, opts: { selectToday?: boolean; quiet?: boolean } = {}) => {
      const id = ++seq.current;
      if (input.weekStart) weekRef.current = input.weekStart;
      if (!opts.quiet) setLoading(true);
      try {
        const d = await weekLoad({ ...input, ...(now ? { now } : {}) });
        if (id !== seq.current) return;
        weekRef.current = d.weekStart;
        setState((prev) => afterLoad(prev, { kind: "ok", data: d }));
        if (opts.selectToday) setSel({ dayIndex: d.today.dayIndex, half: d.today.half });
      } catch (e) {
        if (id !== seq.current) return;
        setState((prev) => afterLoad(prev, e instanceof SessionError ? { kind: "session" } : { kind: "error" }));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [now],
  );
  const reloadQuiet = useCallback(() => void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}) }, { quiet: true }), [load]);

  useEffect(() => {
    void load({}, { selectToday: true });
  }, [load]);

  // Freshness: refetch on window focus (at most once a minute), quietly every 5 minutes, and on "r" or Refresh.
  const auto = useMemo(
    () =>
      createAutoRefresh({
        isHidden: () => document.hidden,
        refresh: (t: RefreshTrigger) => load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true }, { quiet: t === "focus" || t === "interval" }),
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

  /** The clock in the day shape's zone (pinned by ?now= for checks). */
  const zonedNow = useCallback(
    (tz: string) => (now ? Temporal.Instant.from(now).toZonedDateTimeISO(tz) : Temporal.Now.zonedDateTimeISO(tz)),
    [now],
  );
  /** Default day to plan: today on a workday before the usual end, else the next workday (D97). */
  // PTO days are skipped (D106): the ones ahead of today from the server, plus any on the week shown.
  const target = useMemo(() => {
    if (!data) return null;
    const pto = new Set([...data.ptoAhead, ...data.week.days.filter((d) => d.pto).map((d) => d.date)]);
    return planTarget(zonedNow(data.dayShape.timeZone), data.dayShape.end, pto);
  }, [data, zonedNow, clock]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opens Plan the day for a date (default: today or the next workday). Moves to that date's week when it isn't
   * on screen. The automatic open is for today only, once per day.
   */
  const openPlanDay = useCallback(
    async (date?: IsoDate, automatic = false) => {
      if (!data || !data.planDay.available || !target) return;
      const day = automatic ? data.planDay.date : (date ?? target.date);
      try {
        const st = await planAction("planday.start", automatic ? { date: day, auto: true } : { date: day });
        if (automatic && !st.opened) return;
        setPdError(null);
        setDetailsOpen(false);
        const monday = mondayOf(day);
        if (monday !== data.weekStart) await load({ weekStart: monday });
        const dayIndex = dayOfWeekIndex(day);
        setSel((s) => ({ dayIndex, half: s.dayIndex === dayIndex ? s.half : "AM" }));
        setPd(st);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not open planning");
      }
    },
    [data, target, load],
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
      } else void openPlanDay();
    },
    [closePlanDay, openPlanDay],
  );

  // First focus of a workday after 05:00 opens Plan the day once (the server remembers it was offered).
  const tryAuto = useCallback(() => {
    if (!data || pd || detailsOpen || cmdOpen || !document.hasFocus()) return;
    if (!autoOpenDue(zonedNow(data.dayShape.timeZone), data.planDay)) return;
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
    if (dayRolledOver(zonedNow(data.dayShape.timeZone), data.planDay.date)) {
      const onTodaysWeek = data.today.weekStart === data.weekStart;
      void load(onTodaysWeek ? {} : { weekStart: data.weekStart }, { selectToday: onTodaysWeek, quiet: true });
    } else tryAuto();
  }, [clock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detailsOpen && !pd && !cmdOpen) cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel, detailsOpen, data?.weekStart, layout, pd, cmdOpen]);

  // Ctrl+K (or Cmd+K) opens the command menu from anywhere, even while Plan the day or details are open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setDetailsOpen(false); // the details dialog is modal and would sit above the menu
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detailsOpen || pd || cmdOpen || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (e.target instanceof HTMLInputElement) return;
      if ((e.target as HTMLElement | null)?.closest?.(".popup-menu")) return;
      if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
      const move = (dayIndex: number, half: Half) => {
        e.preventDefault();
        setSel({ dayIndex: Math.max(0, Math.min(4, dayIndex)), half });
      };
      switch (e.key) {
        case "ArrowLeft": return move(sel.dayIndex - 1, sel.half);
        case "ArrowRight": return move(sel.dayIndex + 1, sel.half);
        case "ArrowUp": return move(sel.dayIndex, "AM");
        case "ArrowDown": return move(sel.dayIndex, "PM");
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
  }, [sel, detailsOpen, data, goToday, changeWeek, auto, pd, cmdOpen, openPlanDay]);

  const work = useMemo(() => workByClient(data?.devops ?? null), [data?.devops]);

  const env = useMemo<MenuEnv | null>(() => {
    if (!data || !target) return null;
    const day = data.week.days[sel.dayIndex]!;
    const cal = (src: "outlook" | "google") => {
      const s = data.sources.find((x) => x.source === src);
      return !!s && !s.sample && s.fixAction !== "connect_microsoft" && s.fixAction !== "connect_google" && (s.status === "ok" || s.fromCache);
    };
    return {
      week: data.week,
      selection: { date: day.date, half: sel.half },
      planWeek: data.plan,
      planState: pd,
      planTarget: target,
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
      showSourceStatus: () => setNotice(data.sources.map((s) => `${SOURCE_NAMES[s.source] ?? s.source}: ${s.status === "ok" ? (s.sample ? "sample" : "live") : s.fromCache ? "cached" : s.status.replace("_", " ")}`).join(" · ")),
      connect: (c) => void connect(c),
      disconnect: (c) => void disconnect(c),
      setView,
    };
  }, [data, target, sel, pd, work, runPlan, openPlanDay, commit, closePlanDay, changeWeek, goToday, auto, connect, disconnect, setView]);

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
  const day = week.days[sel.dayIndex]!;
  const slot = sel.half === "AM" ? day.am : day.pm;
  // Weekend: "Today" shows the coming week (D36), so say so.
  const localToday = data.planDay.date;
  // The real date only: on a weekend the Today key shows next week, but no day there is badged "Today".
  const today = week.days.some((d) => d.date === localToday) ? localToday : "";
  const weekendNote = Temporal.PlainDate.from(localToday).dayOfWeek >= 6 && data.weekStart === data.today.weekStart ? `Today is ${shortDay(localToday)} · showing next week` : null;
  const view: View = pd ? "planday" : "week";

  const samples = new Set(data.sources.filter((s) => s.sample).map((s) => s.source));

  return (
    <SampleSources.Provider value={samples}>
    <DevOpsWork.Provider value={work}>
    <PlanCtx.Provider value={{ week: data.plan, toggle }}>
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
          <button type="button" className="view-tab" aria-current={view === "planday" ? "page" : undefined} onClick={() => void openPlanDay()} title={`Plan ${shortDay(target.date)} (P)`}>
            Plan the day <kbd>P</kbd>
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
          <button type="button" className="top-btn" onClick={() => auto.trigger("button")} disabled={loading} title="Refresh all sources (R)">
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="top-btn cmd-btn" onClick={() => { setDetailsOpen(false); setCmdOpen(true); }} title="Every command, with its shortcut">
            Commands <kbd>Ctrl K</kbd>
          </button>
          <button type="button" className="top-btn" disabled title="Settings: coming soon">
            Settings
          </button>
        </div>
      </header>

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

      <StatusBar
        sources={data.sources}
        devops={data.devops}
        sampleWeek={SAMPLE_WEEK}
        isSampleWeek={data.weekStart === SAMPLE_WEEK}
        shape={data.dayShape}
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
    </div>
    </MenuHost>
    </PlanCtx.Provider>
    </DevOpsWork.Provider>
    </SampleSources.Provider>
  );
}
