import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWeeks } from "../week/dates.ts";
import type { Half } from "../week/types.ts";
import { connectSource, disconnectSource, planAction, SessionError, weekLoad } from "./api.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";
import type { IgnitionState } from "../plan/types.ts";
import { Ignition } from "./Ignition.tsx";
import { autoOpenDue, dayRolledOver } from "./ignition.ts";
import { PlanCtx } from "./planview.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { Details } from "./Details.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { WeekGrid, type Selection } from "./WeekGrid.tsx";
import { SampleSources, weekLabel } from "./labels.ts";
import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import { useLayout } from "./viewport.ts";

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

export function App() {
  const now = useRef(nowOverride()).current;
  const { layout, compact } = useLayout();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const [ign, setIgn] = useState<IgnitionState | null>(null);
  const [ignError, setIgnError] = useState<string | null>(null);
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

  /** Opens ignition for today when it is in the week on screen, else for the selected day (planning ahead). */
  const openIgnition = useCallback(
    async (automatic: boolean) => {
      if (!data || !data.ignition.available) return;
      const days = data.week.days.map((d) => d.date);
      const date = automatic || days.includes(data.ignition.date) ? data.ignition.date : days[sel.dayIndex]!;
      const dayIndex = days.indexOf(date);
      if (dayIndex < 0) return;
      try {
        const st = await planAction("ignition.start", automatic ? { date, auto: true } : { date });
        if (automatic && !st.opened) return;
        setIgnError(null);
        setDetailsOpen(false);
        setSel((s) => ({ dayIndex, half: s.dayIndex === dayIndex ? s.half : "AM" }));
        setIgn(st);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not open planning");
      }
    },
    [data, sel.dayIndex],
  );

  /** Runs a plan action from the panel; the panel shows the returned state. False (with a message) on refusal. */
  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      if (!ign) return false;
      try {
        const r = await planAction(action, input);
        setIgnError(null);
        // The panel always shows its own day (a move or carry-over answers with the other day's state).
        setIgn(r.state?.date === ign.date ? r.state : await planAction("ignition.start", { date: ign.date }));
        return true;
      } catch (e) {
        setIgnError(e instanceof Error ? e.message : "That did not work");
        return false;
      }
    },
    [ign],
  );

  const closeIgnition = useCallback(() => {
    setIgn(null);
    setIgnError(null);
  }, []);

  const commit = useCallback(async () => {
    if (!ign) return;
    try {
      await planAction("ignition.commit", { date: ign.date });
      setIgn(null);
      void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}) }, { quiet: true });
    } catch (e) {
      setIgnError(e instanceof Error ? e.message : "Could not commit");
    }
  }, [ign, load]);

  /** Tick a committed pick done or not; local status only. Shown at once, put back if the store refuses. */
  const toggle = useCallback(
    (id: number, done: boolean) => {
      setState((prev) => {
        if (prev.kind !== "ready" || !prev.data.plan) return prev;
        const plan = Object.fromEntries(Object.entries(prev.data.plan).map(([d, v]) => [d, { ...v, picks: v.picks.map((p) => (p.id === id ? { ...p, status: done ? ("done" as const) : ("planned" as const) } : p)) }]));
        return { ...prev, data: { ...prev.data, plan } };
      });
      planAction("pick.mark_done", { id, done }).catch(() => void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}) }, { quiet: true }));
    },
    [load],
  );

  // First focus of a workday after 05:00 opens ignition once (the server remembers it was offered).
  const tryAuto = useCallback(() => {
    if (!data || ign || detailsOpen || !document.hasFocus()) return;
    if (!autoOpenDue(zonedNow(data.dayShape.timeZone), data.ignition)) return;
    if (autoTried.current === data.ignition.date) return;
    autoTried.current = data.ignition.date;
    void openIgnition(true);
  }, [data, ign, detailsOpen, zonedNow, openIgnition]);
  useEffect(() => {
    tryAuto();
    window.addEventListener("focus", tryAuto);
    return () => window.removeEventListener("focus", tryAuto);
  }, [tryAuto]);

  // Running for days: on a new local day, move to it (when showing the week that was current) and re-check ignition.
  useEffect(() => {
    if (!data) return;
    if (dayRolledOver(zonedNow(data.dayShape.timeZone), data.ignition.date)) {
      const onTodaysWeek = data.today.weekStart === data.weekStart;
      void load(onTodaysWeek ? {} : { weekStart: data.weekStart }, { selectToday: onTodaysWeek, quiet: true });
    } else tryAuto();
  }, [clock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detailsOpen && !ign) cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel, detailsOpen, data?.weekStart, layout, ign]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detailsOpen || ign || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (e.target instanceof HTMLInputElement) return;
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
        case "i":
          e.preventDefault();
          void openIgnition(false);
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
  }, [sel, detailsOpen, data, goToday, changeWeek, auto, ign, openIgnition]);

  if (state.kind === "session") {
    return (
      <div className="center-note">
        <h1>Coopilot needs a fresh launch link</h1>
        <p>The server was restarted, so this window's access token is no longer valid. Open Coopilot again from the launcher or with Super + Alt + C. It replaces this window.</p>
      </div>
    );
  }
  if (!data) {
    return <div className="center-note">{state.kind === "failed" ? <p>{state.message}. Is <code>npm start</code> still running?</p> : <p>Loading your week…</p>}</div>;
  }

  const { week } = data;
  const day = week.days[sel.dayIndex]!;
  const slot = sel.half === "AM" ? day.am : day.pm;
  const today = data.today.weekStart === data.weekStart ? week.days[data.today.dayIndex]?.date ?? "" : "";

  const samples = new Set(data.sources.filter((s) => s.sample).map((s) => s.source));

  return (
    <SampleSources.Provider value={samples}>
    <DevOpsWork.Provider value={workByClient(data.devops)}>
    <PlanCtx.Provider value={{ week: data.plan, toggle }}>
    <div className={`app ${layout}${compact ? " compact" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span className="name">Coopilot</span>
          <span className="sub">Look-ahead</span>
        </div>
        <nav className="weeknav" aria-label="Week">
          <button type="button" onClick={() => changeWeek(-1)} aria-label="Previous week">
            <kbd>[</kbd>
          </button>
          <h1>Week of {weekLabel(week.days[0]!.date, week.days[4]!.date)}</h1>
          <button type="button" onClick={() => changeWeek(1)} aria-label="Next week">
            <kbd>]</kbd>
          </button>
          <button type="button" className="today-btn" onClick={goToday}>
            <kbd>t</kbd> Today
          </button>
        </nav>
        <div className="hints" aria-hidden="true">
          <span><kbd>←</kbd><kbd>→</kbd> {layout === "narrow" ? "day" : "move"}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> AM/PM</span>
          <span><kbd>Enter</kbd> details</span>
          <span><kbd>i</kbd> plan</span>
          <span><kbd>t</kbd> today</span>
          <span><kbd>r</kbd> refresh</span>
          <span><kbd>[</kbd><kbd>]</kbd> change week</span>
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
        selection={sel}
        cellRefs={cellRefs.current}
        layout={layout}
        compact={compact}
        ignition={
          ign
            ? (() => {
                const dayIndex = week.days.findIndex((d) => d.date === ign.date);
                if (dayIndex < 0) return undefined;
                const fri = week.days[4]!.date;
                return {
                  dayIndex,
                  node: (
                    <Ignition
                      key={ign.date}
                      day={week.days[dayIndex]!}
                      state={ign}
                      friday={fri === ign.date ? null : fri}
                      now={now ?? new Date(clock).toISOString()}
                      tz={week.timeZone}
                      colors={data.clients}
                      clients={data.planClients}
                      error={ignError}
                      act={act}
                      onCommit={() => void commit()}
                      onClose={closeIgnition}
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
        onConnect={async (src) => {
          setBusy(src);
          setNotice(`Finish signing in to ${src === "outlook" ? "Microsoft" : "Google"} in your browser`);
          try {
            const r = await connectSource(src);
            setNotice(r.status === "connected" ? null : (r.message ?? "Sign-in did not finish"));
          } catch {
            setNotice("Sign-in did not finish");
          } finally {
            setBusy(null);
            void load({ weekStart: data.weekStart, refresh: true });
          }
        }}
        onDisconnect={async (src) => {
          const name = src === "outlook" ? "Outlook" : "Google";
          if (!window.confirm(`Disconnect ${name}? Coopilot forgets its sign-in and cached ${name} events. Nothing changes in ${name}.`)) return;
          await disconnectSource(src).catch(() => setNotice(`Could not disconnect ${name}`));
          void load({ weekStart: data.weekStart, refresh: true });
        }}
      />

      <Details open={detailsOpen} day={day} slot={slot} timeZone={week.timeZone} colors={data.clients} onClose={() => setDetailsOpen(false)} />
    </div>
    </PlanCtx.Provider>
    </DevOpsWork.Provider>
    </SampleSources.Provider>
  );
}
