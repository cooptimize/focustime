// AH-1, BL-1: Backlog › Grid. Every client's DevOps on one screen: each client a section that folds (remembered on this
// device) with a header line (name, project, "33 items · 5 need attention", "you're a lead here"), its items as a tree
// in the client's backlog order (by target date where the project has none, said once in the header). Columns: Item,
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
// Two other shapes of the same table: one level as a flat list in each client's rank order with its rank number (the
// Backlog mode before BL-1), and Needs attention (Readiness before BL-1): only the items with something to fix, under
// their parents for context, each with its fix (Break down, Set dates, Assign, Size) and Skip in its Status cell.
import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChangeField } from "../../plan/ahead-edit.ts";
import { shortName } from "../../plan/ahead-people.ts";
import { ageDays, ageText, isStale } from "../../plan/backlog.ts";
import { NEED_ACTION, statusOf, statusWords, type Status } from "../../plan/backlog-status.ts";
import type { FixEntry } from "../../plan/fixnext.ts";
import { skipEnds, type Skips } from "../../plan/readiness.ts";
import { isOpenRow, setRow } from "../../plan/gantt-tree.ts";
import { WorkLink } from "../WorkLink.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import { useAhead } from "./Ahead.tsx";
import { BulkBar } from "./Bulk.tsx";
import { Chevron, ChevronSpace } from "./Chevron.tsx";
import { CellEditor } from "./Editors.tsx";
import type { GridLayout } from "./layout.ts";
import { isOpen, type LoadClient, type Row } from "./model.ts";
import { NewUnder } from "./NewUnder.tsx";
import { usePref } from "./prefs.ts";

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

/** A row as the Grid shows it: its rank in a flat list, and in Needs attention its entry (null: shown for context). */
export type GridRow = Row & { rank?: number; entry?: FixEntry | null; /** The ranked list: the last change in DevOps ("5 days ago · state"). */ lastWords?: string };
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
};
export type GridShape = "tree" | "flat" | "attention";

export function Grid({ groups, layout = "wide", shape = "tree", skip, unskip, skips, onChanged }: { groups: GridGroup[]; layout?: GridLayout; shape?: GridShape; skip?: (k: string) => void; unskip?: (k: string) => void; skips?: Skips; onChanged?: () => void }) {
  const COLS = COLUMNS[layout];
  const a = useAhead();
  const { fold, setFold } = a.view;
  const [focus, setFocus] = useState<{ key: string; col: Col } | null>(null);
  const [editing, setEditing] = useState<{ key: string; col: Col } | null>(null);
  const [folded, setFolded] = usePref<string[]>("grid.folded", isKeys, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
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
          const kids = shape !== "flat" && (g.rows[i + 1]?.depth ?? -1) > r.depth;
          rows.push({ r, kids });
          if (kids && !isOpenRow(fold, r)) closedAt = r.depth;
        });
      }
      out.push({ g, rows });
    }
    return out;
  }, [groups, fold, folded, shape]);
  const flat = shown.flatMap((x) => x.rows.map((y) => y.r));
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

  const toggle = (r: Row, open?: boolean) => setFold((f) => setRow(f, r, open ?? !isOpenRow(f, r)));
  const foldClient = (k: string) => setFolded((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const ticks = !a.readOnly;
  return (
    <div className={`ah-grid-box lay-${layout} shape-${shape}${sel.size ? " has-sel" : ""}`} onKeyDown={(e) => e.key === "Escape" && sel.size > 0 && !editing && (e.stopPropagation(), setSel(new Set()))}>
      {ticks && <BulkBar chosen={chosen} titleOf={(k, id) => byKey.get(`${k}:${id}`)?.item.title ?? ""} select={(keys) => setSel(new Set(keys))} onChanged={onChanged ?? (() => null)} />}
      {shown.map(({ g, rows }) => {
        const c = g.client;
        const open = !folded.includes(c.clientKey);
        return (
          <section key={c.clientKey} className={`ah-client${open ? "" : " folded"}`} style={{ "--c": a.color(c.clientKey) } as CSSProperties} aria-label={c.clientName}>
            <h3 className="ah-client-head">
              <button type="button" className="ah-client-fold" aria-expanded={open} onClick={() => foldClient(c.clientKey)} title={open ? `Fold ${c.clientName}` : `Unfold ${c.clientName}`}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className={`ah-chev-svg${open ? " open" : ""}`}>
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="dl-swatch" aria-hidden="true" />
                <span className="ah-client-name">{c.clientName}</span>
              </button>
              {c.project && <span className="muted">· {c.project}</span>}
              {c.status === "ok" && (
                <span className="muted ah-client-counts">
                  · {plural(g.count, "item", "items")}
                  {g.need > 0 && shape !== "attention" ? ` · ${g.need} need attention` : ""}
                </span>
              )}
              {c.lead && <span className="muted">· you're a lead here</span>}
              {c.status === "ok" && g.rankedBy === "target" && (
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
              <table className="ah-grid" role="grid" aria-label={`${c.clientName} items`} aria-multiselectable={ticks || undefined}>
                <colgroup>
                  {COLS.map((col) => <col key={col} className={WIDTH[col]} />)}
                </colgroup>
                <thead>
                  <tr>
                    {COLS.map((col) => (
                      <th key={col} scope="col">
                        {col === "item" && shape === "flat" ? "Rank · Item" : HEAD[col]}
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
                      focus={focus}
                      first={flat[0]?.key === r.key}
                      editing={editing?.key === r.key ? editing.col : null}
                      setFocus={setFocus}
                      edit={(col) => setEditing(col ? { key: r.key, col } : null)}
                      backTo={(col) => backTo(r.key, col)}
                      cellOf={(col) => cells.current.get(cellKey(r.key, col)) ?? null}
                      move={move}
                      reg={(col, el) => void (el ? cells.current.set(cellKey(r.key, col), el) : cells.current.delete(cellKey(r.key, col)))}
                      highlighted={a.focusItem === r.item.id}
                      cols={COLS}
                      dots={layout === "dots" || layout === "cards"}
                      selected={sel.has(r.key)}
                      pick={ticks && !r.context ? (range) => pick(r, range) : null}
                      shape={shape}
                      skip={skip}
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

function GridRowView({ r, g, kids, open, toggle, focus, first, editing, setFocus, edit, backTo, cellOf, move, reg, highlighted, cols, dots, selected, pick, shape, skip }: {
  r: GridRow; g: GridGroup; kids: boolean; open: boolean; toggle: (open?: boolean) => void; focus: { key: string; col: Col } | null; first: boolean; editing: Col | null;
  setFocus: (f: { key: string; col: Col }) => void; edit: (c: Col | null) => void; backTo: (c: Col) => void; cellOf: (c: Col) => HTMLElement | null; move: (dr: number, dc: number) => void; reg: (c: Col, el: HTMLElement | null) => void; highlighted: boolean;
  cols: readonly Col[]; dots: boolean; selected: boolean; pick: ((range: boolean) => void) | null; shape: GridShape; skip: ((k: string) => void) | undefined;
}) {
  const a = useAhead();
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
  const statusTab = focus?.key === r.key && focus.col === "status";
  /** A popover closed: back to its cell, or (Tab) on to the next editable cell in the row. */
  const closed = (col: Col, step: 0 | 1 | -1) => {
    edit(null);
    const i = editableCols.indexOf(col);
    const next = step && i >= 0 ? editableCols[i + step] : undefined;
    backTo(next ?? col);
  };
  // Needs attention's fix for a need: Break down opens its panel; the others open the row's own cell editor.
  const fix = (need: FixEntry["action"]) => {
    if (need === "needs_stories") a.breakDown(r);
    else if (need === "no_dates" && can("dates")) edit("dates");
    else if (need === "unassigned") edit("assignee");
    else if (need === "unsized" && can("size")) edit("size");
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
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === " " && pick) pick(e.shiftKey);
    else if (e.key === "N" && e.shiftKey && col === "item" && a.newUnder && r.tier !== "story" && !a.readOnly) a.newUnder({ clientKey: c.clientKey, id: r.item.id, type: r.item.type, title: r.item.title });
    else if (e.key === "Enter" && col === "item" && kids) toggle();
    else if (e.key === "Enter" && col === "status" && entry && NEED_ACTION[entry.action]) fix(entry.action);
    else if (e.key === "Enter" && field && canChange && can(col)) edit(col);
    else if ((e.key === "Delete" || e.key === "Backspace") && col === "dates" && canChange && (r.pending.start || r.pending.target)) void (async () => (r.pending.start && (await a.unstage(r, "start")), r.pending.target && (await a.unstage(r, "target"))))();
    else if ((e.key === "Delete" || e.key === "Backspace") && field && canChange && r.has[field] && r.pending[field]) void a.unstage(r, field);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const cell = (col: Col, body: React.ReactNode, o: { label: string; title?: string }) => {
    const field = EDIT[col];
    const pending = col === "dates" ? (r.pending.start ?? r.pending.target) : field ? r.pending[field] : undefined;
    const conf = col === "dates" ? r.pending.start?.theirs !== undefined || r.pending.target?.theirs !== undefined : pending?.theirs !== undefined;
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
        onClick={(e) => editable && editing !== col && !(e.target as HTMLElement).closest("a, button, input, select, [role=listbox]") && edit(col)}
        onDoubleClick={() => editable && edit(col)}
      >
        {body}
        {editing === col && field && <CellEditor r={r} kind={col === "dates" ? "dates" : field} anchor={cellOf(col)} done={(step) => closed(col, step)} />}
        {pending && <span className="ah-dot" title={conf ? "Changed in DevOps too: see the review" : "Pending: not in DevOps until you save"} aria-hidden="true" />}
      </td>
    );
  };
  /** An empty value: nothing at rest; "+ date" on hover and focus where I may fill it; the reason for screen readers. */
  const empty = (col: Col, add: string, why: string) => (
    <>
      {canChange && can(col) && (
        <span className="ah-add" aria-hidden="true">
          {add}
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
    if (!r.eff.start && !r.eff.target) return empty("dates", "+ date", r.has.target ? "No target date" : "No start date");
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
      {status.main && <StatusChip s={status} dots={dots} />}
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
  const label = `${r.rank ? `Rank ${r.rank}. ` : ""}${r.lastWords ? `Last change ${r.lastWords}. ` : ""}${r.item.type} #${r.item.id} ${r.item.title}${r.context ? ", shown for what's under it" : ""}${r.editable ? "" : `. ${c.note}`}${kids ? `. ${open ? "Expanded" : "Collapsed"}: Enter, Left or Right to ${open ? "hide" : "show"} what's under it` : ""}${pick ? `. ${selected ? "Selected" : "Space to select"}` : ""}`;
  return (
    <tr
      role="row"
      aria-selected={pick ? selected : undefined}
      data-key={r.key}
      className={`ah-row tier-${r.tier} depth-${r.depth}${r.context ? " context" : ""}${closedItem ? " closed" : ""}${r.item.inScope === false ? " out-scope" : ""}${highlighted ? " highlighted" : ""}${r.editable ? "" : " ro"}${selected ? " sel" : ""}${entry?.leaving ? " leaving" : ""}`}
      style={{ "--ah-depth": shape === "flat" ? 0 : r.depth } as CSSProperties}
      title={r.editable ? undefined : c.note}
    >
      {cols.map((col) => {
        if (col === "item")
          return (
            <Fragment key={col}>
              {cell(
                "item",
                <span className="ah-item" style={{ paddingInlineStart: shape === "flat" ? 0 : `calc(${r.depth} * var(--ah-indent, 18px))` }}>
                  {pick ? (
                    <span className="ah-tick">
                      <input type="checkbox" tabIndex={-1} checked={selected} onChange={() => null} onClick={(e) => (e.stopPropagation(), pick(e.shiftKey))} aria-label={`Select #${r.item.id} ${r.item.title}`} />
                    </span>
                  ) : (
                    <span className="ah-tick" aria-hidden="true" />
                  )}
                  {shape === "flat" ? (
                    <span className="bl-rank" title={`Rank ${r.rank} in this backlog${r.lastWords ? `. Last change in DevOps: ${r.lastWords}` : ""}`}>
                      {r.rank}
                    </span>
                  ) : kids ? (
                    <Chevron open={open} title={r.item.title} onToggle={() => toggle()} />
                  ) : (
                    <ChevronSpace />
                  )}
                  <TypeIcon clientKey={c.clientKey} type={r.item.type} className="ah-type-icon" />
                  <span className="ah-title" title={`${r.item.type} #${r.item.id}: ${r.item.title}`}>
                    <WorkLink clientKey={c.clientKey} url={r.item.url}>
                      {r.item.title}
                    </WorkLink>{" "}
                    <span className="muted ah-id">#{r.item.id}</span>
                  </span>
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
        if (col === "assignee") return <Fragment key={col}>{cell("assignee", r.eff.assignee ? <Who name={r.eff.assignee.name} email={r.eff.assignee.email} /> : empty("assignee", "+ owner", "Nobody assigned"), { label: `Assigned to: ${r.eff.assignee?.name ?? "nobody"}` })}</Fragment>;
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
                  empty("size", "+ size", `No ${r.sizeLabel ?? "size"}${r.hint ? `. ${r.hint}` : ""}`)
                ),
                { label: `${r.sizeLabel ?? "Size"}: ${r.has.size ? (r.eff.size ?? "none") : notIn}${r.hint ? `. ${r.hint}` : ""}`, ...(!r.has.size ? { title: notIn } : r.eff.size === null && r.hint ? { title: r.hint } : {}) },
              )}
            </Fragment>
          );
        return <Fragment key={col}>{cell("status", statusCell(), { label: `Status: ${closedItem ? "closed" : statusWords(status)}${action ? `. Enter: ${action}` : ""}` })}</Fragment>;
      })}
    </tr>
  );
}

/** One chip, and the other reasons as a quiet "+N" whose list shows on hover and when the cell has focus. */
function StatusChip({ s, dots }: { s: Status; dots: boolean }) {
  const m = s.main!;
  return (
    <span className="ah-ready">
      {dots ? (
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
