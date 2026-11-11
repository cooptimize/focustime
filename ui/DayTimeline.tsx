// TY-1: Today as an hour timeline, Week's look and Week's parts (ui/Timeline.tsx): each block a client-coloured band with
// its header, its hours underneath, the Evening band below. TY-2: beside the hours (above them under 1100 px) the block's
// checklist, the list view's own rows: the timed to-dos in time order, then "Not timeboxed yet". A to-do gets its time
// here: drag from the checklist, drag or resize the band, drag it back to the checklist, or the keyboard. Timebox my day
// shows its suggestions as dashed placeholders to accept, drop or move. The phone keeps TY-1's in-block tray, all by tap.
// Own-plan changes run at once with Undo. A timebox on Outlook goes through the usual preview; nothing else leaves FocusTime.
import { BlockSuggestions } from "./Suggest.tsx";
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { TimeboxView, WeekLoadData } from "../actions/types.ts";
import { didntFitText, openGaps, type DayPlacement, type Unplaced, type AgendaTimebox } from "../plan/agenda.ts";
import { blockStatus, watchTip } from "../plan/blockstatus.ts";
import { bandIds, eveningBand } from "../plan/evening.ts";
import { railItems, type InboxItemView } from "../plan/inbox-items.ts";
import { nowClock, nowSpot } from "../plan/nowline.ts";
import { lateOnCards } from "../plan/rail-promises.ts";
import { checklistRows, dropSpan, fitToGap, nextFreeSpan, nudgeSpan, placeholderFits, quarterStarts, type Span } from "../plan/timeline.ts";
import { minutesOf, TIMEBOX_MIN } from "../plan/timebox.ts";
import { pickNeed, type Pick } from "../plan/types.ts";
import type { DragMode } from "../plan/picktime.ts";
import type { Day, Half, IsoDate, Slot } from "../week/types.ts";
import { call } from "./api.ts";
import { DueBadge } from "./FollowUps.tsx";
import { clientColor, halfName, slotRange, startClock } from "./labels.ts";
import { PickRow } from "./PickRow.tsx";
import { PhoneSheet } from "./PhoneShell.tsx";
import { PlanCtx } from "./planview.ts";
import { AllDay, EveningBandView, OutLine, WholeDay } from "./WeekGrid.tsx";
import { CardWhen, LateChip, RulerPromises } from "./BlockCard.tsx";
import { RulerCtx, type PanelFocus } from "./weekctx.ts";
import { BandEditCtx, timeboxRun, useBandDrag, useTimeboxes, type BandEdit, type TimeboxEnv } from "./Timeboxes.tsx";
import { ms, pct, railNowOf, Timeline } from "./Timeline.tsx";
import { WeekDnd } from "./WeekStories.tsx";
import { NOTICE_EVENT } from "./WorkLink.tsx";

/** Timebox my day's suggestions, until each is accepted or dropped. */
export type Proposals = { date: IsoDate; items: DayPlacement[]; unplaced: Unplaced[]; outlook: boolean };

type Props = {
  day: Day;
  blocks: readonly Slot[];
  data: WeekLoadData;
  picks: readonly Pick[];
  now: string;
  tz: string;
  /** The day can be changed here: not past, not PTO, Use timeboxing on. */
  editable: boolean;
  /** A day only to look at: the checkboxes don't work, as on the list view. */
  readOnly: boolean;
  phone: boolean;
  proposals: Proposals | null;
  setProposals: (p: Proposals | null) => void;
  /** Rows for the promises on the hours and the late chip (today only). */
  inbox: readonly InboxItemView[];
  onPromise: (key: string) => void;
  onLate: (clientKey: string | null) => void;
  onOpen?: ((half: Half, focus?: PanelFocus) => void) | undefined;
  /** WD-2: "+ Add" on a block that can take work: the block panel with the cursor in its Add box. Absent on a day that takes none. */
  onAdd?: ((half: Half) => void) | undefined;
  nameOf: (k: string) => string;
};

const notice = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const same = (a: Span, b: Span) => ms(a.start) === ms(b.start) && ms(a.end) === ms(b.end);
const halfWord = (h: Half) => halfName(h).toLowerCase();
const spanWords = (s: Span, tz: string) => `${startClock(s.start, tz)}–${startClock(s.end, tz)}`;
const pseudo = (p: DayPlacement, date: IsoDate): AgendaTimebox => ({ id: -p.pickId, date, start: p.start, end: p.end, title: p.title, clientKey: p.clientKey, pickId: p.pickId, removedAt: null });

/** A click that follows a drag isn't a click (the row's link, the row itself). */
function eatNextClick() {
  const eat = (e: Event) => (e.preventDefault(), e.stopPropagation());
  window.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 60);
}

type TrayDrag = { pick: Pick; x: number; y: number; over: Span | null };
type SheetTarget = { pick: Pick | null; timebox: TimeboxView | null; slot: Slot };

export function DayTimeline(props: Props) {
  const { day, blocks, data, picks, now, tz, editable, phone, proposals, setProposals } = props;
  const env = useTimeboxes();
  const dnd = useContext(WeekDnd);
  const pv = useContext(PlanCtx);
  const root = useRef<HTMLElement>(null);
  const hours = useRef(new Map<Half, HTMLDivElement>());
  const trays = useRef(new Map<Half, HTMLElement>());
  const [sel, setSel] = useState<string | null>(null);
  // TY-2: the to-do under the mouse, on either side: its row and its band light up together.
  const [linked, setLinked] = useState<number | null>(null);
  const wantFocus = useRef<string | null>(null);
  const [drag, setDrag] = useState<TrayDrag | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // A change being saved shows at once; the reload that has it clears it.
  const [held, setHeld] = useState<Record<number, Span>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const date = day.date;
  const isToday = date === data.planDay.date;
  const nowIso = isToday ? now : undefined;
  const timing = !!env && env.settings.enabled;
  const boxes = useMemo(() => (timing ? env.timeboxes.filter((t) => t.date === date && !t.removedAt) : []), [timing, env?.timeboxes, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const boxedIds = useMemo(() => new Set(boxes.map((t) => t.pickId)), [boxes]);
  const placed = useMemo(() => (proposals?.date === date ? proposals.items : []), [proposals, date]);
  const placedIds = useMemo(() => new Set(placed.map((p) => p.pickId)), [placed]);
  const ended = (s: Slot) => ms(now) >= ms(s.end);
  const canChange = (s: Slot) => editable && timing && !s.pto && !ended(s);
  const slotOfHalf = (h: Half) => blocks.find((s) => s.half === h) ?? null;
  const slotOfBox = (t: { start: string; pickId: number | null }) => (t.pickId !== null ? slotOfHalf(picks.find((p) => p.id === t.pickId)?.half ?? "AM") : null) ?? blocks.find((s) => ms(t.start) >= ms(s.view.start) && ms(t.start) < ms(s.view.end)) ?? null;
  const note = (t: string, undo: (() => Promise<void>) | null = null) => dnd?.note(t, undo);

  // TY-2: a to-do with a suggestion is still on the checklist; once it gets a real time the suggestion has done its job.
  useEffect(() => {
    if (!proposals || proposals.date !== date) return;
    const items = proposals.items.filter((x) => !boxedIds.has(x.pickId));
    if (items.length !== proposals.items.length) setProposals(items.length ? { ...proposals, items } : null);
  }, [boxedIds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setHeld((o) => {
      const ids = Object.keys(o).map(Number);
      const keep = ids.filter((id) => {
        const t = boxes.find((x) => x.id === id);
        return !!t && !same(t, o[id]!);
      });
      return keep.length === ids.length ? o : Object.fromEntries(keep.map((id) => [id, o[id]!]));
    });
  }, [boxes]);
  // After a key changes what's selected (T makes a band, Backspace a tray row), the keyboard stays on it.
  useEffect(() => {
    if (!wantFocus.current) return;
    // TY-2: the row moves to Not timeboxed yet when the reload has the change; waiting for that keeps the keyboard on it.
    if (wantFocus.current[0] === "p" && boxedIds.has(Number(wantFocus.current.slice(1)))) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-tt="${wantFocus.current}"]`);
    if (!el) return;
    el.focus({ preventScroll: false });
    wantFocus.current = null;
  });

  // ---- my timeboxes: each change at once, with Undo ----
  const release = (id: number) => setHeld((o) => {
    if (!(id in o)) return o;
    const n = { ...o };
    delete n[id];
    return n;
  });
  const update = (t: TimeboxView, next: Span) => {
    if (!env) return;
    setHeld((o) => ({ ...o, [t.id]: next }));
    queue.current = queue.current.then(async () => {
      if (!(await timeboxRun(env, "timebox.update", { id: t.id, start: next.start, end: next.end }))) release(t.id);
    });
  };
  const moved = (t: TimeboxView, next: Span, verb: string) => {
    const was = held[t.id] ?? { start: t.start, end: t.end };
    if (same(was, next)) return;
    update(t, next);
    note(`${verb}: ${t.title} · ${spanWords(next, tz)}`, async () => update(t, was));
  };
  const add = async (p: Pick, span: Span, then?: (tb: TimeboxView) => void): Promise<void> => {
    if (!env) return;
    const r = await timeboxRun(env, "timebox.add", { pickId: p.id, date, start: span.start, end: span.end });
    if (!r?.timebox) return;
    const tb = r.timebox;
    then?.(tb);
    note(`Timeboxed: ${p.title} · ${spanWords(span, tz)}`, async () => void (await timeboxRun(env, "timebox.remove", { id: tb.id })));
  };
  const unbox = async (t: TimeboxView): Promise<void> => {
    if (!env) return;
    if (!(await timeboxRun(env, "timebox.remove", { id: t.id }))) {
      wantFocus.current = null;
      return;
    }
    const back = t.pickId !== null ? { pickId: t.pickId } : { clientKey: t.clientKey, title: t.title, ...(t.itemId !== null ? { itemId: t.itemId } : {}), ...(t.url ? { url: t.url } : {}) };
    note(`No time: ${t.title}`, async () => void (await timeboxRun(env, "timebox.add", { ...back, date, start: t.start, end: t.end, outlook: t.outlook })));
  };

  /** TY-2: a click on a checklist row brings its band (or suggestion) into view. */
  const reveal = (p: Pick) => {
    const box = boxes.find((x) => x.pickId === p.id);
    const key = box ? `t${box.id}` : placedIds.has(p.id) ? `g${p.id}` : null;
    if (!key) return setSel(`p${p.id}`);
    setSel(key);
    const calm = document.documentElement.hasAttribute("data-reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.current?.querySelector(`[data-tt="${key}"]`)?.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  };

  // ---- drag from the tray or the checklist ----
  const hit = (x: number, y: number): { half: Half; frac: number } | null => {
    for (const [half, el] of hours.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { half, frac: (y - r.top) / Math.max(1, r.height) };
    }
    return null;
  };
  const overTray = (x: number, y: number) => [...trays.current.values()].some((el) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  const lengthOf = (p: Pick) => Math.max(TIMEBOX_MIN, pickNeed(p, pv.sizes));
  const trayDown = (p: Pick, s: Slot) => (ev: ReactPointerEvent<HTMLElement>) => {
    if (ev.button !== 0 || phone || !canChange(s) || (ev.target as HTMLElement).closest("button, input")) return;
    const [x0, y0] = [ev.clientX, ev.clientY];
    let active = false;
    const spanAt = (x: number, y: number) => {
      const h = hit(x, y);
      return h?.half === p.half ? fitToGap(dropSpan(s.view, h.frac, lengthOf(p), tz), openGaps(s, boxes)) : null;
    };
    const onMove = (e: PointerEvent) => {
      if (!active && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      active = true;
      setDrag({ pick: p, x: e.clientX, y: e.clientY, over: spanAt(e.clientX, e.clientY) });
    };
    const finish = (e: PointerEvent | null) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
      if (!active || !e) return;
      eatNextClick();
      const h = hit(e.clientX, e.clientY);
      if (!h) return;
      if (h.half !== p.half) notice(`That's the ${halfWord(h.half)} block. Move the to-do there first`);
      else void add(p, fitToGap(dropSpan(s.view, h.frac, lengthOf(p), tz), openGaps(s, boxes)));
    };
    const onUp = (e: PointerEvent) => finish(e);
    const onCancel = () => finish(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  // ---- placeholders ----
  const others = (pickId: number) => [...boxes, ...placed.filter((x) => x.pickId !== pickId).map((x) => pseudo(x, date))];
  const movePlaceholder = (p: DayPlacement, s: Slot, next: Span) => {
    if (!proposals) return;
    if (!placeholderFits(s, others(p.pickId), next, nowIso)) {
      notice("A suggestion stays clear of meetings and other timeboxes");
      return;
    }
    setProposals({ ...proposals, items: proposals.items.map((x) => (x.pickId === p.pickId ? { ...x, start: next.start, end: next.end, minutes: minutesOf(next), trimmed: false } : x)) });
  };
  const dropOne = (pickId: number) => {
    if (!proposals) return;
    const items = proposals.items.filter((x) => x.pickId !== pickId);
    setProposals(items.length ? { ...proposals, items } : null);
  };
  const acceptOne = async (p: DayPlacement) => {
    if (!env || !proposals) return;
    const r = await timeboxRun(env, "timebox.add", { pickId: p.pickId, date, start: p.start, end: p.end, outlook: proposals.outlook });
    if (!r?.timebox) return;
    const tb = r.timebox;
    dropOne(p.pickId);
    note(`Timeboxed: ${p.title} · ${spanWords(p, tz)}`, async () => void (await timeboxRun(env, "timebox.remove", { id: tb.id })));
  };
  const acceptAll = async () => {
    if (!env || !proposals) return;
    try {
      const r = await call<{ timeboxes: TimeboxView[]; sync: string[] }>("timebox.add_many", { date, items: proposals.items.map((p) => ({ pickId: p.pickId, start: p.start, end: p.end, outlook: proposals.outlook })) });
      env.changed();
      setProposals(null);
      const n = r.timeboxes.length;
      note(`Timeboxed ${n} to-do${n === 1 ? "" : "s"}`, async () => {
        for (const t of r.timeboxes) await timeboxRun(env, "timebox.remove", { id: t.id });
      });
      if (r.sync.length && env.access?.access === "write") await env.syncMany(r.sync);
    } catch (e) {
      notice(e instanceof Error ? e.message : "That didn't work");
    }
  };

  // ---- the keyboard: on whichever row or band has focus ----
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = (e.target as HTMLElement).closest<HTMLElement>("[data-tt]")?.dataset.tt;
    if (!at) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : null;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    // TY-2: on a checklist row, Up, Down and Backspace act on that to-do's band or suggestion.
    let kind = at[0];
    let id = Number(at.slice(1));
    if (kind === "p" && (dir || e.key === "Backspace")) {
      const box = boxes.find((x) => x.pickId === id);
      if (box) (kind = "t"), (id = box.id);
      else if (placedIds.has(id)) kind = "g";
    }
    if (kind === "t") {
      const t = boxes.find((x) => x.id === id);
      const s = t ? slotOfBox(t) : null;
      if (!t || !s || !canChange(s)) return;
      if (dir) {
        stop();
        const next = nudgeSpan(s.view, held[t.id] ?? t, dir, e.shiftKey);
        if (next) moved(t, next, e.shiftKey ? "Resized" : "Moved");
      } else if (e.key === "Backspace") {
        stop();
        if (t.pickId !== null) wantFocus.current = `p${t.pickId}`;
        void unbox(t);
      }
    } else if (kind === "g") {
      const p = placed.find((x) => x.pickId === id);
      const s = p ? slotOfHalf(p.half) : null;
      if (!p || !s) return;
      if (dir) {
        stop();
        const next = nudgeSpan(s.view, p, dir, e.shiftKey);
        if (next) movePlaceholder(p, s, next);
      } else if (e.key === "Backspace") {
        stop();
        dropOne(id);
      }
    } else if (kind === "p" && (e.key === "t" || e.key === "T") && !e.shiftKey && !boxedIds.has(id)) {
      const p = picks.find((x) => x.id === id);
      const s = p ? slotOfHalf(p.half) : null;
      if (!p || !s || !canChange(s)) return;
      stop();
      const span = nextFreeSpan(s, boxes, p, pv.sizes, nowIso, pv.minSizes);
      if (!span) {
        notice(`No free time left for "${p.title}" in this block`);
        return;
      }
      void add(p, span, (tb) => {
        wantFocus.current = `t${tb.id}`;
        setSel(`t${tb.id}`);
      });
    }
  };

  const edit: BandEdit = {
    canDrag: (t) => {
      const s = slotOfBox(t);
      return !phone && !!s && canChange(s);
    },
    timeOf: (t) => held[t.id] ?? null,
    commit: (t, next, mode: DragMode) => moved(t, next, mode === "move" ? "Moved" : "Resized"),
    overTray,
    unbox: (t) => void unbox(t),
    click: (t) => {
      if (!phone) return setSel(`t${t.id}`), true;
      const s = slotOfBox(t);
      if (s && canChange(s)) setSheet({ pick: picks.find((p) => p.id === t.pickId) ?? null, timebox: t, slot: s });
      return true;
    },
    selected: (t) => sel === `t${t.id}`,
    select: (t) => setSel(`t${t.id}`),
    done: (t) => picks.find((p) => p.id === t.pickId)?.status === "done",
    linked: (t) => t.pickId !== null && t.pickId === linked,
    hover: (t) => setLinked(t?.pickId ?? null),
  };

  // ---- what's around the hours ----
  const spot = nowSpot(day, now, tz, false);
  const label = spot ? nowClock(now, tz) : "";
  const band = eveningBand(day, data.week, [...picks]);
  const inBand = bandIds(band);
  const clockNow = now;
  const rail = useMemo(() => railItems(props.inbox), [props.inbox]);
  const lateBy = isToday ? lateOnCards(rail, blocks.filter((s) => !s.pto).map((s) => ({ key: `${date}|${s.half}`, date, start: s.view.start, end: s.view.end, clients: s.focus.map((f) => f.clientKey) })), { today: date, now: clockNow }) : new Map<string, typeof rail>();
  const dayLabel = `${day.weekday} ${date}`;

  const rulerCtx = { layout: "wide" as const, promises: isToday ? rail.filter((p) => !p.overdue) : [], onPromise: props.onPromise, onLate: props.onLate, today: date, now: clockNow, home: null, late: lateBy };
  const offered = placed.length;

  return (
    <RulerCtx.Provider value={rulerCtx}>
      <BandEditCtx.Provider value={edit}>
        <section ref={root} className={`today-tl${phone ? " phone" : ""}${offered ? " has-bar" : ""}`} aria-label="Timeline" onKeyDown={onKeyDown}>
          {proposals && proposals.date === date && (
            <ProposalBar p={proposals} env={env} count={offered} onAcceptAll={() => void acceptAll()} onDiscard={() => setProposals(null)} onOutlook={(on) => setProposals({ ...proposals, outlook: on })} />
          )}
          <AllDay events={day.allDay} />
          <OutLine kind="early" items={day.pto ? [] : day.early.map((p) => p.event)} tz={tz} />
          {day.pto ? (
            <div className="tt-off">
              <WholeDay day={day} band={band} kind="pto" tz={tz} selected={false} refAm={() => {}} refPm={() => {}} onOpen={() => {}} dayLabel={dayLabel} now={null} />
            </div>
          ) : (
            blocks.map((s) => {
              const untimed = picks.filter((p) => p.half === s.half && p.status === "planned" && !inBand.has(p.id) && !boxedIds.has(p.id) && !placedIds.has(p.id));
              const checklist = checklistRows(picks.filter((p) => p.half === s.half && !inBand.has(p.id)), boxes);
              const held0 = placed.filter((p) => p.half === s.half);
              return (
                <TimelineBlock
                  key={s.half}
                  slot={s}
                  day={day}
                  data={data}
                  picks={picks}
                  tz={tz}
                  now={now}
                  nowLine={railNowOf(day, s.half, spot, now, label, () => {})}
                  name={s.focus[0] ? props.nameOf(s.focus[0].clientKey) : s.half === "EVE" ? "Evening" : s.open ? "Open" : halfName(s.half)}
                  untimed={untimed}
                  checklist={checklist}
                  tickable={date <= data.planDay.date && !s.pto}
                  linked={linked}
                  setLinked={setLinked}
                  onReveal={reveal}
                  canChange={canChange(s)}
                  timing={timing}
                  phone={phone}
                  sel={sel}
                  setSel={setSel}
                  trayDown={trayDown}
                  onTrayTap={(p) => setSheet({ pick: p, timebox: null, slot: s })}
                  trayRef={(el) => (el ? trays.current.set(s.half, el) : trays.current.delete(s.half))}
                  hoursRef={(el) => (el ? hours.current.set(s.half, el) : hours.current.delete(s.half))}
                  ghost={drag && drag.over && drag.pick.half === s.half ? drag.over : null}
                  ghostTitle={drag?.pick.title ?? ""}
                  placeholders={held0}
                  onMovePlaceholder={(p, next) => movePlaceholder(p, s, next)}
                  onAccept={(p) => void acceptOne(p)}
                  onDrop={dropOne}
                  late={lateBy.get(`${date}|${s.half}`) ?? []}
                  onPromise={props.onPromise}
                  onLate={props.onLate}
                  onOpen={props.onOpen ? (focus) => props.onOpen!(s.half, focus) : undefined}
                  onAdd={props.onAdd ? () => props.onAdd!(s.half) : undefined}
                />
              );
            })
          )}
          {band ? <EveningBandView band={band} date={date} tz={tz} dayLabel={dayLabel} /> : <OutLine kind="late" items={day.pto ? [] : day.evening.map((p) => p.event)} tz={tz} />}
          {drag && !drag.over && (
            <div className="tt-drag-chip" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
              {drag.pick.title}
            </div>
          )}
          {sheet && env && <TimeSheet target={sheet} env={env} boxes={boxes} tz={tz} nowIso={nowIso} length={sheet.pick ? lengthOf(sheet.pick) : sheet.timebox ? minutesOf(sheet.timebox) : 60} onClose={() => setSheet(null)} onPick={(span) => {
            setSheet(null);
            if (sheet.timebox) moved(sheet.timebox, span, "Moved");
            else if (sheet.pick) void add(sheet.pick, span);
          }} onUnbox={() => {
            setSheet(null);
            if (sheet.timebox) void unbox(sheet.timebox);
          }} />}
        </section>
      </BandEditCtx.Provider>
    </RulerCtx.Provider>
  );
}

function ProposalBar({ p, env, count, onAcceptAll, onDiscard, onOutlook }: { p: Proposals; env: TimeboxEnv | null; count: number; onAcceptAll: () => void; onDiscard: () => void; onOutlook: (on: boolean) => void }) {
  const { sizes } = useContext(PlanCtx);
  const a = env?.access ?? null;
  const canWrite = a?.access === "write";
  return (
    <div className="tt-bar" role="group" aria-label="Timebox my day">
      <strong>{count} suggestion{count === 1 ? "" : "s"}</strong>
      {count > 0 && <button type="button" className="primary" onClick={onAcceptAll}>Accept all</button>}
      <button type="button" onClick={onDiscard}>Discard</button>
      {p.unplaced.length > 0 && <span className="tt-bar-left muted" title={p.unplaced.map((u) => `${u.title}: ${u.reason}`).join("\n")}>{didntFitText(p.unplaced, sizes)}</span>}
      {count > 0 && (
        <label className="tt-bar-outlook" title="A Busy event only you are on, titled with the client and item. You'll see every Outlook event in one preview before anything is written">
          <input type="checkbox" checked={p.outlook} onChange={(e) => onOutlook(e.target.checked)} /> Put on Outlook
        </label>
      )}
      {p.outlook && a && !canWrite && (
        <span className="tb-explain" role="note">
          {a.access === "not_set_up" ? "Outlook isn't set up, so these stay in FocusTime." : a.message}
        </span>
      )}
    </div>
  );
}

type BlockProps = {
  slot: Slot;
  day: Day;
  data: WeekLoadData;
  picks: readonly Pick[];
  tz: string;
  now: string;
  nowLine: ReturnType<typeof railNowOf>;
  name: string;
  untimed: Pick[];
  checklist: ReturnType<typeof checklistRows<Pick, TimeboxView>>;
  /** The checkboxes work: a confirmed day that isn't past or off, as on the list view. */
  tickable: boolean;
  linked: number | null;
  setLinked: (id: number | null) => void;
  onReveal: (p: Pick) => void;
  canChange: boolean;
  timing: boolean;
  phone: boolean;
  sel: string | null;
  setSel: (s: string) => void;
  trayDown: (p: Pick, s: Slot) => (ev: ReactPointerEvent<HTMLElement>) => void;
  onTrayTap: (p: Pick) => void;
  trayRef: (el: HTMLElement | null) => void;
  hoursRef: (el: HTMLDivElement | null) => void;
  ghost: Span | null;
  ghostTitle: string;
  placeholders: DayPlacement[];
  onMovePlaceholder: (p: DayPlacement, next: Span) => void;
  onAccept: (p: DayPlacement) => void;
  onDrop: (pickId: number) => void;
  late: Parameters<typeof LateChip>[0]["late"];
  onPromise: (key: string) => void;
  onLate: (clientKey: string | null) => void;
  onOpen?: ((focus?: PanelFocus) => void) | undefined;
  onAdd?: (() => void) | undefined;
};

/** One block: the client-coloured band with Week's card header, then Week's hour timeline with the checklist beside it (the phone: TY-1's tray above it). */
function TimelineBlock(b: BlockProps) {
  const { slot, day, data, tz, name, untimed } = b;
  const client = slot.focus[0]?.clientKey ?? null;
  const ended = ms(b.now) >= ms(slot.end);
  // QT-1: the calendar alone makes a status (At risk); how much is planned never does.
  const status = blockStatus(slot.risks);
  const sev = status.kind === "at_risk" ? "at_risk" : null;
  const pill = status.kind === "at_risk" ? `At risk${status.short ? ` · ${status.short}` : ""}` : "";
  const state = slot.pto ? "pto-half" : slot.half === "EVE" ? "eve" : slot.open ? "open" : "focus";
  const span = Math.max(1, ms(slot.view.end) - ms(slot.view.start));
  const pos = (iso: string) => (ms(iso) - ms(slot.view.start)) / span;
  const minutes = span / 60_000;
  const earlier = new Set(slot.half === "PM" ? day.am.events.map((p) => p.event.id) : slot.half === "EVE" ? day.pm.events.map((p) => p.event.id) : []);
  const openHead = b.onOpen;
  const showTray = b.phone && b.timing && !slot.pto && (untimed.length > 0 || b.canChange);
  const hours = (
    <Timeline slot={slot} tz={tz} earlier={earlier} showGaps={!slot.open} minFocusWindow={data.thresholds.minFocusWindowMinutes} now={b.nowLine} className="tt-hours" style={{ height: `calc(${minutes} * var(--tl-hour) / 60)` }} rootRef={b.hoursRef} firstHour={!b.phone} markOverlaps={!b.phone}>
      <RulerPromises rail={{ key: `${slot.date}|${slot.half}`, start: slot.view.start, end: slot.view.end }} tz={tz} />
      {b.ghost && (
        <div className="tbox tt-ghost" style={{ top: pct(pos(b.ghost.start)), height: pct((ms(b.ghost.end) - ms(b.ghost.start)) / span) }} aria-hidden="true">
          <span className="tbox-label">{b.ghostTitle}</span>
          <span className="tbox-time">{spanWords(b.ghost, tz)}</span>
        </div>
      )}
      {b.placeholders.map((p) => (
        <Placeholder key={p.pickId} p={p} slot={slot} tz={tz} pos={pos} span={span} phone={b.phone} client={p.clientKey} colors={data.clients} selected={b.sel === `g${p.pickId}`} linked={b.linked === p.pickId} onHover={b.setLinked} onSelect={() => b.setSel(`g${p.pickId}`)} onMove={(next) => b.onMovePlaceholder(p, next)} onAccept={() => b.onAccept(p)} onDrop={() => b.onDrop(p.pickId)} />
      ))}
    </Timeline>
  );
  return (
    <article className={`half ${state} tt-block${sev ? ` ${sev}` : ""}${ended ? " ended" : ""}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties} aria-label={`${name}, ${slotRange(slot, tz)}`}>
      <header className="tt-head card-head" title={watchTip(slot.risks) ?? undefined} onClick={openHead ? () => openHead() : undefined}>
        <span className="swatch" aria-hidden="true" />
        <span className="card-client" title={name}>{name}</span>
        <CardWhen slot={slot} tz={tz} />
        {status.kind !== "none" && (
          <span className={`status-pill ${status.kind}`} title={status.detail ?? undefined}>
            {pill}
          </span>
        )}
        {b.late.length > 0 && <LateChip late={b.late} tabIndex={0} onPromise={b.onPromise} onLate={b.onLate} />}
      </header>
      {showTray && (
        <section ref={b.trayRef} className="tt-tray" aria-label={`Not timeboxed yet, ${halfName(slot.half)}`}>
          <h3 className="tt-tray-label">Not timeboxed yet</h3>
          {untimed.length > 0 ? (
            <ul className="tt-tray-list">
              {untimed.map((p) => (
                <TrayRow key={p.id} pick={p} slot={slot} canChange={b.canChange} phone={b.phone} selected={b.sel === `p${p.id}`} onSelect={() => b.setSel(`p${p.id}`)} trayDown={b.trayDown} onTap={() => b.onTrayTap(p)} />
              ))}
            </ul>
          ) : (
            <p className="tt-tray-empty muted">{b.phone ? "Everything here has a time." : "Everything here has a time. Drag one back here to take its time off."}</p>
          )}
        </section>
      )}
      {b.phone ? hours : (
        <div className="tt-split">
          {hours}
          <TodoChecklist b={b} />
        </div>
      )}
      {b.phone && b.onAdd && !slot.pto && !slot.off && (
        <button type="button" className="add-work add-row tt-add" onClick={b.onAdd} aria-label={`Add to ${name}, ${halfName(slot.half)}`}>
          + Add
        </button>
      )}
    </article>
  );
}

/**
 * TY-2: the block's to-dos beside its hours, on the list view's own row: the ones with a time in time order, then "Not
 * timeboxed yet". The whole column is where a band is dropped to take its time off. Sticky while the block scrolls by;
 * under 1100 px it sits above the hours and folds.
 */
function TodoChecklist({ b }: { b: BlockProps }) {
  const { slot, checklist } = b;
  const [folded, setFolded] = useState(false);
  const { timed, rest } = checklist;
  const count = timed.length + rest.length;
  const row = (p: Pick, group: "timed" | "rest") => <CheckRow key={p.id} pick={p} group={group} b={b} />;
  const heading = b.timing && !slot.pto && (rest.length > 0 || (b.canChange && timed.length > 0));
  return (
    <aside ref={b.trayRef} className={`tt-check${folded ? " folded" : ""}`} aria-label={`To-dos, ${halfName(slot.half)}`}>
      <button type="button" className="tt-check-toggle" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
        <span aria-hidden="true">{folded ? "▸" : "▾"}</span> To-dos · {count}
      </button>
      <div className="tt-check-body">
        {timed.length > 0 && <ul className="today-picks tt-check-timed">{timed.map((t) => row(t.pick, "timed"))}</ul>}
        {heading && <h3 className="tt-tray-label">Not timeboxed yet</h3>}
        {rest.length > 0 && <ul className="today-picks tt-check-rest">{rest.map((p) => row(p, "rest"))}</ul>}
        {rest.length === 0 && heading && <p className="tt-tray-empty muted">Everything here has a time. Drag one back here to take its time off.</p>}
        {count === 0 && <p className="tt-tray-empty muted">Nothing here yet.</p>}
        {/* SG-1: an empty block's suggestions, as on its card. */}
        {count === 0 && <BlockSuggestions date={slot.date} half={slot.half} where="timeline" />}
        {b.onAdd && !slot.pto && !slot.off && (
          <button type="button" className="add-work add-row tt-add" onClick={b.onAdd} title="Add to this block (A)" aria-label={`Add to ${b.name}, ${halfName(slot.half)}`}>
            + Add
          </button>
        )}
      </div>
    </aside>
  );
}

/** One checklist row: PickRow as the list view draws it, plus the link to its band, the drag and the keyboard. */
function CheckRow({ pick, group, b }: { pick: Pick; group: "timed" | "rest"; b: BlockProps }) {
  const { slot, data, tz } = b;
  const pv = useContext(PlanCtx);
  const suggestion = b.placeholders.find((p) => p.pickId === pick.id) ?? null;
  const planned = pick.status === "planned";
  const canDrag = group === "rest" && planned && b.canChange;
  const followUp = pick.followUpId !== null ? data.followUps.find((f) => f.id === pick.followUpId) ?? null : null;
  const box = b.checklist.timed.find((t) => t.pick.id === pick.id)?.box ?? null;
  const selected = b.sel === `p${pick.id}` || (!!box && b.sel === `t${box.id}`) || (!!suggestion && b.sel === `g${pick.id}`);
  const rowProps = {
    tabIndex: 0,
    "data-tt": `p${pick.id}`,
    onFocus: () => b.setSel(`p${pick.id}`),
    onMouseEnter: () => b.setLinked(pick.id),
    onMouseLeave: () => b.setLinked(null),
    ...(canDrag ? { onPointerDown: b.trayDown(pick, slot) } : {}),
    onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: (e: { target: EventTarget }) => {
      if (!(e.target as HTMLElement).closest("button, input, a")) b.onReveal(pick);
    },
  } as unknown as HTMLAttributes<HTMLLIElement>;
  const cls = `tt-check-row${canDrag ? " can-drag" : ""}${selected ? " selected" : ""}${b.linked === pick.id ? " linked" : ""}`;
  const tags = (
    <>
      {suggestion && <span className="tt-suggested">Suggested {spanWords(suggestion, tz)}</span>}
    </>
  );
  return <PickRow pick={pick} toggle={pv.toggle} link density="today" checklist canTick={b.tickable} timeEditable={b.canChange} readOnly={!b.canChange} tabIndex={0} className={cls} extra={tags} badge={followUp ? <DueBadge l={followUp} /> : undefined} dragProps={rowProps} />;
}

/** A tray row (the phone): Plan today's row, with its size chip always shown (a tap for a time). */
function TrayRow({ pick, slot, canChange, phone, selected, onSelect, trayDown, onTap }: { pick: Pick; slot: Slot; canChange: boolean; phone: boolean; selected: boolean; onSelect: () => void; trayDown: BlockProps["trayDown"]; onTap: () => void }) {
  const pv = useContext(PlanCtx);
  const rowProps = {
    tabIndex: 0,
    "data-tt": `p${pick.id}`,
    onFocus: onSelect,
    onPointerDown: trayDown(pick, slot),
    onDragStart: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: (e: { target: EventTarget }) => {
      if ((e.target as HTMLElement).closest("button, input, a")) return;
      onSelect();
      if (phone && canChange) onTap();
    },
  } as unknown as HTMLAttributes<HTMLLIElement>;
  return <PickRow pick={pick} toggle={pv.toggle} link density="plan" className={`tt-tray-row${selected ? " selected" : ""}`} timeEditable={!phone && canChange} tabIndex={0} dragProps={rowProps} readOnly={!canChange} />;
}

/** Timebox my day's suggestion: dashed until accepted; drag or resize it first if you like. Never saved until ✓. */
function Placeholder({ p, slot, tz, pos, span, phone, client, colors, selected, linked, onHover, onSelect, onMove, onAccept, onDrop }: { p: DayPlacement; slot: Slot; tz: string; pos: (iso: string) => number; span: number; phone: boolean; client: string; colors: Record<string, string>; selected: boolean; linked: boolean; onHover: (id: number | null) => void; onSelect: () => void; onMove: (next: Span) => void; onAccept: () => void; onDrop: () => void }) {
  const { drag, live, down, move, up, cancel } = useBandDrag({ start: p.start, end: p.end, bounds: slot.view, inside: true, enabled: !phone, onCommit: onMove });
  const words = spanWords(live, tz);
  const noDrag = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div
      className={`tbox tt-ph${drag ? " dragging" : ""}${selected ? " selected" : ""}${linked ? " linked" : ""}`}
      style={{ top: pct(pos(live.start)), height: pct((ms(live.end) - ms(live.start)) / span), "--c": clientColor(client, colors) } as CSSProperties}
      data-tt={`g${p.pickId}`}
      role="group"
      tabIndex={0}
      aria-label={`Suggestion: ${p.title}, ${words}`}
      onFocus={onSelect}
      onMouseEnter={() => onHover(p.pickId)}
      onMouseLeave={() => onHover(null)}
      onPointerDown={(ev) => (onSelect(), down(ev, "move"))}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <span className="tt-ph-text">
        <span className="tbox-label">{p.title}</span>
        <span className="tbox-time">{words}{p.trimmed ? " · shortened to fit" : ""}</span>
      </span>
      <span className="tt-ph-acts">
        <button type="button" onPointerDown={noDrag} onClick={onAccept} aria-label={`Accept ${p.title}`} title="Accept">✓</button>
        <button type="button" onPointerDown={noDrag} onClick={onDrop} aria-label={`Drop ${p.title}`} title="Drop">✕</button>
      </span>
      <span className="tbox-edge" onPointerDown={(ev) => down(ev, "end")} aria-hidden="true" />
    </div>
  );
}

/** The phone: tap a to-do: Pick a time (untimed), or Move and Un-timebox (timed), from a 15-minute list. */
function TimeSheet({ target, env, boxes, tz, nowIso, length, onClose, onPick, onUnbox }: { target: SheetTarget; env: TimeboxEnv; boxes: readonly TimeboxView[]; tz: string; nowIso: string | undefined; length: number; onClose: () => void; onPick: (s: Span) => void; onUnbox: () => void }): ReactNode {
  const [list, setList] = useState(false);
  void env;
  const title = target.pick?.title ?? target.timebox?.title ?? "";
  const timed = !!target.timebox;
  const starts = quarterStarts(target.slot, boxes, target.timebox, length, tz, nowIso);
  return (
    <PhoneSheet label={`Timebox ${title}`} title={title} onClose={onClose} className="todo-sheet tt-sheet">
      {!list ? (
        <div className="ts-acts">
          <button type="button" className="primary" onClick={() => setList(true)}>{timed ? "Move" : "Pick a time"}</button>
          {timed && <button type="button" onClick={onUnbox}>Un-timebox</button>}
        </div>
      ) : starts.length ? (
        <ul className="tt-times" aria-label="Times">
          {starts.map((s) => (
            <li key={s.start}>
              <button type="button" onClick={() => onPick(s)}>{spanWords(s, tz)}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No free time left in this block that fits.</p>
      )}
    </PhoneSheet>
  );
}

