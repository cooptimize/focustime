// AH-1: Ahead › Grid (was Roadmap, D653): every level grouped client › epic › feature › story, collapsible, with
// State, Start, Target, Assigned to, Size and Readiness. AH-2: no cell is filled for a gap; a missing value is a muted
// "—" saying what's missing in its tooltip ("No target date"), a field the type doesn't have is a "—" saying "Not in
// <project>'s process", and gaps show only in Readiness as quiet chips (two, then +N). Closed items are dimmed with no
// gap marks; a state is a small dot and its word in the neutral color. Edits are inline and go into my change set (nothing is written until Commit): Enter
// edits, Enter keeps, Esc cancels; arrows move between cells. Items I may not change say who can.
// AH-5: a click or Enter on an editable cell opens its editor as a small popover anchored to the cell (ui/ahead/Editors.tsx),
// never squeezed into the column: Enter saves, Esc cancels, Tab saves and moves to the next editable cell in the row, and
// focus comes back to the cell. State is editable too (the type's states from the process model). Assigned to shows a
// photo or initials and "First L."; readiness chips wrap inside their cell.
// AH-3: the Item column comes first at every window size (ui/ahead/layout.ts): the type as its icon, the title on one or
// two lines with #id beside it, the other columns compact and fixed; under 1400 Start and Target are one Dates column,
// under 1200 Readiness is dots, under 900 each row is a two-line card (Size leaves; Unsized shows as a dot).
import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChangeField } from "../../plan/ahead-edit.ts";
import { shortName } from "../../plan/ahead-people.ts";
import { GAP_WORDS } from "../../plan/fixnext.ts";
import { STATE_WORDS } from "../../plan/roadmap.ts";
import { gapChip, ReadyChips, stateChip } from "./Chips.tsx";
import { isOpen } from "./model.ts";
import { WorkLink } from "../WorkLink.tsx";
import { NewUnder } from "./NewUnder.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import type { GridLayout } from "./layout.ts";
import { useAhead } from "./Ahead.tsx";
import { CellEditor } from "./Editors.tsx";
import { Avatar, usePhotos } from "../Presence.tsx";
import type { Group, Row } from "./model.ts";
import { isOpenRow, setRow } from "../../plan/gantt-tree.ts";

type Col = "item" | "state" | "start" | "target" | "dates" | "assignee" | "size" | "ready";
/** The columns at each layout, in order. */
export const COLUMNS: Record<GridLayout, readonly Col[]> = {
  wide: ["item", "state", "start", "target", "assignee", "size", "ready"],
  dates: ["item", "state", "dates", "assignee", "size", "ready"],
  dots: ["item", "state", "dates", "assignee", "size", "ready"],
  cards: ["item", "state", "dates", "assignee", "ready"],
};
const HEAD: Record<Col, string> = { item: "Item", state: "State", start: "Start", target: "Target", dates: "Dates", assignee: "Assigned to", size: "Size", ready: "Readiness" };
const WIDTH: Record<Col, string> = { item: "w-item", state: "w-state", start: "w-date", target: "w-date", dates: "w-dates", assignee: "w-who", size: "w-size", ready: "w-ready" };
const EDIT: Partial<Record<Col, ChangeField>> = { state: "state", start: "start", target: "target", dates: "start", assignee: "assignee", size: "size" };
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function Grid({ groups, layout = "wide" }: { groups: Group[]; layout?: GridLayout }) {
  const COLS = COLUMNS[layout];
  const a = useAhead();
  // AH-6: "Show: Epics · Features · Stories" as in the Gantt (everything open by default, as before), carets on top.
  const { fold, setFold } = a.view;
  const [focus, setFocus] = useState<{ key: string; col: Col } | null>(null);
  const [editing, setEditing] = useState<{ key: string; col: Col } | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  // The rows on screen, in order, collapsed parents hiding what's under them.
  const shown = useMemo(() => {
    const out: { g: Group; rows: Row[] }[] = [];
    for (const g of groups) {
      const rows: Row[] = [];
      const hidden = new Set<number>();
      for (const r of g.rows) {
        if (r.item.parentId !== null && hidden.has(r.item.parentId)) {
          hidden.add(r.item.id);
          continue;
        }
        rows.push(r);
        if (!isOpenRow(fold, r)) hidden.add(r.item.id);
      }
      out.push({ g, rows });
    }
    return out;
  }, [groups, fold]);
  const flat = shown.flatMap((x) => x.rows);
  // AH-5: after a popover closes, focus goes back to its cell; Tab moves to the next editable cell in the row.
  const backTo = (key: string, col: Col) => requestAnimationFrame(() => {
    setFocus({ key, col });
    cells.current.get(cellKey(key, col))?.focus({ preventScroll: true });
  });
  const cellKey = (k: string, c: Col) => `${k}|${c}`;
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
  return (
    <div className={`ah-grid-box lay-${layout}`}>
      {shown.map(({ g, rows }) => (
        <section key={g.client.clientKey} className="ah-client" style={{ "--c": a.color(g.client.clientKey) } as CSSProperties} aria-label={g.client.clientName}>
          <h3 className="ah-client-head">
            <span className="dl-swatch" aria-hidden="true" />
            {g.client.clientName}
            {g.client.project && <span className="muted"> · {g.client.project}</span>}
            {g.client.lead && <span className="muted"> · you're a lead here</span>}
          </h3>
          {g.client.status !== "ok" && <p className="set-problem">{g.client.message ?? "DevOps couldn't be read for this client"}</p>}
          {rows.length > 0 && (
            <table className="ah-grid" role="grid" aria-label={`${g.client.clientName} items`}>
              <colgroup>
                {COLS.map((col) => <col key={col} className={WIDTH[col]} />)}
              </colgroup>
              <thead>
                <tr>
                  {COLS.map((col) => <th key={col} scope="col">{HEAD[col]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <GridRow
                    key={r.key}
                    r={r}
                    g={g}
                    open={isOpenRow(fold, r)}
                    toggle={(o) => toggle(r, o)}
                    focus={focus}
                    first={flat[0]?.key === r.key}
                    editing={editing?.key === r.key ? editing.col : null}
                    setFocus={setFocus}
                    edit={(c) => setEditing(c ? { key: r.key, col: c } : null)}
                    backTo={(c) => backTo(r.key, c)}
                    cellOf={(c) => cells.current.get(cellKey(r.key, c)) ?? null}
                    move={move}
                    reg={(c, el) => void (el ? cells.current.set(cellKey(r.key, c), el) : cells.current.delete(cellKey(r.key, c)))}
                    highlighted={a.focusItem === r.item.id}
                    cols={COLS}
                    dots={layout === "dots" || layout === "cards"}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function GridRow({ r, g, open, toggle, focus, first, editing, setFocus, edit, backTo, cellOf, move, reg, highlighted, cols, dots }: {
  r: Row; g: Group; open: boolean; toggle: (open?: boolean) => void; focus: { key: string; col: Col } | null; first: boolean; editing: Col | null;
  setFocus: (f: { key: string; col: Col }) => void; edit: (c: Col | null) => void; backTo: (c: Col) => void; cellOf: (c: Col) => HTMLElement | null; move: (dr: number, dc: number) => void; reg: (c: Col, el: HTMLElement | null) => void; highlighted: boolean;
  cols: readonly Col[]; dots: boolean;
}) {
  const a = useAhead();
  const c = g.client;
  const rm = a.roadmap.get(r.key);
  const hasKids = g.rows.some((x) => x.item.parentId === r.item.id);
  const canChange = r.editable && !a.readOnly;
  const notIn = `Not in ${c.project ?? c.clientName}'s process`;
  const can = (col: Col) => (col === "dates" ? r.has.start || r.has.target : !!EDIT[col] && r.has[EDIT[col]!]);
  const editableCols = cols.filter((col) => !!EDIT[col] && canChange && can(col));
  /** A popover closed: back to its cell, or (Tab) on to the next editable cell in the row. */
  const closed = (col: Col, step: 0 | 1 | -1) => {
    edit(null);
    const i = editableCols.indexOf(col);
    const next = step && i >= 0 ? editableCols[i + step] : undefined;
    backTo(next ?? col);
  };
  const tab = (col: Col) => (focus ? (focus.key === r.key && focus.col === col ? 0 : -1) : first && col === "item" ? 0 : -1);
  const keys = (col: Col) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const field = EDIT[col];
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    // AH-6: on the Item cell, Left collapses and Right expands (then they move between cells as before).
    else if (e.key === "ArrowRight" && col === "item" && hasKids && !open) toggle(true);
    else if (e.key === "ArrowLeft" && col === "item" && hasKids && open) toggle(false);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "N" && e.shiftKey && col === "item" && a.newUnder && r.tier !== "story" && !a.readOnly) a.newUnder({ clientKey: c.clientKey, id: r.item.id, type: r.item.type, title: r.item.title });
    else if (e.key === "Enter" && col === "item" && hasKids) toggle();
    else if (e.key === "Enter" && field && canChange && can(col)) edit(col);
    else if ((e.key === "Delete" || e.key === "Backspace") && col === "dates" && canChange && (r.pending.start || r.pending.target)) void (async () => (r.pending.start && (await a.unstage(r, "start")), r.pending.target && (await a.unstage(r, "target"))))();
    else if ((e.key === "Delete" || e.key === "Backspace") && field && canChange && r.has[field] && r.pending[field]) void a.unstage(r, field);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const cell = (col: Col, body: React.ReactNode, o: { label: string }) => {
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
  const dateText = (f: "start" | "target") => {
    const v = r.eff[f];
    const half = f === "start" ? r.startHalf : r.targetHalf;
    return v ? `${monthDay(v)}${half ? ` ${half}` : ""}` : null;
  };
  const date = (f: "start" | "target") => {
    if (!r.has[f]) return <None title={notIn} />;
    const t = dateText(f);
    return t ? <span title={longDay(r.eff[f]!)}>{t}</span> : <None title={f === "start" ? "No start date" : "No target date"} />;
  };
  // Under 1400: one Dates column, "Apr 1 → Apr 30"; a missing end is a dash.
  const dates = () => {
    if (!r.has.start && !r.has.target) return <None title={notIn} />;
    if (!r.eff.start && !r.eff.target) return <None title="No dates" />;
    return (
      <span className="ah-dates">
        {r.has.start ? date("start") : null}
        {r.has.start && r.has.target && <span className="ah-arrow" aria-hidden="true"> → </span>}
        {r.has.target ? date("target") : null}
      </span>
    );
  };
  const datesLabel = `Dates: ${r.has.start ? `start ${r.eff.start ?? "none"}` : ""}${r.has.start && r.has.target ? ", " : ""}${r.has.target ? `target ${r.eff.target ?? "none"}` : ""}${!r.has.start && !r.has.target ? notIn : ""}`;
  const closedItem = !isOpen(r.item);
  const chips = closedItem ? [] : [...(rm ? [stateChip(rm.status.state, rm.status.reason)] : []), ...r.gaps.map((k) => gapChip(k, k === "needs_stories" && !a.readOnly ? () => a.breakDown(r) : undefined))];
  return (
    <tr role="row" className={`ah-row tier-${r.tier} depth-${r.depth}${r.context ? " context" : ""}${closedItem ? " closed" : ""}${r.item.inScope === false ? " out-scope" : ""}${highlighted ? " highlighted" : ""}${r.editable ? "" : " ro"}`} style={{ "--ah-depth": r.depth } as CSSProperties} title={r.editable ? undefined : c.note}>
      {cols.map((col) => {
        if (col === "item")
          return (
            <Fragment key={col}>
              {cell(
                "item",
                <span className="ah-item" style={{ paddingInlineStart: `calc(${r.depth} * var(--ah-indent, 18px))` }}>
                  {hasKids ? (
                    <button type="button" className="rm-expand" tabIndex={-1} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what's under ${r.item.title}`} onClick={() => toggle()}>
                      {open ? "▾" : "▸"}
                    </button>
                  ) : (
                    <span className="rm-expand-space" aria-hidden="true" />
                  )}
                  <TypeIcon clientKey={c.clientKey} type={r.item.type} className="ah-type-icon" />
                  <span className="ah-title" title={`${r.item.type} #${r.item.id}: ${r.item.title}`}>
                    <WorkLink clientKey={c.clientKey} url={r.item.url}>
                      {r.item.title}
                    </WorkLink>{" "}
                    <span className="muted ah-id">#{r.item.id}</span>
                  </span>
                  {!r.editable && !r.context && <span className="ah-ro" title={c.note}>Read only</span>}
                  <ChangedUnder clientKey={c.clientKey} itemId={r.item.id} />
                  {r.item.inScope === false && !r.context && <span className="ah-ro" title="Outside Cooptimize's work in this project (shown with Show the whole project)">Outside scope</span>}
                  <NewUnder clientKey={c.clientKey} item={r.item} />
                </span>,
                { label: `${r.item.type} #${r.item.id} ${r.item.title}${r.editable ? "" : `. ${c.note}`}${hasKids ? `. Enter to ${open ? "hide" : "show"} what's under it.` : ""}` },
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
        if (col === "start") return <Fragment key={col}>{cell("start", date("start"), { label: `Start: ${r.eff.start ?? (r.has.start ? "no start date" : notIn)}` })}</Fragment>;
        if (col === "target") return <Fragment key={col}>{cell("target", date("target"), { label: `Target: ${r.eff.target ?? (r.has.target ? "no target date" : notIn)}` })}</Fragment>;
        if (col === "dates") return <Fragment key={col}>{cell("dates", dates(), { label: datesLabel })}</Fragment>;
        if (col === "assignee") return <Fragment key={col}>{cell("assignee", r.eff.assignee ? <Who name={r.eff.assignee.name} email={r.eff.assignee.email} /> : <None title="Nobody assigned" />, { label: `Assigned to: ${r.eff.assignee?.name ?? "nobody"}` })}</Fragment>;
        if (col === "size")
          return (
            <Fragment key={col}>
              {cell(
                "size",
                !r.has.size ? (
                  <None title={notIn} />
                ) : r.eff.size !== null ? (
                  <span className="ah-size" title={`${r.eff.size} ${r.sizeLabel ?? ""}${r.hint ? `\n${r.hint}` : ""}`}>
                    {r.eff.size} <span className="muted">{shortLabel(r.sizeLabel)}</span>
                  </span>
                ) : (
                  <None title={`No ${r.sizeLabel ?? "size"}${r.hint ? `. ${r.hint}` : ""}`} />
                ),
                { label: `${r.sizeLabel ?? "Size"}: ${r.has.size ? (r.eff.size ?? "none") : notIn}${r.hint ? `. ${r.hint}` : ""}` },
              )}
            </Fragment>
          );
        return (
          <Fragment key={col}>
            {cell(
              "ready",
              <ReadyChips chips={chips} dots={dots} />,
              { label: `Readiness: ${closedItem ? "closed" : [rm ? STATE_WORDS[rm.status.state] : null, ...r.gaps.map((k) => GAP_WORDS[k])].filter(Boolean).join(", ") || "nothing missing"}` },
            )}
          </Fragment>
        );
      })}
    </tr>
  );
}

/** "Story Points" → "SP", "Effort" → "Effort": the size field's name, short enough for one line. */
export function shortLabel(label: string | null): string {
  if (!label) return "";
  const words = label.trim().split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join("") : label;
}

/** A value that isn't there: a muted dash, with what's missing in words for the tooltip and screen readers. */
function None({ title }: { title: string }) {
  return (
    <span className="ah-none" title={title}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{title}</span>
    </span>
  );
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

// The editors moved to ./Editors.tsx (AH-5); Gantt and Gaps import Editor from there.
export { Editor } from "./Editors.tsx";

/**
 * DV-2: an item I have staged changes on that changed in DevOps while Ahead was open. My changes stay staged; Show the
 * new values puts DevOps's values beside mine, so nothing is overwritten silently on either side.
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
