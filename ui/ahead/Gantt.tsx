// AH-1: Ahead › Gantt (was Plan ahead, D653). One timeline: the last 2 weeks (planned against worked), weeks 1 to 4
// (hours per feature on the shared stepper, the same rows as Plan the week; immediate, outside the change set) and
// months to week 12 (free hours against features due, Crowded month). Bars grouped client › epic › feature from the
// change set over DevOps: solid where both dates are set, a dashed edge where one is missing (from the estimate), and
// a "No dates" group with Set dates. Dragging snaps to half-days with the dates shown live and goes into the change
// set; while it runs, rows keep their order and reloads wait (the drag bug's fix, D655). Readiness marks sit on bars,
// an amber edge where the work can't reach its target (D663), and a click opens Break down's side panel.
import type React from "react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AheadState, RoadmapRow, WeekLoadData } from "../../actions/types.ts";
import { aboutText, budgetWords, DEFAULT_FEATURE_MINUTES, hoursText, stepHours } from "../../plan/estimate.ts";
import { barDates, CROWDED_MINUTES_PER_FEATURE, monthLoad, NEXT_WORDS, pastWords, readiness, timelineScale, type AheadColumn, type MonthLoad, type NextStep, type ReadinessFlag, type Scale } from "../../plan/ahead.ts";
import { dayOf, dragHalves, edgeLabel, ganttBar, halfRight, halfX, halvesMoved, receive, release, shownOrder, type DragMode, type GanttBar, type Held, type HalfBar } from "../../plan/gantt.ts";
import { GAP_WORDS } from "../../plan/fixnext.ts";
import { reach, type Reach } from "../../plan/reach.ts";
import type { DraftStory } from "../../plan/types.ts";
import { call } from "../api.ts";
import { DraftEditorCtx } from "../DraftEditor.tsx";
import { MenuCtx } from "../Menus.tsx";
import { HoursStepper } from "../plan/Estimate.tsx";
import { WorkLink } from "../WorkLink.tsx";
import { useAhead } from "./Ahead.tsx";
import { Editor } from "./Grid.tsx";
import { OneChip, stateChip } from "./Chips.tsx";
import { isOpen, type Group, type Row } from "./model.ts";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const dayHalf = (p: { date: string; half: string }) => `${Temporal.PlainDate.from(p.date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${p.half}`;
const addDays = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();

type Bar = GanttBar & { row: Row; rm: RoadmapRow | null; target: string | null; ghostEnd: string | null };
type Line = { bar: Bar; depth: number; children: number; open: boolean };

/** The estimate for an item with one date or none: its features' span (an epic), else Roadmap's estimate. */
function estimateOf(r: Row, rm: RoadmapRow | null, kids: Bar[], ahead: AheadState): { start: string; end: string } | null {
  if (kids.length) return { start: kids.map((k) => k.start.date).sort()[0]!, end: kids.map((k) => k.end.date).sort().at(-1)! };
  if (!rm) return null;
  const weeks = ahead.cells.filter((x) => x.clientKey === r.clientKey && x.itemId === r.item.id && x.minutes > 0).map((x) => x.weekStart);
  const b = barDates({ hasStartField: r.has.start, startDate: null, targetDate: null, local: null, plannedWeeks: weeks, firstActivity: rm.firstActivity, forecastEnd: rm.status.forecastEnd, today: ahead.today });
  return { start: b.start, end: b.end };
}

export function Gantt({ data, groups: incoming, onChanged }: { data: WeekLoadData; groups: Group[]; onChanged: () => void }) {
  const a = useAhead();
  const [ahead, setAhead] = useState<AheadState | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(1200);
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

  const labelW = width >= 2400 ? 440 : width >= 1600 ? 320 : 240;
  const cols = ahead?.columns ?? [];
  const months = cols.filter((c) => c.kind === "month").length;
  const pastN = cols.filter((c) => c.kind === "past").length;
  const weekW = Math.max(90, Math.floor((width - labelW - 24) / (4 + 1.6 * months + 0.8 * pastN)));
  const scale = useMemo(() => (cols.length ? timelineScale(cols, { week: weekW, month: Math.floor(weekW * 1.6), past: Math.floor(weekW * 0.8) }) : null), [cols, weekW]);

  /** Whole hours; 0 takes the feature off that week (Plan the week's rows; immediate). */
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

  return (
    <div className="pa-box ah-gantt" ref={box}>
      {!ahead && <p className="muted">Reading the weeks ahead…</p>}
      {ahead && scale && (
        <div className="pa-grid" style={{ "--label-w": `${labelW}px`, "--tl-w": `${scale.width}px` } as CSSProperties} role="grid" aria-label="Gantt timeline" aria-rowcount={-1}>
          <HeaderRow cols={cols} scale={scale} />
          {held.shown.map((g) =>
            g.client.status === "ok" && g.rows.length ? (
              <ClientGroup key={g.client.clientKey} g={g} ahead={ahead} scale={scale} cols={cols} pastN={pastN} wide={labelW >= 440} nudges={data.guidance?.readinessNudges !== false} closed={closed} toggle={(k) => setClosed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} setHours={setHours} frozen={frozen?.get(g.client.clientKey) ?? null} begin={begin} end={end} onChanged={onChanged} />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function HeaderRow({ cols, scale }: { cols: AheadColumn[]; scale: Scale }) {
  const a = useAhead();
  const pastCount = cols.filter((c) => c.kind === "past").length;
  return (
    <div className="pa-row pa-head" role="row">
      <div className="pa-label" role="columnheader" aria-label="Feature or epic" />
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

type GroupProps = {
  g: Group;
  ahead: AheadState;
  scale: Scale;
  cols: AheadColumn[];
  pastN: number;
  wide: boolean;
  nudges: boolean;
  closed: Set<string>;
  toggle: (k: string) => void;
  setHours: (k: string, id: number, w: string, hours: number) => Promise<void>;
  /** The row order when a drag began (D655); null when nothing is dragged. */
  frozen: string[] | null;
  begin: (order: Map<string, string[]>) => void;
  end: () => void;
  onChanged: () => void;
};

function ClientGroup(p: GroupProps) {
  const a = useAhead();
  const { g, ahead, scale, cols } = p;
  const c = g.client;
  const cap = ahead.clients.find((x) => x.clientKey === c.clientKey);
  // Bars: features first (from their own dates or the estimate), then epics (their own, else their features' span).
  const bars = useMemo(() => {
    const out = new Map<number, Bar | null>();
    const mk = (r: Row, kids: Bar[]) => {
      const rm = a.roadmap.get(r.key) ?? null;
      const est = estimateOf(r, rm, kids, ahead);
      // An epic with no dates of its own spans its features, both edges dashed, so they stay nested under it.
      const b = ganttBar({ start: r.eff.start, target: r.eff.target, startHalf: r.startHalf, targetHalf: r.targetHalf, estimate: est }) ?? (kids.length && est ? { start: { date: est.start, half: "AM" as const }, end: { date: est.end, half: "PM" as const }, dashedStart: true, dashedEnd: true } : null);
      return b ? { ...b, row: r, rm, target: r.eff.target, ghostEnd: rm?.status.forecastEnd && r.eff.target && rm.status.forecastEnd > r.eff.target ? rm.status.forecastEnd : null } : null;
    };
    for (const r of g.rows.filter((x) => x.tier === "feature")) out.set(r.item.id, mk(r, []));
    for (const r of g.rows.filter((x) => x.tier === "epic")) out.set(r.item.id, mk(r, g.rows.filter((x) => x.item.parentId === r.item.id).map((x) => out.get(x.item.id)).filter((x): x is Bar => !!x)));
    return out;
  }, [g.rows, a.roadmap, ahead]);
  const loads = useMemo(() => monthLoads(g.rows, bars, cap, cols), [g.rows, bars, cap, cols]);
  const crowded = useMemo(() => new Set(loads.filter((m) => m.crowded).map((m) => m.month)), [loads]);
  // Rows: epics (their features under them, collapsible), then features with no epic shown, each by start date. The
  // order freezes while a drag runs (D655).
  const startOf = (r: Row) => bars.get(r.item.id)?.start.date ?? "9999";
  const byStart = (x: Row, y: Row) => startOf(x).localeCompare(startOf(y)) || x.item.title.localeCompare(y.item.title);
  const dated = g.rows.filter((r) => bars.get(r.item.id));
  const epics = dated.filter((r) => r.tier === "epic").sort(byStart);
  const top = dated.filter((r) => r.tier === "feature" && !epics.some((e) => e.item.id === r.item.parentId)).sort(byStart);
  const natural: Line[] = [];
  for (const e of epics) {
    const kids = dated.filter((r) => r.item.parentId === e.item.id && r.tier === "feature").sort(byStart);
    const open = !p.closed.has(e.key);
    natural.push({ bar: bars.get(e.item.id)!, depth: 0, children: kids.length, open });
    if (open) for (const k of kids) natural.push({ bar: bars.get(k.item.id)!, depth: 1, children: 0, open: false });
  }
  for (const f of top) natural.push({ bar: bars.get(f.item.id)!, depth: 0, children: 0, open: false });
  const order = shownOrder(p.frozen, natural.map((l) => l.bar.row.key));
  const byKey = new Map(natural.map((l) => [l.bar.row.key, l]));
  const lines = order.map((k) => byKey.get(k)!).filter(Boolean);
  const noDates = g.rows.filter((r) => r.tier !== "story" && !bars.get(r.item.id) && !r.context);
  const freeze = () => p.begin(new Map([[c.clientKey, lines.map((l) => l.bar.row.key)]]));
  // The hours lane (weeks 1 to 4): arrows between weeks and rows; dragging across empty weeks gives each 4h.
  const [focus, setFocus] = useState<{ id: number; week: number } | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const move = (id: number, week: number, dRow: number, dWeek: number) => {
    const i = lines.findIndex((l) => l.bar.row.item.id === id);
    const nr = lines[Math.max(0, Math.min(lines.length - 1, i + dRow))];
    const nw = Math.max(0, Math.min(3, week + dWeek));
    if (!nr) return;
    setFocus({ id: nr.bar.row.item.id, week: nw });
    cellRefs.current.get(`${nr.bar.row.item.id}:${nw}`)?.focus();
  };
  const paint = useRef<{ id: number; from: number; to: number } | null>(null);
  const [span, setSpan] = useState<{ id: number; from: number; to: number } | null>(null);
  useEffect(() => {
    const up = () => {
      const d = paint.current;
      paint.current = null;
      setSpan(null);
      if (!d || d.from === d.to) return;
      const [x, y] = d.from < d.to ? [d.from, d.to] : [d.to, d.from];
      void (async () => {
        for (let w = x; w <= y; w++) {
          const ws = ahead.weeks[w]!;
          const cur = ahead.cells.find((k) => k.clientKey === c.clientKey && k.itemId === d.id && k.weekStart === ws)?.minutes ?? 0;
          if (cur === 0) await p.setHours(c.clientKey, d.id, ws, DEFAULT_FEATURE_MINUTES / 60);
        }
      })();
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [ahead, c.clientKey, p]);
  const lane: Lane = { focus, setFocus, move, cellRefs: cellRefs.current, paint, span, setSpan };

  return (
    <section className="pa-client" style={{ "--c": a.color(c.clientKey) } as CSSProperties} aria-label={c.clientName} role="rowgroup">
      <div className="pa-row pa-client-head" role="row">
        <div className="pa-label" role="rowheader">
          <span className="dl-swatch" aria-hidden="true" />
          <strong>{c.clientName}</strong>
        </div>
        <div className="pa-track" role="presentation">
          {cols.map((col, i) => <span key={col.from} className={`pa-gridline ${col.kind}`} style={{ left: scale.colX(i) }} aria-hidden="true" />)}
        </div>
      </div>
      {lines.map((l, i) => (
        <BarRow key={l.bar.row.key} l={l} gp={p} rows={g.rows} crowded={crowded} first={i === 0} freeze={freeze} lane={lane} />
      ))}
      <CapacityRow name={c.clientName} clientKey={c.clientKey} cap={cap} cols={cols} scale={scale} loads={loads} ahead={ahead} />
      {noDates.length > 0 && <NoDates rows={noDates} />}
    </section>
  );
}

/** Items with neither date: a list under the client with Set dates (D653). */
function NoDates({ rows }: { rows: Row[] }) {
  const a = useAhead();
  const [open, setOpen] = useState<{ key: string; field: "start" | "target" } | null>(null);
  return (
    <div className="ah-nodates" role="row">
      <h4 className="muted">No dates · {rows.length}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className={r.editable ? "" : "ro"} title={r.editable ? undefined : a.load.clients.find((c) => c.clientKey === r.clientKey)?.note}>
            <span className="ah-type muted">{r.item.type}</span> {r.item.title} <span className="muted">#{r.item.id}</span>
            {open?.key === r.key ? (
              <Editor r={r} field={open.field} done={() => setOpen(open.field === "start" && r.has.target ? { key: r.key, field: "target" } : null)} />
            ) : r.editable && !a.readOnly && (r.has.start || r.has.target) ? (
              <button type="button" className="mini" onClick={() => setOpen({ key: r.key, field: r.has.start ? "start" : "target" })}>
                Set dates
              </button>
            ) : !r.has.start && !r.has.target ? (
              <span className="muted"> · dates aren't in this process</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Lane = {
  focus: { id: number; week: number } | null;
  setFocus: (f: { id: number; week: number }) => void;
  move: (id: number, week: number, dRow: number, dWeek: number) => void;
  cellRefs: Map<string, HTMLElement>;
  paint: React.MutableRefObject<{ id: number; from: number; to: number } | null>;
  span: { id: number; from: number; to: number } | null;
  setSpan: (s: { id: number; from: number; to: number } | null) => void;
};

function BarRow({ l, gp, rows, crowded, first, freeze, lane }: { l: Line; gp: GroupProps; rows: Row[]; crowded: ReadonlySet<string>; first: boolean; freeze: () => void; lane: Lane }) {
  const a = useAhead();
  const { bar: b } = l;
  const { ahead, scale } = gp;
  const r = b.row;
  const c = gp.g.client;
  const rm = b.rm;
  const { env, open: openMenu } = useContext(MenuCtx);
  const openDraft = useContext(DraftEditorCtx);
  const [live, setLive] = useState<HalfBar | null>(null);
  const shown: HalfBar = live ?? b;
  const x0 = halfX(scale, shown.start), x1 = halfRight(scale, shown.end);
  const cap = ahead.clients.find((x) => x.clientKey === c.clientKey);
  const isFeature = r.tier === "feature";
  const kids = rows.filter((x) => x.item.parentId === r.item.id).map((x) => x.item.id);
  const cellOf = (w: string) => (isFeature ? ahead.cells.find((x) => x.clientKey === c.clientKey && x.itemId === r.item.id && x.weekStart === w) : null);
  const epicBlocks = (w: string) => ahead.cells.filter((x) => x.clientKey === c.clientKey && kids.includes(x.itemId) && x.weekStart === w).reduce((n, x) => n + x.minutes, 0);
  const canDrag = r.editable && !a.readOnly && (r.has.start || r.has.target);
  const flags = !gp.nudges || !rm ? [] : readiness({
    tier: isFeature ? "feature" : "epic", state: rm.status.state, owned: r.mine, stories: rm.done + rm.open, start: b.start.date, target: r.eff.target, today: ahead.today, weeks: ahead.weeks,
    plannedWeeks: isFeature ? ahead.cells.filter((x) => x.clientKey === c.clientKey && x.itemId === r.item.id && x.minutes > 0).map((x) => x.weekStart) : [],
    crowdedMonths: crowded, cols: gp.cols, needsStories: isFeature && ahead.cells.some((x) => x.clientKey === c.clientKey && x.itemId === r.item.id && x.minutes > 0 && !x.derived),
  });
  // D663: can the open stories under a feature reach its target in the blocks FocusTime knows (mine only)?
  const can: Reach = isFeature
    ? reach({ target: r.eff.target, today: ahead.today, me: c.me, stories: rows.filter((x) => x.item.parentId === r.item.id && x.tier === "story").map((x) => ({ assigneeEmail: x.eff.assignee?.email ?? null, assigneeName: x.eff.assignee?.name ?? null, minutes: c.hints[x.item.id]?.minutes ?? null })), weeks: cap?.weeks ?? [], months: cap?.months.map((m) => { const col = gp.cols.find((k) => k.kind === "month" && k.month === m.month); return { from: col?.from ?? ahead.today, to: col?.to ?? ahead.today, available: m.available }; }) ?? [] })
    : { kind: "none" };
  const runNext = async (f: ReadinessFlag, n: NextStep) => {
    try {
      if (n === "brief" || n === "breakdown") a.breakDown(r);
      else if (n === "draft_feature") {
        const res = await call<{ draft: DraftStory }>("draft.add_feature", { clientKey: c.clientKey, parentItemId: r.item.id, title: `New feature for ${r.item.title}` });
        gp.onChanged();
        if (openDraft) openDraft(res.draft);
      } else if (n === "ask_owner") {
        const who = r.eff.assignee && !r.mine ? r.eff.assignee.name : null;
        await call("followup.add", { clientKey: c.clientKey, itemId: r.item.id, what: `Ask about ${r.item.title}: ${f.text.toLowerCase()}`, channel: "teams", ...(who ? { who } : {}) });
        gp.onChanged();
      } else if (n === "help") env?.openHelp({ clientKey: c.clientKey, title: `#${r.item.id} ${r.item.title}`, url: r.item.url, itemId: r.item.id, pinned: null });
    } catch (e) {
      a.error(e instanceof Error ? e.message : "That didn't work");
    }
  };
  const showFlags = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: rect.left, y: rect.bottom + 4 }, {
      title: `${r.item.title}: ready?`,
      items: flags.flatMap((f) => f.next.filter((n) => n !== "plan_weeks" && n !== "set_target").map((n) => ({ id: `${f.kind}:${n}`, label: `${f.text}: ${NEXT_WORDS[n]}`, run: () => void runNext(f, n) }))),
    });
  };

  /** Drag in half-days (D659): the bar, or one edge; dates show live; on drop the changes are staged. A click opens Break down. */
  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
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
        if (canDrag) gp.end();
        if (r.tier !== "story") a.breakDown(r);
        return;
      }
      const next = dragHalves(base, mode, n);
      void (async () => {
        if (r.has.start && (mode !== "end" || b.dashedStart) && (next.start.date !== base.start.date || next.start.half !== base.start.half || b.dashedStart)) await a.stage(r, "start", dayOf(next.start), next.start.half);
        if (r.has.target && (mode !== "start" || b.dashedEnd) && (next.end.date !== base.end.date || next.end.half !== base.end.half || b.dashedEnd)) await a.stage(r, "target", dayOf(next.end), next.end.half);
        setLive(null);
        gp.end();
      })();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const endsLate = shown.end.date >= scale.to;
  const endedBefore = shown.end.date < scale.from;
  const startsEarly = shown.start.date < scale.from;
  const pending = !!(r.pending.start || r.pending.target);
  const label = `${r.item.title}: ${b.dashedStart ? "start estimated, " : ""}${b.dashedEnd ? "end estimated, " : ""}${dayHalf(shown.start)} to ${dayHalf(shown.end)}${b.target ? `, target ${monthDay(b.target)}` : ""}${b.ghostEnd ? `, the pace says ${monthDay(b.ghostEnd)}` : ""}${can.kind === "short" ? ". Can't reach target in the blocks known" : ""}${r.editable ? "" : `. ${c.note}`}`;
  const marks = [...flags.map((f) => f.text), ...r.gaps.map((k) => GAP_WORDS[k])];
  return (
    <div className={`pa-row pa-item depth-${l.depth} ${r.tier}${rm ? ` st-${rm.status.state}` : ""}${r.context ? " context" : ""}`} role="row">
      <div className="pa-label" role="rowheader">
        {l.children > 0 ? (
          <button type="button" className="rm-expand" aria-expanded={l.open} aria-label={`${l.open ? "Hide" : "Show"} the features of ${r.item.title}`} onClick={() => gp.toggle(r.key)}>
            {l.open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="rm-expand-space" aria-hidden="true" />
        )}
        {rm && isOpen(r.item) && (
          <span className="pa-badge">
            <OneChip c={stateChip(rm.status.state, rm.status.reason)} />
          </span>
        )}
        <span className="pa-title" title={`${r.item.title} (#${r.item.id})${rm ? `: ${rm.status.reason}` : ""}`}>
          <WorkLink clientKey={c.clientKey} url={r.item.url}>{r.item.title}</WorkLink>
        </span>
        {flags.length > 0 && (
          <button type="button" className="pa-flags" onClick={showFlags} aria-label={`${r.item.title}: ${plural(flags.length, "thing", "things")} to get ready: ${flags.map((f) => f.text).join("; ")}`} title={flags.map((f) => f.text).join("\n")}>
            <span aria-hidden="true">⚑</span> {gp.wide && flags.length === 1 ? flags[0]!.text : flags.length}
          </button>
        )}
        {can.kind === "unknown" && <span className="muted ah-reach-unknown" title={can.text}>{gp.wide ? can.text : "Can't check"}</span>}
        {!r.editable && <span className="ah-ro" title={c.note}>Read only</span>}
      </div>
      <div className="pa-track" role="presentation">
        {gp.cols.map((col, i) => <span key={col.from} className={`pa-gridline ${col.kind}`} style={{ left: scale.colX(i) }} aria-hidden="true" />)}
        {endedBefore ? (
          <span className="pa-before" title={label}>{edgeLabel("before", shown.end.date, { estimated: b.dashedEnd, today: ahead.today })}</span>
        ) : (
          <div
            className={`pa-bar ah-bar${!b.dashedStart && !b.dashedEnd && !live ? " solid" : " est"}${b.dashedStart ? " dash-start" : ""}${b.dashedEnd ? " dash-end" : ""}${pending || live ? " changed" : ""}${startsEarly ? " early" : ""}${endsLate ? " late" : ""}${can.kind === "short" ? " short" : ""}${canDrag ? "" : " fixed"}`}
            style={{ left: x0, width: Math.max(6, x1 - x0) }}
            title={label}
            aria-label={label}
            role="button"
            tabIndex={-1}
            onPointerDown={startDrag("move")}
          >
            {canDrag && <span className="pa-handle start" onPointerDown={startDrag("start")} aria-hidden="true" />}
            {marks.length > 0 && x1 - x0 >= 28 && <span className="ah-marks" title={marks.join("\n")} aria-hidden="true">⚑{marks.length}</span>}
            {can.kind === "short" && x1 - x0 >= 120 && <span className="ah-short">Can't reach target</span>}
            {canDrag && <span className="pa-handle end" onPointerDown={startDrag("end")} aria-hidden="true" />}
          </div>
        )}
        {live && (
          <span className="ah-live" style={{ left: Math.max(0, x0), top: 0 }} role="status">
            {dayHalf(live.start)} → {dayHalf(live.end)}
          </span>
        )}
        {b.ghostEnd && b.target && <span className="pa-ghost" style={{ left: scale.x(addDays(b.target, 1)), width: Math.max(4, scale.x(addDays(b.ghostEnd, 1)) - scale.x(addDays(b.target, 1))) }} title={`At the pace stories close, about ${monthDay(b.ghostEnd)}: after the target date`} aria-hidden="true" />}
        {b.target && b.target >= scale.from && b.target < scale.to && <span className="pa-diamond" style={{ left: scale.x(b.target) + (scale.x(addDays(b.target, 1)) - scale.x(b.target)) / 2 }} title={`Target ${monthDay(b.target)}`} aria-hidden="true" />}
        {endsLate && <span className="pa-beyond" title={`Ends ${b.dashedEnd ? "about " : ""}${monthDay(shown.end.date)}, after these 12 weeks`}>{edgeLabel("after", shown.end.date, { estimated: b.dashedEnd, today: ahead.today })}</span>}
        {ahead.past.map((p, j) => {
          const ids = new Set([r.item.id, ...rows.filter((x) => x.item.parentId === r.item.id || (!isFeature && kids.includes(x.item.parentId ?? -1))).map((x) => x.item.id)]);
          const planned = p.planned.filter((x) => x.clientKey === c.clientKey && (x.itemId === r.item.id || (!isFeature && kids.includes(x.itemId)))).reduce((n, x) => n + x.minutes, 0);
          const minutes = p.worked.filter((x) => x.clientKey === c.clientKey && x.itemId !== null && ids.has(x.itemId)).reduce((n, x) => n + x.minutes, 0);
          const words = pastWords(planned, minutes);
          if (!words) return null;
          return (
            <span key={p.weekStart} className="pa-past" style={{ left: scale.colX(j) + 2, width: scale.colW(j) - 4 }} title={`Week of ${monthDay(p.weekStart)}${p.committed ? "" : " (not confirmed)"}: ${words}`}>
              <PastWords words={words} />
            </span>
          );
        })}
        {ahead.weeks.slice(0, 4).map((w, i) => {
          const cell = cellOf(w);
          const derived = !!cell?.derived;
          const n = isFeature ? (cell?.minutes ?? 0) : epicBlocks(w);
          const free = cap?.weeks[i]?.freeMinutes ?? 0;
          const words = n ? (isFeature && cell?.exact ? hoursText(n) : aboutText(n)) : "nothing";
          const style = { left: scale.colX(i + gp.pastN) + 2, width: scale.colW(i + gp.pastN) - 4 };
          const focused = lane.focus?.id === r.item.id && lane.focus.week === i;
          const ref = (el: HTMLElement | null) => void (el ? lane.cellRefs.set(`${r.item.id}:${i}`, el) : lane.cellRefs.delete(`${r.item.id}:${i}`));
          const arrows = (e: React.KeyboardEvent) => {
            if (e.key === "ArrowRight") lane.move(r.item.id, i, 0, 1);
            else if (e.key === "ArrowLeft") lane.move(r.item.id, i, 0, -1);
            else if (e.key === "ArrowDown") lane.move(r.item.id, i, 1, 0);
            else if (e.key === "ArrowUp") lane.move(r.item.id, i, -1, 0);
            else return false;
            return true;
          };
          const tab = focused || (!lane.focus && first && i === 0) ? 0 : -1;
          if (!isFeature || a.readOnly)
            return (
              <span
                key={w}
                role="gridcell"
                ref={ref}
                tabIndex={tab}
                className="pa-cell epic"
                style={style}
                aria-label={`${r.item.title}, week of ${monthDay(w)}: ${isFeature ? "" : "its features take "}${words}.${l.children ? ` Enter to ${l.open ? "hide" : "show"} its features.` : ""}`}
                title={`${isFeature ? "" : "Its features: "}${words} in the week of ${monthDay(w)}`}
                onFocus={() => lane.setFocus({ id: r.item.id, week: i })}
                onKeyDown={(e) => {
                  if (arrows(e) || (e.key === "Enter" && l.children && (gp.toggle(r.key), true))) (e.preventDefault(), e.stopPropagation());
                }}
              >
                {n > 0 && <span className="pa-hours">{aboutText(n)}</span>}
              </span>
            );
          const hours = Math.round(n / 60);
          const set = (h: number) => void gp.setHours(c.clientKey, r.item.id, w, h);
          const inSpan = lane.span && lane.span.id === r.item.id && i >= Math.min(lane.span.from, lane.span.to) && i <= Math.max(lane.span.from, lane.span.to);
          return (
            <span
              key={w}
              role="gridcell"
              ref={ref}
              tabIndex={tab}
              className={`pa-cell${n ? " set" : ""}${cell?.tier === "nice" ? " nice" : ""}${inSpan ? " span" : ""}${derived ? " derived" : ""}`}
              style={style}
              aria-label={`${r.item.title}, week of ${monthDay(w)}: ${words}${derived ? " from its stories" : ""}${cell?.tier === "nice" ? " (nice to have)" : ""}. ${hoursText(free)} free that week.${n || derived ? "" : " Enter to plan it here."}`}
              title={`${n ? words : "Nothing"} in the week of ${monthDay(w)}${derived ? ", from its stories (size them in Plan the week)" : n ? "" : ". Click to plan it here (4h)"}${cell?.tier === "nice" ? " (nice to have)" : ""}`}
              aria-disabled={derived || undefined}
              onFocus={() => lane.setFocus({ id: r.item.id, week: i })}
              onPointerDown={(e) => {
                if (e.button !== 0 || derived || n) return;
                lane.paint.current = { id: r.item.id, from: i, to: i };
              }}
              onPointerEnter={() => {
                if (lane.paint.current?.id === r.item.id) {
                  lane.paint.current.to = i;
                  lane.setSpan({ ...lane.paint.current });
                }
              }}
              onClick={() => !derived && !n && !lane.paint.current && set(DEFAULT_FEATURE_MINUTES / 60)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (arrows(e)) void 0;
                else if (!derived && !n && e.key === "Enter") set(DEFAULT_FEATURE_MINUTES / 60);
                else if (!derived && n && (e.key === "Delete" || e.key === "Backspace")) set(0);
                else if (!derived && (e.key === "+" || e.key === "=")) set(n ? stepHours(hours, 1) : DEFAULT_FEATURE_MINUTES / 60);
                else if (!derived && n && (e.key === "-" || e.key === "−")) set(hours <= 1 ? 0 : stepHours(hours, -1));
                else return;
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {n > 0 && <HoursStepper className="pa-stepper" label={`${r.item.title}, week of ${monthDay(w)}`} minutes={n} derived={derived} about={!cell?.exact} tabIndex={-1} onSet={set} onClear={() => set(0)} />}
            </span>
          );
        })}
      </div>
    </div>
  );
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
