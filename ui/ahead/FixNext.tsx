// AH-1 (D662): Fix next: readiness gaps as actions on items I may change. AH-3: ranked by each client's DevOps backlog
// (plan/fixnext.ts): only what's near the top of each backlog, dated in the next 4 weeks, or mine; grouped by client,
// then epic › feature, with TypeIcons. Each row shows its gaps and the one next action (Break down, Set dates, Assign,
// Size); top 10 per client, then Show more. A project with no backlog order is ranked by target date and says so. What
// I do here goes into the change set like any edit (Break down opens its side panel, which publishes on its own). AH-7:
// Start here (the 5 most urgent), the counts by kind, a fix per missing piece on the row, a ready item fading out with
// Undo, and Skip kept on the server for 2 weeks (Skipped at the bottom, with Unskip). Its own mode (#/ahead/fix); the count is in the mode switch ("Readiness · N"; Fix
// next, then Gaps, before AH-6). AH-6: Ahead's filters narrow it, and the shared level folds it (carets, Left, Right).
import type React from "react";
import { useState, type CSSProperties } from "react";
import { isOpenRow, setRow } from "../../plan/gantt-tree.ts";
import { GAP_ACTION, GAP_KINDS, GAP_WORDS, PER_CLIENT, fixRows, type FixEntry, type FixGroup, type GapKind } from "../../plan/fixnext.ts";
import type { AheadFilters } from "../../plan/ahead-edit.ts";
import { kindCounts, skipEnds, START_RULE, startHere, toggleKind, type Skips } from "../../plan/readiness.ts";
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

const FLAT: Fold = { kids: false, open: true, hidden: 0, toggle: () => {}, tab: -1 };

function FixRowView({ r, entry, depth, skip, dots, fold, client }: { r: Row; entry: FixEntry | null; depth: number; skip: (k: string) => void; dots: boolean; fold: Fold; /** AH-7: Start here names the client. */ client?: string }) {
  const a = useAhead();
  const [open, setOpen] = useState<Open>(null);
  // AH-7: every missing piece has its own fix on the row, the first one first.
  const act = (g: GapKind) => {
    if (g === "needs_stories") a.breakDown(r);
    else if (g === "no_dates") setOpen(r.has.start && !r.eff.start ? "start" : "target");
    else if (g === "unassigned") setOpen("assignee");
    else setOpen("size");
  };
  return (
    <li data-tour={entry ? "ah-fix-row" : undefined} data-key={entry?.key} className={`ah-fx-row${entry ? "" : " ctx"}${entry?.leaving ? " leaving" : ""}`} style={{ "--ah-depth": depth } as CSSProperties} aria-label={entry ? `${r.item.title}: ${entry.gaps.map((g) => GAP_WORDS[g]).join(", ")}` : undefined}>
      <span className="ah-fx-item" tabIndex={fold.tab} data-depth={depth} data-key={r.key} aria-expanded={fold.kids ? fold.open : undefined} onKeyDown={(e) => rowKeys(e, fold)}>
        {fold.kids ? (
          <button type="button" className="rm-expand" tabIndex={-1} aria-expanded={fold.open} aria-label={`${fold.open ? "Hide" : "Show"} what's under ${r.item.title}`} onClick={() => fold.toggle(!fold.open)}>
            {fold.open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="rm-expand-space" aria-hidden="true" />
        )}
        {client && (
          <span className="ah-fx-client-name" style={{ "--c": a.color(r.clientKey) } as CSSProperties}>
            <span className="dl-swatch" aria-hidden="true" />
            {client}
          </span>
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
          {entry.leaving ? (
            <span className="ah-fx-ready">Ready</span>
          ) : open === null ? (
            <span className="ah-fx-acts">
              {entry.gaps.map((g, i) => (
                <button key={g} type="button" className={i === 0 ? "mini" : "mini quiet"} onClick={() => act(g)} aria-label={`${GAP_ACTION[g]}: ${r.item.title}`}>
                  {GAP_ACTION[g]}
                </button>
              ))}
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

/** AH-7: "Needs stories 23 · No target date 40 · …": each applies that kind in the toolbar; again clears it. */
function KindCounts({ entries, f, setFilters }: { entries: FixEntry[]; f: AheadFilters; setFilters: (f: AheadFilters) => void }) {
  const n = kindCounts(entries);
  const on = f.kinds ?? [];
  return (
    <div className="ah-fx-kinds" role="group" aria-label="Not ready, by kind">
      {GAP_KINDS.map((k: GapKind) => {
        const active = on.includes(k);
        return (
          <button key={k} type="button" className={`ah-fx-kind${active ? " on" : ""}`} aria-pressed={active} aria-disabled={!n[k] && !active ? true : undefined} title={active ? "Show every kind again" : n[k] ? `Show only ${GAP_WORDS[k].toLowerCase()}` : `Nothing is ${GAP_WORDS[k].toLowerCase()} here`} onClick={() => (n[k] || active) && setFilters({ ...f, kinds: toggleKind(on, k) })}>
            {GAP_WORDS[k]} <strong>{n[k]}</strong>
          </button>
        );
      })}
    </div>
  );
}

/** AH-7: the five most urgent across the clients shown, with the rule one hover away. */
function StartHere({ groups, skip, dots }: { groups: { client: LoadClient; group: FixGroup; rows: Row[] }[]; skip: (k: string) => void; dots: boolean }) {
  const [why, setWhy] = useState(false);
  const picks = startHere(groups.flatMap((g) => g.group.entries.map((entry, rank) => ({ entry, rank, date: entry.due ?? null, mine: entry.mine === true }))));
  if (!picks.length) return null;
  const rowOf = (e: FixEntry) => groups.find((g) => g.client.clientKey === e.clientKey)?.rows.find((r) => r.item.id === e.itemId);
  const nameOf = (k: string) => groups.find((g) => g.client.clientKey === k)?.client.clientName ?? k;
  return (
    <section className="ah-fx-start" aria-labelledby="ah-start-head">
      <h3 className="ah-client-head" id="ah-start-head">
        Start here
        <span className="ah-fx-why">
          <button type="button" className="mini quiet" aria-describedby="ah-why-tip" aria-expanded={why} onClick={() => setWhy(!why)} onMouseEnter={() => setWhy(true)} onMouseLeave={() => setWhy(false)} onFocus={() => setWhy(true)} onBlur={() => setWhy(false)}>
            Why these?
          </button>
          <span id="ah-why-tip" role="tooltip" className="ah-fx-tip" hidden={!why}>
            The {picks.length} most urgent here. {START_RULE}
          </span>
        </span>
      </h3>
      <ol className="ah-fx-list">
        {picks.map((e) => {
          const r = rowOf(e);
          return r ? <FixRowView key={`start:${e.key}`} r={r} entry={e} depth={0} skip={skip} dots={dots} fold={FLAT} client={nameOf(e.clientKey)} /> : null;
        })}
      </ol>
    </section>
  );
}

/** AH-7: what I skipped, folded at the bottom; each comes back on its own after 2 weeks, or with Unskip. */
function Skipped({ groups, unskip, skips }: { groups: { client: LoadClient; group: FixGroup; rows: Row[] }[]; unskip: (k: string) => void; skips: Skips }) {
  const [open, setOpen] = useState(false);
  const list = groups.flatMap((g) => (g.group.skipped ?? []).map((e) => ({ e, r: g.rows.find((r) => r.item.id === e.itemId), client: g.client })));
  if (!list.length) return null;
  return (
    <section className="ah-fx-skipped" aria-label="Skipped">
      <button type="button" className="mini quiet ah-fx-skipped-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Skipped ({list.length})
      </button>
      {open && (
        <ol className="ah-fx-list">
          {list.map(({ e, r, client }) =>
            r ? (
              <li key={e.key} className="ah-fx-row" data-key={e.key} aria-label={`${r.item.title}: skipped`}>
                <span className="ah-fx-item">
                  <span className="ah-fx-client-name" style={{ "--c": "var(--text-muted)" } as CSSProperties}>{client.clientName}</span>
                  <TypeIcon clientKey={r.clientKey} type={r.item.type} className="ah-type-icon" />
                  <span className="ah-title">
                    <WorkLink clientKey={r.clientKey} url={r.item.url}>{r.item.title}</WorkLink> <span className="muted ah-id">#{r.item.id}</span>
                    {skips[e.key] && <span className="muted"> · back {monthDay(skipEnds(skips[e.key]!))}</span>}
                  </span>
                </span>
                <span className="ah-fx-side">
                  <ReadyChips chips={e.gaps.map((g) => gapChip(g))} dots={false} max={2} />
                  <button type="button" className="mini" onClick={() => unskip(e.key)} aria-label={`Unskip ${r.item.title}`}>
                    Unskip
                  </button>
                </span>
              </li>
            ) : null,
          )}
        </ol>
      )}
    </section>
  );
}

export function FixNext({ groups, skip, unskip, skips, f, setFilters, dots, filtered = false }: { groups: { client: LoadClient; group: FixGroup; rows: Row[]; unkinded?: FixEntry[] }[]; skip: (k: string) => void; unskip: (k: string) => void; skips: Skips; f: AheadFilters; setFilters: (f: AheadFilters) => void; dots: boolean; /** AH-6: some filter narrows the list. */ filtered?: boolean }) {
  const total = groups.reduce((k, g) => k + g.group.entries.length, 0);
  if (!groups.length) return null;
  const unkinded = groups.flatMap((g) => (g.unkinded ?? g.group.entries).filter((e) => !e.leaving));
  return (
    <div className="ah-fix-mode">
      {unkinded.length > 0 && <KindCounts entries={unkinded} f={f} setFilters={setFilters} />}
      <p className="muted ah-fx-intro">
        {total
          ? "Items near the top of each backlog, dated in the next 4 weeks, or yours, that are missing stories, a target date, an owner or a size. In backlog order."
          : filtered
            ? "Nothing not ready matches these filters."
            : "Nothing to fix on items you can change. The top of each backlog has its stories, dates, owners and sizes."}
      </p>
      <StartHere groups={groups} skip={skip} dots={dots} />
      {groups.map((g) => <ClientFix key={g.client.clientKey} {...g} skip={skip} dots={dots} filtered={filtered} />)}
      <Skipped groups={groups} unskip={unskip} skips={skips} />
    </div>
  );
}
