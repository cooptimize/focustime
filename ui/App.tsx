import { useCallback, useEffect, useRef, useState } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { addWeeks } from "../week/dates.ts";
import type { Half } from "../week/types.ts";
import { SessionError, weekLoad } from "./api.ts";
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

type LoadState = { kind: "loading" } | { kind: "ready"; data: WeekLoadData } | { kind: "session" } | { kind: "failed"; message: string };

export function App() {
  const now = useRef(nowOverride()).current;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const data = state.kind === "ready" ? state.data : null;

  const load = useCallback(
    async (input: { weekStart?: string; refresh?: boolean }, selectToday = false) => {
      setLoading(true);
      try {
        const d = await weekLoad({ ...input, ...(now ? { now } : {}) });
        setState({ kind: "ready", data: d });
        if (selectToday) setSel({ dayIndex: d.today.dayIndex, half: d.today.half });
      } catch (e) {
        setState(e instanceof SessionError ? { kind: "session" } : { kind: "failed", message: "Could not reach the Coopilot server" });
      } finally {
        setLoading(false);
      }
    },
    [now],
  );

  useEffect(() => {
    void load({}, true);
  }, [load]);

  const changeWeek = useCallback((n: number) => data && void load({ weekStart: addWeeks(data.weekStart, n) }), [data, load]);
  const goToday = useCallback(() => {
    if (!data) return;
    if (data.today.weekStart === data.weekStart) setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
    else void load({ weekStart: data.today.weekStart }, true);
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
        case "[": return changeWeek(-1);
        case "]": return changeWeek(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, detailsOpen, data, goToday, changeWeek]);

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
        sampleWeek={SAMPLE_WEEK}
        isSampleWeek={data.weekStart === SAMPLE_WEEK}
        shape={data.dayShape}
        loading={loading}
        onRefresh={() => void load({ weekStart: data.weekStart, refresh: true })}
      />

      <Details open={detailsOpen} day={day} slot={slot} timeZone={week.timeZone} colors={data.clients} onClose={() => setDetailsOpen(false)} />
    </div>
    </SampleSources.Provider>
  );
}
