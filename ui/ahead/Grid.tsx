// AH-1, BL-1: Backlog › Grid. Every client's DevOps on one screen: each client a section that folds (remembered on this
// device) with a header line (name, project, "33 items · 5 need attention", "you're a lead here"), its items as a tree
// BL-2: the level picked in Filter › Levels as a list in its own backlog order, each row with its rank number and its
// parent as a quiet label (press it to show only what's under that parent), opening to what is one level under it in
// that level's order (by target date where the project has none, said once in the header). Columns: Item,
// State, Dates ("Aug 10 → Nov 6"), Assigned to, Size, Status.
//
// No dashes: an empty cell is empty; where I may fill it, "+ date", "+ owner" or "+ size" shows on hover and on focus; a
// field the type's process doesn't have stays empty with the reason on hover. Status is one chip per row
// (plan/backlog-status.ts): the item's health when it has one, else its most important gap, the rest as a quiet "+N".
//
// Edits are as AH-5 made them: a click or Enter on an editable cell opens its editor as a popover anchored to the cell,
// Enter saves, Esc cancels, Tab saves and moves to the next editable cell; everything goes into my change set and
// nothing is written until Save. Arrows move between cells; on the Item cell Left collapses and Right expands. Space
// selects a row (Shift+Space or Shift+click a range); with rows selected the bulk bar offers what the Backlog mode did.
// Esc clears the selection.
//
// ED-2: on the Item cell F2 renames in place, M opens Move… (ED-1's picker), E opens the story card ready to edit, and
// the row's ⋯ (Shift+F10) has the same. A row can also be dragged onto a row one level up in the same client: only rows
// that can take it light up, the gaps between rows do nothing, Esc cancels, and dropping stages the move. A move
// changes the parent link only: there is no drag to reorder, and FocusTime never changes the backlog's order.
//
// The table's other shape is Needs attention (Readiness before BL-1), in its own order: only the items with something to
// fix, under their parents for context, each with its fix (Break down, Set dates, Assign, Size) and Skip in its Status
// cell.
import type React from "react";
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { moveItemFrom, moveProblem, type ChangeField } from "../../plan/ahead-edit.ts";
import { shortName } from "../../plan/ahead-people.ts";
import { ageDays, ageText, isStale } from "../../plan/backlog.ts";
import { NEED_ACTION, statusOf, statusWords, type Status } from "../../plan/backlog-status.ts";
import type { FixEntry } from "../../plan/fixnext.ts";
import { skipEnds, type Skips } from "../../plan/readiness.ts";
import { isOpenRow, levelRank, setRow } from "../../plan/gantt-tree.ts";
import { openItemCardToEdit, WorkLink } from "../WorkLink.tsx";
import { MenuCtx } from "../Menus.tsx";
import type { MenuItem } from "../menu.ts";
import { MovePicker, RenameBox, Unsaved, unsavedWords } from "./GridEdits.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import { useAhead } from "./Ahead.tsx";
import { BulkBar } from "./Bulk.tsx";
import { Chevron, ChevronSpace } from "./Chevron.tsx";
import { CellEditor } from "./Editors.tsx";
import type { GridLayout } from "./layout.ts";
import { isOpen, type LoadClient, type Row, type Tier } from "./model.ts";
import type { ParentLabel } from "../../plan/backlog-list.ts";
import { NewUnder } from "./NewUnder.tsx";
import { usePref } from "./prefs.ts";
import { Icon } from "../icons.tsx";

type Col = "item" | "state" | "dates" | "assignee" | "size" | "status";
/** The columns at each layout, in order (BL-1: Start and Target are one Dates cell at every size). */
export const COLUMNS: Record<GridLayout, readonly Col[]> = {
  wide: ["item", "state", "dates", "assignee", "size", "status"],
  dates: ["item", "state", "dates", "assignee", "size", "status"],
  dots: ["item", "state", "dates", "assignee", "size", "status"],
  cards: ["item", "state", "dates", "assignee", "status"],
};
const HEAD: Record<Col, string> = { item: "Item", state: "State", dates: "Dates", assignee: "Assigned to", size: "Size", status: "Status" };
const WIDTH: Record<Col, string> = { item: "w-item", state: "w-state", dates: "w-dates", assignee: "w-who", size: "w-size", status: "w-ready" };
const EDIT: Partial<Record<Col, ChangeField>> = { state: "state", dates: "start", assignee: "assignee", size: "size" };
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isKeys = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A row as the Grid shows it: in the list its rank and parent, and in Needs attention its entry (null: shown for context). */
export type GridRow = Row & { rank?: number | null; parent?: ParentLabel | null; entry?: FixEntry | null; /** The list: the last change in DevOps ("5 days ago · state"). */ lastWords?: string };
export type GridGroup = {
  client: LoadClient;
  rows: GridRow[];
  rankedBy: "backlog" | "target";
  /** Items the client's section counts ("33 items"). */
  count: number;
  /** Items that need attention under the same filters ("5 need attention"). */
  need: number;
  /** Needs attention: the rows past the first 10, shown with Show more. */
  more?: { hidden: number; all: boolean; toggle: () => void };
  /** Needs attention: the entries I skipped (2 weeks each), with Unskip. */
  skipped?: { e: FixEntry; r: Row }[];
  /** BL-2: the level listed. */
  level?: Tier;
};
export type GridShape = "list" | "attention";

export function Grid({ groups, layout = "wide", shape = "list", skip, unskip, skips, onChanged }: { groups: GridGroup[]; layout?: GridLayout; shape?: GridShape; skip?: (k: string) => void; unskip?: (k: string) => void; skips?: Skips; onChanged?: () => void }) {
  const COLS = COLUMNS[layout];
  const a = useAhead();
  const { fold, setFold } = a.view;
  const [focus, setFocus] = useState<{ key: string; col: Col } | null>(null);
  const [editing, setEditing] = useState<{ key: string; col: Col } | null>(null);
  const [folded, setFolded] = usePref<string[]>("grid.folded", isKeys, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // ED-2: the row whose Move… picker is open; a drag in progress; what a screen reader last heard.
  const [moving, setMoving] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [said, setSaid] = useState("");
  const say = (text: string) => setSaid((old) => (old === text ? `${text}\u00a0` : text));
  const anchor = useRef<string | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  // The rows on screen, in order: a client folded hides its rows; a collapsed row hides what's under it (by depth, so
  // the same rule works for the tree and for Needs attention's rows under their parents).
  const shown = useMemo(() => {
    const out: { g: GridGroup; rows: { r: GridRow; kids: boolean }[] }[] = [];
    for (const g of groups) {
      const rows: { r: GridRow; kids: boolean }[] = [];
      if (!folded.includes(g.client.clientKey)) {
        let closedAt: number | null = null;
        g.rows.forEach((r, i) => {
          if (closedAt !== null && r.depth > closedAt) return;
          closedAt = null;
          const kids = (g.rows[i + 1]?.depth ?? -1) > r.depth;
          rows.push({ r, kids });
          if (kids && !isOpenRow(fold, r)) closedAt = r.depth;
        });
      }
      out.push({ g, rows });
    }
    return out;
  }, [groups, fold, folded, shape]);
  const flat = shown.flatMap((x) => x.rows.map((y) => y.r));
  // A row that left (skipped, fixed, folded away, searched out) gives the grid's one Tab stop back to the first row.
  const live = focus && flat.some((x) => x.key === focus.key) ? focus : null;
  const byKey = useMemo(() => new Map(groups.flatMap((g) => g.rows.map((r) => [r.key, r] as const))), [groups]);
  // Selection: only rows still listed stay selected.
  useEffect(() => {
    setSel((s) => {
      const keep = new Set([...s].filter((k) => byKey.has(k)));
      return keep.size === s.size ? s : keep;
    });
  }, [byKey]);
  const chosen = [...sel].map((k) => byKey.get(k)).filter((r): r is GridRow => !!r && !r.context);
  const pick = (r: GridRow, range: boolean) => {
    setSel((s) => {
      const n = new Set(s);
      if (range && anchor.current) {
        const i = flat.findIndex((x) => x.key === anchor.current);
        const j = flat.findIndex((x) => x.key === r.key);
        if (i >= 0 && j >= 0) {
          for (const x of flat.slice(Math.min(i, j), Math.max(i, j) + 1)) if (!x.context) n.add(x.key);
          return n;
        }
      }
      if (n.has(r.key)) n.delete(r.key);
      else n.add(r.key);
      return n;
    });
    anchor.current = r.key;
  };

  const cellKey = (k: string, c: Col) => `${k}|${c}`;
  const backTo = (key: string, col: Col) => requestAnimationFrame(() => {
    setFocus({ key, col });
    cells.current.get(cellKey(key, col))?.focus({ preventScroll: true });
  });
  const move = (dr: number, dc: number) => {
    const f = focus ?? (flat[0] ? { key: flat[0].key, col: "item" as Col } : null);
    if (!f) return;
    const i = Math.max(0, Math.min(flat.length - 1, flat.findIndex((r) => r.key === f.key) + dr));
    const at = COLS.indexOf(f.col);
    const c = COLS[Math.max(0, Math.min(COLS.length - 1, (at < 0 ? 0 : at) + dc))]!;
    const r = flat[i];
    if (!r) return;
    setFocus({ key: r.key, col: c });
    cells.current.get(cellKey(r.key, c))?.focus();
  };
  /** BL-2: the row a row is opened under (the nearest row above it at a smaller depth), to go back to with Left. */
  const upOf = (r: (typeof flat)[number]) => {
    if (!r.depth) return null;
    const i = flat.findIndex((x) => x.key === r.key);
    for (let j = i - 1; j >= 0; j--) if (flat[j]!.depth < r.depth) return () => backTo(flat[j]!.key, "item");
    return null;
  };
  // A notice opened one item: show it, focused.
  useEffect(() => {
    if (!a.focusItem) return;
    const r = flat.find((x) => x.item.id === a.focusItem);
    if (!r) return;
    setFocus({ key: r.key, col: "item" });
    const el = cells.current.get(cellKey(r.key, "item"));
    el?.scrollIntoView({ block: "center" });
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.focusItem, flat.length]);

  // ED-2: a drag onto a new parent. The rows that can take the dragged one: same client, open, exactly one level up
  // (ED-1's rule), and not the parent it already has. Nothing else is a target: not other rows, not the gaps between.
  const dragged = drag ? (byKey.get(drag.key) ?? null) : null;
  const drops = useMemo(() => {
    const out = new Set<string>();
    if (!dragged) return out;
    const c = groups.find((g) => g.client.clientKey === dragged.clientKey)?.client;
    if (!c) return out;
    const it = moveItemFrom(dragged.item);
    for (const r of flat) if (r.clientKey === dragged.clientKey && r.item.id !== dragged.item.parentId && moveProblem(it, moveItemFrom(r.item), c.project ?? c.clientName) === null) out.add(r.key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragged?.key, flat.length, groups]);
  const dropsRef = useRef(drops);
  dropsRef.current = drops;
  const startDrag = (r: GridRow, e: React.PointerEvent) => {
    if (e.button !== 0 || a.readOnly || !r.editable || !r.has.parent || (e.target as HTMLElement).closest("input, button, select, textarea, [role=listbox], .cell-pop")) return;
    const x0 = e.clientX, y0 = e.clientY;
    let on = false;
    const overAt = (x: number, y: number) => {
      const k = (document.elementFromPoint(x, y)?.closest("tr[data-key]") as HTMLElement | null)?.dataset.key ?? null;
      return k && dropsRef.current.has(k) ? k : null;
    };
    const move = (ev: PointerEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!on) {
        on = true;
        document.body.classList.add("ah-dragging");
        setEditing(null);
        setMoving(null);
      }
      setDrag({ key: r.key, x: ev.clientX, y: ev.clientY, over: overAt(ev.clientX, ev.clientY) });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("ah-dragging");
      setDrag(null);
    };
    // The click that ends a drag isn't a click on the row (it would open the card or a cell's editor).
    const eatClick = () => {
      const eat = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
      window.addEventListener("click", eat, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", eat, true), 0);
    };
    const up = (ev: PointerEvent) => {
      const over = on ? overAt(ev.clientX, ev.clientY) : null;
      end();
      if (!on) return;
      eatClick();
      const to = over ? byKey.get(over) : null;
      if (!to) return say(`#${r.item.id} wasn't moved.`);
      void a.tryStage(r, "parent", { id: to.item.id, title: to.item.title }).then((why) => {
        if (why) return a.error(why), say(why);
        setFold((f) => setRow(f, to, true));
        say(`#${r.item.id} ${r.item.title} moves under ${to.item.title}. Not saved until you save.`);
      });
    };
    const cancel = () => {
      end();
      if (!on) return;
      say("Move cancelled.");
      // Esc while the button is still down: the release that follows isn't a click either (review 2).
      window.addEventListener("pointerup", eatClick, { once: true });
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !on) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };
  // What the drag says as it goes: how many rows can take it, then the row under the pointer.
  const dragOver = drag?.over ?? null;
  useEffect(() => {
    if (!dragged) return;
    say(dragOver ? `Move under ${byKey.get(dragOver)?.item.title ?? ""}` : drops.size ? `Dragging #${dragged.item.id} ${dragged.item.title}. ${plural(drops.size, "row", "rows")} can take it. Escape cancels.` : `Dragging #${dragged.item.id}. No row shown here can take it. Use Move… (M) instead. Escape cancels.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragged?.key, dragOver, drops.size]);
  const toggle = (r: Row, open?: boolean) => setFold((f) => setRow(f, r, open ?? !isOpenRow(f, r)));
  const foldClient = (k: string) => setFolded((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const ticks = !a.readOnly;
  // BH-1: each client's stale count, and its rows that can be ticked (all of them at once from its header).
  const weeks = a.load.staleWeeks ?? 6;
  const staleOf = (g: GridGroup) => g.rows.filter((r) => !r.context && isOpen(r.item) && isStale(r.item, a.load.today, weeks)).length;
  // Select all takes the rows shown: never what sits under a closed row.
  const pickable = (rows: readonly { r: GridRow }[]) => rows.map((x) => x.r).filter((r) => !r.context);
  return (
    <div className={`ah-grid-box lay-${layout} shape-${shape}${sel.size ? " has-sel" : ""}${drag ? " dragging" : ""}`} onKeyDown={(e) => e.key === "Escape" && sel.size > 0 && !editing && (e.stopPropagation(), setSel(new Set()))}>
      <span className="sr-only" role="status" aria-live="polite" data-ed2-said>
        {said}
      </span>
      {drag && dragged && (
        <span className="ah-drag-say" style={{ left: drag.x + 14, top: drag.y + 16 }} aria-hidden="true">
          {drag.over ? `Move under ${byKey.get(drag.over)?.item.title ?? ""}` : drops.size ? `Drag onto a lit row to move #${dragged.item.id}` : "No row here can take it. Use Move… (M)"}
        </span>
      )}
      {ticks && <BulkBar chosen={chosen} titleOf={(k, id) => byKey.get(`${k}:${id}`)?.item.title ?? ""} select={(keys) => setSel(new Set(keys))} onChanged={onChanged ?? (() => null)} />}
      {shown.map(({ g, rows }) => {
        const c = g.client;
        const open = !folded.includes(c.clientKey);
        return (
          <section key={c.clientKey} className={`ah-client${open ? "" : " folded"}`} style={{ "--c": a.color(c.clientKey) } as CSSProperties} aria-label={c.clientName}>
            <h3 className="ah-client-head">
              <button type="button" className="ah-client-fold" aria-expanded={open} onClick={() => foldClient(c.clientKey)} title={open ? `Fold ${c.clientName}` : `Unfold ${c.clientName}`}>
                <Icon name="closed" className={`ah-chev-svg${open ? " open" : ""}`} />
                <span className="dl-swatch" aria-hidden="true" />
                <span className="ah-client-name">{c.clientName}</span>
              </button>
              {c.project && <span className="muted">· {c.project}</span>}
              {c.status === "ok" && (
                <span className="muted ah-client-counts">
                  · {plural(g.count, "item", "items")}
                  {g.need > 0 && shape !== "attention" ? ` · ${g.need} ${g.need === 1 ? "needs" : "need"} attention` : ""}
                  {staleOf(g) > 0 ? ` · ${staleOf(g)} stale` : ""}
                </span>
              )}
              {ticks && open && pickable(rows).length > 1 && (() => {
                const all = pickable(rows);
                const n = all.filter((r) => sel.has(r.key)).length;
                return (
                  <label className="ah-client-all" title={`Select all ${all.length} shown in ${c.clientName}`}>
                    <input
                      type="checkbox"
                      checked={n === all.length}
                      ref={(el) => void (el && (el.indeterminate = n > 0 && n < all.length))}
                      onChange={(e) => setSel((s) => {
                        const next = new Set(s);
                        for (const r of all) e.target.checked ? next.add(r.key) : next.delete(r.key);
                        return next;
                      })}
                    />
                    <span aria-hidden="true">Select all</span>
                    <span className="sr-only">Select all {all.length} shown in {c.clientName}</span>
                  </label>
                );
              })()}
              {c.lead && <span className="muted">· you're a lead here</span>}
              {c.status === "ok" && shape === "list" && g.level && (
                <span className="muted ah-client-order" title={g.rankedBy === "target" ? `${c.project ?? c.clientName} has no backlog order field in DevOps` : `${a.view.names[g.level]} in ${c.project ?? c.clientName}'s own backlog order, as DevOps ranks them`}>
                  · {rows.length > 0 && !rows.some(({ r }) => r.depth === 0 && r.tier === g.level) ? `No ${a.view.names[g.level].toLowerCase()} in ${c.project ?? c.clientName}: what's here is listed below` : g.rankedBy === "target" ? `${a.view.names[g.level]} by target date (no backlog order)` : `${a.view.names[g.level]}, in backlog order`}
                </span>
              )}
              {c.status === "ok" && shape !== "list" && g.rankedBy === "target" && (
                <span className="muted ah-client-order" title={`${c.project ?? c.clientName} has no backlog order field in DevOps`}>
                  · by target date (no backlog order)
                </span>
              )}
            </h3>
            {c.status !== "ok" && <p className="set-problem">{c.message ?? "DevOps couldn't be read for this client"}</p>}
            {open && c.status === "ok" && rows.length === 0 && (
              <p className="muted ah-client-empty">{shape === "attention" ? "Nothing to fix near the top of this backlog or in the next 4 weeks." : "Nothing here with these filters."}</p>
            )}
            {open && rows.length > 0 && (
              <table className="ah-grid" role="treegrid" aria-label={`${c.clientName} items`} aria-multiselectable={ticks || undefined}>
                <colgroup>
                  {COLS.map((col) => <col key={col} className={WIDTH[col]} />)}
                </colgroup>
                <thead>
                  <tr>
                    {COLS.map((col) => (
                      <th key={col} scope="col">
                        {col === "item" && shape === "list" ? "Rank · Item" : HEAD[col]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ r, kids }) => (
                    <GridRowView
                      key={r.key}
                      r={r}
                      g={g}
                      kids={kids}
                      open={kids && isOpenRow(fold, r)}
                      toggle={(o) => toggle(r, o)}
                      focus={live}
                      first={flat[0]?.key === r.key}
                      editing={editing?.key === r.key ? editing.col : null}
                      setFocus={setFocus}
                      edit={(col) => setEditing(col ? { key: r.key, col } : null)}
                      backTo={(col) => backTo(r.key, col)}
                      cellOf={(col) => cells.current.get(cellKey(r.key, col)) ?? null}
                      move={move}
                      up={upOf(r)}
                      reg={(col, el) => void (el ? cells.current.set(cellKey(r.key, col), el) : cells.current.delete(cellKey(r.key, col)))}
                      highlighted={a.focusItem === r.item.id}
                      cols={COLS}
                      dots={layout === "dots" || layout === "cards"}
                      selected={sel.has(r.key)}
                      pick={ticks && !r.context ? (range) => pick(r, range) : null}
                      shape={shape}
                      skip={skip}
                      moving={moving === r.key}
                      setMoving={(on) => setMoving(on ? r.key : null)}
                      say={say}
                      startDrag={(e) => startDrag(r, e)}
                      drop={drag ? (drag.key === r.key ? "from" : drag.over === r.key ? "on" : drops.has(r.key) ? "ok" : null) : null}
                    />
                  ))}
                </tbody>
              </table>
            )}
            {open && g.more && g.more.hidden > 0 && (
              <button type="button" className="mini quiet ah-fx-more" aria-expanded={g.more.all} onClick={g.more.toggle}>
                {g.more.all ? "Show fewer" : `Show ${g.more.hidden} more`}
              </button>
            )}
          </section>
        );
      })}
      {shape === "attention" && unskip && <Skipped list={groups.flatMap((g) => (g.skipped ?? []).map((x) => ({ ...x, client: g.client })))} unskip={unskip} skips={skips ?? {}} />}
    </div>
  );
}

/** ED-2: a row being dragged onto a new parent: where the pointer is, and the row under it that can take it. */
type Drag = { key: string; x: number; y: number; over: string | null };

function GridRowView({ r, g, kids, open, toggle, focus, first, editing, setFocus, edit, backTo, cellOf, move, up, reg, highlighted, cols, dots, selected, pick, shape, skip, moving, setMoving, say, startDrag, drop }: {
  r: GridRow; g: GridGroup; kids: boolean; open: boolean; toggle: (open?: boolean) => void; focus: { key: string; col: Col } | null; first: boolean; editing: Col | null;
  setFocus: (f: { key: string; col: Col }) => void; edit: (c: Col | null) => void; backTo: (c: Col) => void; cellOf: (c: Col) => HTMLElement | null; move: (dr: number, dc: number) => void; /** The row this one is opened under, if any. */ up: (() => void) | null; reg: (c: Col, el: HTMLElement | null) => void; highlighted: boolean;
  cols: readonly Col[]; dots: boolean; selected: boolean; pick: ((range: boolean) => void) | null; shape: GridShape; skip: ((k: string) => void) | undefined;
  /** ED-2: this row's Move… picker is open; what a screen reader hears; a drag starting here; this row in a drag ("from": the dragged row, "ok": it can take it, "on": the pointer is on it). */
  moving: boolean; setMoving: (on: boolean) => void; say: (text: string) => void; startDrag: (e: React.PointerEvent) => void; drop: "from" | "ok" | "on" | null;
}) {
  const a = useAhead();
  const menus = useContext(MenuCtx);
  const c = g.client;
  const rm = a.roadmap.get(r.key);
  const canChange = r.editable && !a.readOnly;
  const notIn = `Not in ${c.project ?? c.clientName}'s process`;
  const can = (col: Col) => (col === "dates" ? r.has.start || r.has.target : !!EDIT[col] && r.has[EDIT[col]!]);
  const editableCols = cols.filter((col) => !!EDIT[col] && canChange && can(col));
  const closedItem = !isOpen(r.item);
  const weeks = a.load.staleWeeks ?? 6;
  const stale = isStale(r.item, a.load.today, weeks) ? ageText(ageDays(r.item.changedAt, a.load.today)).replace(/ ago$/, "") : null;
  const status: Status = statusOf({ open: !closedItem && !r.context, health: rm ? { state: rm.status.state, reason: rm.status.reason } : null, gaps: r.gaps, stale });
  const entry = shape === "attention" ? (r.entry ?? null) : null;
  // Outside Needs attention, an item missing stories keeps its Break down (as its chip did before BL-1).
  const treeBreak = !entry && !closedItem && !r.context && r.editable && !a.readOnly && r.tier !== "story" && r.gaps.includes("needs_stories");
  const statusTab = focus?.key === r.key && focus.col === "status";
  /** A popover closed: back to its cell, or (Tab) on to the next editable cell in the row. */
  const closed = (col: Col, step: 0 | 1 | -1) => {
    edit(null);
    const i = editableCols.indexOf(col);
    // ED-2: Tab out of the title goes on to the row's first editable cell.
    const next = col === "item" ? (step === 1 ? editableCols[0] : undefined) : step && i >= 0 ? editableCols[i + step] : undefined;
    backTo(next ?? col);
  };
  // Needs attention's fix for a need: Break down opens its panel; the others open the row's own cell editor.
  const fix = (need: FixEntry["action"]) => {
    if (need === "needs_stories") a.breakDown(r);
    else if (need === "no_dates" && can("dates")) edit("dates");
    else if (need === "unassigned") edit("assignee");
    else if (need === "unsized" && can("size")) edit("size");
  };
  // ED-2: rename, move and the card's editor from the Item cell. A row I can't change offers none of them.
  const rename = () => canChange && edit("item");
  const moveNo = !r.has.parent ? `In ${c.project ?? c.clientName}'s process, ${r.item.type} is the top level, so it has no parent to change` : null;
  const startMove = () => {
    if (!canChange) return;
    if (moveNo) return say(moveNo), a.error(moveNo);
    edit(null);
    setMoving(true);
  };
  const editCard = () => openItemCardToEdit(c.clientKey, r.item.id);
  const parentTitle = (id: number) => c.items.find((i) => i.id === id)?.title ?? "";
  const rowMenu = (at: { x: number; y: number }) => {
    const items: MenuItem[] = [
      { id: "rename", label: "Rename", hint: "F2", icon: "edit", run: () => void rename() },
      { id: "move", label: "Move…", hint: "M", icon: "move", ...(moveNo ? { disabled: moveNo, expected: true } : {}), run: () => startMove() },
      { id: "edit", label: "Edit description…", hint: "E", run: () => editCard() },
    ];
    if (r.pending.title) items.push({ id: "undo-rename", label: "Undo rename", run: () => a.unstage(r, "title").then(() => say(`Rename of #${r.item.id} undone.`)) });
    if (r.pending.parent) items.push({ id: "undo-move", label: "Undo move", run: () => a.unstage(r, "parent").then(() => say(`Move of #${r.item.id} undone.`)) });
    menus.open(at, { title: `#${r.item.id} ${r.item.title}`, items });
  };
  const tab = (col: Col) => (focus ? (focus.key === r.key && focus.col === col ? 0 : -1) : first && col === "item" ? 0 : -1);
  const keys = (col: Col) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const field = EDIT[col];
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    // On the Item cell, Left collapses and Right expands (then they move between cells as before).
    else if (e.key === "ArrowRight" && col === "item" && kids && !open) toggle(true);
    else if (e.key === "ArrowLeft" && col === "item" && kids && open) toggle(false);
    // BL-2: Left on a row opened under another (and not open itself) goes to that row, as in a tree.
    else if (e.key === "ArrowLeft" && col === "item" && up) up();
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === " " && pick) pick(e.shiftKey);
    else if (e.key === "N" && e.shiftKey && col === "item" && a.newUnder && r.tier !== "story" && !a.readOnly) a.newUnder({ clientKey: c.clientKey, id: r.item.id, type: r.item.type, title: r.item.title });
    // ED-2: F2 renames, M moves, Shift+F10 (or the menu key) opens the row's menu; E opens the card ready to edit.
    else if (e.key === "F2" && col === "item" && canChange) rename();
    else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey && col === "item" && canChange) startMove();
    else if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && r.item.id > 0) editCard();
    else if (((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") && col === "item" && canChange) {
      const b = e.currentTarget.getBoundingClientRect();
      rowMenu({ x: b.left + 60, y: b.bottom });
    } else if (e.key === "Enter" && col === "item" && kids) toggle();
    else if (e.key === "Enter" && col === "status" && entry && NEED_ACTION[entry.action]) fix(entry.action);
    else if (e.key === "Enter" && col === "status" && treeBreak) a.breakDown(r);
    else if (e.key === "Enter" && field && canChange && can(col)) edit(col);
    else if ((e.key === "Delete" || e.key === "Backspace") && col === "dates" && canChange && (r.pending.start || r.pending.target)) void (async () => (r.pending.start && (await a.unstage(r, "start")), r.pending.target && (await a.unstage(r, "target"))))();
    else if ((e.key === "Delete" || e.key === "Backspace") && field && canChange && r.has[field] && r.pending[field]) void a.unstage(r, field);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const cell = (col: Col, body: React.ReactNode, o: { label: string; title?: string }) => {
    const field = EDIT[col];
    // ED-2: the Item cell carries the staged title and move.
    const pending = col === "item" ? (r.pending.title ?? r.pending.parent) : col === "dates" ? (r.pending.start ?? r.pending.target) : field ? r.pending[field] : undefined;
    const conf = col === "item" ? r.pending.title?.theirs !== undefined || r.pending.parent?.theirs !== undefined : col === "dates" ? r.pending.start?.theirs !== undefined || r.pending.target?.theirs !== undefined : pending?.theirs !== undefined;
    // QF-1: one click opens the picker (double-click and Enter still do); a cell I can change says so on hover.
    const editable = !!field && canChange && can(col);
    return (
      <td
        ref={(el) => reg(col, el)}
        role="gridcell"
        tabIndex={tab(col)}
        aria-label={o.label}
        title={o.title}
        className={`ah-cell ah-col-${col}${pending ? " ah-pend" : ""}${conf ? " ah-conf" : ""}${field && !can(col) ? " ah-abs" : ""}${editable ? " ah-edit" : ""}${editing === col ? " ah-editing" : ""}`}
        aria-haspopup={editable ? "dialog" : undefined}
        aria-expanded={editable ? editing === col : undefined}
        onFocus={() => setFocus({ key: r.key, col })}
        onKeyDown={keys(col)}
        {...(col === "item" ? { onPointerDown: startDrag, onDragStart: (e: React.DragEvent) => e.preventDefault() } : {})}
        onClick={(e) => editable && editing !== col && !(e.target as HTMLElement).closest("a, button, input, select, [role=listbox]") && edit(col)}
        onDoubleClick={() => editable && edit(col)}
      >
        {body}
        {editing === col && field && <CellEditor r={r} kind={col === "dates" ? "dates" : field} anchor={cellOf(col)} done={(step) => closed(col, step)} />}
        {col === "item" && moving && <MovePicker rows={[r]} anchor={cellOf("item")} onPick={(p) => a.tryStage(r, "parent", p).then((why) => (why ? why : (say(p ? `#${r.item.id} moves under ${p.title}. Not saved until you save.` : `#${r.item.id} will have no parent. Not saved until you save.`), null)))} done={() => (setMoving(false), backTo("item"))} />}
        {pending && <span className="ah-dot" title={conf ? "Changed in DevOps too: see the review" : "Pending: not in DevOps until you save"} aria-hidden="true" />}
      </td>
    );
  };
  /** An empty value: nothing at rest; "+ date" on hover and focus where I may fill it; the reason for screen readers. */
  const empty = (col: Col, add: string, why: string) => (
    <>
      {canChange && can(col) && (
        <span className="ah-add" aria-hidden="true">
          <Icon name="add" /> {add}
        </span>
      )}
      <span className="sr-only">{why}</span>
    </>
  );
  const day = (f: "start" | "target") => {
    const v = r.eff[f];
    const half = f === "start" ? r.startHalf : r.targetHalf;
    return v ? <span title={`${f === "start" ? "Start" : "Target"}: ${longDay(v)}${half ? ` ${half}` : ""}`}>{`${monthDay(v)}${half ? ` ${half}` : ""}`}</span> : null;
  };
  // "Aug 10 → Nov 6", "Nov 6" with only a target, "Aug 10 →" with only a start.
  const dates = () => {
    if (!r.has.start && !r.has.target) return <span className="sr-only">{notIn}</span>;
    if (!r.eff.start && !r.eff.target) return empty("dates", "date", r.has.target ? "No target date" : "No start date");
    return (
      <span className="ah-dates">
        {r.eff.start && day("start")}
        {r.eff.start && (
          <span className="ah-arrow" aria-hidden="true">
            {" "}→{" "}
          </span>
        )}
        {r.eff.target && day("target")}
      </span>
    );
  };
  const datesLabel = !r.has.start && !r.has.target ? `Dates: ${notIn}` : `Dates: ${r.has.start ? `start ${r.eff.start ?? "none"}` : ""}${r.has.start && r.has.target ? ", " : ""}${r.has.target ? `target ${r.eff.target ?? "none"}` : ""}`;
  const action = entry ? NEED_ACTION[entry.action] : null;
  const statusCell = () => (
    <span className="ah-status">
      {status.main && <StatusChip s={status} dots={dots} open={treeBreak ? { label: `Break down: ${r.item.title}`, tab: statusTab ? 0 : -1, run: () => a.breakDown(r) } : null} />}
      {entry && !entry.leaving && (
        <span className="ah-fix">
          {action && (
            <button type="button" className="mini" tabIndex={statusTab ? 0 : -1} onClick={() => fix(entry.action)} aria-label={`${action}: ${r.item.title}`}>
              {action}
            </button>
          )}
          {skip && (
            <button type="button" className="mini quiet" tabIndex={statusTab ? 0 : -1} onClick={() => skip(entry.key)} aria-label={`Skip ${r.item.title} for now`} title="Hide it from Needs attention for 2 weeks">
              Skip
            </button>
          )}
        </span>
      )}
      {entry?.leaving && <span className="ah-fx-ready">Ready</span>}
    </span>
  );
  const parent = shape === "list" && r.depth === 0 ? (r.parent ?? null) : null;
  /** BL-2 review: a row below the level with nothing at the level above it, listed after the ranked rows: says why. */
  const loose = shape === "list" && r.depth === 0 && !!g.level && levelRank(r.tier) > levelRank(g.level) ? `Not under any ${a.view.names[g.level].toLowerCase()}` : null;
  const label = `${r.rank ? `Rank ${r.rank}. ` : ""}${r.item.type} #${r.item.id} ${r.item.title}${parent ? `, in ${parent.type} ${parent.title}` : ""}${loose ? `. ${loose}` : ""}${r.lastWords ? `. Last change ${r.lastWords}` : ""}${unsavedWords(r)}${r.context ? ", shown for what's under it" : ""}${r.editable ? "" : `. ${c.note}`}${canChange ? `. F2 renames${r.has.parent ? ", M moves" : ""}, E opens it to edit` : ""}${drop === "ok" || drop === "on" ? ". Can take the dragged row" : ""}${kids ? `. ${open ? "Expanded" : "Collapsed"}: Enter, Left or Right to ${open ? "hide" : "show"} what's under it` : ""}${pick ? `. ${selected ? "Selected" : "Space to select"}` : ""}`;
  return (
    <tr
      role="row"
      aria-level={r.depth + 1}
      aria-expanded={kids ? open : undefined}
      aria-selected={pick ? selected : undefined}
      data-key={r.key}
      className={`ah-row tier-${r.tier} depth-${r.depth}${drop ? ` ah-drop-${drop}` : ""}${r.context ? " context" : ""}${closedItem ? " closed" : ""}${r.item.inScope === false ? " out-scope" : ""}${highlighted ? " highlighted" : ""}${r.editable ? "" : " ro"}${selected ? " sel" : ""}${entry?.leaving ? " leaving" : ""}`}
      style={{ "--ah-depth": r.depth } as CSSProperties}
      title={r.editable ? undefined : c.note}
    >
      {cols.map((col) => {
        if (col === "item")
          return (
            <Fragment key={col}>
              {cell(
                "item",
                <span className="ah-item" style={{ paddingInlineStart: `calc(${r.depth} * var(--ah-indent, 18px))` }}>
                  {pick ? (
                    <span className="ah-tick">
                      <input type="checkbox" tabIndex={-1} checked={selected} onChange={() => null} onClick={(e) => (e.stopPropagation(), pick(e.shiftKey))} aria-label={`Select #${r.item.id} ${r.item.title}`} />
                    </span>
                  ) : (
                    <span className="ah-tick" aria-hidden="true" />
                  )}
                  {shape === "list" && (
                    <span className={`bl-rank${r.rank ? "" : " none"}`} title={r.rank ? `Rank ${r.rank} in this backlog${r.lastWords ? `. Last change in DevOps: ${r.lastWords}` : ""}` : r.lastWords ? `Last change in DevOps: ${r.lastWords}` : undefined} aria-hidden={r.rank ? undefined : true}>
                      {r.rank ?? ""}
                    </span>
                  )}
                  {kids ? (
                    <Chevron open={open} title={r.item.title} onToggle={() => toggle()} />
                  ) : (
                    <ChevronSpace />
                  )}
                  <TypeIcon clientKey={c.clientKey} type={r.item.type} className="ah-type-icon" />
                  {editing === "item" ? (
                    <RenameBox r={r} done={(step) => closed("item", step)} say={say} />
                  ) : (
                    <span className="ah-title" title={`${r.item.type} #${r.item.id}: ${r.item.title}`}>
                      <WorkLink clientKey={c.clientKey} url={r.item.url}>
                        {r.item.title}
                      </WorkLink>{" "}
                      <span className="muted ah-id">#{r.item.id}</span>
                    </span>
                  )}
                  {/* UC-2: Rename is in the row's menu and on F2 only; its hover button took the title's room. */}
                  <Unsaved r={r} parentTitle={parentTitle} />
                  {drop === "on" && <span className="ah-drop-say">Move under {r.item.title}</span>}
                  {parent && (
                    <button type="button" className={`ah-parent${r.pending.parent ? " pend" : ""}`} tabIndex={-1} onClick={(e) => (e.stopPropagation(), a.filterUnder(parent.key))} title={`In ${parent.type} #${parent.id}. Show only what's under it`} aria-label={`Show only what's under ${parent.type} ${parent.title}`}>
                      <TypeIcon clientKey={c.clientKey} type={parent.type} className="ah-type-icon" />
                      <span className="ah-parent-text">{parent.title}</span>
                    </button>
                  )}
                  {loose && (
                    <span className="muted ah-loose" title={`Listed after the ranked ${a.view.names[g.level!].toLowerCase()}, in its own order`}>
                      {loose}
                    </span>
                  )}
                  {!r.editable && !r.context && (
                    <span className="ah-ro" title={c.note}>
                      Read only
                    </span>
                  )}
                  <ChangedUnder clientKey={c.clientKey} itemId={r.item.id} />
                  {r.item.inScope === false && !r.context && (
                    <span className="ah-ro" title="Outside Cooptimize's work in this project (shown with Show the whole project)">
                      Outside scope
                    </span>
                  )}
                  <NewUnder clientKey={c.clientKey} item={r.item} />
                  {canChange && (
                    <button type="button" className="more-btn ah-row-more" tabIndex={-1} aria-label={`More for ${r.item.title}: rename, move, edit`} aria-haspopup="menu" title="Rename, move, edit (Shift F10)" onClick={(e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); rowMenu({ x: b.right, y: b.bottom + 4 }); }}>
                      <Icon name="more" />
                    </button>
                  )}
                </span>,
                { label },
              )}
            </Fragment>
          );
        if (col === "state")
          return (
            <Fragment key={col}>
              {cell(
                "state",
                <span className="ah-state">
                  <span className={`ah-state-dot cat-${r.eff.stateCategory.toLowerCase()}`} aria-hidden="true" />
                  {r.eff.state}
                </span>,
                { label: `State: ${r.eff.state}` },
              )}
            </Fragment>
          );
        if (col === "dates") return <Fragment key={col}>{cell("dates", dates(), { label: datesLabel, ...(!r.has.start && !r.has.target ? { title: notIn } : {}) })}</Fragment>;
        if (col === "assignee") return <Fragment key={col}>{cell("assignee", r.eff.assignee ? <Who name={r.eff.assignee.name} email={r.eff.assignee.email} /> : empty("assignee", "owner", "Nobody assigned"), { label: `Assigned to: ${r.eff.assignee?.name ?? "nobody"}` })}</Fragment>;
        if (col === "size")
          return (
            <Fragment key={col}>
              {cell(
                "size",
                !r.has.size ? (
                  <span className="sr-only">{notIn}</span>
                ) : r.eff.size !== null ? (
                  <span className="ah-size" title={`${r.eff.size} ${r.sizeLabel ?? ""}${r.hint ? `\n${r.hint}` : ""}`}>
                    {r.eff.size} <span className="muted">{shortLabel(r.sizeLabel)}</span>
                  </span>
                ) : (
                  empty("size", "size", `No ${r.sizeLabel ?? "size"}${r.hint ? `. ${r.hint}` : ""}`)
                ),
                { label: `${r.sizeLabel ?? "Size"}: ${r.has.size ? (r.eff.size ?? "none") : notIn}${r.hint ? `. ${r.hint}` : ""}`, ...(!r.has.size ? { title: notIn } : r.eff.size === null && r.hint ? { title: r.hint } : {}) },
              )}
            </Fragment>
          );
        return <Fragment key={col}>{cell("status", statusCell(), { label: `Status: ${closedItem ? "closed" : statusWords(status)}${action ? `. Enter: ${action}` : treeBreak ? ". Enter: Break down" : ""}` })}</Fragment>;
      })}
    </tr>
  );
}

/** One chip, and the other reasons as a quiet "+N" whose list shows on hover and when the cell has focus. */
function StatusChip({ s, dots, open = null }: { s: Status; dots: boolean; /** The chip opens Break down (a feature missing stories, in the tree). */ open?: { label: string; tab: number; run: () => void } | null }) {
  const m = s.main!;
  return (
    <span className="ah-ready">
      {open ? (
        <button type="button" className="ah-chip ah-chip-btn" title={`${m.title}. Click to break it down`} aria-label={open.label} tabIndex={open.tab} data-status={m.key} onClick={open.run}>
          <span className={`ah-chip-dot${m.action ? " action" : ""}`} aria-hidden="true" />
          {m.text}
        </button>
      ) : dots ? (
        <span className={`ah-gapdot${m.action ? " action" : ""}`} title={m.title} data-status={m.key} aria-hidden="true" />
      ) : (
        <span className="ah-chip" title={m.title} data-status={m.key}>
          <span className={`ah-chip-dot${m.action ? " action" : ""}`} aria-hidden="true" />
          {m.text}
        </span>
      )}
      {s.more.length > 0 && (
        <span className="ah-chip ah-more" aria-hidden="true">
          +{s.more.length}
          <span className="ah-more-list" role="tooltip">
            {s.more.map((x) => (
              <span key={x.key}>{x.title}</span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** "Story Points" → "SP", "Effort" → "Effort": the size field's name, short enough for one line. */
export function shortLabel(label: string | null): string {
  if (!label) return "";
  const words = label.trim().split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join("") : label;
}

/** AH-5: who an item is assigned to, compact: a photo or initials and "First L.", the full name on hover. */
function Who({ name, email }: { name: string; email: string }) {
  const photos = usePhotos({ emails: [email] });
  return (
    <span className="ah-who" title={name}>
      <Avatar name={name} photo={photos.photoFor(email)} size={20} />
      <span className="ah-who-name">{shortName(name)}</span>
    </span>
  );
}

/** AH-7: what I skipped in Needs attention, folded at the bottom; each comes back after 2 weeks, or with Unskip. */
function Skipped({ list, unskip, skips }: { list: { e: FixEntry; r: Row; client: LoadClient }[]; unskip: (k: string) => void; skips: Skips }) {
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <section className="ah-fx-skipped" aria-label="Skipped">
      <button type="button" className="mini quiet ah-fx-skipped-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        Skipped ({list.length})
      </button>
      {open && (
        <ol className="ah-fx-list">
          {list.map(({ e, r, client }) => (
            <li key={e.key} className="ah-fx-row" data-key={e.key} aria-label={`${r.item.title}: skipped`}>
              <span className="ah-fx-item">
                <span className="ah-fx-client-name">{client.clientName}</span>
                <TypeIcon clientKey={r.clientKey} type={r.item.type} className="ah-type-icon" />
                <span className="ah-title">
                  <WorkLink clientKey={r.clientKey} url={r.item.url}>
                    {r.item.title}
                  </WorkLink>{" "}
                  <span className="muted ah-id">#{r.item.id}</span>
                  {skips[e.key] && <span className="muted"> · back {monthDay(skipEnds(skips[e.key]!))}</span>}
                </span>
              </span>
              <span className="ah-fx-side">
                <button type="button" className="mini" onClick={() => unskip(e.key)} aria-label={`Unskip ${r.item.title}`}>
                  Unskip
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// The editors moved to ./Editors.tsx (AH-5); Gantt imports Editor from there.
export { Editor } from "./Editors.tsx";

/**
 * DV-2: an item I have staged changes on that changed in DevOps while the tab was open. My changes stay staged; Show
 * the new values puts DevOps's values beside mine, so nothing is overwritten silently on either side.
 */
function ChangedUnder({ clientKey, itemId }: { clientKey: string; itemId: number }) {
  const { changedUnder } = useAhead();
  const [open, setOpen] = useState(false);
  const vals = changedUnder(clientKey, itemId);
  if (!vals) return null;
  return (
    <span className="ah-changed" role="status">
      Changed in DevOps just now
      <button type="button" className="mini quiet" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}>
        {open ? "Hide the new values" : "Show the new values"}
      </button>
      {open && (
        <span className="ah-changed-vals">
          {vals.map((v) => (
            <span key={v.field}>
              {v.field}: DevOps has {v.devops}, yours {v.mine}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
