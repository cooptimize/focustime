// Roadmap › Plan ahead (step 17, slice 2): one timeline, weekly columns for weeks 1 to 4 and a column per month for
// weeks 5 to 12, with a today line. Rows by client; epics as parent bars with their features nested (collapsible).
// Bars from DevOps Start Date and Target Date where the process has them (solid), otherwise estimated (hatched, "est.");
// the target as a diamond, a ghost past it when the pace forecast overshoots. Weeks 1 to 4: whole blocks per feature per
// week, the same rows Plan the week edits. Dragging a bar keeps its dates locally; "Save dates to DevOps" writes them
// through the DevOps write flow (preview, rev test, read back, undo). Whole numbers only.
import type React from "react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AheadState, RoadmapClient, RoadmapRow, RoadmapState, WeekLoadData } from "../actions/types.ts";
import { barDates, cellChoices, dragBar, monthLoad, NEXT_WORDS, pastWords, readiness, stepCell, timelineScale, type AheadColumn, type BarDates, type DragMode, type MonthLoad, type NextStep, type ReadinessFlag, type Scale } from "../plan/ahead.ts";
import type { DraftStory } from "../plan/types.ts";
import { DraftEditorCtx } from "./DraftEditor.tsx";
import { copy } from "./FollowUps.tsx";
import { STATE_WORDS } from "../plan/roadmap.ts";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { MenuCtx } from "./Menus.tsx";
import { ModeArea } from "./ModeSwitch.tsx";
import { StateBadge } from "./Roadmap.tsx";
import { WorkLink } from "./WorkLink.tsx";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const addDays = (d: string, n: number) => Temporal.PlainDate.from(d).add({ days: n }).toString();
const daysBetween = (a: string, b: string) => Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: "days" }).days;
const key = (k: string, id: number) => `${k}:${id}`;

type Bar = BarDates & { row: RoadmapRow; clientKey: string };
type Line = { kind: "row"; bar: Bar; depth: number; children: number; open: boolean };

/** Bars for every row of a client: features first (from their own dates and planned weeks), then epics (their own dates, else their features' span). */
function barsFor(c: RoadmapClient, ahead: AheadState): Map<number, Bar> {
  const out = new Map<number, Bar>();
  const weeksOf = (id: number) => ahead.cells.filter((x) => x.clientKey === c.clientKey && x.itemId === id && x.blocks > 0).map((x) => x.weekStart);
  for (const r of c.rows.filter((x) => x.tier === "feature"))
    out.set(r.id, { ...barDates({ hasStartField: r.hasStartField, startDate: r.startDate, targetDate: r.targetDate, local: ahead.dates[key(c.clientKey, r.id)] ?? null, plannedWeeks: weeksOf(r.id), firstActivity: r.firstActivity, forecastEnd: r.status.forecastEnd, today: ahead.today }), row: r, clientKey: c.clientKey });
  for (const e of c.rows.filter((x) => x.tier === "epic")) {
    const kids = c.rows.filter((x) => x.parentId === e.id).map((x) => out.get(x.id)!).filter(Boolean);
    const b = barDates({ hasStartField: e.hasStartField, startDate: e.startDate, targetDate: e.targetDate, local: ahead.dates[key(c.clientKey, e.id)] ?? null, plannedWeeks: [], firstActivity: e.firstActivity, forecastEnd: e.status.forecastEnd, today: ahead.today });
    if (kids.length && b.startFrom !== "devops" && b.startFrom !== "local") b.start = kids.map((k) => k.start).sort()[0]!;
    if (kids.length && b.endFrom !== "devops" && b.endFrom !== "local") b.end = kids.map((k) => k.end).sort().at(-1)!;
    if (b.end < b.start) b.end = b.start;
    out.set(e.id, { ...b, row: e, clientKey: c.clientKey });
  }
  return out;
}

export function PlanAhead({ data, switcher, onDone, onChanged }: { data: WeekLoadData; switcher?: React.ReactNode; onDone: () => void; onChanged: () => void }) {
  const [rm, setRm] = useState<RoadmapState | null>(null);
  const [ahead, setAhead] = useState<AheadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(1200);
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const dw = useDevOpsWrite();

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const [r, a] = await Promise.all([call<RoadmapState>("roadmap.load", refresh ? { refresh: true } : {}), call<AheadState>("roadmap.ahead", refresh ? { refresh: true } : {})]);
      setRm(r);
      setAhead(a);
      setError(null);
      // Dragged dates that DevOps now has (saved) are dropped: DevOps is the source again.
      for (const c of r.clients)
        for (const row of c.rows) {
          const local = a.dates[key(c.clientKey, row.id)];
          if (local && row.targetDate === local.end && (!row.hasStartField || row.startDate === local.start)) void call("roadmap.set_dates", { clientKey: c.clientKey, itemId: row.id, start: null, end: null });
        }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Plan ahead");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(), [load, dw?.version]);
  useEffect(() => head.current?.focus(), []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [rm, ahead]);

  const labelW = width >= 2400 ? 440 : width >= 1600 ? 320 : 240;
  const cols = ahead?.columns ?? [];
  const months = cols.filter((c) => c.kind === "month").length;
  const pastN = cols.filter((c) => c.kind === "past").length;
  // Weeks 1 to 4 get room for their cells; each month (four or five weeks) is compressed to 1.6 weeks' width; the two
  // past weeks take 0.8 each (planned against worked, read only).
  const weekW = Math.max(90, Math.floor((width - labelW - 24) / (4 + 1.6 * months + 0.8 * pastN)));
  const scale = useMemo(() => (cols.length ? timelineScale(cols, { week: weekW, month: Math.floor(weekW * 1.6), past: Math.floor(weekW * 0.8) }) : null), [cols, weekW]);

  const setBlocks = useCallback(
    async (clientKey: string, itemId: number, weekStart: string, blocks: number) => {
      try {
        await call("weekplan.set_feature", { weekStart, clientKey, itemId, blocks });
        onChanged();
        const a = await call<AheadState>("roadmap.ahead", {});
        setAhead(a);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change the blocks");
      }
    },
    [onChanged],
  );
  const setDates = useCallback(async (clientKey: string, itemId: number, d: { start: string; end: string } | null) => {
    try {
      await call("roadmap.set_dates", { clientKey, itemId, start: d?.start ?? null, end: d?.end ?? null });
      setAhead(await call<AheadState>("roadmap.ahead", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not keep those dates");
    }
  }, []);
  const save = (b: Bar) => {
    if (!dw) return;
    if (!dw.can(b.clientKey)) return dw.enable(b.clientKey);
    void dw.begin(b.clientKey, [{ kind: "target_date", itemId: b.row.id, date: b.end, ...(b.row.hasStartField ? { startDate: b.start } : {}) }]);
  };

  const clients = (rm?.clients ?? []).filter((c) => c.status === "ok" && c.rows.length);
  return (
    <main className="roadmap plan-ahead" aria-label="Plan ahead">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Plan ahead <span className="muted">{ahead ? `${monthDay(ahead.weeks[0]!)} to ${monthDay(addDays(ahead.weeks.at(-1)!, 6))}` : ""}</span>
        </h2>
        <button type="button" className="top-btn" disabled={busy} onClick={() => void load(true)} title="Read DevOps and calendars again">
          {busy ? "Reading…" : "Refresh"}
        </button>
        <ModeArea done={{ onClick: onDone, title: "Back to the Roadmap" }}>{switcher}</ModeArea>
      </div>
      <p className="muted follow-ups-note">
        Weeks 1 to 4: click a week to set its blocks (whole blocks, up to the client's budget), or drag across weeks to give each 1. They are the same blocks as Plan the week. After week 4, months. Drag a bar or its ends to estimate dates; "Save dates" writes them to DevOps after a preview.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {(!rm || !ahead) && !error && <p className="muted">Reading DevOps and calendars…</p>}
      <div className="pa-box" ref={box}>
        {rm && ahead && scale && (
          <div className="pa-grid" style={{ "--label-w": `${labelW}px`, "--tl-w": `${scale.width}px` } as CSSProperties} role="grid" aria-label="Plan ahead timeline" aria-rowcount={-1}>
            <HeaderRow cols={cols} scale={scale} today={ahead.today} />
            {clients.length === 0 && <p className="muted">Nothing of yours in DevOps for the followed clients.</p>}
            {clients.map((c) => (
              <ClientGroup key={c.clientKey} c={c} ahead={ahead} scale={scale} cols={cols} pastN={pastN} wide={labelW >= 440} color={clientColor(c.clientKey, data.clients)} closed={closed} toggle={(id) => setClosed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} setBlocks={setBlocks} setDates={setDates} save={save} canWrite={!!dw?.can(c.clientKey)} onNotice={setNotice} onError={setError} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function HeaderRow({ cols, scale, today }: { cols: AheadColumn[]; scale: Scale; today: string }) {
  return (
    <div className="pa-row pa-head" role="row">
      <div className="pa-label" role="columnheader">Feature or epic</div>
      <div className="pa-track" role="presentation">
        {cols.map((c, i) => (
          <div key={c.from} className={`pa-col ${c.kind}`} role="columnheader" style={{ left: scale.colX(i), width: scale.colW(i) }} title={c.kind === "week" ? `Week ${c.index}: ${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}` : c.kind === "past" ? `${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}: planned against focused time` : `${c.label}: ${plural(c.weeks.length, "week", "weeks")}, ${monthDay(c.from)} to ${monthDay(addDays(c.to, -1))}`}>
            <span className="pa-col-main">{c.label}</span>
            <span className="pa-col-sub">{c.kind === "week" ? `Week ${c.index}` : c.kind === "past" ? (i === pastCount(cols) - 1 ? "Last week" : "2 weeks ago") : plural(c.weeks.length, "week", "weeks")}</span>
          </div>
        ))}
        <span className="pa-today" style={{ left: scale.x(today) }} aria-hidden="true" />
      </div>
    </div>
  );
}

const pastCount = (cols: readonly AheadColumn[]) => cols.filter((c) => c.kind === "past").length;

type GroupProps = {
  pastN: number;
  /** A wide label column (3840): a single flag shows its words. */
  wide: boolean;
  onError: (s: string) => void;
  onChanged: () => void;
  c: RoadmapClient;
  ahead: AheadState;
  scale: Scale;
  cols: AheadColumn[];
  color: string;
  closed: Set<string>;
  toggle: (id: string) => void;
  setBlocks: (k: string, id: number, w: string, n: number) => Promise<void>;
  setDates: (k: string, id: number, d: { start: string; end: string } | null) => Promise<void>;
  save: (b: Bar) => void;
  canWrite: boolean;
  onNotice: (s: string) => void;
};

function ClientGroup(p: GroupProps) {
  const { c, ahead, scale, cols } = p;
  const bars = useMemo(() => barsFor(c, ahead), [c, ahead]);
  const cap = ahead.clients.find((x) => x.clientKey === c.clientKey);
  const loads = useMemo(() => monthLoads(c, cap, cols, bars), [c, cap, cols, bars]);
  const crowded = useMemo(() => new Set(loads.filter((m) => m.crowded).map((m) => m.month)), [loads]);
  // Epics first (their features under them), then features with no epic listed, each by start date.
  const byStart = (a: RoadmapRow, b: RoadmapRow) => (bars.get(a.id)!.start).localeCompare(bars.get(b.id)!.start) || a.title.localeCompare(b.title);
  const epics = c.rows.filter((r) => r.tier === "epic").sort(byStart);
  const top = c.rows.filter((r) => r.tier === "feature" && (r.parentId === null || !c.rows.some((e) => e.id === r.parentId))).sort(byStart);
  const lines: Line[] = [];
  for (const e of epics) {
    const kids = c.rows.filter((r) => r.parentId === e.id).sort(byStart);
    const open = !p.closed.has(key(c.clientKey, e.id));
    lines.push({ kind: "row", bar: bars.get(e.id)!, depth: 0, children: kids.length, open });
    if (open) for (const k of kids) lines.push({ kind: "row", bar: bars.get(k.id)!, depth: 1, children: 0, open: false });
  }
  for (const f of top) lines.push({ kind: "row", bar: bars.get(f.id)!, depth: 0, children: 0, open: false });
  // Every row takes keyboard focus: features to set blocks, epics to expand or collapse (Enter).
  const editable = lines;
  const [focus, setFocus] = useState<{ id: number; week: number } | null>(null);
  const cellRefs = useRef(new Map<string, HTMLElement>());
  const move = (id: number, week: number, dRow: number, dWeek: number) => {
    const i = editable.findIndex((l) => l.bar.row.id === id);
    const nr = editable[Math.max(0, Math.min(editable.length - 1, i + dRow))];
    const nw = Math.max(0, Math.min(3, week + dWeek));
    if (!nr) return;
    setFocus({ id: nr.bar.row.id, week: nw });
    cellRefs.current.get(`${nr.bar.row.id}:${nw}`)?.focus();
  };
  // Drag across week cells: each week from the first to the last gets 1 block (weeks already planned keep theirs).
  const drag = useRef<{ id: number; from: number; to: number } | null>(null);
  const [dragSpan, setDragSpan] = useState<{ id: number; from: number; to: number } | null>(null);
  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      setDragSpan(null);
      if (!d || d.from === d.to) return;
      const [a, b] = d.from < d.to ? [d.from, d.to] : [d.to, d.from];
      void (async () => {
        for (let w = a; w <= b; w++) {
          const ws = ahead.weeks[w]!;
          const cur = ahead.cells.find((x) => x.clientKey === c.clientKey && x.itemId === d.id && x.weekStart === ws)?.blocks ?? 0;
          if (cur === 0) await p.setBlocks(c.clientKey, d.id, ws, 1);
        }
      })();
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [ahead, c.clientKey, p]);

  return (
    <section className="pa-client" style={{ "--c": p.color } as CSSProperties} aria-label={c.clientName} role="rowgroup">
      <div className="pa-row pa-client-head" role="row">
        <div className="pa-label" role="rowheader">
          <span className="dl-swatch" aria-hidden="true" />
          <strong>{c.clientName}</strong>
        </div>
        <div className="pa-track" role="presentation">
          {cols.map((col, i) => <span key={col.from} className={`pa-gridline ${col.kind}`} style={{ left: scale.colX(i) }} aria-hidden="true" />)}
        </div>
      </div>
      {lines.map((l) => (
        <BarRow key={l.bar.row.id} l={l} g={p} crowded={crowded} first={editable[0]?.bar.row.id === l.bar.row.id} focus={focus} setFocus={setFocus} move={move} cellRefs={cellRefs.current} drag={drag} dragSpan={dragSpan} setDragSpan={setDragSpan} />
      ))}
      <CapacityRow c={c} cap={cap} cols={cols} scale={scale} loads={loads} ahead={ahead} />
    </section>
  );
}

function BarRow({ l, g, crowded, first, focus, setFocus, move, cellRefs, drag, dragSpan, setDragSpan }: { l: Line; g: GroupProps; crowded: ReadonlySet<string>; first: boolean; focus: { id: number; week: number } | null; setFocus: (f: { id: number; week: number }) => void; move: (id: number, week: number, dRow: number, dWeek: number) => void; cellRefs: Map<string, HTMLElement>; drag: React.MutableRefObject<{ id: number; from: number; to: number } | null>; dragSpan: { id: number; from: number; to: number } | null; setDragSpan: (s: { id: number; from: number; to: number } | null) => void }) {
  const { bar: b } = l;
  const { c, ahead, scale } = g;
  const r = b.row;
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const [live, setLive] = useState<{ start: string; end: string } | null>(null);
  const shown = live ?? { start: b.start, end: b.end };
  const x0 = scale.x(shown.start), x1 = scale.x(addDays(shown.end, 1));
  const cap = ahead.clients.find((x) => x.clientKey === c.clientKey);
  const isFeature = r.tier === "feature";
  const kids = c.rows.filter((x) => x.parentId === r.id).map((x) => x.id);
  const cellOf = (w: string) => (isFeature ? ahead.cells.find((x) => x.clientKey === c.clientKey && x.itemId === r.id && x.weekStart === w) : null);
  const epicBlocks = (w: string) => ahead.cells.filter((x) => x.clientKey === c.clientKey && kids.includes(x.itemId) && x.weekStart === w).reduce((n, x) => n + x.blocks, 0);
  const owned = r.relation === "owned";
  const openDraft = useContext(DraftEditorCtx);
  const flags = readiness({
    tier: r.tier, state: r.status.state, owned, stories: r.done + r.open, start: b.start, target: r.targetDate, today: ahead.today, weeks: ahead.weeks,
    plannedWeeks: isFeature ? ahead.cells.filter((x) => x.clientKey === c.clientKey && x.itemId === r.id && x.blocks > 0).map((x) => x.weekStart) : [],
    crowdedMonths: crowded, cols: g.cols, needsStories: isFeature && ahead.cells.some((x) => x.clientKey === c.clientKey && x.itemId === r.id && x.blocks > 0 && x.fill === "needs_stories"),
  });
  const runNext = async (f: ReadinessFlag, n: NextStep) => {
    try {
      if (n === "brief") {
        const res = await call<{ markdown: string }>("feature.brief", { clientKey: c.clientKey, itemId: r.id });
        g.onNotice((await copy(res.markdown, null)) ? `Coop brief for #${r.id} copied` : "Copy didn't work: open the Roadmap row's ⋯ to copy the brief");
      } else if (n === "breakdown") {
        const res = await call<{ draft: DraftStory }>("draft.add_story", { clientKey: c.clientKey, parentItemId: r.id, title: `First story for ${r.title}` });
        g.onChanged();
        if (openDraft) openDraft(res.draft);
        else g.onNotice(`A draft story is under ${r.title}`);
      } else if (n === "draft_feature") {
        const res = await call<{ draft: DraftStory }>("draft.add_feature", { clientKey: c.clientKey, parentItemId: r.id, title: `New feature for ${r.title}` });
        g.onChanged();
        if (openDraft) openDraft(res.draft);
        else g.onNotice(`A draft feature is under ${r.title}`);
      } else if (n === "set_target") {
        if (!dw) return;
        if (!dw.can(c.clientKey)) dw.enable(c.clientKey);
        else dw.targetDate({ clientKey: c.clientKey, itemId: r.id, title: r.title, current: r.targetDate });
      } else if (n === "ask_owner") {
        const who = r.owner && r.owner !== "You" ? r.owner : (r.people.find((x) => x.name !== "You")?.name ?? null);
        await call("followup.add", { clientKey: c.clientKey, itemId: r.id, what: `Ask about ${r.title}: ${f.text.toLowerCase()}`, channel: "teams", ...(who ? { who } : {}) });
        g.onChanged();
        g.onNotice(`Follow-up added${who ? ` for ${who}` : ""}: ask about ${r.title}`);
      } else if (n === "help") {
        env?.openHelp({ clientKey: c.clientKey, title: `#${r.id} ${r.title}`, url: r.url, itemId: r.id, pinned: null });
      } else if (n === "plan_weeks") {
        const i = ahead.weeks.slice(0, 4).findIndex((w) => !(ahead.cells.find((x) => x.clientKey === c.clientKey && x.itemId === r.id && x.weekStart === w)?.blocks));
        cellRefs.get(`${r.id}:${Math.max(0, i)}`)?.focus();
      }
    } catch (e) {
      g.onError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  const showFlags = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: rect.left, y: rect.bottom + 4 }, {
      title: `${r.title}: ready?`,
      items: flags.flatMap((f) => f.next.map((n) => ({ id: `${f.kind}:${n}`, label: `${f.text}: ${NEXT_WORDS[n]}`, run: () => void runNext(f, n) }))),
    });
  };

  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const from = e.clientX;
    const base = { start: b.start, end: b.end };
    const anchor = mode === "end" ? scale.x(addDays(b.end, 1)) : scale.x(b.start);
    const days = (clientX: number) => {
      const to = scale.dateAt(anchor + (clientX - from));
      return mode === "end" ? daysBetween(addDays(base.end, 1), to) : daysBetween(base.start, to);
    };
    const onMove = (ev: PointerEvent) => setLive(dragBar(base, mode, days(ev.clientX)));
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      const next = dragBar(base, mode, days(ev.clientX));
      if (next.start !== base.start || next.end !== base.end) void g.setDates(c.clientKey, r.id, next).then(() => setLive(null));
      else setLive(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const choose = (w: string, i: number, cur: number, at: { x: number; y: number }) => {
    const budget = cap?.weeks[i]?.budget ?? 0;
    openMenu(at, {
      title: `${r.title}: week of ${monthDay(w)}`,
      items: cellChoices(budget, cur).map((n) => ({ id: String(n), label: n === 0 ? "None" : plural(n, "block", "blocks"), checked: n === cur, action: "weekplan.set_feature", run: () => void g.setBlocks(c.clientKey, r.id, w, n) })),
    });
  };
  const span = dragSpan?.id === r.id ? [Math.min(dragSpan.from, dragSpan.to), Math.max(dragSpan.from, dragSpan.to)] : null;
  const endsLate = b.end >= scale.to;
  const endedBefore = b.end < scale.from;
  const startsEarly = b.start < scale.from;
  const label = `${r.title}: ${b.solid ? "" : "estimated "}${monthDay(b.start)} to ${monthDay(b.end)}${b.target ? `, target ${monthDay(b.target)}` : ""}${b.ghostEnd ? `, the pace says ${monthDay(b.ghostEnd)}` : ""}`;
  return (
    <div className={`pa-row pa-item depth-${l.depth} ${r.tier} st-${r.status.state}`} role="row">
      <div className="pa-label" role="rowheader">
        {l.children > 0 ? (
          <button type="button" className="rm-expand" aria-expanded={l.open} aria-label={`${l.open ? "Hide" : "Show"} the features of ${r.title}`} onClick={() => g.toggle(key(c.clientKey, r.id))}>
            {l.open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="rm-expand-space" aria-hidden="true" />
        )}
        <span className="pa-badge" title={STATE_WORDS[r.status.state]}>
          <StateBadge state={r.status.state} small />
        </span>
        <span className="pa-title" title={`${r.title} (#${r.id}): ${r.status.reason}`}>
          <WorkLink clientKey={c.clientKey} url={r.url}>{r.title}</WorkLink>
        </span>
        {flags.length > 0 && (
          <button type="button" className="pa-flags" onClick={showFlags} aria-label={`${r.title}: ${plural(flags.length, "thing", "things")} to get ready: ${flags.map((f) => f.text).join("; ")}`} title={flags.map((f) => f.text).join("\n")}>
            <span aria-hidden="true">⚑</span> {g.wide && flags.length === 1 ? flags[0]!.text : flags.length}
          </button>
        )}
        {b.changed && (
          <span className="pa-save">
            {owned ? (
              <button type="button" className="mini" onClick={() => g.save(b)} title={g.canWrite ? "Preview, then write the dates to DevOps" : "Enable DevOps writes for this client first"}>
                {g.canWrite ? "Save dates" : "Enable writes"}
              </button>
            ) : (
              <span className="muted" title="Only features and epics assigned to you are written to DevOps">Not yours to save</span>
            )}
            <button type="button" className="mini quiet" onClick={() => void g.setDates(c.clientKey, r.id, null)} title="Back to the DevOps dates or the estimate">
              Reset
            </button>
          </span>
        )}
      </div>
      <div className="pa-track" role="presentation">
        {g.cols.map((col, i) => <span key={col.from} className={`pa-gridline ${col.kind}`} style={{ left: scale.colX(i) }} aria-hidden="true" />)}
        {endedBefore ? (
          <span className="pa-before" title={label}>← {b.target === b.end ? "target" : "ended"} {monthDay(b.end)}</span>
        ) : (
        <div
          className={`pa-bar${b.solid && !live ? " solid" : " est"}${b.changed || live ? " changed" : ""}${startsEarly ? " early" : ""}${endsLate ? " late" : ""}`}
          style={{ left: x0, width: Math.max(6, x1 - x0) }}
          title={label}
          aria-label={label}
          role="img"
          onPointerDown={startDrag("move")}
        >
          <span className="pa-handle start" onPointerDown={startDrag("start")} aria-hidden="true" />
          {!(b.solid && !live) && x1 - x0 >= 44 && <span className="pa-est">est.</span>}
          <span className="pa-handle end" onPointerDown={startDrag("end")} aria-hidden="true" />
        </div>
        )}
        {b.ghostEnd && b.target && <span className="pa-ghost" style={{ left: scale.x(addDays(b.target, 1)), width: Math.max(4, scale.x(addDays(b.ghostEnd, 1)) - scale.x(addDays(b.target, 1))) }} title={`At the pace stories close, about ${monthDay(b.ghostEnd)}: after the target date`} aria-hidden="true" />}
        {b.target && b.target >= scale.from && b.target < scale.to && <span className="pa-diamond" style={{ left: scale.x(b.target) + (scale.x(addDays(b.target, 1)) - scale.x(b.target)) / 2 }} title={`Target ${monthDay(b.target)}`} aria-hidden="true" />}
        {endsLate && <span className="pa-beyond" title={`Ends ${monthDay(b.end)}, after these 12 weeks`}>→ {monthDay(b.end)}</span>}
        {ahead.past.map((p, j) => {
          const ids = new Set([r.id, ...r.stories.map((x) => x.id), ...(isFeature ? [] : c.rows.filter((x) => x.parentId === r.id).flatMap((x) => [x.id, ...x.stories.map((y) => y.id)]))]);
          const planned = p.planned.filter((x) => x.clientKey === c.clientKey && (x.itemId === r.id || (!isFeature && kids.includes(x.itemId)))).reduce((n, x) => n + x.blocks, 0);
          const minutes = p.worked.filter((x) => x.clientKey === c.clientKey && x.itemId !== null && ids.has(x.itemId)).reduce((n, x) => n + x.minutes, 0);
          const words = pastWords(planned, minutes, ahead.blockMinutes);
          if (!words) return null;
          return (
            <span key={p.weekStart} className="pa-past" style={{ left: scale.colX(j) + 2, width: scale.colW(j) - 4 }} title={`Week of ${monthDay(p.weekStart)}${p.committed ? "" : " (not committed)"}: ${words}`}>
              <PastWords words={words} />
            </span>
          );
        })}
        {ahead.weeks.slice(0, 4).map((w, i) => {
          const cell = cellOf(w);
          const n = isFeature ? (cell?.blocks ?? 0) : epicBlocks(w);
          const budget = cap?.weeks[i]?.budget ?? 0;
          const style = { left: scale.colX(i + g.pastN) + 2, width: scale.colW(i + g.pastN) - 4 };
          const focused = focus?.id === r.id && focus.week === i;
          if (!isFeature)
            return (
              <span
                key={w}
                role="gridcell"
                ref={(el) => void (el ? cellRefs.set(`${r.id}:${i}`, el) : cellRefs.delete(`${r.id}:${i}`))}
                tabIndex={focused || (!focus && first && i === 0) ? 0 : -1}
                className="pa-cell epic"
                style={style}
                aria-label={`${r.title}, week of ${monthDay(w)}: its features have ${n ? plural(n, "block", "blocks") : "no blocks"}.${l.children ? ` Enter to ${l.open ? "hide" : "show"} its features.` : ""}`}
                title={`Its features: ${n ? plural(n, "block", "blocks") : "no blocks"} in the week of ${monthDay(w)}`}
                onFocus={() => setFocus({ id: r.id, week: i })}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") move(r.id, i, 0, 1);
                  else if (e.key === "ArrowLeft") move(r.id, i, 0, -1);
                  else if (e.key === "ArrowDown") move(r.id, i, 1, 0);
                  else if (e.key === "ArrowUp") move(r.id, i, -1, 0);
                  else if (e.key === "Enter" && l.children) g.toggle(key(c.clientKey, r.id));
                  else return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                {n > 0 && <Segments n={n} />}
              </span>
            );
          const inSpan = span && i >= span[0]! && i <= span[1]!;
          return (
            <button
              key={w}
              type="button"
              role="gridcell"
              ref={(el) => void (el ? cellRefs.set(`${r.id}:${i}`, el) : cellRefs.delete(`${r.id}:${i}`))}
              tabIndex={focused || (!focus && first && i === 0) ? 0 : -1}
              className={`pa-cell${n ? " set" : ""}${cell?.tier === "nice" ? " nice" : ""}${inSpan ? " span" : ""}`}
              style={style}
              aria-label={`${r.title}, week of ${monthDay(w)}: ${n ? plural(n, "block", "blocks") : "no blocks"}${cell?.tier === "nice" ? " (nice to have)" : ""}. Budget ${plural(budget, "block", "blocks")}.`}
              title={`${n ? plural(n, "block", "blocks") : "No blocks"} in the week of ${monthDay(w)}${cell?.tier === "nice" ? " (nice to have)" : ""}`}
              onFocus={() => setFocus({ id: r.id, week: i })}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                drag.current = { id: r.id, from: i, to: i };
              }}
              onPointerEnter={() => {
                if (drag.current?.id === r.id) {
                  drag.current.to = i;
                  setDragSpan({ ...drag.current });
                }
              }}
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                choose(w, i, n, { x: rect.left, y: rect.bottom + 4 });
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") move(r.id, i, 0, 1);
                else if (e.key === "ArrowLeft") move(r.id, i, 0, -1);
                else if (e.key === "ArrowDown") move(r.id, i, 1, 0);
                else if (e.key === "ArrowUp") move(r.id, i, -1, 0);
                else if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "−") {
                  const next = stepCell(n, e.key === "-" || e.key === "−" ? -1 : 1, budget);
                  if (next !== n) void g.setBlocks(c.clientKey, r.id, w, next);
                } else return;
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {n > 0 && <Segments n={n} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "planned 2, worked about 1" breaking only after the comma. */
function PastWords({ words }: { words: string }) {
  const [a, b] = words.split(", ");
  return (
    <span className="pa-pw">
      <span>{b ? `${a},` : a}</span>
      {b && <span>{b}</span>}
    </span>
  );
}

/** Whole blocks as filled segments (a number beside them past four). */
function Segments({ n }: { n: number }) {
  return (
    <span className="pa-segs" aria-hidden="true">
      {Array.from({ length: Math.min(n, 4) }, (_, i) => <span key={i} className="pa-seg" />)}
      <span className="pa-seg-n">{n}</span>
    </span>
  );
}

/** Each month's load for a client: blocks available against features (not epics) whose target, or else estimated end, falls in it. */
function monthLoads(c: RoadmapClient, cap: AheadState["clients"][number] | undefined, cols: AheadColumn[], bars: Map<number, Bar>): MonthLoad[] {
  return cols.flatMap((col) => {
    if (col.kind !== "month") return [];
    const available = cap?.months.find((m) => m.month === col.month)?.available ?? 0;
    const due = c.rows.filter((r) => r.tier === "feature" && r.status.state !== "done").filter((r) => {
      const end = r.targetDate ?? bars.get(r.id)?.end ?? null;
      return !!end && end >= col.from && end < col.to;
    }).length;
    return [monthLoad(col, available, due)];
  });
}

/** Under each client: the last 2 weeks (planned against worked), weeks 1 to 4 against the whole-block budget (as Plan the week), then each month's load. */
function CapacityRow({ c, cap, cols, scale, loads, ahead }: { c: RoadmapClient; cap: AheadState["clients"][number] | undefined; cols: AheadColumn[]; scale: Scale; loads: MonthLoad[]; ahead: AheadState }) {
  return (
    <div className="pa-row pa-cap" role="row" aria-label={`${c.clientName}: blocks per week and month`}>
      <div className="pa-label muted" role="rowheader">Blocks</div>
      <div className="pa-track" role="presentation">
        {cols.map((col, i) => {
          const style = { left: scale.colX(i) + 2, width: scale.colW(i) - 4 };
          if (col.kind === "past") {
            const p = ahead.past.find((x) => x.weekStart === col.weekStart);
            const planned = p?.planned.filter((x) => x.clientKey === c.clientKey).reduce((n, x) => n + x.blocks, 0) ?? 0;
            const minutes = p?.worked.filter((x) => x.clientKey === c.clientKey).reduce((n, x) => n + x.minutes, 0) ?? 0;
            const words = pastWords(planned, minutes, ahead.blockMinutes) ?? "nothing planned";
            return (
              <span key={col.from} className="pa-capcell past" style={style} title={`Week of ${monthDay(col.weekStart)}: ${words} (musts on that week's plan; focused time on its picks)`}>
                <PastWords words={words} />
              </span>
            );
          }
          if (col.kind === "week") {
            const w = cap?.weeks.find((x) => x.weekStart === col.weekStart);
            const why = w?.notCounted.length ? `Not counted: ${w.notCounted.join(" · ")}` : "";
            return (
              <span key={col.from} className={`pa-capcell ${w?.status ?? "none"}`} style={style} title={`${w?.budget ?? 0} available, ${w?.planned ?? 0} planned (musts)${why ? `. ${why}` : ""}`}>
                {w ? (w.budget || w.planned ? w.text : "No blocks") : "No blocks"}
              </span>
            );
          }
          const m = loads.find((x) => x.month === col.month)!;
          return (
            <span key={col.from} className={`pa-capcell month${m.crowded ? " crowded" : ""}`} style={style} title={m.crowded ? `${m.text}: fewer than 3 blocks for each feature due` : m.text}>
              {m.crowded && <strong className="pa-crowded">Crowded month</strong>}
              <span>{m.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
