// PV-1 (D569 to D574), WD-2: Week (and Day) plan stories into blocks by drag and drop.
// - Drag onto a block (native drag, a long press on touch, "Add to…" and "Move to…" from the keyboard), with the fit
//   shown on the target and Undo after each drop (plan/weekdrop.ts).
// - WD-2: a to-do dragged from a block onto the block panel comes off the plan (Take off the plan), with Undo; the
//   panel opens as the drop area when it was closed.
// (The Week panel's "Your stories" list went with the Details panel in WD-2; the block panel is ui/BlockPanel.tsx.)
import { userZone } from "../week/zone.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { blockLabel } from "../plan/blockstories.ts";
import { dropCheck, type Dragged, type DropCheck } from "../plan/weekdrop.ts";
import type { Pick } from "../plan/types.ts";
import type { Day, Half, IsoDate, Slot, Week } from "../week/types.ts";
import { ActionRefusal, planAction } from "./api.ts";
import { MenuCtx } from "./Menus.tsx";
import type { MenuItem, MenuStep } from "./menu.ts";
import { PV_BREAKDOWN_EVENT } from "./menu.ts";
import { usePhone } from "./viewport.ts";
import { takeOffPick } from "./takeoff.ts";
import { takeOffRule } from "../plan/blockpanel.ts";
import { Icon } from "./icons.tsx";

/** The drag type for a story or a planned pick moving between Week's blocks. */
export const STORY_DRAG = "application/x-focustime-story";
/** PV-1: "Break down" sends { clientKey, itemId }; BD-1's Break down panel (ui/BreakDownPanel.tsx) opens for it. */
export const openBreakdown = (clientKey: string, itemId: number) => window.dispatchEvent(new CustomEvent(PV_BREAKDOWN_EVENT, { detail: { clientKey, itemId } }));

/** One of the week's blocks a story can go to. */
export type Block = { date: IsoDate; half: Half; label: string; slot: Slot; ptoDay: boolean; catchUp: boolean };
const keyOf = (b: { date: IsoDate; half: Half }) => `${b.date}:${b.half}`;

type Toast = { id: number; text: string; undo: (() => Promise<void>) | null };

type DndApi = {
  dragging: Dragged | null;
  hover: string | null;
  setHover: (k: string | null) => void;
  begin: (d: Dragged, touch?: boolean) => void;
  end: () => void;
  blocks: readonly Block[];
  check: (d: Dragged, b: Block) => DropCheck;
  /** Adds or moves the story there, then offers Undo. */
  place: (d: Dragged, b: Block) => Promise<void>;
  openSlot: (date: IsoDate, half: Half) => void;
  /** Reads DevOps again after a write there. */
  refresh: () => void;
  /** "Add to…" / "Move to…": the week's blocks with their fit, the ones that can't take it disabled. */
  menuFor: (d: Dragged, title: string) => MenuStep;
  /** Long press on a touch screen. */
  touchStart: (d: Dragged, e: React.PointerEvent) => void;
  /** A short notice at the foot of the screen, with Undo when given. */
  note: (text: string, undo?: (() => Promise<void>) | null) => void;
  /** WD-2: Take off the plan (a to-do dropped on the block panel): off its block, back to not placed, with Undo. */
  takeOff: (pickId: number) => Promise<void>;
};
export const WeekDnd = createContext<DndApi | null>(null);

function wholeCatchUp(day: Day): boolean {
  return !day.pto && day.kind !== "work" && day.am.off && day.pm.off && !day.eve;
}

/** The last minute of a date in the week's zone (a weekend drop is open all day, not only in the nominal morning). */
const endOfDay = (date: IsoDate, timeZone: string) => Temporal.PlainDate.from(date).toZonedDateTime({ timeZone, plainTime: "23:59" }).toInstant().toString();

/** The week's blocks: AM and PM of each day, one block for a PTO day and one for Friday's catch-up. */
export function weekBlocks(week: Week): Block[] {
  const zone = userZone(week);
  const out: Block[] = [];
  for (const d of week.days) {
    const day = Temporal.PlainDate.from(d.date).toLocaleString("en-US", { weekday: "short" });
    // WK-3: a weekend day is one drop target too, with no fit (D947: it takes the move with its note).
    if (d.kind === "weekend") out.push({ date: d.date, half: "AM", label: Temporal.PlainDate.from(d.date).toLocaleString("en-US", { weekday: "long" }), slot: { ...d.am, end: endOfDay(d.date, zone) }, ptoDay: !!d.pto, catchUp: true });
    else if (d.pto) out.push({ date: d.date, half: "AM", label: `${day} (PTO)`, slot: d.am, ptoDay: true, catchUp: false });
    else if (wholeCatchUp(d)) out.push({ date: d.date, half: "AM", label: `${day} catch-up`, slot: d.am, ptoDay: false, catchUp: true });
    else for (const s of [d.am, d.pm]) out.push({ date: d.date, half: s.half, label: blockLabel(s), slot: s, ptoDay: false, catchUp: false });
  }
  return out;
}

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "That didn't work");

export function WeekDndProvider({ data, week, now, onChanged, onRefresh, onOpenSlot, onPickDrag, onTookOff, children }: { /** WD-2: a to-do started (its block) or stopped (null) dragging: the block panel opens as the drop area. */ onPickDrag?: (at: { date: IsoDate; half: Half } | null) => void; /** WD-2: a to-do was taken off this block. */ onTookOff?: (at: { date: IsoDate; half: Half }) => void; data: WeekLoadData; week: Week; now: string; onChanged: () => void; /** Reads DevOps again (after a create or Take one, so the story shows under its feature). */ onRefresh?: () => void; onOpenSlot: (date: IsoDate, half: Half) => void; children: ReactNode }) {
  const [dragging, setDragging] = useState<Dragged | null>(null);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const blocks = useMemo(() => weekBlocks(week), [week]);
  const picks = useMemo(() => Object.values(data.plan ?? {}).flatMap((d) => d.picks), [data.plan]);
  const ref = useRef({ dragging, hover, blocks });
  ref.current = { dragging, hover, blocks };

  const note = useCallback((text: string, undo: Toast["undo"] = null) => setToast({ id: Date.now(), text, undo }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((x) => (x?.id === toast.id ? null : x)), toast.undo ? 10_000 : 5_000);
    return () => clearTimeout(t);
  }, [toast]);

  const check = useCallback((d: Dragged, b: Block) => dropCheck({ slot: b.slot, ptoDay: b.ptoDay, catchUp: b.catchUp, now, today: data.planDay.date, picks: picks.filter((p) => p.date === b.date && p.half === b.half), sizes: data.planning.sizes, timeboxes: data.timeboxes, dragged: d }), [now, data.planDay.date, data.planning.sizes, data.timeboxes, picks]);

  const place = useCallback(
    async (d: Dragged, b: Block) => {
      const c = check(d, b);
      if (!c.ok) return note(`Can't add it to ${b.label}: ${c.why}`);
      try {
        if (d.feature) {
          // WD-1: a feature dropped as a placeholder: its pin on that block (the week's features list), Undo unpins.
          const p = Temporal.PlainDate.from(b.date);
          const weekStart = p.subtract({ days: p.dayOfWeek - 1 }).toString();
          const pin = (on: boolean) => planAction("weekplan.place", { weekStart, clientKey: d.clientKey, itemId: d.itemId, date: b.date, half: b.half, on });
          await pin(true);
          onChanged();
          note(`${d.title} placed on ${b.label}`, async () => (await pin(false), onChanged()));
        } else if (d.pickId !== undefined) {
          const from = picks.find((p) => p.id === d.pickId);
          const r = await planAction("pick.move", { id: d.pickId, date: b.date, half: b.half, ...(b.catchUp ? { anyway: true } : {}) });
          onChanged();
          // UI-B: a pick from a past day (an unfinished one, maybe from an earlier week) can't be moved back into the
          // past: Undo deletes the carried copy and plans the original again.
          const copy = r.pick && r.pick.id !== d.pickId ? r.pick.id : null;
          // WK-3: any move that left a copy is undone by taking the copy back (moving the original, now marked moved,
          // would leave the copy where it went).
          const back = copy !== null ? async () => (await planAction("pick.uncarry", { id: copy }), onChanged()) : from ? async () => (await planAction("pick.move", { id: d.pickId, date: from.date, half: from.half, anyway: true }), onChanged()) : null;
          note(`Moved to ${b.label}${r.note ? ` · ${r.note}` : ""}`, back);
        } else {
          const r = await planAction("pick.add", { date: b.date, half: b.half, clientKey: d.clientKey, ...(d.add ? d.add : { itemId: d.itemId }), ...(d.size ? { size: d.size } : {}) });
          onChanged();
          const id = r.pick?.id;
          // WD-1: Undo also takes back what the add did to the week (its feature, the confirmed week's change mark).
          const undo = (r as { undo?: unknown }).undo;
          note(`Added to ${b.label}${r.note ? ` · ${r.note}` : ""}`, id ? async () => (await planAction("pick.remove", { id, ...(undo ? { undo } : {}) }), onChanged()) : null);
        }
      } catch (e) {
        note(errText(e));
      }
    },
    [check, note, onChanged, picks, data.planDay.date],
  );

  const takeOff = useCallback(
    async (pickId: number) => {
      const p = picks.find((x) => x.id === pickId);
      const at = p ? { date: p.date, half: p.half } : null;
      if (await takeOffPick(pickId, at, { changed: onChanged, note }) && at) onTookOff?.(at);
    },
    [picks, onChanged, note, onTookOff],
  );
  // WD-2: while a to-do drags, the block panel is the drop area for Take off the plan (it opens when it was closed).
  const dragPick = dragging?.pickId;
  useEffect(() => {
    if (dragPick === undefined) return;
    const p = picks.find((x) => x.id === dragPick);
    // Only for a to-do that can come off the plan (a past day's or a deployment never does).
    if (p && takeOffRule(p, data.planDay.date).ok) onPickDrag?.({ date: p.date, half: p.half });
    return () => onPickDrag?.(null);
  }, [dragPick]); // eslint-disable-line react-hooks/exhaustive-deps

  // WD-2: a native drag whose source left the page (its day folded when the panel opened) never gets its dragend, so
  // the drop area would stay. The pointer moving again means the drag is over: end it. (No mousemove fires during a
  // native drag; a touch drag has its own end.)
  const nativeDrag = !!dragging && !touch;
  useEffect(() => {
    if (!nativeDrag) return;
    const done = () => (setDragging(null), setHover(null));
    window.addEventListener("mousemove", done);
    window.addEventListener("dragend", done, true);
    return () => (window.removeEventListener("mousemove", done), window.removeEventListener("dragend", done, true));
  }, [nativeDrag]);

  const menuFor = useCallback(
    (d: Dragged, title: string): MenuStep => ({
      title: `${d.pickId !== undefined ? "Move" : "Add"} ${title} to…`,
      items: blocks.map<MenuItem>((b) => {
        const c = check(d, b);
        return { id: `to-${keyOf(b)}`, label: b.label, action: d.pickId !== undefined ? "pick.move" : "pick.add", ...(c.ok ? { hint: c.text, run: () => place(d, b) } : { disabled: c.why, expected: true }) };
      }),
    }),
    [blocks, check, place],
  );

  // A long press on a touch screen: the finger drags; the block under it shows the fit; lifting drops it there.
  const pressRef = useRef<{ timer: number; x: number; y: number; d: Dragged } | null>(null);
  const touchStart = useCallback((d: Dragged, e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const at = { x: e.clientX, y: e.clientY };
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      setDragging(d);
      setTouch(at);
      navigator.vibrate?.(10);
    }, 450);
    pressRef.current = { timer, ...at, d };
  }, []);
  useEffect(() => {
    const cancelPress = (e: PointerEvent) => {
      const p = pressRef.current;
      if (p && (e.type !== "pointermove" || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8)) (clearTimeout(p.timer), (pressRef.current = null));
    };
    window.addEventListener("pointermove", cancelPress);
    window.addEventListener("pointerup", cancelPress);
    window.addEventListener("pointercancel", cancelPress);
    return () => (window.removeEventListener("pointermove", cancelPress), window.removeEventListener("pointerup", cancelPress), window.removeEventListener("pointercancel", cancelPress));
  }, []);
  useEffect(() => {
    if (!touch) return;
    // WD-2: the block panel's Take off area is a target too ("takeoff").
    const target = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest("[data-takeoff]") ? "takeoff" : (el?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null);
    };
    const move = (e: PointerEvent) => (e.preventDefault(), setTouch({ x: e.clientX, y: e.clientY }), setHover(target(e.clientX, e.clientY)));
    const up = (e: PointerEvent) => {
      const k = target(e.clientX, e.clientY);
      const { dragging: d, blocks: bs } = ref.current;
      const b = bs.find((x) => keyOf(x) === k);
      setTouch(null);
      setDragging(null);
      setHover(null);
      if (d && k === "takeoff" && d.pickId !== undefined) void takeOff(d.pickId);
      else if (d && b) void place(d, b);
    };
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("contextmenu", block);
    document.body.classList.add("touch-dragging");
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("contextmenu", block);
      document.body.classList.remove("touch-dragging");
    };
  }, [touch !== null, place, takeOff]); // eslint-disable-line react-hooks/exhaustive-deps

  const api: DndApi = {
    dragging,
    hover,
    setHover,
    begin: (d) => setDragging(d),
    end: () => (setDragging(null), setHover(null)),
    blocks,
    check,
    place,
    openSlot: onOpenSlot,
    refresh: onRefresh ?? onChanged,
    menuFor,
    touchStart,
    note: (t, u) => note(t, u ?? null),
    takeOff,
  };
  return (
    <WeekDnd.Provider value={api}>
      {children}
      {touch && dragging && (
        <div className="touch-ghost" style={{ left: touch.x, top: touch.y }} aria-hidden="true">
          {dragging.itemId > 0 ? `#${dragging.itemId} ` : ""}{dragging.title}
        </div>
      )}
      {toast && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="mini" onClick={() => { const u = toast.undo!; setToast({ ...toast, undo: null }); void u().then(() => setToast({ id: Date.now(), text: "Undone", undo: null }), (e: unknown) => setToast({ id: Date.now(), text: errText(e), undo: null })); }}>
              Undo
            </button>
          )}
          <button type="button" className="mini quiet" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </WeekDnd.Provider>
  );
}

/** A Week block as a drop target: its class while something drags, and the fit tip on the one under the pointer. */
export function useDropTarget(at: { date: IsoDate; half: Half } | null): { props: HTMLAttributes<HTMLElement> & { "data-drop"?: string }; cls: string; tip: ReactNode } {
  const dnd = useContext(WeekDnd);
  const block = dnd && at ? dnd.blocks.find((b) => b.date === at.date && b.half === at.half) ?? null : null;
  if (!dnd || !block) return { props: {}, cls: "", tip: null };
  const key = keyOf(block);
  const d = dnd.dragging;
  const c = d ? dnd.check(d, block) : null;
  const over = dnd.hover === key;
  const enterOrOver = (e: React.DragEvent<HTMLElement>) => {
    if (!d) return;
    if (c?.ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = d.pickId !== undefined ? "move" : "copy";
    } else e.dataTransfer.dropEffect = "none";
    if (!over) dnd.setHover(key);
  };
  const props: HTMLAttributes<HTMLElement> & { "data-drop": string } = {
    "data-drop": key,
    onDragOver: (e) => enterOrOver(e),
    // UI-8: dragenter too (HTML5 wants both). A pointer that ends its move on a dragenter (into a child of the block)
    // with no dragover after it left the block unmarked: no fit tip, and the drop target never knew it was under it.
    onDragEnter: (e) => enterOrOver(e),
    onDragLeave: (e) => {
      if (over && !(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) dnd.setHover(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      dnd.end();
      if (d && c?.ok) void dnd.place(d, block);
    },
  };
  const cls = !d || !c ? "" : c.ok ? (over ? " drop-over" : " drop-ok") : " drop-no";
  const tip = d && c && over ? <span className={`drop-tip${c.ok ? (c.over ? " over" : "") : " no"}`} role="status">{c.ok ? c.text : `Can't drop here · ${c.why}`}</span> : null;
  return { props, cls, tip };
}

/** A story row or a planned pick as a drag source (none on the phone, where Add to… is the way). */
export function useDragSource(d: Dragged | null): HTMLAttributes<HTMLElement> {
  const dnd = useContext(WeekDnd);
  const phone = usePhone();
  if (!dnd || !d || phone) return {};
  return {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.setData(STORY_DRAG, JSON.stringify(d));
      e.dataTransfer.effectAllowed = d.pickId !== undefined ? "move" : "copy";
      setTimeout(() => dnd.begin(d), 0);
    },
    onDragEnd: () => dnd.end(),
    onPointerDown: (e) => dnd.touchStart(d, e),
  };
}

/** The pick's drag (a planned DevOps story, still to do) on Week's cards and the panel's Plan list. */
export function pickDragged(p: Pick): Dragged | null {
  if (p.status !== "planned") return null;
  if (p.kind === "item" && p.itemId !== null) return { clientKey: p.clientKey, itemId: p.itemId, size: p.size, title: p.title, pickId: p.id, remainingMinutes: p.remainingMinutes };
  // WK-3: a to-do with no DevOps item (a Deployment, an intention, a draft) moves by drag too; a negative id never
  // matches a real item in the "already planned here" check.
  return { clientKey: p.clientKey, itemId: -p.id, size: p.size, title: p.title, pickId: p.id, remainingMinutes: p.remainingMinutes };
}

/** "Move to…" for a planned pick: a small button that opens the blocks with their fit. */
export function MoveTo({ pick }: { pick: Pick }) {
  const dnd = useContext(WeekDnd);
  const { open } = useContext(MenuCtx);
  const d = pickDragged(pick);
  if (!dnd || !d) return null;
  return (
    <button type="button" className="link-btn ps-moveto" onClick={(e) => (e.stopPropagation(), openAt(e, open, dnd.menuFor(d, `#${d.itemId}`)))}>
      Move to…
    </button>
  );
}

function openAt(e: ReactMouseEvent | ReactKeyboardEvent, open: (at: { x: number; y: number }, s: MenuStep) => void, step: MenuStep) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  open({ x: r.left, y: r.bottom + 4 }, step);
}
