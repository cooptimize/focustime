// AH-1: Ahead › Grid (was Roadmap, D653): every level grouped client › epic › feature › story, collapsible, with
// State, Start, Target, Assigned to, Size and Readiness. AH-2: no cell is filled for a gap; a missing value is a muted
// "—" saying what's missing in its tooltip ("No target date"), a field the type doesn't have is a "—" saying "Not in
// <project>'s process", and gaps show only in Readiness as quiet chips (two, then +N). Closed items are dimmed with no
// gap marks; a state is a small dot and its word in the neutral color. Edits are inline and go into my change set (nothing is written until Commit): Enter
// edits, Enter keeps, Esc cancels; arrows move between cells. Items I may not change say who can.
// AH-3: the Item column comes first at every window size (ui/ahead/layout.ts): the type as its icon, the title on one or
// two lines with #id beside it, the other columns compact and fixed; under 1400 Start and Target are one Dates column,
// under 1200 Readiness is dots, under 900 each row is a two-line card (Size leaves; Unsized shows as a dot).
import type React from "react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChangeField, DayHalf } from "../../plan/ahead-edit.ts";
import { GAP_WORDS } from "../../plan/fixnext.ts";
import { STATE_WORDS } from "../../plan/roadmap.ts";
import { gapChip, ReadyChips, stateChip } from "./Chips.tsx";
import { isOpen } from "./model.ts";
import { WorkLink } from "../WorkLink.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import type { GridLayout } from "./layout.ts";
import { useAhead } from "./Ahead.tsx";
import { AssigneePicker } from "./Assignee.tsx";
import type { Group, Row } from "./model.ts";

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
const EDIT: Partial<Record<Col, ChangeField>> = { start: "start", target: "target", dates: "start", assignee: "assignee", size: "size" };
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const longDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function Grid({ groups, layout = "wide" }: { groups: Group[]; layout?: GridLayout }) {
  const COLS = COLUMNS[layout];
  const a = useAhead();
  const [closed, setClosed] = useState<Set<string>>(new Set());
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
        if (closed.has(r.key)) hidden.add(r.item.id);
      }
      out.push({ g, rows });
    }
    return out;
  }, [groups, closed]);
  const flat = shown.flatMap((x) => x.rows);
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

  const toggle = (k: string) => setClosed((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });
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
                    open={!closed.has(r.key)}
                    toggle={() => toggle(r.key)}
                    focus={focus}
                    first={flat[0]?.key === r.key}
                    editing={editing?.key === r.key ? editing.col : null}
                    setFocus={setFocus}
                    edit={(c) => setEditing(c ? { key: r.key, col: c } : null)}
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

function GridRow({ r, g, open, toggle, focus, first, editing, setFocus, edit, move, reg, highlighted, cols, dots }: {
  r: Row; g: Group; open: boolean; toggle: () => void; focus: { key: string; col: Col } | null; first: boolean; editing: Col | null;
  setFocus: (f: { key: string; col: Col }) => void; edit: (c: Col | null) => void; move: (dr: number, dc: number) => void; reg: (c: Col, el: HTMLElement | null) => void; highlighted: boolean;
  cols: readonly Col[]; dots: boolean;
}) {
  const a = useAhead();
  const c = g.client;
  const rm = a.roadmap.get(r.key);
  const hasKids = g.rows.some((x) => x.item.parentId === r.item.id);
  const canChange = r.editable && !a.readOnly;
  const notIn = `Not in ${c.project ?? c.clientName}'s process`;
  const can = (col: Col) => (col === "dates" ? r.has.start || r.has.target : !!EDIT[col] && r.has[EDIT[col]!]);
  const tab = (col: Col) => (focus ? (focus.key === r.key && focus.col === col ? 0 : -1) : first && col === "item" ? 0 : -1);
  const keys = (col: Col) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const field = EDIT[col];
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
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
        className={`ah-cell ah-col-${col}${pending ? " ah-pend" : ""}${conf ? " ah-conf" : ""}${field && !can(col) ? " ah-abs" : ""}${editable && editing !== col ? " ah-edit" : ""}`}
        onFocus={() => setFocus({ key: r.key, col })}
        onKeyDown={keys(col)}
        onClick={(e) => editable && editing !== col && !(e.target as HTMLElement).closest("a, button, input, select, [role=listbox]") && edit(col)}
        onDoubleClick={() => editable && edit(col)}
      >
        {editing === col && col === "dates" ? <DatesEditor r={r} done={() => (edit(null), move(0, 0))} /> : editing === col && field ? <Editor r={r} field={field} done={() => (edit(null), move(0, 0))} /> : body}
        {pending && editing !== col && <span className="ah-dot" title={conf ? "Changed in DevOps too: see the review" : "Pending: not in DevOps until you save"} aria-hidden="true" />}
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
                    <button type="button" className="rm-expand" tabIndex={-1} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what's under ${r.item.title}`} onClick={toggle}>
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
                  {r.item.inScope === false && !r.context && <span className="ah-ro" title="Outside Cooptimize's work in this project (shown with Show the whole project)">Outside scope</span>}
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
                  <span className={`ah-state-dot cat-${r.item.stateCategory.toLowerCase()}`} aria-hidden="true" />
                  {r.item.state}
                </span>,
                { label: `State: ${r.item.state}` },
              )}
            </Fragment>
          );
        if (col === "start") return <Fragment key={col}>{cell("start", date("start"), { label: `Start: ${r.eff.start ?? (r.has.start ? "no start date" : notIn)}` })}</Fragment>;
        if (col === "target") return <Fragment key={col}>{cell("target", date("target"), { label: `Target: ${r.eff.target ?? (r.has.target ? "no target date" : notIn)}` })}</Fragment>;
        if (col === "dates") return <Fragment key={col}>{cell("dates", dates(), { label: datesLabel })}</Fragment>;
        if (col === "assignee") return <Fragment key={col}>{cell("assignee", r.eff.assignee ? <span className="ah-who" title={r.eff.assignee.name}>{r.eff.assignee.name}</span> : <None title="Nobody assigned" />, { label: `Assigned to: ${r.eff.assignee?.name ?? "nobody"}` })}</Fragment>;
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

/** The Dates column's editor: start first (where the type has one), then target. */
function DatesEditor({ r, done }: { r: Row; done: () => void }) {
  const [f, setF] = useState<"start" | "target">(r.has.start ? "start" : "target");
  return (
    <span className="ah-dates-edit">
      <span className="muted">{f === "start" ? "Start" : "Target"}</span>
      <Editor key={f} r={r} field={f} done={() => (f === "start" && r.has.target ? setF("target") : done())} />
    </span>
  );
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

/** One inline editor: a date (with its half-day), a number, or the assignee picker. Enter keeps, Esc cancels. */
export function Editor({ r, field, done }: { r: Row; field: ChangeField; done: () => void }) {
  const a = useAhead();
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey)!;
  const [text, setText] = useState(() => (field === "size" ? (r.eff.size === null ? "" : String(r.eff.size)) : field === "start" ? (r.eff.start ?? "") : field === "target" ? (r.eff.target ?? "") : ""));
  const [half, setHalf] = useState<DayHalf>(() => (field === "start" ? (r.startHalf ?? "AM") : (r.targetHalf ?? "PM")));
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  if (field === "assignee")
    return (
      <AssigneePicker
        clientKey={r.clientKey}
        me={c.me}
        current={r.eff.assignee}
        onCancel={done}
        onPick={(v) => void a.stage(r, "assignee", v).then(done)}
      />
    );
  const keep = () => {
    if (field === "size") {
      const n = text.trim() === "" ? null : Number(text);
      if (n !== null && !Number.isFinite(n)) return;
      void a.stage(r, "size", n).then(done);
    } else void a.stage(r, field, text || null, text ? half : null).then(done);
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") (e.preventDefault(), keep());
    else if (e.key === "Escape") (e.preventDefault(), done());
  };
  return (
    <span className="ah-editor" onKeyDown={keys}>
      {field === "size" ? (
        <input ref={box} type="number" min={0} step="any" inputMode="decimal" aria-label={r.sizeLabel ?? "Size"} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <>
          <input ref={box} type="date" aria-label={field === "start" ? "Start date" : "Target date"} value={text} onChange={(e) => setText(e.target.value)} />
          <select aria-label="Half-day" value={half} onChange={(e) => setHalf(e.target.value as DayHalf)}>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </>
      )}
      <button type="button" className="mini" onClick={keep}>
        Keep
      </button>
      <button type="button" className="mini quiet" onClick={done}>
        Cancel
      </button>
    </span>
  );
}
