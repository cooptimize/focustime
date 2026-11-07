// AH-1: Ahead › Gantt (was Plan ahead, D653). One timeline: the last 2 weeks, weeks 1 to 4 and months to week 12, the
// free time per client under its rows. Dragging a bar snaps to half-days with the dates shown live and goes into the
// change set; while it runs, rows keep their order and reloads wait (the drag bug's fix, D655).
//
// AH-6: a planning layout. The label column is the hierarchy only: a caret (only with children), the type's icon and
// the title (two lines at most, the full title and #id in its tooltip), indented by level alone. Every label and its
// bar share one row height, the bar centered. Status is the bar's look (solid on track, an amber edge at risk, muted
// and dashed when stalled, a dashed open end where a date is missing, light hatching only when both dates are
// estimated); callouts are one marker at the bar's end whose popover lists them with their fixes (Break down, Set
// dates, Assign, Size), the planned hours and the last two weeks. An item past the edge gets an arrow cap. "Show:
// Epics · Features · Stories" folds the tree (a collapsed row's bar spans what's under it), and the label column can be
// resized; both remembered per viewer. Keyboard: Up and Down between rows, Left collapses, Right expands, Enter opens
// the side panel.
import type React from "react";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AheadState, RoadmapRow, WeekLoadData } from "../../actions/types.ts";
import { aboutText, budgetWords, DEFAULT_FEATURE_MINUTES, hoursText } from "../../plan/estimate.ts";
import { barDates, CROWDED_MINUTES_PER_FEATURE, monthLoad, NEXT_WORDS, pastWords, readiness, timelineScale, type AheadColumn, type MonthLoad, type NextStep, type ReadinessFlag, type Scale } from "../../plan/ahead.ts";
import { barTreatment, capText, dayOf, dragHalves, ganttBar, halfRight, halfX, halvesMoved, receive, release, shownOrder, type DragMode, type GanttBar, type Held, type HalfBar } from "../../plan/gantt.ts";
import { atLevel, countText, descendants, levelNames, levelRank, rollup, setRow, tree, visible, type Fold, type Node as TreeNode, type Span } from "../../plan/gantt-tree.ts";
import { GAP_WORDS, type GapKind } from "../../plan/fixnext.ts";
import { reach, type Reach } from "../../plan/reach.ts";
import { STATE_WORDS } from "../../plan/roadmap.ts";
import type { DraftStory } from "../../plan/types.ts";
import { call } from "../api.ts";
import { DraftEditorCtx } from "../DraftEditor.tsx";
import { MenuCtx } from "../Menus.tsx";
import { HoursStepper } from "../plan/Estimate.tsx";
import { placePopover } from "../popover-place.ts";
import { TypeIcon } from "../TypeIcon.tsx";
import { WorkLink } from "../WorkLink.tsx";
import { ganttLabelW, useWindowScale } from "./layout.ts";
import { useAhead } from "./Ahead.tsx";
import { CellEditor, type EditKind } from "./Editors.tsx";
import { LevelControl } from "./Levels.tsx";
import { isNum, isBool, useFold, usePref } from "./prefs.ts";
import { isOpen, type Group, type Row } from "./model.ts";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const dayHalf = (p: { date: string; half: string }) => `${Temporal.PlainDate.from(p.date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${p.half}`;
const addDays = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();

type Bar = GanttBar & { row: Row; rm: RoadmapRow | null; target: string | null; ghostEnd: string | null };
/** A fix a callout offers, through the existing actions and editors. */
type Fix = "breakdown" | "dates" | "assignee" | "size" | "draft_feature" | "ask_owner" | "help";
const FIX_WORDS: Record<Fix, string> = { breakdown: "Break down", dates: "Set dates", assignee: "Assign", size: "Size", draft_feature: NEXT_WORDS.draft_feature, ask_owner: NEXT_WORDS.ask_owner, help: NEXT_WORDS.help };
export type Callout = { key: string; text: string; row: Row; fix: Fix | null; flag?: ReadinessFlag };
const GAP_FIX: Record<GapKind, Fix> = { needs_stories: "breakdown", no_dates: "dates", unassigned: "assignee", unsized: "size" };
const NEXT_FIX: Partial<Record<NextStep, Fix>> = { breakdown: "breakdown", brief: "breakdown", set_target: "dates", draft_feature: "draft_feature", ask_owner: "ask_owner", help: "help" };

/** The estimate for an item with one date or none: its children's span, else Roadmap's estimate. */
function estimateOf(r: Row, rm: RoadmapRow | null, kids: Bar[], ahead: AheadState): { start: string; end: string } | null {
  if (kids.length) return { start: kids.map((k) => k.start.date).sort()[0]!, end: kids.map((k) => k.end.date).sort().at(-1)! };
  if (!rm) return null;
  const weeks = ahead.cells.filter((x) => x.clientKey === r.clientKey && x.itemId === r.item.id && x.minutes > 0).map((x) => x.weekStart);
  const b = barDates({ hasStartField: r.has.start, startDate: null, targetDate: null, local: null, plannedWeeks: weeks, firstActivity: rm.firstActivity, forecastEnd: rm.status.forecastEnd, today: ahead.today });
  return { start: b.start, end: b.end };
}

/** What the Gantt shares with its rows. */
type Env = {
  ahead: AheadState;
  scale: Scale;
  cols: AheadColumn[];
  fold: Fold;
  setFold: (f: Fold | ((o: Fold) => Fold)) => void;
  names: Record<"epic" | "feature" | "story", string>;
  callouts: boolean;
  nudges: boolean;
  setHours: (k: string, id: number, w: string, hours: number) => Promise<void>;
  onChanged: () => void;
  /** The row the keyboard is on (one tab stop for the whole tree). */
  cursor: string | null;
  setCursor: (k: string) => void;
  frozen: Map<string, string[]> | null;
  begin: (order: Map<string, string[]>) => void;
  end: () => void;
};

export function Gantt({ data, groups: incoming, onChanged }: { data: WeekLoadData; groups: Group[]; onChanged: () => void }) {
  const a = useAhead();
  const [ahead, setAhead] = useState<AheadState | null>(null);
  const [fold, setFold] = useFold("gantt", atLevel("feature"));
  const [callouts, setCallouts] = usePref("gantt.callouts", isBool, true);
  const [labelPref, setLabelPref] = usePref<number | null>("gantt.labelW", (v): v is number | null => v === null || isNum(v), null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [width, setWidth] = useState(1200);
  const [maxH, setMaxH] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The drag fix (D655): while a bar is dragged, what arrives (a stage, a reload) waits and rows keep their order.
  const dragging = useRef(false);
  const [held, setHeld] = useState<Held<Group[]>>({ shown: incoming, pending: null });
  const [frozen, setFrozen] = useState<Map<string, string[]> | null>(null);
  useEffect(() => setHeld((h) => receive(h, incoming, dragging.current)), [incoming]);
  const begin = useCallback((order: Map<string, string[]>) => {
    dragging.current = true;
    setFrozen(order);
  }, []);
  const end = useCallback(() => {
    dragging.current = false;
    setFrozen(null);
    setHeld(release);
  }, []);

  const reloadAhead = useCallback(async () => {
    try {
      const x = await call<AheadState>("roadmap.ahead", { seen: true });
      setAhead(x);
    } catch (e) {
      a.error(e instanceof Error ? e.message : "Could not read the weeks ahead");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Opening the Gantt answers its rituals (Look ahead 4 weeks, the direction review): seen.
  useEffect(() => void reloadAhead(), [reloadAhead]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ahead]);
  // AH-6: the timeline scrolls in its own box, so the header and each client's name stay in view (sticky).
  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      setMaxH(Math.max(360, Math.round(window.innerHeight - Math.max(0, el.getBoundingClientRect().top) - 56)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ahead]);

  // AH-3: a readable label column at any size; AH-6: the person's own width when they dragged it.
  const { scale: textScale } = useWindowScale();
  const minLabel = Math.round(200 * textScale);
  const maxLabel = Math.max(minLabel, Math.round(Math.min(640 * textScale, width * 0.6)));
  const labelW = Math.max(minLabel, Math.min(maxLabel, Math.round(labelPref ?? ganttLabelW(width, textScale))));
  const cols = ahead?.columns ?? [];
  const months = cols.filter((c) => c.kind === "month").length;
  const pastN = cols.filter((c) => c.kind === "past").length;
  const weekW = Math.max(90, Math.floor((width - labelW - 24) / (4 + 1.6 * months + 0.8 * pastN)));
  const scale = useMemo(() => (cols.length ? timelineScale(cols, { week: weekW, month: Math.floor(weekW * 1.6), past: Math.floor(weekW * 0.8) }) : null), [cols, weekW]);
  const names = useMemo(() => levelNames(held.shown), [held.shown]);

  /** Whole hours; 0 takes the feature off that week (Plan the week's rows; immediate, outside the change set). */
  const setHours = useCallback(
    async (clientKey: string, itemId: number, weekStart: string, hours: number) => {
      try {
        await call("weekplan.set_feature", { weekStart, clientKey, itemId, hours });
        onChanged();
        setAhead(await call<AheadState>("roadmap.ahead", {}));
      } catch (e) {
        a.error(e instanceof Error ? e.message : "Could not change the estimate");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChanged],
  );

  // One tab stop for the tree: the row the keyboard was on, else the first row on screen.
  useEffect(() => {
    const grid = box.current;
    if (!grid) return;
    if (cursor && grid.querySelector(`.pa-item > .pa-label[data-key="${CSS.escape(cursor)}"]`)) return;
    const first = grid.querySelector<HTMLElement>(".pa-item > .pa-label");
    if (first?.dataset.key) setCursor(first.dataset.key);
  });

  const env: Env | null = ahead && scale ? { ahead, scale, cols, fold, setFold, names, callouts, nudges: data.guidance?.readinessNudges !== false, setHours, onChanged, cursor, setCursor, frozen, begin, end } : null;
  return (
    <div className="ah-gantt-wrap">
      <div className="ah-gantt-bar" role="toolbar" aria-label="Gantt view">
        <LevelControl fold={fold} setFold={setFold} names={names} />
        <button type="button" className="rm-chip ah-callouts-toggle" aria-pressed={callouts} onClick={() => setCallouts(!callouts)} title="The marker at the end of a bar: what needs attention, with its fix">
          Show callouts
        </button>
        <Legend />
      </div>
      <div className="pa-box ah-gantt" ref={box} style={maxH ? { maxHeight: maxH } : undefined}>
        {!ahead && <p className="muted">Reading the weeks ahead…</p>}
        {env && scale && (
          <div className={`pa-grid${callouts ? "" : " no-callouts"}`} style={{ "--label-w": `${labelW}px`, "--tl-w": `${scale.width}px` } as CSSProperties} role="treegrid" aria-label="Gantt timeline">
            <Backdrop scale={scale} cols={cols} today={a.load.today} />
            <HeaderRow cols={cols} scale={scale} labelW={labelW} min={minLabel} max={maxLabel} setW={(w) => setLabelPref(w)} reset={() => setLabelPref(null)} />
            {held.shown.map((g) => (g.client.status === "ok" && g.rows.length ? <ClientGroup key={g.client.clientKey} g={g} env={env} /> : null))}
          </div>
        )}
      </div>
    </div>
  );
}

/** What each bar's look means, in the toolbar. */
function Legend() {
  const items: [string, string, string][] = [
    ["ok", "On track", "Solid: dates from DevOps (or your change)"],
    ["risk", "At risk", "An amber edge: at risk, blocked, or the work can't reach the target in the blocks known"],
    ["stalled", "Stalled", "Muted with a dashed edge: no progress lately"],
    ["open", "Date missing", "A dashed open end: that date isn't set, the end shown is estimated"],
    ["est", "Estimated", "Light hatching: neither date is set; the bar is FocusTime's estimate"],
    ["sum", "Under it", "A collapsed row: spans what's under it"],
  ];
  return (
    <ul className="pa-legend" aria-label="Legend">
      {items.map(([k, word, title]) => (
        <li key={k} title={title}>
          <span className={`pa-legend-swatch lg-${k}`} aria-hidden="true" />
          {word}
        </li>
      ))}
      <li title="The item runs past the edge of the timeline; its date is in the tooltip">
        <span className="pa-legend-cap" aria-hidden="true" />
        Beyond
      </li>
      <li title="The target date">
        <span className="pa-legend-diamond" aria-hidden="true" />
        Target
      </li>
    </ul>
  );
}

/** The grid lines, weekends and today, once behind every row. */
function Backdrop({ scale, cols, today }: { scale: Scale; cols: AheadColumn[]; today: string }) {
  const weekends = useMemo(() => {
    const out: { from: number; w: number }[] = [];
    let d = Temporal.PlainDate.from(scale.from);
    d = d.add({ days: (6 - d.dayOfWeek + 7) % 7 });
    for (; Temporal.PlainDate.compare(d, Temporal.PlainDate.from(scale.to)) < 0; d = d.add({ days: 7 })) {
      const x0 = scale.x(d.toString());
      const x1 = scale.x(d.add({ days: 2 }).toString());
      if (x1 > x0) out.push({ from: x0, w: x1 - x0 });
    }
    return out;
  }, [scale]);
  return (
    <div className="pa-backdrop" aria-hidden="true">
      {weekends.map((w) => <span key={w.from} className="pa-weekend" style={{ left: w.from, width: w.w }} />)}
      {cols.map((col, i) => <span key={col.from} className={`pa-gridline ${col.kind}`} style={{ left: scale.colX(i) }} />)}
      {today >= scale.from && today < scale.to && <span className="pa-today-line" style={{ left: scale.x(today) }} />}
    </div>
  );
}

function HeaderRow({ cols, scale, labelW, min, max, setW, reset }: { cols: AheadColumn[]; scale: Scale; labelW: number; min: number; max: number; setW: (w: number) => void; reset: () => void }) {
  const a = useAhead();
  const pastCount = cols.filter((c) => c.kind === "past").length;
  const [live, setLive] = useState<number | null>(null);
  const resize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const from = e.clientX;
    const clamp = (x: number) => Math.max(min, Math.min(max, Math.round(x)));
    const move = (ev: PointerEvent) => setLive(clamp(labelW + ev.clientX - from));
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setLive(null);
      setW(clamp(labelW + ev.clientX - from));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <div className="pa-row pa-head" role="row" style={live ? ({ "--label-w-live": `${live}px` } as CSSProperties) : undefined}>
      <div className="pa-label" role="columnheader" aria-label="Item">
        <span
          className={`pa-resize${live ? " on" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Item column width"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={live ?? labelW}
          tabIndex={0}
          title="Drag to resize the item column; double-click for the default"
          style={live ? { transform: `translateX(${live - labelW}px)` } : undefined}
          onPointerDown={resize}
          onDoubleClick={reset}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
            if (!step) return;
            e.preventDefault();
            setW(Math.max(min, Math.min(max, labelW + step)));
          }}
        />
      </div>
      <div className="pa-track" role="presentation">
        {cols.map((c, i) => (
          <div key={c.from} className={`pa-col ${c.kind}`} role="columnheader" style={{ left: scale.colX(i), width: scale.colW(i) }} title={c.kind === "week" ? `Week ${c.index}: ${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}` : c.kind === "past" ? `${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}: planned against focused time` : `${c.label}: ${plural(c.weeks.length, "week", "weeks")}, ${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}`}>
            <span className="pa-col-main">{c.label}</span>
            {(c.kind === "past" || (c.kind === "week" && c.index === 1)) && <span className="pa-col-sub">{c.kind === "week" ? "This week" : i === pastCount - 1 ? "Last week" : "2 weeks ago"}</span>}
          </div>
        ))}
        <span className="pa-today" style={{ left: scale.x(a.load.today) }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** Planned hours for an item in the next 4 weeks: a feature's own, an epic's from its features. */
function plannedOf(ahead: AheadState, clientKey: string, ids: ReadonlySet<number>): { total: number; weeks: { weekStart: string; minutes: number; exact: boolean; derived: boolean; nice: boolean }[] } {
  const weeks = ahead.weeks.slice(0, 4).map((w) => {
    const cells = ahead.cells.filter((x) => x.clientKey === clientKey && ids.has(x.itemId) && x.weekStart === w);
    return { weekStart: w, minutes: cells.reduce((n, x) => n + x.minutes, 0), exact: cells.length === 1 && !!cells[0]!.exact, derived: cells.some((x) => x.derived), nice: cells.length > 0 && cells.every((x) => x.tier === "nice") };
  });
  return { total: weeks.reduce((n, w) => n + w.minutes, 0), weeks };
}

function ClientGroup({ g, env }: { g: Group; env: Env }) {
  const a = useAhead();
  const { env: menuEnv } = useContext(MenuCtx);
  const openDraft = useContext(DraftEditorCtx);
  const { ahead, scale, cols } = env;
  const c = g.client;
  const cap = ahead.clients.find((x) => x.clientKey === c.clientKey);
  // Bars: stories (their own dates only), then features (their own dates or the estimate), then epics (their own,
  // else their features' span).
  const bars = useMemo(() => {
    const out = new Map<number, Bar | null>();
    const mk = (r: Row, kids: Bar[]) => {
      const rm = a.roadmap.get(r.key) ?? null;
      const est = r.tier === "story" ? null : estimateOf(r, rm, kids, ahead);
      // An epic with no dates of its own spans its features, both edges dashed, so they stay nested under it.
      const b = ganttBar({ start: r.eff.start, target: r.eff.target, startHalf: r.startHalf, targetHalf: r.targetHalf, estimate: est }) ?? (kids.length && est ? { start: { date: est.start, half: "AM" as const }, end: { date: est.end, half: "PM" as const }, dashedStart: true, dashedEnd: true } : null);
      return b ? { ...b, row: r, rm, target: r.eff.target, ghostEnd: rm?.status.forecastEnd && r.eff.target && rm.status.forecastEnd > r.eff.target ? rm.status.forecastEnd : null } : null;
    };
    for (const r of g.rows.filter((x) => x.tier === "story")) out.set(r.item.id, mk(r, []));
    for (const r of g.rows.filter((x) => x.tier === "feature")) out.set(r.item.id, mk(r, []));
    for (const r of g.rows.filter((x) => x.tier === "epic")) out.set(r.item.id, mk(r, g.rows.filter((x) => x.item.parentId === r.item.id && x.tier === "feature").map((x) => out.get(x.item.id)).filter((x): x is Bar => !!x)));
    return out;
  }, [g.rows, a.roadmap, ahead]);
  const loads = useMemo(() => monthLoads(g.rows, bars, cap, cols), [g.rows, bars, cap, cols]);
  const crowded = useMemo(() => new Set(loads.filter((m) => m.crowded).map((m) => m.month)), [loads]);

  // Each row's own callouts: its roadmap state when it asks for something, the readiness flags, the gaps, and whether
  // the work can reach the target (D663).
  const own = useMemo(() => {
    const out = new Map<string, Callout[]>();
    for (const r of g.rows) {
      if (r.context || !isOpen(r.item)) {
        out.set(r.key, []);
        continue;
      }
      const rm = a.roadmap.get(r.key) ?? null;
      const b = bars.get(r.item.id) ?? null;
      const isFeature = r.tier === "feature";
      const list: Callout[] = [];
      const can = r.editable && !a.readOnly;
      const allow = (f: Fix | null): Fix | null => (!f ? null : f === "breakdown" ? (r.tier === "story" ? null : f) : f === "dates" ? (can && (r.has.start || r.has.target) ? f : null) : f === "assignee" || f === "size" ? (can && r.has[f] ? f : null) : a.readOnly ? null : f);
      if (rm && rm.status.state !== "on_track" && rm.status.state !== "done" && rm.status.state !== "watch") list.push({ key: `state:${rm.status.state}`, text: `${STATE_WORDS[rm.status.state]}: ${rm.status.reason}`, row: r, fix: null });
      const flags = env.nudges && rm && r.tier !== "story"
        ? readiness({
          tier: isFeature ? "feature" : "epic", state: rm.status.state, owned: r.mine, stories: rm.done + rm.open, start: b?.start.date ?? ahead.today, target: r.eff.target, today: ahead.today, weeks: ahead.weeks,
          plannedWeeks: isFeature ? ahead.cells.filter((x) => x.clientKey === c.clientKey && x.itemId === r.item.id && x.minutes > 0).map((x) => x.weekStart) : [],
          crowdedMonths: crowded, cols, needsStories: isFeature && ahead.cells.some((x) => x.clientKey === c.clientKey && x.itemId === r.item.id && x.minutes > 0 && !x.derived),
        })
        : [];
      for (const f of flags) list.push({ key: `flag:${f.kind}`, text: f.text, row: r, fix: allow(f.next.map((n) => NEXT_FIX[n]).find((x): x is Fix => !!x && !!allow(x)) ?? null), flag: f });
      const offered = new Set(list.map((x) => x.fix));
      for (const k of r.gaps) {
        const fix = allow(GAP_FIX[k]);
        if (fix && offered.has(fix)) continue;
        list.push({ key: `gap:${k}`, text: GAP_WORDS[k], row: r, fix });
      }
      if (isFeature) {
        const reachIt: Reach = reach({ target: r.eff.target, today: ahead.today, me: c.me, stories: g.rows.filter((x) => x.item.parentId === r.item.id && x.tier === "story").map((x) => ({ assigneeEmail: x.eff.assignee?.email ?? null, assigneeName: x.eff.assignee?.name ?? null, minutes: c.hints[x.item.id]?.minutes ?? null })), weeks: cap?.weeks ?? [], months: cap?.months.map((m) => { const col = cols.find((k) => k.kind === "month" && k.month === m.month); return { from: col?.from ?? ahead.today, to: col?.to ?? ahead.today, available: m.available }; }) ?? [] });
        if (reachIt.kind === "short") list.push({ key: "reach", text: "Can't reach the target in the blocks known", row: r, fix: null });
        if (reachIt.kind === "unknown") list.push({ key: "reach", text: reachIt.text, row: r, fix: null });
      }
      if (b?.ghostEnd && b.target) list.push({ key: "pace", text: `At the pace stories close, about ${monthDay(b.ghostEnd)}: after the target`, row: r, fix: null });
      out.set(r.key, list);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.rows, a.roadmap, a.readOnly, bars, ahead, crowded, cols, env.nudges, c.clientKey, c.me, c.hints, cap]);

  // Rows: the tree, siblings by start date (no dates last), folded to the level and carets. The order freezes while a
  // drag runs (D655).
  const startOf = (r: Row) => bars.get(r.item.id)?.start.date ?? "9999";
  const roots = useMemo(() => tree(g.rows, (x, y) => startOf(x).localeCompare(startOf(y)) || x.item.title.localeCompare(y.item.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [g.rows, bars]);
  const natural = visible(roots, env.fold);
  const order = shownOrder(env.frozen?.get(c.clientKey) ?? null, natural.map((l) => l.node.row.key));
  const byKey = new Map(natural.map((l) => [l.node.row.key, l]));
  const lines = order.map((k) => byKey.get(k)!).filter(Boolean);
  const freeze = () => env.begin(new Map([[c.clientKey, lines.map((l) => l.node.row.key)]]));
  const span = (r: Row): Span | null => {
    const b = bars.get(r.item.id);
    return b ? { start: b.start.date, end: b.end.date } : null;
  };

  const runFix = async (x: Callout, anchor: HTMLElement | null, edit: (k: EditKind, r: Row, anchor: HTMLElement | null) => void) => {
    const r = x.row;
    try {
      if (x.fix === "breakdown") a.breakDown(r);
      else if (x.fix === "dates") edit(r.has.start && r.has.target ? "dates" : r.has.target ? "target" : "start", r, anchor);
      else if (x.fix === "assignee" || x.fix === "size") edit(x.fix, r, anchor);
      else if (x.fix === "draft_feature") {
        const res = await call<{ draft: DraftStory }>("draft.add_feature", { clientKey: c.clientKey, parentItemId: r.item.id, title: `New feature for ${r.item.title}` });
        env.onChanged();
        if (openDraft) openDraft(res.draft);
      } else if (x.fix === "ask_owner") {
        const who = r.eff.assignee && !r.mine ? r.eff.assignee.name : null;
        await call("followup.add", { clientKey: c.clientKey, itemId: r.item.id, what: `Ask about ${r.item.title}: ${x.text.toLowerCase()}`, channel: "teams", ...(who ? { who } : {}) });
        env.onChanged();
      } else if (x.fix === "help") menuEnv?.openHelp({ clientKey: c.clientKey, title: `#${r.item.id} ${r.item.title}`, url: r.item.url, itemId: r.item.id, pinned: null });
    } catch (e) {
      a.error(e instanceof Error ? e.message : "That didn't work");
    }
  };

  return (
    <section className="pa-client" style={{ "--c": a.color(c.clientKey) } as CSSProperties} aria-label={c.clientName} role="rowgroup">
      <div className="pa-row pa-client-head" role="row">
        <div className="pa-label" role="rowheader">
          <span className="dl-swatch" aria-hidden="true" />
          <strong>{c.clientName}</strong>
        </div>
        <div className="pa-track" role="presentation" />
      </div>
      {lines.map((l) => {
        const r = l.node.row;
        const collapsedKids = l.kids > 0 && !l.open;
        const below = collapsedKids ? descendants(l.node) : [];
        const sum = collapsedKids ? rollup(l.node, span) : null;
        const childTier = l.node.children[0]?.row.tier ?? "story";
        const list = [...(own.get(r.key) ?? []), ...below.flatMap((d) => own.get(d.key) ?? [])];
        return (
          <GanttRow
            key={r.key}
            node={l.node}
            open={l.open}
            kids={l.kids}
            bar={bars.get(r.item.id) ?? null}
            sum={sum ? { ...sum, count: countText(l.kids, env.names[childTier]) } : null}
            callouts={list}
            env={env}
            freeze={freeze}
            runFix={runFix}
          />
        );
      })}
      <CapacityRow name={c.clientName} clientKey={c.clientKey} cap={cap} cols={cols} scale={scale} loads={loads} ahead={ahead} />
    </section>
  );
}

function GanttRow({ node, open, kids, bar: b, sum, callouts, env, freeze, runFix }: {
  node: TreeNode<Row>;
  open: boolean;
  kids: number;
  bar: Bar | null;
  /** A collapsed row with dated rows under it: their span and how many children. */
  sum: (Span & { count: string }) | null;
  callouts: Callout[];
  env: Env;
  freeze: () => void;
  runFix: (x: Callout, anchor: HTMLElement | null, edit: (k: EditKind, r: Row, anchor: HTMLElement | null) => void) => Promise<void>;
}) {
  const a = useAhead();
  const r = node.row;
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey);
  const { ahead, scale } = env;
  const [live, setLive] = useState<HalfBar | null>(null);
  const [editing, setEditing] = useState<{ kind: EditKind; r: Row; anchor: HTMLElement | null } | null>(null);
  const marker = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLDivElement>(null);
  // A collapsed row's roll-up: the bar itself when the row has no dates of its own in DevOps, else a thin bracket
  // under its own bar (which stays draggable).
  const ownDated = !!b && !(b.dashedStart && b.dashedEnd);
  const summary = sum && !ownDated ? sum : null;
  const bracket = sum && ownDated ? sum : null;
  const canDrag = !summary && !!b && r.editable && !a.readOnly && (r.has.start || r.has.target);
  const rm = b?.rm ?? a.roadmap.get(r.key) ?? null;
  const short = callouts.some((x) => x.key === "reach" && x.row === r && x.text.startsWith("Can't reach"));
  const look = barTreatment(rm?.status.state, short);
  const isFeature = r.tier === "feature";
  const ids = useMemo(() => new Set(isFeature ? [r.item.id] : r.tier === "epic" ? node.children.map((k) => k.row.item.id) : []), [isFeature, r.tier, r.item.id, node.children]);
  const planned = useMemo(() => plannedOf(ahead, r.clientKey, ids), [ahead, r.clientKey, ids]);

  /** Drag in half-days (D659): the bar, or one edge; dates show live; on drop the changes are staged. A click opens the side panel. */
  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !b) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const from = e.clientX;
    const base: HalfBar = { start: b.start, end: b.end };
    const anchor = mode === "end" ? halfRight(scale, b.end) - 1 : halfX(scale, b.start) + 1;
    const moved = (x: number) => halvesMoved(scale, anchor, anchor + (x - from));
    if (canDrag) freeze();
    let any = false;
    const onMove = (ev: PointerEvent) => {
      if (!canDrag) return;
      const n = moved(ev.clientX);
      if (n !== 0) any = true;
      setLive(dragHalves(base, mode, n));
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      const n = canDrag ? moved(ev.clientX) : 0;
      if (!any && n === 0) {
        setLive(null);
        if (canDrag) env.end();
        if (r.tier !== "story") a.breakDown(r);
        return;
      }
      const next = dragHalves(base, mode, n);
      void (async () => {
        if (r.has.start && (mode !== "end" || b.dashedStart) && (next.start.date !== base.start.date || next.start.half !== base.start.half || b.dashedStart)) await a.stage(r, "start", dayOf(next.start), next.start.half);
        if (r.has.target && (mode !== "start" || b.dashedEnd) && (next.end.date !== base.end.date || next.end.half !== base.end.half || b.dashedEnd)) await a.stage(r, "target", dayOf(next.end), next.end.half);
        setLive(null);
        env.end();
      })();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  // What the row draws: the roll-up when collapsed (and something under it has dates), else its own bar.
  const shownBar: HalfBar | null = summary ? { start: { date: summary.start, half: "AM" }, end: { date: summary.end, half: "PM" } } : (live ?? b);
  const estStart = !summary && !!b?.dashedStart;
  const estEnd = !summary && !!b?.dashedEnd;
  const before = !!shownBar && shownBar.end.date < scale.from;
  const after = !!shownBar && shownBar.start.date >= scale.to;
  const early = !!shownBar && !before && shownBar.start.date < scale.from;
  const late = !!shownBar && !after && shownBar.end.date >= scale.to;
  const inRange = !!shownBar && !before && !after;
  const x0 = inRange ? Math.max(0, halfX(scale, shownBar.start)) : 0;
  const x1 = inRange ? Math.min(scale.width, halfRight(scale, shownBar.end)) : 0;
  const w = Math.max(6, x1 - x0);
  const pending = !!(r.pending.start || r.pending.target);
  const today = ahead.today;
  const capL = before ? capText("ended", shownBar!.end.date, { estimated: estEnd, today }) : early ? capText("started", shownBar!.start.date, { estimated: estStart, today }) : null;
  const capR = after ? capText("starts", shownBar!.start.date, { estimated: estStart, today }) : late ? capText("ends", shownBar!.end.date, { estimated: estEnd, today }) : null;
  const note = r.editable ? "" : `. ${c?.note ?? "Read only"}`;
  const under = sum ? `. ${sum.count} under it, ${monthDay(sum.start)} to ${monthDay(sum.end)}` : "";
  const barLabel = summary
    ? `${r.item.title}: ${summary.count} under it, ${monthDay(summary.start)} to ${monthDay(summary.end)}${note}`
    : shownBar
      ? `${r.item.title}: ${estStart ? "start estimated, " : ""}${estEnd ? "end estimated, " : ""}${dayHalf(shownBar.start)} to ${dayHalf(shownBar.end)}${b?.target ? `, target ${monthDay(b.target)}` : ""}${rm ? `. ${STATE_WORDS[rm.status.state]}` : ""}${under}${note}`
      : "";
  // Inside the bar when it fits: a roll-up's count, else the planned hours, else what's under a collapsed row.
  const inner = live ? "" : summary ? summary.count : planned.total > 0 ? aboutText(planned.total) : (sum?.count ?? "");
  const showInner = !!inner && w >= 84;
  const markerX = inRange ? Math.min(x0 + w, scale.width - (capR ? 18 : 0)) + 6 : before ? 20 : after ? Math.max(4, scale.width - 46) : 6;

  const keys = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const rows = [...(e.currentTarget.closest(".pa-grid")?.querySelectorAll<HTMLElement>(".pa-item > .pa-label") ?? [])];
    const i = rows.indexOf(e.currentTarget as HTMLElement);
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      env.setCursor(el.dataset.key ?? "");
      el.focus();
    };
    if (e.key === "ArrowDown") go(rows[i + 1]);
    else if (e.key === "ArrowUp") go(rows[i - 1]);
    else if (e.key === "Home") go(rows[0]);
    else if (e.key === "End") go(rows.at(-1));
    else if (e.key === "ArrowLeft") {
      if (kids > 0 && open) env.setFold((f) => setRow(f, r, false));
      else go(rows.find((x) => x.dataset.id === String(r.item.parentId) && x.dataset.client === r.clientKey));
    } else if (e.key === "ArrowRight") {
      if (kids > 0 && !open) env.setFold((f) => setRow(f, r, true));
      else if (kids > 0) go(rows[i + 1]);
    } else if (e.key === "Enter" && r.tier !== "story") a.breakDown(r);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const tab = env.cursor === r.key ? 0 : -1;

  return (
    <div className={`pa-row pa-item tier-${r.tier}${r.context ? " context" : ""}${isOpen(r.item) ? "" : " closed"}`} role="row" aria-level={levelRank(r.tier) + 1} aria-expanded={kids > 0 ? open : undefined}>
      <div
        ref={label}
        className="pa-label"
        role="rowheader"
        tabIndex={tab}
        data-key={r.key}
        data-id={r.item.id}
        data-client={r.clientKey}
        aria-label={`${r.item.type} #${r.item.id} ${r.item.title}${kids > 0 ? `, ${open ? "expanded" : "collapsed"}` : ""}`}
        onFocus={() => env.setCursor(r.key)}
        onKeyDown={keys}
        style={{ "--lvl": levelRank(r.tier) } as CSSProperties}
      >
        {kids > 0 ? (
          <button type="button" className="rm-expand pa-caret" tabIndex={-1} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what's under ${r.item.title}`} onClick={() => env.setFold((f) => setRow(f, r, !open))}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="rm-expand-space pa-caret" aria-hidden="true" />
        )}
        <TypeIcon clientKey={r.clientKey} type={r.item.type} className="pa-type" />
        <span className="pa-title" title={`${r.item.title} (#${r.item.id})`}>
          <WorkLink clientKey={r.clientKey} url={r.item.url} title={`${r.item.title} (#${r.item.id})`}>
            {r.item.title}
          </WorkLink>
        </span>
      </div>
      <div className="pa-track" role="gridcell" aria-label={barLabel || `${r.item.title}: no dates`}>
        {capL && <span className={`pa-capmark before${early ? " early" : ""}`} title={capL} aria-label={capL} role="img" />}
        {inRange && (
          <div
            className={`pa-bar ah-bar lk-${look}${summary ? " rollup" : estStart && estEnd ? " est" : ""}${estStart ? " dash-start" : ""}${estEnd ? " dash-end" : ""}${!summary && (pending || live) ? " changed" : ""}${early ? " early" : ""}${late ? " late" : ""}${canDrag ? "" : " fixed"}`}
            style={{ left: x0, width: w }}
            title={barLabel}
            aria-label={barLabel}
            data-count={summary?.count}
            data-from={summary?.start}
            data-to={summary?.end}
            role="button"
            tabIndex={-1}
            onPointerDown={startDrag("move")}
          >
            {canDrag && !early && <span className="pa-handle start" onPointerDown={startDrag("start")} aria-hidden="true" />}
            {showInner && <span className="pa-inner" aria-hidden="true">{inner}</span>}
            {canDrag && !late && <span className="pa-handle end" onPointerDown={startDrag("end")} aria-hidden="true" />}
          </div>
        )}
        {bracket && bracket.end >= scale.from && bracket.start < scale.to && (
          <span
            className="pa-rollup-line"
            style={{ left: Math.max(0, scale.x(bracket.start)), width: Math.max(4, Math.min(scale.width, scale.x(addDays(bracket.end, 1))) - Math.max(0, scale.x(bracket.start))) }}
            title={`${bracket.count} under it: ${monthDay(bracket.start)} to ${monthDay(bracket.end)}`}
            data-count={bracket.count}
            data-from={bracket.start}
            data-to={bracket.end}
            aria-hidden="true"
          />
        )}
        {live && (
          <span className="ah-live" style={{ left: Math.max(0, x0) }} role="status">
            {dayHalf(live.start)} → {dayHalf(live.end)}
          </span>
        )}
        {!summary && b?.ghostEnd && b.target && b.target < scale.to && <span className="pa-ghost" style={{ left: scale.x(addDays(b.target, 1)), width: Math.max(4, Math.min(scale.width, scale.x(addDays(b.ghostEnd, 1))) - scale.x(addDays(b.target, 1))) }} aria-hidden="true" />}
        {b?.target && b.target >= scale.from && b.target < scale.to && <span className="pa-diamond" style={{ left: scale.x(b.target) + (scale.x(addDays(b.target, 1)) - scale.x(b.target)) / 2 }} title={`Target ${monthDay(b.target)}`} aria-hidden="true" />}
        {capR && <span className={`pa-capmark after${late ? " late" : ""}`} title={capR} aria-label={capR} role="img" />}
        {env.callouts && (callouts.length > 0 || (isFeature && planned.total > 0)) && (
          <Marker r={r} innerRef={marker} x={markerX} callouts={callouts} planned={planned} env={env} tab={tab} collapsed={!!sum} onFix={(x) => void runFix(x, marker.current, (kind, row, anchor) => setEditing({ kind, r: row, anchor }))} />
        )}
        {editing && (
          <CellEditor
            r={editing.r}
            kind={editing.kind}
            anchor={editing.anchor}
            done={() => {
              setEditing(null);
              requestAnimationFrame(() => quietFocus(marker.current));
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Focus back on a marker without opening its popover again. */
function quietFocus(el: HTMLElement | null) {
  if (!el) return;
  el.dataset.quiet = "1";
  el.focus({ preventScroll: true });
}

/**
 * The one callout marker at the end of a bar: an icon and, past one, the count. Hover or focus opens its popover with
 * every callout (a collapsed row's include what's under it, each named), its fix, the planned hours (a feature's on
 * steppers, as Plan the week sets them) and the last two weeks.
 */
function Marker({ r, innerRef, x, callouts, planned, env, tab, collapsed, onFix }: {
  r: Row;
  innerRef: React.RefObject<HTMLButtonElement | null>;
  x: number;
  callouts: Callout[];
  planned: ReturnType<typeof plannedOf>;
  env: Env;
  tab: number;
  collapsed: boolean;
  onFix: (x: Callout) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (delay: number) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = (delay: number) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(false), delay);
  };
  useEffect(() => clear, []);
  const n = callouts.length;
  const words = n ? callouts.map((c) => c.text).join("; ") : `${aboutText(planned.total)} planned`;
  return (
    <>
      <button
        ref={innerRef}
        type="button"
        className={`pa-marker${n ? "" : " hours"}`}
        style={{ left: x }}
        tabIndex={tab}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${r.item.title}: ${n ? plural(n, "callout", "callouts") : "planned hours"}. ${words}`}
        data-count={n}
        onMouseEnter={() => show(120)}
        onMouseLeave={() => hide(250)}
        onFocus={(e) => {
          // Focus coming back after Esc or an editor closed doesn't open it again.
          if (e.currentTarget.dataset.quiet) delete e.currentTarget.dataset.quiet;
          else show(0);
        }}
        onBlur={(e) => {
          if (!pop.current?.contains(e.relatedTarget as Node | null)) hide(150);
        }}
        onClick={() => (clear(), setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) (e.preventDefault(), e.stopPropagation(), clear(), setOpen(false));
          else if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            pop.current?.querySelector<HTMLElement>("button")?.focus();
          }
        }}
      >
        <span aria-hidden="true">{n ? "⚑" : "◷"}</span>
        {n > 1 && <span className="pa-marker-n">{n}</span>}
      </button>
      {open && (
        <CalloutPop
          ref={pop}
          anchor={innerRef.current}
          r={r}
          callouts={callouts}
          planned={planned}
          env={env}
          collapsed={collapsed}
          onEnter={clear}
          onLeave={() => hide(250)}
          onClose={(back) => {
            clear();
            setOpen(false);
            if (back) requestAnimationFrame(() => quietFocus(innerRef.current));
          }}
          onFix={(x) => {
            clear();
            setOpen(false);
            onFix(x);
          }}
        />
      )}
    </>
  );
}

function CalloutPop({ ref, anchor, r, callouts, planned, env, collapsed, onEnter, onLeave, onClose, onFix }: {
  ref: React.RefObject<HTMLDivElement | null>;
  anchor: HTMLElement | null;
  r: Row;
  callouts: Callout[];
  planned: ReturnType<typeof plannedOf>;
  env: Env;
  collapsed: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: (back: boolean) => void;
  onFix: (x: Callout) => void;
}) {
  const a = useAhead();
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const place = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    setPos(placePopover(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor, ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && typeof el.showPopover === "function" && !el.matches(":popover-open")) el.showPopover();
    place();
  }, [place, ref]);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose(false);
    };
    window.addEventListener("mousedown", away, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("mousedown", away, true);
    };
  }, [place, anchor, onClose, ref]);
  const { ahead } = env;
  const isFeature = r.tier === "feature";
  const past = ahead.past.map((p) => {
    const plannedM = p.planned.filter((x) => x.clientKey === r.clientKey && x.itemId === r.item.id).reduce((n, x) => n + x.minutes, 0);
    const worked = p.worked.filter((x) => x.clientKey === r.clientKey && x.itemId === r.item.id).reduce((n, x) => n + x.minutes, 0);
    return { weekStart: p.weekStart, words: pastWords(plannedM, worked) };
  }).filter((p) => p.words);
  const client = a.load.clients.find((x) => x.clientKey === r.clientKey);
  return (
    <div
      ref={ref}
      className="cell-pop pa-pop"
      role="dialog"
      aria-label={`${r.item.title}: callouts`}
      popover="manual"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget !== anchor) onClose(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") (e.preventDefault(), onClose(true));
      }}
    >
      <div className="cell-pop-head">
        <span className="cell-pop-title">{r.item.title}</span>
        <span className="cell-pop-sub"> · #{r.item.id}</span>
      </div>
      {!r.editable && <p className="muted pa-pop-ro">{client?.note ?? "Read only"}</p>}
      {callouts.length > 0 && (
        <ul className="pa-pop-list">
          {callouts.map((x) => (
            <li key={`${x.row.key}:${x.key}`}>
              <span className="pa-pop-text">
                {collapsed && x.row !== r && <span className="muted pa-pop-who">{x.row.item.title}: </span>}
                {x.text}
              </span>
              {x.fix && (
                <button type="button" className="mini" data-fix={x.fix} onClick={() => onFix(x)}>
                  {FIX_WORDS[x.fix]}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(isFeature || planned.total > 0) && (
        <div className="pa-pop-hours">
          <p className="pa-pop-sum">{planned.total ? `${aboutText(planned.total)} planned in the next 4 weeks` : "Nothing planned in the next 4 weeks"}</p>
          <ul>
            {planned.weeks.map((w) => (
              <li key={w.weekStart}>
                <span className="muted">Week of {monthDay(w.weekStart)}</span>
                {isFeature && !a.readOnly && !w.derived ? (
                  w.minutes > 0 ? (
                    <HoursStepper className="pa-stepper" label={`${r.item.title}, week of ${monthDay(w.weekStart)}`} minutes={w.minutes} about={!w.exact} onSet={(h) => void env.setHours(r.clientKey, r.item.id, w.weekStart, h)} onClear={() => void env.setHours(r.clientKey, r.item.id, w.weekStart, 0)} />
                  ) : (
                    <button type="button" className="mini quiet" onClick={() => void env.setHours(r.clientKey, r.item.id, w.weekStart, DEFAULT_FEATURE_MINUTES / 60)}>
                      Plan {hoursText(DEFAULT_FEATURE_MINUTES)}
                    </button>
                  )
                ) : (
                  <span>{w.minutes ? `${aboutText(w.minutes)}${w.derived ? ", from its stories" : ""}` : "nothing"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {past.length > 0 && (
        <ul className="pa-pop-past">
          {past.map((p) => (
            <li key={p.weekStart}>
              <span className="muted">Week of {monthDay(p.weekStart)}</span> <span>{p.words}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Each month's load for a client: free hours against features (not epics) whose target, or else estimated end, falls in it. */
function monthLoads(rows: Row[], bars: Map<number, Bar | null>, cap: AheadState["clients"][number] | undefined, cols: AheadColumn[]): MonthLoad[] {
  return cols.flatMap((col) => {
    if (col.kind !== "month") return [];
    const available = cap?.months.find((m) => m.month === col.month)?.available ?? 0;
    const due = rows.filter((r) => r.tier === "feature" && !r.context).filter((r) => {
      const end = r.eff.target ?? bars.get(r.item.id)?.end.date ?? null;
      return !!end && end >= col.from && end < col.to;
    }).length;
    return [monthLoad(col, available, due)];
  });
}

function PastWords({ words }: { words: string }) {
  const [a, b] = words.split(", ");
  return (
    <span className="pa-pw">
      <span>{b ? `${a},` : a}</span>
      {b && <span>{b}</span>}
    </span>
  );
}

function CapacityRow({ name, clientKey, cap, cols, scale, loads, ahead }: { name: string; clientKey: string; cap: AheadState["clients"][number] | undefined; cols: AheadColumn[]; scale: Scale; loads: MonthLoad[]; ahead: AheadState }) {
  return (
    <div className="pa-row pa-cap" role="row" aria-label={`${name}: free time per week and month`}>
      <div className="pa-label muted" role="rowheader">Free time</div>
      <div className="pa-track" role="presentation">
        {cols.map((col, i) => {
          const style = { left: scale.colX(i) + 2, width: scale.colW(i) - 4 };
          if (col.kind === "past") {
            const p = ahead.past.find((x) => x.weekStart === col.weekStart);
            const planned = p?.planned.filter((x) => x.clientKey === clientKey).reduce((n, x) => n + x.minutes, 0) ?? 0;
            const minutes = p?.worked.filter((x) => x.clientKey === clientKey).reduce((n, x) => n + x.minutes, 0) ?? 0;
            const words = pastWords(planned, minutes) ?? "nothing planned";
            return (
              <span key={col.from} className="pa-capcell past" style={style} title={`Week of ${monthDay(col.weekStart)}: ${words}`}>
                <PastWords words={words} />
              </span>
            );
          }
          if (col.kind === "week") {
            const w = cap?.weeks.find((x) => x.weekStart === col.weekStart);
            const bw = budgetWords(w?.freeMinutes ?? 0, w?.plannedMinutes ?? 0);
            return (
              <span key={col.from} className={`pa-capcell ${w?.status ?? "none"}`} style={style} title={`Free focus time in ${name}'s blocks that week, after meetings; musts planned against it`}>
                {bw.text}
                {w?.over && <span className="over-word"> · {w.over}</span>}
              </span>
            );
          }
          const m = loads.find((x) => x.month === col.month)!;
          return (
            <span key={col.from} className={`pa-capcell month${m.crowded ? " crowded" : ""}`} style={style} title={m.crowded ? `${m.text}: less than ${hoursText(CROWDED_MINUTES_PER_FEATURE)} free for each feature due` : m.text}>
              {m.crowded && <strong className="pa-crowded">Crowded month</strong>}
              <span>{m.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

