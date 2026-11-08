// PV-1 (D569 to D574): Week plans stories into blocks.
// - The block panel's "Your stories for <client>": only my open stories for that client, grouped under their feature,
//   ranked by this week's plan then DevOps backlog order (plan/blockstories.ts). Features are headers, never rows.
// - A feature on this week's plan with no stories of mine: Add a story for me (a draft under it, planned here, then
//   created in DevOps through the write framework in one go), Break down, and Take one on a teammate's story.
// - Drag and drop onto the Week's blocks (native drag, a long press on touch, "Add to…" and "Move to…" from the
//   keyboard), with the fit shown on the target and Undo after each drop (plan/weekdrop.ts).
import { userZone } from "../week/zone.ts";
import { openSend } from "./send-event.ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { blockLabel, blockStories, groupLine, type StoryGroup, type StoryRow } from "../plan/blockstories.ts";
import { STORY_SIZES, type StorySize } from "../plan/estimate.ts";
import { dropCheck, type Dragged, type DropCheck } from "../plan/weekdrop.ts";
import type { Pick } from "../plan/types.ts";
import type { ClientWork, Day, Half, IsoDate, Slot, Week, WorkItem } from "../week/types.ts";
import { ActionRefusal, call, planAction } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { MenuCtx } from "./Menus.tsx";
import type { MenuItem, MenuStep } from "./menu.ts";
import { PV_BREAKDOWN_EVENT, rowHead } from "./menu.ts";
import { SizeChip } from "./plan/Estimate.tsx";
import { Avatar, usePhotos } from "./Presence.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { usePhone } from "./viewport.ts";
import { WorkLink } from "./WorkLink.tsx";

/** The drag type for a story or a planned pick moving between Week's blocks. */
export const STORY_DRAG = "application/x-focustime-story";
/** PV-1: "Break down" sends { clientKey, itemId }; BD-1's Break down panel (ui/BreakDownPanel.tsx) opens for it. */
export const openBreakdown = (clientKey: string, itemId: number) => window.dispatchEvent(new CustomEvent(PV_BREAKDOWN_EVENT, { detail: { clientKey, itemId } }));

/** One of the week's blocks a story can go to. */
export type Block = { date: IsoDate; half: Half; label: string; slot: Slot; ptoDay: boolean; catchUp: boolean };
const keyOf = (b: { date: IsoDate; half: Half }) => `${b.date}:${b.half}`;
const live = (p: Pick) => p.status === "planned" || p.status === "done";

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

export function WeekDndProvider({ data, week, now, onChanged, onRefresh, onOpenSlot, children }: { data: WeekLoadData; week: Week; now: string; onChanged: () => void; /** Reads DevOps again (after a create or Take one, so the story shows under its feature). */ onRefresh?: () => void; onOpenSlot: (date: IsoDate, half: Half) => void; children: ReactNode }) {
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
        if (d.pickId !== undefined) {
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
          const r = await planAction("pick.add", { date: b.date, half: b.half, clientKey: d.clientKey, itemId: d.itemId, ...(d.size ? { size: d.size } : {}) });
          onChanged();
          const id = r.pick?.id;
          note(`Added to ${b.label}${r.note ? ` · ${r.note}` : ""}`, id ? async () => (await planAction("pick.remove", { id }), onChanged()) : null);
        }
      } catch (e) {
        note(errText(e));
      }
    },
    [check, note, onChanged, picks, data.planDay.date],
  );

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
    const target = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null;
    const move = (e: PointerEvent) => (e.preventDefault(), setTouch({ x: e.clientX, y: e.clientY }), setHover(target(e.clientX, e.clientY)));
    const up = (e: PointerEvent) => {
      const k = target(e.clientX, e.clientY);
      const { dragging: d, blocks: bs } = ref.current;
      const b = bs.find((x) => keyOf(x) === k);
      setTouch(null);
      setDragging(null);
      setHover(null);
      if (d && b) void place(d, b);
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
  }, [touch !== null, place]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <button type="button" className="mini" onClick={() => void toast.undo!().then(() => setToast({ id: Date.now(), text: "Undone", undo: null }), (e: unknown) => setToast({ id: Date.now(), text: errText(e), undo: null }))}>
              Undo
            </button>
          )}
          <button type="button" className="mini quiet" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
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
  if (p.kind === "item" && p.itemId !== null) return { clientKey: p.clientKey, itemId: p.itemId, size: p.size, title: p.title, pickId: p.id };
  // WK-3: a to-do with no DevOps item (a Deployment, an intention, a draft) moves by drag too; a negative id never
  // matches a real item in the "already planned here" check.
  return { clientKey: p.clientKey, itemId: -p.id, size: p.size, title: p.title, pickId: p.id };
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

// ---------- the panel's "Your stories for <client>" ----------

export function YourStories({ data, work, clientName, slot, onChanged }: { data: WeekLoadData; work: ClientWork; clientName: string; slot: Slot; onChanged: () => void }) {
  const weekPicks = useMemo(() => Object.values(data.plan ?? {}).flatMap((d) => d.picks).filter(live), [data.plan]);
  const weekStart = data.weekStart;
  const groups = useMemo(() => blockStories({ sizes: data.planning.sizes, work, list: data.weekFeatures, weekStart, picks: weekPicks, date: slot.date, half: slot.half }), [work, data.weekFeatures, weekStart, weekPicks, slot.date, slot.half]);
  const emails = [...new Set(groups.flatMap((g) => g.others.map((o) => o.assignedToEmail).filter((e): e is string => !!e)))];
  const photos = usePhotos({ emails });
  return (
    <section className="dp-section ps" aria-label={`Your stories for ${clientName}`} data-panel-focus="features">
      <h3>Your stories for {clientName}</h3>
      {!groups.length && <p className="dp-empty">No open stories assigned to you for {clientName}.</p>}
      {groups.map((g) => (
        <StoryGroupView key={g.feature?.id ?? "none"} g={g} work={work} clientName={clientName} slot={slot} onChanged={onChanged} photoFor={photos.photoFor} />
      ))}
    </section>
  );
}

function StoryGroupView({ g, work, clientName, slot, onChanged, photoFor }: { g: StoryGroup; work: ClientWork; clientName: string; slot: Slot; onChanged: () => void; photoFor: (email?: string | null) => string | null }) {
  const f = g.feature;
  const empty = !!f && g.committed && !g.stories.length;
  return (
    <div className={`ps-group${g.committed ? " committed" : ""}`} role="group" aria-label={f ? `${f.type} #${f.id} ${f.title}` : "No feature"}>
      <div className="ps-head">
        {f ? (
          <>
            <TypeIcon clientKey={work.clientKey} type={f.type} />
            <WorkLink clientKey={work.clientKey} url={f.url} className="ps-feat" title={`#${f.id} ${f.title}`}>
              {f.title}
            </WorkLink>
            {g.committed && <span className="ps-tag" title="On this week's plan">This week</span>}
          </>
        ) : (
          <span className="ps-feat muted">No feature</span>
        )}
        {g.stories.length > 0 && <span className="ps-line">{groupLine(g)}</span>}
      </div>
      {g.stories.length > 0 && (
        <ul className="ps-rows">
          {g.stories.map((r) => (
            <StoryRowView key={r.item.id} r={r} work={work} slot={slot} clientName={clientName} />
          ))}
        </ul>
      )}
      {empty && <NoStoriesYet feature={f!} others={g.others} work={work} clientName={clientName} slot={slot} onChanged={onChanged} photoFor={photoFor} />}
    </div>
  );
}

function StoryRowView({ r, work, slot, clientName }: { r: StoryRow; work: ClientWork; slot: Slot; clientName: string }) {
  const dnd = useContext(WeekDnd);
  const { open, env: menuEnv } = useContext(MenuCtx);
  const { item } = r;
  const d: Dragged = { clientKey: work.clientKey, itemId: item.id, size: r.size, title: item.title };
  const drag = useDragSource(r.here ? null : d);
  const block = dnd?.blocks.find((b) => b.date === slot.date && b.half === slot.half) ?? null;
  const canHere = !!dnd && !!block && !r.here && dnd.check(d, block).ok;
  const moving = r.here ?? r.elsewhere;
  const more = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    const items: MenuItem[] = [
      ...(menuEnv ? [{ id: "open", label: "Open in DevOps", action: "link.open", run: () => menuEnv.openLink(work.clientKey, item.url) } as MenuItem] : []),
      ...(dnd ? [{ id: "add", label: "Add to…", action: "pick.add", next: () => dnd.menuFor(d, `#${item.id}`) } as MenuItem] : []),
      ...(dnd && moving ? [{ id: "move", label: `Move from ${blockLabel(moving)} to…`, action: "pick.move", next: () => dnd.menuFor({ ...d, pickId: moving.pickId }, `#${item.id}`) } as MenuItem] : []),
      // SW-1: hand it to a teammate's week.
      { id: "send", label: "Send to…", hint: "a teammate's week", action: "send.create", run: () => openSend({ clientKey: work.clientKey, clientName, itemId: item.id, level: "story", title: item.title, itemType: item.type, url: item.url, parentId: item.parentId }) } as MenuItem,
    ];
    openAt(e, open, { title: `#${item.id}: ${item.title}`, items, head: rowHead({ id: item.id, title: item.title, client: clientName }) });
  };
  return (
    <li className={`ps-row${r.here ? " here" : ""}`} data-story={item.id} {...drag}>
      {!r.here && dnd && (
        <button type="button" className="drag-handle" aria-label={`Drag #${item.id} to a block, or press Enter to choose one`} title="Drag to a block on the week" onClick={(e) => (e.stopPropagation(), openAt(e, open, dnd.menuFor(d, `#${item.id}`)))}>
          ⋮⋮
        </button>
      )}
      <TypeIcon clientKey={work.clientKey} type={item.type} />
      <span className="ps-id">#{item.id}</span>
      <WorkLink clientKey={work.clientKey} url={item.url} className="ps-title" title={item.title}>
        {item.title}
      </WorkLink>
      <SizeChip size={r.size} title={item.title} wide />
      <span className="ps-state">{item.state}</span>
      {r.here ? (
        <span className="ps-here">In this block</span>
      ) : r.elsewhere ? (
        <button type="button" className="link-btn ps-planned" onClick={(e) => (e.stopPropagation(), dnd?.openSlot(r.elsewhere!.date, r.elsewhere!.half))} title="Open that block">
          Planned · {blockLabel(r.elsewhere)}
        </button>
      ) : null}
      {canHere && (
        <button type="button" className="mini ps-add" onClick={(e) => (e.stopPropagation(), void dnd!.place(d, block!))}>
          Add to this block
        </button>
      )}
      <button type="button" className="more-btn ps-more" aria-label={`More for #${item.id}`} aria-haspopup="menu" onClick={more}>
        ⋯
      </button>
    </li>
  );
}

function NoStoriesYet({ feature, others, work, clientName, slot, onChanged, photoFor }: { feature: WorkItem; others: readonly WorkItem[]; work: ClientWork; clientName: string; slot: Slot; onChanged: () => void; photoFor: (email?: string | null) => string | null }) {
  const env = useDevOpsWrite();
  const dnd = useContext(WeekDnd);
  const can = !!env?.can(work.clientKey);
  const people = [...new Map(others.filter((o) => o.assignedTo).map((o) => [(o.assignedToEmail ?? o.assignedTo!).toLowerCase(), o])).values()];
  return (
    <div className="ps-empty">
      <p className="ps-none">No stories for you yet</p>
      {can ? (
        <AddStoryForMe feature={feature} work={work} slot={slot} onChanged={onChanged} />
      ) : (
        <p className="ps-nopat">
          <button type="button" className="link-btn" onClick={() => env?.enable(work.clientKey)}>
            Add DevOps write access for {clientName} in Settings
          </button>
        </p>
      )}
      <div className="ps-actions">
        <button type="button" className="link-btn ps-breakdown" onClick={() => openBreakdown(work.clientKey, feature.id)}>
          Break down
        </button>
      </div>
      {others.length > 0 && (
        <div className="ps-others">
          <div className="ps-others-head">
            <span className="ps-faces" aria-hidden="true">
              {people.slice(0, 4).map((o) => (
                <Avatar key={o.id} name={o.assignedTo!} photo={photoFor(o.assignedToEmail)} size={20} />
              ))}
            </span>
            <span>
              {others.length} open {others.length === 1 ? "story" : "stories"} by {people.length === 1 ? people[0]!.assignedTo : people.length ? `${people.length} teammates` : "nobody yet"}
            </span>
          </div>
          <ul className="ps-rows">
            {others.map((o) => (
              <li key={o.id} className="ps-row other">
                <TypeIcon clientKey={work.clientKey} type={o.type} />
                <span className="ps-id">#{o.id}</span>
                <WorkLink clientKey={work.clientKey} url={o.url} className="ps-title" title={o.title}>
                  {o.title}
                </WorkLink>
                <span className="ps-state">{o.assignedTo ?? "Unassigned"}</span>
                {can && env ? (
                  <button type="button" className="mini ps-take" onClick={() => void env.begin(work.clientKey, [{ kind: "assign", itemId: o.id }], ({ confirmed }) => (confirmed ? (dnd ? dnd.refresh() : onChanged()) : undefined))}>
                    Take one
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * "Add a story for me": a title (and an optional size), then Enter: a draft story under the feature, planned in this
 * block, and the create preview for it (the parent type's default child, assigned to me). Confirm makes it a DevOps
 * item in the plan; a cancel before anything is sent removes the draft and its pick, so nothing is left behind.
 */
function AddStoryForMe({ feature, work, slot, onChanged }: { feature: WorkItem; work: ClientWork; slot: Slot; onChanged: () => void }) {
  const env = useDevOpsWrite();
  const dnd = useContext(WeekDnd);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<StorySize | null>(null);
  const [busy, setBusy] = useState(false);
  const childType = work.types?.find((t) => t.name === feature.type)?.defaultChild ?? null;
  const submit = async () => {
    const t = title.trim();
    if (!t || !env || busy) return;
    setBusy(true);
    try {
      const { draft } = await call<{ draft: { id: number } }>("draft.add_story", { clientKey: work.clientKey, parentItemId: feature.id, title: t, ...(size ? { size } : {}) });
      let pickId: number | null = null;
      try {
        pickId = (await planAction("pick.add", { date: slot.date, half: slot.half, clientKey: work.clientKey, draftId: draft.id, ...(size ? { size } : {}) })).pick?.id ?? null;
      } catch (e) {
        await call("draft.remove", { id: draft.id }).catch(() => undefined);
        throw e;
      }
      setTitle("");
      setSize(null);
      await env.begin(work.clientKey, [{ kind: "create", draftId: draft.id, ...(childType ? { type: childType } : {}) }], ({ confirmed, sent }) => {
        if (!confirmed && !sent)
          void (async () => {
            if (pickId !== null) await planAction("pick.remove", { id: pickId }).catch(() => undefined);
            await call("draft.remove", { id: draft.id }).catch(() => undefined);
            onChanged();
          })();
        else if (confirmed) (dnd ? dnd.refresh() : onChanged());
        else onChanged();
      });
    } catch (e) {
      dnd?.note(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ps-addme" role="group" aria-label={`Add a story for me under #${feature.id}`}>
      <input
        type="text"
        className="ps-addme-box"
        value={title}
        maxLength={200}
        disabled={busy}
        placeholder="Add a story for me, then Enter"
        aria-label={`New story title under ${feature.title}`}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), void submit());
          e.stopPropagation();
        }}
      />
      <span className="ps-sizes" role="radiogroup" aria-label="Size (optional)">
        {STORY_SIZES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={size === s} className={`size-chip${size === s ? "" : " unsized"}`} onClick={() => setSize(size === s ? null : s)}>
            {s}
          </button>
        ))}
      </span>
    </div>
  );
}
