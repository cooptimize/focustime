// AH-1 (D662): Fix next: readiness gaps as actions on items I may change. AH-3: ranked by each client's DevOps backlog
// (plan/fixnext.ts): only what's near the top of each backlog, dated in the next 4 weeks, or mine; grouped by client,
// then epic › feature, with TypeIcons. Each row shows its gaps and the one next action (Break down, Set dates, Assign,
// Size); top 10 per client, then Show more. A project with no backlog order is ranked by target date and says so. What
// I do here goes into the change set like any edit (Break down opens its side panel, which publishes on its own); Skip
// puts one aside for the session. Its own mode (#/ahead/fix); the count is in the mode switch ("Fix next · N").
import { useState, type CSSProperties } from "react";
import { GAP_ACTION, GAP_WORDS, PER_CLIENT, fixRows, type FixEntry, type FixGroup } from "../../plan/fixnext.ts";
import { useAhead } from "./Ahead.tsx";
import { gapChip, ReadyChips } from "./Chips.tsx";
import { AssigneePicker } from "./Assignee.tsx";
import { Editor } from "./Grid.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { WorkLink } from "../WorkLink.tsx";
import type { LoadClient, Row } from "./model.ts";

const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Open = "start" | "target" | "size" | "assignee" | null;

function FixRowView({ r, entry, depth, skip, dots }: { r: Row; entry: FixEntry | null; depth: number; skip: (k: string) => void; dots: boolean }) {
  const a = useAhead();
  const [open, setOpen] = useState<Open>(null);
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey)!;
  const act = (e: FixEntry) => {
    if (e.action === "needs_stories") a.breakDown(r);
    else if (e.action === "no_dates") setOpen(r.has.start && !r.eff.start ? "start" : "target");
    else if (e.action === "unassigned") setOpen("assignee");
    else setOpen("size");
  };
  return (
    <li className={`ah-fx-row${entry ? "" : " ctx"}`} style={{ "--ah-depth": depth } as CSSProperties} aria-label={entry ? `${r.item.title}: ${entry.gaps.map((g) => GAP_WORDS[g]).join(", ")}` : undefined}>
      <span className="ah-fx-item">
        <TypeIcon clientKey={r.clientKey} type={r.item.type} className="ah-type-icon" />
        <span className="ah-title" title={`${r.item.type} #${r.item.id}: ${r.item.title}`}>
          <WorkLink clientKey={r.clientKey} url={r.item.url}>{r.item.title}</WorkLink> <span className="muted ah-id">#{r.item.id}</span>
          {entry && r.eff.target && <span className="muted ah-fx-due"> · target {monthDay(r.eff.target)}</span>}
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
      {open === "assignee" ? (
        <span className="ah-fx-edit">
          <AssigneePicker clientKey={r.clientKey} me={c.me} current={r.eff.assignee} onCancel={() => setOpen(null)} onPick={(v) => void a.stage(r, "assignee", v).then(() => setOpen(null))} />
        </span>
      ) : open ? (
        <span className="ah-fx-edit">
          <span className="muted">{open === "size" ? (r.sizeLabel ?? "Size") : open === "start" ? "Start" : "Target"}</span>
          <Editor key={open} r={r} field={open} done={() => setOpen(open === "start" && r.has.target && !r.eff.target ? "target" : null)} />
          {open === "size" && r.hint && <span className="muted ah-hint">{r.hint}</span>}
        </span>
      ) : null}
    </li>
  );
}

function ClientFix({ client, group, rows, skip, dots }: { client: LoadClient; group: FixGroup; rows: Row[]; skip: (k: string) => void; dots: boolean }) {
  const a = useAhead();
  const [all, setAll] = useState(false);
  const n = group.entries.length;
  const shown = fixRows(group, rows.map((r) => ({ id: r.item.id, parentId: r.item.parentId })), all ? n : PER_CLIENT);
  const byId = new Map(rows.map((r) => [r.item.id, r]));
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
        <p className="muted ah-fx-note">Nothing to fix near the top of the backlog or in the next 4 weeks.</p>
      ) : (
        <ol className="ah-fx-list">
          {shown.map((x) => {
            const r = byId.get(x.itemId);
            return r ? <FixRowView key={x.key} r={r} entry={x.entry} depth={x.depth} skip={skip} dots={dots} /> : null;
          })}
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

export function FixNext({ groups, skip, dots }: { groups: { client: LoadClient; group: FixGroup; rows: Row[] }[]; skip: (k: string) => void; dots: boolean }) {
  const total = groups.reduce((k, g) => k + g.group.entries.length, 0);
  if (!groups.length) return null;
  return (
    <div className="ah-fix-mode">
      <p className="muted ah-fx-intro">
        {total
          ? "Items near the top of each backlog, dated in the next 4 weeks, or yours, that are missing stories, a target date, an owner or a size. In backlog order."
          : "Nothing to fix on items you can change. The top of each backlog has its stories, dates, owners and sizes."}
      </p>
      {groups.map((g) => <ClientFix key={g.client.clientKey} {...g} skip={skip} dots={dots} />)}
    </div>
  );
}
