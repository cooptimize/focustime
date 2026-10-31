import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { weekLoad } from "../actions/week-load";
import { weekConfig } from "../config/defaults";
import { SAMPLE_WEEK } from "../fixtures/sample-week";
import { addWeeks, localToday, todayTarget } from "../week/dates";
import type { Half } from "../week/types";
import { Details } from "./Details";
import { StatusBar } from "./StatusBar";
import { WeekGrid, type Selection } from "./WeekGrid";
import { weekLabel } from "./labels";

/** ?now=ISO overrides the clock (used for screenshots and checks). */
function readNow(): string {
  const p = new URLSearchParams(location.search).get("now");
  try {
    if (p) return Temporal.Instant.from(p).toString();
  } catch {
    /* ignore a bad override */
  }
  return Temporal.Now.instant().toString();
}

export function App() {
  const now = useMemo(readNow, []);
  const shape = weekConfig.dayShape;
  const today = localToday(now, shape.timeZone);
  const initial = todayTarget(now, shape);

  const [weekStart, setWeekStart] = useState(initial.weekStart);
  const [sel, setSel] = useState<Selection>({ dayIndex: initial.dayIndex, half: initial.half });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const { week, sources } = useMemo(() => weekLoad(weekStart), [weekStart]);
  const day = week.days[sel.dayIndex]!;
  const slot = sel.half === "AM" ? day.am : day.pm;

  const focusSelected = useCallback(() => {
    cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel]);
  useEffect(() => {
    if (!detailsOpen) focusSelected();
  }, [focusSelected, detailsOpen, weekStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detailsOpen || e.ctrlKey || e.metaKey || e.altKey) return;
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
        case "t": {
          const t = todayTarget(readNow(), shape);
          setWeekStart(t.weekStart);
          return setSel({ dayIndex: t.dayIndex, half: t.half });
        }
        case "[": return setWeekStart((w) => addWeeks(w, -1));
        case "]": return setWeekStart((w) => addWeeks(w, 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, detailsOpen, now, shape]);

  const isSampleWeek = weekStart === SAMPLE_WEEK;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span className="name">Coopilot</span>
          <span className="sub">Look-ahead</span>
        </div>
        <nav className="weeknav" aria-label="Week">
          <button type="button" onClick={() => setWeekStart((w) => addWeeks(w, -1))} aria-label="Previous week">
            <kbd>[</kbd>
          </button>
          <h1>
            Week of {weekLabel(week.days[0]!.date, week.days[4]!.date)}
          </h1>
          <button type="button" onClick={() => setWeekStart((w) => addWeeks(w, 1))} aria-label="Next week">
            <kbd>]</kbd>
          </button>
          <button
            type="button"
            className="today-btn"
            onClick={() => {
              const t = todayTarget(now, shape);
              setWeekStart(t.weekStart);
              setSel({ dayIndex: t.dayIndex, half: t.half });
            }}
          >
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

      <WeekGrid
        week={week}
        today={today}
        selection={sel}
        cellRefs={cellRefs.current}
        onSelect={(s) => setSel(s)}
        onOpen={(s) => {
          setSel(s);
          setDetailsOpen(true);
        }}
      />

      <StatusBar sources={sources} week={week} isSampleWeek={isSampleWeek} sampleWeek={SAMPLE_WEEK} shape={shape} />

      <Details open={detailsOpen} day={day} slot={slot} timeZone={week.timeZone} onClose={() => setDetailsOpen(false)} />
    </div>
  );
}
