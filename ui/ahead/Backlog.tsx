// BH-1: Ahead › Backlog. Each client's backlog at one tier (Stories, Features or Epics) in that project's own order,
// within Cooptimize's scope, clients side by side on wide screens and stacked on narrow ones. Each row: rank, type,
// title, a gap marker (as in Gaps), and one quiet line of state, assignee, target date, size and last change. Stale
// rows (no change for the person's weeks, Settings › Ahead) say so. The order is read-only here.
//
// Bulk actions on the selected rows go into Ahead's change set (nothing is written until Save to DevOps, with its
// preview, confirm, read back and undo): push the target date by 2 or 4 weeks or to a chosen date, set one where
// there's none, assign to me. Items I can't change are skipped with the reason. Plan it puts the selected stories on
// next week's Plan (a plan-store write), with Undo.
import { DateField } from "../DatePicker.tsx";
import { useMemo, useState, type CSSProperties } from "react";
import type { WeekPlanState } from "../../actions/types.ts";
import { bulkSummary, lastText, nextMonday, type BacklogGroup, type BacklogRow, type BulkOp } from "../../plan/backlog.ts";
import type { StagedChange } from "../../plan/ahead-edit.ts";
import { call } from "../api.ts";
import { TypeIcon } from "../TypeIcon.tsx";
import { NewUnder } from "./NewUnder.tsx";
import { WorkLink } from "../WorkLink.tsx";
import { useAhead } from "./Ahead.tsx";
import { gapChip, ReadyChips } from "./Chips.tsx";

const SHOW = 40;
const TIER_WORDS = { story: ["story", "stories"], feature: ["feature", "features"], epic: ["epic", "epics"] } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

type Skip = { clientKey: string; itemId: number; reason: string };
type Result = { text: string; skipped: Skip[] };
type Toast = { id: number; text: string; undo: (() => Promise<void>) | null };

export function Backlog({ groups, tier, onChanged }: { groups: BacklogGroup[]; tier: "story" | "feature" | "epic"; onChanged: () => void }) {
  const a = useAhead();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dateFor, setDateFor] = useState<"move" | "set_missing" | null>(null);
  const [date, setDate] = useState("");
  const rows = useMemo(() => new Map(groups.flatMap((g) => g.rows.map((r) => [r.key, r] as const))), [groups]);
  const chosen = [...sel].map((k) => rows.get(k)).filter((r): r is BacklogRow => !!r);
  const titleOf = (s: Skip) => rows.get(`${s.clientKey}:${s.itemId}`)?.item.title ?? "";
  const toggle = (k: string, on?: boolean) => setSel((s) => {
    const n = new Set(s);
    (on ?? !n.has(k)) ? n.add(k) : n.delete(k);
    return n;
  });

  const bulk = async (op: BulkOp) => {
    setBusy(true);
    try {
      const r = await call<{ changes: StagedChange[]; staged: { clientKey: string; itemId: number }[]; skipped: Skip[] }>("ahead.stage_bulk", { items: chosen.map((x) => ({ clientKey: x.clientKey, itemId: x.item.id })), op });
      a.setChanges(r.changes);
      setResult({ text: bulkSummary(op, r.staged.length, r.skipped.length), skipped: r.skipped });
      setSel(new Set(r.skipped.map((s) => `${s.clientKey}:${s.itemId}`)));
      setDateFor(null);
    } catch (e) {
      a.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // Plan it: next week's Plan; Undo takes off only what this added.
  const planIt = async () => {
    const weekStart = nextMonday(a.load.today);
    const stories = chosen.filter((r) => r.tier === "story");
    const skipped: Skip[] = chosen.filter((r) => r.tier !== "story").map((r) => ({ clientKey: r.clientKey, itemId: r.item.id, reason: "Plan it adds stories" }));
    if (!stories.length) return;
    setBusy(true);
    try {
      const st = await call<WeekPlanState>("weekplan.load", { weekStart });
      const on = new Set(st.plan.features.map((f) => `${f.clientKey}:${f.itemId}`));
      const added: number[] = [];
      for (const r of stories) {
        if (on.has(r.key)) {
          skipped.push({ clientKey: r.clientKey, itemId: r.item.id, reason: "Already on next week's Plan" });
          continue;
        }
        try {
          const res = await call<{ item: { id: number } }>("weekplan.add", { weekStart, clientKey: r.clientKey, itemId: r.item.id });
          added.push(res.item.id);
        } catch (e) {
          skipped.push({ clientKey: r.clientKey, itemId: r.item.id, reason: errText(e) });
        }
      }
      setResult({ text: `${plural(added.length, "story", "stories")} on next week's Plan (week of ${monthDay(weekStart)})`, skipped });
      setSel(new Set(skipped.map((s) => `${s.clientKey}:${s.itemId}`)));
      if (added.length) {
        setToast({
          id: Date.now(),
          text: `${plural(added.length, "story", "stories")} on next week's Plan`,
          undo: async () => {
            for (const id of added) await call("weekplan.remove", { id });
            onChanged();
          },
        });
        onChanged();
      }
    } catch (e) {
      a.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const [one, many] = TIER_WORDS[tier];
  return (
    <div className="bl-box">
      {!a.readOnly && chosen.length > 0 && (
        <div className="bl-bulk" role="toolbar" aria-label="Selected items">
          <strong>{chosen.length} selected</strong>
          <span className="bl-bulk-group" role="group" aria-label="Push target date">
            <span className="muted">Push target date</span>
            <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "push", weeks: 2 })}>
              2 weeks
            </button>
            <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "push", weeks: 4 })}>
              4 weeks
            </button>
            <button type="button" className="mini" disabled={busy} aria-pressed={dateFor === "move"} onClick={() => setDateFor(dateFor === "move" ? null : "move")}>
              To a date…
            </button>
          </span>
          <button type="button" className="mini" disabled={busy} aria-pressed={dateFor === "set_missing"} onClick={() => setDateFor(dateFor === "set_missing" ? null : "set_missing")}>
            Set a target date…
          </button>
          <button type="button" className="mini" disabled={busy} onClick={() => void bulk({ kind: "assign_me" })}>
            Assign to me
          </button>
          <button type="button" className="mini" disabled={busy || !chosen.some((r) => r.tier === "story")} title={chosen.some((r) => r.tier === "story") ? "Adds the selected stories to next week's Plan" : "Plan it adds stories: switch to Stories"} onClick={() => void planIt()}>
            Plan it
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={() => (setSel(new Set()), setDateFor(null))}>
            Clear
          </button>
          {dateFor && (
            <span className="bl-bulk-date">
              <span className="bl-bulk-label">
                {dateFor === "move" ? "New target date" : "Target date, only where there's none"}
                <DateField label={dateFor === "move" ? "New target date" : "Target date, only where there's none"} value={date || null} today={a.load.today} clearable={false} placeholder="Choose a date" onChange={(d) => setDate(d ?? "")} />
              </span>
              <button type="button" className="mini primary" disabled={busy || !date} onClick={() => void bulk({ kind: dateFor, date })}>
                Apply
              </button>
            </span>
          )}
        </div>
      )}
      {result && (
        <div className="bl-result" role="status">
          <span>{result.text}</span>
          {result.skipped.length > 0 && (
            <details>
              <summary>Why {plural(result.skipped.length, "item was", "items were")} skipped</summary>
              <ul>
                {result.skipped.map((s) => (
                  <li key={`${s.clientKey}:${s.itemId}`}>
                    #{s.itemId} {titleOf(s)}: <span className="muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" className="mini quiet" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="bl-clients">
        {groups.map((g) => {
          const c = g.client;
          const all = g.rows.map((r) => r.key);
          const picked = all.filter((k) => sel.has(k)).length;
          const shown = more.has(c.clientKey) ? g.rows : g.rows.slice(0, SHOW);
          return (
            <section key={c.clientKey} className="bl-client" style={{ "--c": a.color(c.clientKey) } as CSSProperties} aria-label={`${c.clientName} backlog`}>
              <header className="bl-head">
                {!a.readOnly && g.rows.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label={`Select all ${plural(g.rows.length, one, many)} shown for ${c.clientName}`}
                    checked={picked > 0 && picked === all.length}
                    ref={(el) => void (el && (el.indeterminate = picked > 0 && picked < all.length))}
                    onChange={(e) => setSel((s) => {
                      const n = new Set(s);
                      for (const k of all) e.target.checked ? n.add(k) : n.delete(k);
                      return n;
                    })}
                  />
                )}
                <span className="dl-swatch" aria-hidden="true" />
                <h3>{c.clientName}</h3>
                {c.project && <span className="muted">{c.project}</span>}
                <span className="bl-counts muted">
                  {plural(g.total, one, many)}
                  {g.stale > 0 && <span className="bl-stale-count"> · {g.stale} stale</span>}
                </span>
              </header>
              {c.status !== "ok" && <p className="set-problem">{c.message ?? "DevOps couldn't be read for this client"}</p>}
              {c.status === "ok" && g.rankedBy === "target" && <p className="muted bl-note">{c.project ?? c.clientName} has no backlog order field, so this is by target date.</p>}
              {c.status === "ok" && g.rows.length === 0 && <p className="muted bl-note">{g.total ? "Nothing here with these filters." : `No open ${many} in scope.`}</p>}
              {shown.length > 0 && (
                <ol className="bl-list">
                  {shown.map((r) => (
                    <BacklogItem key={r.key} r={r} selected={sel.has(r.key)} toggle={(on) => toggle(r.key, on)} />
                  ))}
                </ol>
              )}
              {g.rows.length > shown.length && (
                <button type="button" className="mini quiet bl-more" onClick={() => setMore((m) => new Set(m).add(c.clientKey))}>
                  Show all {g.rows.length}
                </button>
              )}
            </section>
          );
        })}
      </div>
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
    </div>
  );
}

function BacklogItem({ r, selected, toggle }: { r: BacklogRow; selected: boolean; toggle: (on: boolean) => void }) {
  const a = useAhead();
  const c = a.load.clients.find((x) => x.clientKey === r.clientKey);
  const look = c?.types.find((t) => t.name === r.item.type) ?? null;
  const pending = !!(r.pending.target || r.pending.assignee);
  const target = r.eff.target ? monthDay(r.eff.target) : null;
  const size = r.has.size ? (typeof r.eff.size === "number" ? `${r.eff.size}${r.sizeLabel ? ` ${r.sizeLabel}` : ""}` : "Unsized") : null;
  const last = lastText(r.age, r.last);
  return (
    <li className={`bl-row${r.stale ? " stale" : ""}${selected ? " sel" : ""}`}>
      {!a.readOnly && <input type="checkbox" checked={selected} onChange={(e) => toggle(e.target.checked)} aria-label={`Select #${r.item.id} ${r.item.title}`} />}
      <span className="bl-rank" title={`Rank ${r.rank} in this backlog`}>
        {r.rank}
      </span>
      <TypeIcon type={r.item.type} look={look} />
      <span className="bl-title">
        <WorkLink clientKey={r.clientKey} url={r.item.url}>
          {r.item.title}
        </WorkLink>{" "}
        <span className="muted bl-id">#{r.item.id}</span>
      </span>
      <NewUnder clientKey={r.clientKey} item={r.item} />
      <ReadyChips chips={r.gaps.map((k) => gapChip(k))} dots />
      <span className="bl-meta">
        <span>{r.item.state}</span>
        <span className={r.eff.assignee ? "" : "muted"}>{r.eff.assignee?.name ?? "Unassigned"}</span>
        <span className={target ? "" : "muted"}>{target ? `Target ${target}` : "No target date"}</span>
        {size && <span className={typeof r.eff.size === "number" ? "" : "muted"}>{size}</span>}
        <span className={r.stale ? "bl-stale" : "muted"} title={r.stale ? `No change in DevOps for ${a.load.staleWeeks ?? 6} weeks or more` : "Last change in DevOps"}>
          {r.stale ? `Stale · ${last}` : last}
        </span>
        {pending && <span className="ah-dot" title="Pending: not in DevOps until you save" aria-label="Pending change" />}
      </span>
    </li>
  );
}
