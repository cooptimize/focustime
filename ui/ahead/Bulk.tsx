// BH-1, BL-1: the bulk bar over the Grid's selected rows (was the Backlog mode's). Push the target date by 2 or 4 weeks
// or to a chosen date, set one where there's none, assign to me: each goes into the change set (nothing is written
// until Save to DevOps, with its preview, confirm, read back and undo); items I can't change are skipped with the
// reason. Plan it puts the selected stories on next week's Plan (a plan-store write), with Undo.
import { useState } from "react";
import type { WeekPlanState } from "../../actions/types.ts";
import type { StagedChange } from "../../plan/ahead-edit.ts";
import { bulkSummary, nextMonday, type BulkOp } from "../../plan/backlog.ts";
import { call } from "../api.ts";
import { DateField } from "../DatePicker.tsx";
import { useAhead } from "./Ahead.tsx";
import type { Row } from "./model.ts";
import { Icon } from "../icons.tsx";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

type Skip = { clientKey: string; itemId: number; reason: string };
type Result = { text: string; skipped: Skip[] };
type Toast = { id: number; text: string; undo: (() => Promise<void>) | null };

/** ahead.stage_bulk's most items a call. */
export const BULK_MAX = 200;
/** A list in parts of at most n, in order. */
export const inParts = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function BulkBar({ chosen, titleOf, select, onChanged }: { chosen: Row[]; titleOf: (clientKey: string, itemId: number) => string; /** The rows left selected (the ones skipped), or none. */ select: (keys: string[]) => void; onChanged: () => void }) {
  const a = useAhead();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dateFor, setDateFor] = useState<"move" | "set_missing" | null>(null);
  const [date, setDate] = useState("");

  const bulk = async (op: BulkOp) => {
    setBusy(true);
    try {
      // The server takes 200 items a call: a larger selection goes in parts, one result.
      type Part = { changes: StagedChange[]; staged: { clientKey: string; itemId: number }[]; skipped: Skip[] };
      const items = chosen.map((x) => ({ clientKey: x.clientKey, itemId: x.item.id }));
      const r: Part = { changes: [], staged: [], skipped: [] };
      for (const part of inParts(items, BULK_MAX)) {
        const p = await call<Part>("ahead.stage_bulk", { items: part, op });
        r.changes = p.changes;
        r.staged.push(...p.staged);
        r.skipped.push(...p.skipped);
      }
      a.setChanges(r.changes);
      setResult({ text: bulkSummary(op, r.staged.length, r.skipped.length), skipped: r.skipped });
      select(r.skipped.map((s) => `${s.clientKey}:${s.itemId}`));
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
      select(skipped.map((s) => `${s.clientKey}:${s.itemId}`));
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

  const stories = chosen.some((r) => r.tier === "story");
  return (
    <>
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
          <button type="button" className="mini" disabled={busy || !stories} title={stories ? "Adds the selected stories to next week's Plan" : "Plan it adds stories: select some stories"} onClick={() => void planIt()}>
            Plan it
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={() => (select([]), setDateFor(null))} title="Clear the selection (Esc)">
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
                    #{s.itemId} {titleOf(s.clientKey, s.itemId)}: <span className="muted">{s.reason}</span>
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
      {toast && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="mini" onClick={() => void toast.undo!().then(() => setToast({ id: Date.now(), text: "Undone", undo: null }), (e: unknown) => setToast({ id: Date.now(), text: errText(e), undo: null }))}>
              Undo
            </button>
          )}
          <button type="button" className="mini quiet icon-btn small" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}
