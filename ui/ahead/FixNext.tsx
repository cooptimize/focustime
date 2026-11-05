// AH-1 (D658): Fix next: readiness gaps as actions, one at a time, on items I may change: Break down (no open items
// under it), Set dates, Assign, Size. Soonest target first. What I do here goes into the change set like any edit
// (Break down opens its side panel, which publishes on its own). Skip puts one aside for the session. Its own mode
// (#/ahead/fix) and a slim pane beside Grid and Gantt.
import { useState, type CSSProperties } from "react";
import { GAP_ACTION, GAP_WORDS, type QueueEntry } from "../../plan/fixnext.ts";
import { useAhead } from "./Ahead.tsx";
import { AssigneePicker } from "./Assignee.tsx";
import { Editor } from "./Grid.tsx";
import type { Row } from "./model.ts";

type Entry = QueueEntry & { row: Row };
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

function FixCard({ e, skip, compact }: { e: Entry; skip?: (k: string) => void; compact?: boolean }) {
  const a = useAhead();
  const [open, setOpen] = useState<"start" | "target" | "size" | "assignee" | null>(null);
  const r = e.row;
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey)!;
  const due = r.eff.target;
  const act = () => {
    if (e.gap === "needs_stories") a.breakDown(r);
    else if (e.gap === "no_dates") setOpen(r.has.start && !r.eff.start ? "start" : "target");
    else if (e.gap === "unassigned") setOpen("assignee");
    else setOpen("size");
  };
  return (
    <article className={`ah-fix${compact ? " compact" : ""}`} style={{ "--c": a.color(r.clientKey) } as CSSProperties} aria-label={`${GAP_WORDS[e.gap]}: ${r.item.title}`}>
      <p className="ah-fix-what">
        <span className="ah-gap">{GAP_WORDS[e.gap]}</span>
        <span className="muted">
          {c.clientName} · {r.item.type} #{r.item.id}
          {due ? ` · target ${monthDay(due)}` : ""}
        </span>
      </p>
      <h3 className="ah-fix-title">{r.item.title}</h3>
      {open === "assignee" ? (
        <AssigneePicker clientKey={r.clientKey} me={c.me} current={r.eff.assignee} onCancel={() => setOpen(null)} onPick={(v) => void a.stage(r, "assignee", v).then(() => setOpen(null))} />
      ) : open ? (
        <span className="ah-fix-edit">
          <span className="muted">{open === "size" ? (r.sizeLabel ?? "Size") : open === "start" ? "Start" : "Target"}</span>
          <Editor r={r} field={open} done={() => setOpen(open === "start" && r.has.target && !r.eff.target ? "target" : null)} />
          {open === "size" && r.hint && <span className="muted ah-hint">{r.hint}</span>}
        </span>
      ) : (
        <span className="ah-fix-actions">
          <button type="button" className="primary" onClick={act}>
            {GAP_ACTION[e.gap]}
          </button>
          {skip && (
            <button type="button" className="mini quiet" onClick={() => skip(e.key)}>
              Skip
            </button>
          )}
        </span>
      )}
    </article>
  );
}

export function FixNext({ queue, skip, onNotice }: { queue: Entry[]; skip: (k: string) => void; onNotice: (s: string) => void }) {
  const [first, ...rest] = queue;
  void onNotice;
  if (!first) return <p className="muted ah-fix-empty">Nothing to fix on items you can change. Dates, owners, sizes and stories are all there.</p>;
  return (
    <div className="ah-fix-mode">
      <FixCard key={first.key} e={first} skip={skip} />
      {rest.length > 0 && (
        <section className="ah-fix-next" aria-label="After this">
          <h3 className="muted">After this · {rest.length}</h3>
          <ol>
            {rest.slice(0, 12).map((e) => (
              <li key={e.key}>
                <span className="ah-gap">{GAP_WORDS[e.gap]}</span> {e.row.item.title} <span className="muted">#{e.row.item.id}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Beside Grid and Gantt: "Fix next · N" with the first one ready to do. */
export function FixPane({ queue }: { queue: Entry[] }) {
  const [first] = queue;
  return (
    <aside className="ah-pane" aria-label={`Fix next: ${queue.length}`}>
      <h3>
        Fix next <span className="muted">· {queue.length}</span>
      </h3>
      {first ? <FixCard key={first.key} e={first} compact /> : <p className="muted">Nothing to fix.</p>}
      {queue.length > 1 && (
        <a className="mini quiet" href="#/ahead/fix">
          Open Fix next
        </a>
      )}
    </aside>
  );
}
