import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addWeeks } from "../week/dates.ts";
import type { Half } from "../week/types.ts";
import { connectSource, disconnectSource, SessionError, weekLoad } from "./api.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { Details } from "./Details.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { WeekGrid, type Selection } from "./WeekGrid.tsx";
import { SampleSources, weekLabel } from "./labels.ts";
import { SAMPLE_WEEK } from "../fixtures/sample-week.ts";

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
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<"outlook" | "google" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
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

  useEffect(() => {
    if (!detailsOpen) cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel, detailsOpen, data?.weekStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detailsOpen || e.ctrlKey || e.metaKey || e.altKey || !data) return;
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
  }, [sel, detailsOpen, data, goToday, changeWeek, auto]);

  if (state.kind === "session") {
    return (
      <div className="center-note">
        <h1>Coopilot needs a fresh launch link</h1>
        <p>The server was restarted, so this window's access token is no longer valid. Start Coopilot again with <code>npm start</code>.</p>
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
    <div className="app">
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
          <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> details</span>
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
    </DevOpsWork.Provider>
    </SampleSources.Provider>
  );
}
