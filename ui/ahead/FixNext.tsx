// AH-1 (D662): Fix next: readiness gaps as actions on items I may change. AH-3: ranked by each client's DevOps backlog
// (plan/fixnext.ts): only what's near the top of each backlog, dated in the next 4 weeks, or mine; grouped by client,
// then epic › feature, with TypeIcons. Each row shows its gaps and the one next action (Break down, Set dates, Assign,
// Size); top 10 per client, then Show more. A project with no backlog order is ranked by target date and says so. What
// I do here goes into the change set like any edit (Break down opens its side panel, which publishes on its own); Skip
// puts one aside for the session. Its own mode (#/ahead/fix); the count is in the mode switch ("Readiness · N"; Fix
// next, then Gaps, before AH-6). AH-6: Ahead's filters narrow it, and the shared level folds it (carets, Left, Right).
import type React from "react";
import { useState, type CSSProperties } from "react";
import { isOpenRow, setRow } from "../../plan/gantt-tree.ts";
import { GAP_ACTION, GAP_WORDS, PER_CLIENT, fixRows, type FixEntry, type FixGroup } from "../../plan/fixnext.ts";
import { useAhead } from "./Ahead.tsx";
import { gapChip, ReadyChips } from "./Chips.tsx";
import { Editor } from "./Editors.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { WorkLink } from "../WorkLink.tsx";
import type { LoadClient, Row } from "./model.ts";

const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Open = "start" | "target" | "size" | "assignee" | null;

/** AH-6: a row's place in the folded list: its caret (only with rows under it), and what a closed row hides. */
type Fold = { kids: boolean; open: boolean; hidden: number; toggle: (open: boolean) => void; tab: number };

/** On a row: Up and Down between rows, Left collapses (or goes to its parent), Right expands. */
function rowKeys(e: React.KeyboardEvent<HTMLElement>, fold: Fold) {
  if (e.target !== e.currentTarget) return;
  const rows = [...(e.currentTarget.closest(".ah-fix-mode")?.querySelectorAll<HTMLElement>(".ah-fx-item[tabindex]") ?? [])];
  const i = rows.indexOf(e.currentTarget);
  const depth = Number(e.currentTarget.dataset.depth ?? 0);
  const go = (el: HTMLElement | undefined) => el?.focus();
  if (e.key === "ArrowDown") go(rows[i + 1]);
  else if (e.key === "ArrowUp") go(rows[i - 1]);
  else if (e.key === "ArrowLeft") {
    if (fold.kids && fold.open) fold.toggle(false);
    else go(rows.slice(0, i).reverse().find((x) => Number(x.dataset.depth ?? 0) < depth));
  } else if (e.key === "ArrowRight") {
    if (fold.kids && !fold.open) fold.toggle(true);
    else if (fold.kids) go(rows[i + 1]);
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

function FixRowView({ r, entry, depth, skip, dots, fold }: { r: Row; entry: FixEntry | null; depth: number; skip: (k: string) => void; dots: boolean; fold: Fold }) {
  const a = useAhead();
  const [open, setOpen] = useState<Open>(null);
  const act = (e: FixEntry) => {
    if (e.action === "needs_stories") a.breakDown(r);
    else if (e.action === "no_dates") setOpen(r.has.start && !r.eff.start ? "start" : "target");
    else if (e.action === "unassigned") setOpen("assignee");
    else setOpen("size");
  };
  return (
    <li data-tour={entry ? "ah-fix-row" : undefined} className={`ah-fx-row${entry ? "" : " ctx"}`} style={{ "--ah-depth": depth } as CSSProperties} aria-label={entry ? `${r.item.title}: ${entry.gaps.map((g) => GAP_WORDS[g]).join(", ")}` : undefined}>
      <span className="ah-fx-item" tabIndex={fold.tab} data-depth={depth} data-key={r.key} aria-expanded={fold.kids ? fold.open : undefined} onKeyDown={(e) => rowKeys(e, fold)}>
        {fold.kids ? (
          <button type="button" className="rm-expand" tabIndex={-1} aria-expanded={fold.open} aria-label={`${fold.open ? "Hide" : "Show"} what's under ${r.item.title}`} onClick={() => fold.toggle(!fold.open)}>
            {fold.open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="rm-expand-space" aria-hidden="true" />
        )}
        <TypeIcon clientKey={r.clientKey} type={r.item.type} className="ah-type-icon" />
        <span className="ah-title" title={`${r.item.type} #${r.item.id}: ${r.item.title}`}>
          <WorkLink clientKey={r.clientKey} url={r.item.url}>{r.item.title}</WorkLink> <span className="muted ah-id">#{r.item.id}</span>
          {entry && r.eff.target && <span className="muted ah-fx-due"> · target {monthDay(r.eff.target)}</span>}
          {!fold.open && fold.hidden > 0 && <span className="muted ah-fx-under"> · {fold.hidden} more under it</span>}
        </span>
      </span>
      {entry && (
        <span className="ah-fx-side">
          <ReadyChips chips={entry.gaps.map((g) => gapChip(g))} dots={dots} max={dots ? 4 : 2} />
          {open === null ? (
            <span className="ah-fx-acts">
              <button type="button" className="mini" onClick={() => act(entry)}>
                {GAP_ACTION[entry.action]}
              </button>
              <button type="button" className="mini quiet" onClick={() => skip(entry.key)} aria-label={`Skip ${r.item.title} for now`}>
                Skip
              </button>
            </span>
          ) : null}
        </span>
      )}
      {open ? (
        <span className="ah-fx-edit">
          <span className="muted">{open === "size" ? (r.sizeLabel ?? "Size") : open === "assignee" ? "Assigned to" : open === "start" ? "Start" : "Target"}</span>
          <Editor key={open} r={r} field={open} done={() => setOpen(open === "start" && r.has.target && !r.eff.target ? "target" : null)} />
          {open === "size" && r.hint && <span className="muted ah-hint">{r.hint}</span>}
        </span>
      ) : null}
    </li>
  );
}

function ClientFix({ client, group, rows, skip, dots, filtered }: { client: LoadClient; group: FixGroup; rows: Row[]; skip: (k: string) => void; dots: boolean; filtered: boolean }) {
  const a = useAhead();
  const [all, setAll] = useState(false);
  const n = group.entries.length;
  const listed = fixRows(group, rows.map((r) => ({ id: r.item.id, parentId: r.item.parentId })), all ? n : PER_CLIENT);
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  // AH-6: the shared level and carets fold the list; a closed row says how many are under it.
  const { fold, setFold } = a.view;
  const shown: { x: (typeof listed)[number]; f: Fold }[] = [];
  let closedAt: number | null = null;
  listed.forEach((x, i) => {
    if (closedAt !== null && x.depth > closedAt) return;
    closedAt = null;
    const r = byId.get(x.itemId);
    if (!r) return;
    const under: typeof listed = [];
    for (let j = i + 1; j < listed.length && listed[j]!.depth > x.depth; j++) under.push(listed[j]!);
    const kids = under.length > 0;
    const open = kids && isOpenRow(fold, r);
    if (kids && !open) closedAt = x.depth;
    shown.push({ x, f: { kids, open, hidden: open ? 0 : under.filter((u) => u.entry).length, toggle: (o) => setFold((old) => setRow(old, r, o)), tab: shown.length === 0 ? 0 : -1 } });
  });
  return (
    <section className="ah-fx-client" style={{ "--c": a.color(client.clientKey) } as CSSProperties} aria-label={`${client.clientName}: ${plural(n, "thing", "things")} to fix`}>
      <h3 className="ah-client-head">
        <span className="dl-swatch" aria-hidden="true" />
        {client.clientName}
        {client.project && <span className="muted"> · {client.project}</span>}
        <span className="muted"> · {n}</span>
      </h3>
      {group.rankedBy === "target" && n > 0 && <p className="muted ah-fx-note">{client.project ?? client.clientName} has no backlog order, so these are ranked by target date.</p>}
      {n === 0 ? (
        <p className="muted ah-fx-note">{filtered ? "Nothing here matches these filters." : "Nothing to fix near the top of the backlog or in the next 4 weeks."}</p>
      ) : (
        <ol className="ah-fx-list">
          {shown.map(({ x, f }) => <FixRowView key={x.key} r={byId.get(x.itemId)!} entry={x.entry} depth={x.depth} skip={skip} dots={dots} fold={f} />)}
        </ol>
      )}
      {n > PER_CLIENT && (
        <button type="button" className="mini quiet ah-fx-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${n - PER_CLIENT} more`}
        </button>
      )}
    </section>
  );
}

export function FixNext({ groups, skip, dots, filtered = false }: { groups: { client: LoadClient; group: FixGroup; rows: Row[] }[]; skip: (k: string) => void; dots: boolean; /** AH-6: some filter narrows the list. */ filtered?: boolean }) {
  const total = groups.reduce((k, g) => k + g.group.entries.length, 0);
  if (!groups.length) return null;
  return (
    <div className="ah-fix-mode">
      <p className="muted ah-fx-intro">
        {total
          ? "Items near the top of each backlog, dated in the next 4 weeks, or yours, that are missing stories, a target date, an owner or a size. In backlog order."
          : filtered
            ? "Nothing not ready matches these filters."
            : "Nothing to fix on items you can change. The top of each backlog has its stories, dates, owners and sizes."}
      </p>
      {groups.map((g) => <ClientFix key={g.client.clientKey} {...g} skip={skip} dots={dots} filtered={filtered} />)}
    </div>
  );
}
