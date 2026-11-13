// PK-1: checking off a to-do offers the DevOps update, never automatically. After a tick on Today or the Board, a
// small card asks "Set #<id> to <done state>?" with the write's own preview (the state before and after, who it writes
// as) and Confirm, which is the existing state write (test /rev, read back, audit log, undo). Not now writes nothing.
// Unchecking a to-do whose item its offer just set offers that write's Undo (the write framework's undo preview).
// Close out asks once for the day's done to-dos (DoneBatch; FN-1: Finished or Made progress, time left and a comment per row). Offers come from devops.done_offer: only items I can
// change, not done already, with my write PAT; Settings › Planning's "never ask" turns them off.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DevOpsPreview, DevOpsResult, DoneOffer, UndoOffer } from "../actions/types.ts";
import { ActionRefusal, call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { commentPlaceholder, LEFT_PICKS, parseLeftText } from "../plan/wrapup.ts";
import { Icon } from "./icons.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** What a place that ticks a to-do tells the offer: which to-do, and done or not. */
export type DoneOfferEnv = {
  /** A to-do ticked or unticked. Its client and item when the caller knows them (a known "no item" asks nothing); the server checks the rest. */
  ticked: (pickId: number, done: boolean, clientKey?: string | null, itemId?: number | null) => void;
  /** FN-1: a check-in's Partly opens Wrap it up on Made progress with the time left. */
  progress?: (pickId: number, left: number, clientKey?: string | null, itemId?: number | null) => void;
};
export const DoneOfferCtx = createContext<DoneOfferEnv>({ ticked: () => {} });
export const useDoneOffer = () => useContext(DoneOfferCtx);

type Card =
  | { kind: "done"; offer: DoneOffer; state: string; preview: DevOpsPreview | null; busy: boolean; error: string | null; result: DevOpsResult | null }
  | { kind: "undo"; offer: UndoOffer };

/** Owned by App: `allowed` are the clients with my write PAT; `ask` is Settings › Planning's choice. */
export function useDoneOfferFlow(o: { allowed: readonly string[]; ask: boolean; onDone: () => void }) {
  const [card, setCard] = useState<Card | null>(null);
  const seq = useRef(0);
  const { onDone } = o;
  // Read at tick time, so `ticked` stays the same function across renders.
  const opts = useRef(o);
  opts.current = o;
  const previewFor = useCallback(async (offer: DoneOffer, state: string) => (await call<{ preview?: DevOpsPreview; nothing?: string }>("devops.preview", { clientKey: offer.clientKey, change: { kind: "state", itemId: offer.itemId, state, pickId: offer.pickId, ...(offer.followUpId !== null ? { followUpId: offer.followUpId } : {}) } })).preview ?? null, []);
  const ticked = useCallback(
    (pickId: number, done: boolean, clientKey?: string | null, itemId?: number | null) => {
      if (!opts.current.ask || itemId === null || (clientKey && !opts.current.allowed.includes(clientKey))) return;
      const n = ++seq.current;
      void (async () => {
        try {
          if (done) {
            const r = await call<{ offers: DoneOffer[] }>("devops.done_offer", { pickIds: [pickId] });
            const offer = r.offers[0];
            if (!offer || n !== seq.current) return;
            const state = offer.choices[0]!;
            const preview = await previewFor(offer, state);
            if (n === seq.current && preview) setCard({ kind: "done", offer, state, preview, busy: false, error: null, result: null });
          } else {
            // Unchecked before Confirm: the offer goes, nothing was written. After a write: offer its Undo.
            setCard((c) => (c?.kind === "done" && c.offer.pickId === pickId && !c.result ? null : c));
            const r = await call<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId });
            if (r.offer && n === seq.current) setCard({ kind: "undo", offer: r.offer });
          }
        } catch {
          // The tick stands; an offer that can't be prepared just isn't shown.
        }
      })();
    },
    [previewFor],
  );
  const view = card ? <DoneOfferCard card={card} setCard={setCard} previewFor={previewFor} onDone={onDone} /> : null;
  const env = useMemo<DoneOfferEnv>(() => ({ ticked }), [ticked]);
  return { env, card: view };
}

function DoneOfferCard({ card, setCard, previewFor, onDone }: { card: Card; setCard: (c: Card | null) => void; previewFor: (o: DoneOffer, s: string) => Promise<DevOpsPreview | null>; onDone: () => void }) {
  const writes = useDevOpsWrite();
  // A confirmed change says so, then goes after a few seconds (Undo stays in Settings › Data).
  useEffect(() => {
    if (card.kind !== "done" || !card.result?.confirmed) return;
    const t = window.setTimeout(() => setCard(null), 8000);
    return () => window.clearTimeout(t);
  }, [card, setCard]);
  const close = () => setCard(null);
  if (card.kind === "undo") {
    const u = card.offer;
    return (
      <div className="done-offer" role="region" aria-label="DevOps update">
        <p className="do-title">
          You set #{u.itemId} to {u.after} in DevOps. Undo that too?
        </p>
        <p className="do-item muted">{u.title}</p>
        <div className="do-acts">
          <button type="button" className="mini primary" onClick={() => (close(), void writes?.begin(u.clientKey, [{ kind: "undo", writeId: u.writeId }]))}>
            Undo in DevOps
          </button>
          <button type="button" className="mini" onClick={close}>
            Keep {u.after}
          </button>
        </div>
      </div>
    );
  }
  const { offer, state, preview, busy, error, result } = card;
  const choose = async (s: string) => {
    setCard({ ...card, state: s, busy: true, error: null });
    try {
      setCard({ ...card, state: s, preview: await previewFor(offer, s), busy: false, error: null });
    } catch (e) {
      setCard({ ...card, state: s, busy: false, error: errText(e) });
    }
  };
  const confirm = async () => {
    setCard({ ...card, busy: true, error: null });
    try {
      // Trying again after a write that didn't confirm: its log entry is retried (it checks before writing).
      const r = result && !result.confirmed ? await call<DevOpsResult>("devops.retry", { id: result.entry.id }) : await call<DevOpsResult>("devops.confirm", { previewId: preview!.previewId });
      onDone();
      setCard({ ...card, busy: false, error: null, result: r });
    } catch (e) {
      // The item changed in DevOps, or the preview went stale: a fresh preview to confirm again.
      const fresh = await previewFor(offer, state).catch(() => null);
      setCard({ ...card, preview: fresh ?? preview, busy: false, error: e instanceof ActionRefusal && e.code === "changed" ? "It changed in DevOps since. Here it is as it is now." : errText(e) });
    }
  };
  if (result?.confirmed)
    return (
      <div className="done-offer" role="status" aria-label="DevOps update">
        <p className="do-title">{result.message}</p>
        <div className="do-acts">
          <button type="button" className="mini" onClick={() => (close(), void writes?.begin(offer.clientKey, [{ kind: "undo", writeId: result.entry.id }]))}>
            Undo
          </button>
          <button type="button" className="mini quiet" aria-label="Dismiss" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      </div>
    );
  const row = preview?.fields.find((f) => f.label === "State");
  return (
    <div className="done-offer" role="region" aria-label="DevOps update">
      <p className="do-title">
        Set #{offer.itemId} to {state}?
      </p>
      <p className="do-item muted">{offer.title}</p>
      {offer.choices.length > 1 && (
        <div className="cap-kinds do-choices" role="radiogroup" aria-label="Done state">
          {offer.choices.map((s) => (
            <button key={s} type="button" role="radio" className="chip-btn" aria-checked={s === state} disabled={busy} onClick={() => s !== state && void choose(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <dl className="do-preview">
        <dt>State</dt>
        <dd>
          {row?.before ?? offer.state} → {row?.after ?? state}
        </dd>
        <dt>As</dt>
        <dd>{preview?.identity.replace(/\s*<[^>]*>$/, "") ?? "you"}, in {offer.clientName}'s DevOps</dd>
      </dl>
      {result && !result.confirmed && <p className="do-error">{result.message}</p>}
      {error && <p className="do-error">{error}</p>}
      <div className="do-acts">
        <button type="button" className="mini primary" disabled={busy || !preview} onClick={() => void confirm()}>
          {busy ? "Writing…" : result && !result.confirmed ? "Retry" : "Confirm"}
        </button>
        <button type="button" className="mini" disabled={busy} onClick={close}>
          Not now
        </button>
      </div>
    </div>
  );
}

type BatchResult = { ok: boolean; message: string; retry: boolean };
type BatchRow = { offer: DoneOffer; on: boolean; outcome: "finished" | "progress"; state: string; left: number; leftText: string; comment: string; result: BatchResult | null };
type RowPreview = { previews: DevOpsPreview[]; refused: { itemId: number | null; error: string; key?: string }[]; nothing: string[]; summary: string };
type WrapRes = { key: string | null; ok: boolean; message: string; writeId: number | null; retry: "retry" | "preview" | null };
const newRow = (offer: DoneOffer): BatchRow => ({ offer, on: true, outcome: "finished", state: offer.choices[0]!, left: 60, leftText: "", comment: "", result: null });

/**
 * FN-1 (was PK-1's state-only batch): Close out's "N to-dos done today" asks Wrap it up for each in one place: Finished
 * (with its done state) or Made progress (with the time left), and an optional comment per row. Preview shows every
 * row's writes at once; one Confirm writes them (each row through wrapup.confirm, test /rev, read back, audit log, undo).
 */
export function DoneBatch({ offers, dayWords, onDone }: { offers: DoneOffer[]; dayWords: string; onDone: () => void }): ReactNode {
  const [rows, setRows] = useState<BatchRow[]>(() => offers.map(newRow));
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Map<number, RowPreview | { error: string }> | null>(null);
  const [mentionsOk, setMentionsOk] = useState(false);
  const key = offers.map((x) => `${x.pickId}:${x.state}`).join(",");
  useEffect(() => setRows((prev) => offers.map((offer) => prev.find((r) => r.offer.pickId === offer.pickId) ?? newRow(offer))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (pickId: number, f: (r: BatchRow) => BatchRow) => {
    setPreviews(null);
    setRows((rs) => rs.map((r) => (r.offer.pickId === pickId ? f(r) : r)));
  };
  const todo = rows.filter((r) => r.on && !r.result?.ok);
  const n = rows.length;
  const leftOf = (r: BatchRow) => (r.leftText.trim() ? parseLeftText(r.leftText) : r.left);
  const bad = todo.some((r) => r.outcome === "progress" && leftOf(r) === null);
  const spec = (r: BatchRow) => ({ clientKey: r.offer.clientKey, itemId: r.offer.itemId, pickId: r.offer.pickId, outcome: r.outcome, comment: r.comment.trim(), ...(r.outcome === "finished" ? { state: r.state } : { left: leftOf(r) }) });

  /** One preview for every chosen row; nothing is written. */
  const preview = async (replace = false) => {
    setBusy(true);
    const out = new Map<number, RowPreview | { error: string }>();
    for (const r of todo)
      try {
        out.set(r.offer.pickId, await call<RowPreview>("wrapup.preview", { ...spec(r), ...(replace ? { mentions: "replace" } : {}) }));
      } catch (e) {
        out.set(r.offer.pickId, { error: errText(e) });
      }
    setPreviews(out);
    setMentionsOk(false);
    setBusy(false);
  };
  const shown = previews ? todo.filter((r) => previews.has(r.offer.pickId)) : [];
  const ready = shown.filter((r) => { const p = previews!.get(r.offer.pickId)!; return !("error" in p) && p.previews.length > 0; });
  const mentions = [...new Set(ready.flatMap((r) => (previews!.get(r.offer.pickId) as RowPreview).previews.flatMap((p) => p.mentions ?? [])))];

  /** The one Confirm: the plan's side first (Made progress keeps the story's later to-dos), then each row's writes. */
  const confirm = async () => {
    if (!previews) return;
    setBusy(true);
    for (const r of shown) {
      const p = previews.get(r.offer.pickId)!;
      const setResult = (result: BatchResult) => setRows((rs) => rs.map((x) => (x.offer.pickId === r.offer.pickId ? { ...x, result } : x)));
      if ("error" in p) {
        setResult({ ok: false, message: p.error, retry: true });
        continue;
      }
      try {
        if (r.outcome === "progress") await call("wrapup.tick", { pickId: r.offer.pickId, outcome: "progress", left: leftOf(r) });
        if (!p.previews.length) {
          setResult({ ok: true, message: p.refused[0]?.error ?? p.nothing[0] ?? "Nothing to change in DevOps", retry: false });
          continue;
        }
        const res = await call<{ results: WrapRes[]; landed: number; message: string }>("wrapup.confirm", { previewIds: p.previews.map((x) => x.previewId), ...(mentionsOk ? { mentionsOk: true } : {}) });
        const ok = res.results.every((x) => x.ok);
        setResult({ ok, message: ok ? p.summary.replace(/^#\d+: /, "") : res.message, retry: !ok });
      } catch (e) {
        setResult({ ok: false, message: errText(e), retry: true });
      }
    }
    setPreviews(null);
    setBusy(false);
    onDone();
  };
  const done = rows.filter((r) => r.result?.ok).length;
  if (!n) return null;
  return (
    <div className="done-batch" role="group" aria-label="Wrap up in DevOps">
      <p className="db-ask">
        {done === n
          ? `${n} ${n === 1 ? "to-do" : "to-dos"} done ${dayWords}; wrapped up in DevOps.`
          : `${n} ${n === 1 ? "to-do" : "to-dos"} done ${dayWords}. Wrap ${n === 1 ? "it" : "them"} up in DevOps?`}
      </p>
      <ul className="db-rows">
        {rows.map((r) => {
          const p = previews?.get(r.offer.pickId);
          const locked = busy || !!r.result?.ok;
          return (
            <li key={r.offer.pickId} className="db-row">
              <label className="db-check">
                <input type="checkbox" checked={r.on} disabled={locked} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, on: e.target.checked }))} />
                <span className="db-what">
                  #{r.offer.itemId} {r.offer.title}
                </span>
              </label>
              {r.on && !r.result?.ok && (
                <div className="db-wrap">
                  <span className="db-outcome" role="radiogroup" aria-label={`How #${r.offer.itemId} went`}>
                    {(["finished", "progress"] as const).map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={r.outcome === o} className={`mini${r.outcome === o ? " on" : ""}`} disabled={locked} onClick={() => set(r.offer.pickId, (x) => ({ ...x, outcome: o }))}>
                        {o === "finished" ? "Finished" : "Made progress"}
                      </button>
                    ))}
                  </span>
                  {r.outcome === "finished" ? (
                    <span className="db-state muted">
                      {r.offer.state} →{" "}
                      {r.offer.choices.length > 1 ? (
                        <select aria-label={`State for #${r.offer.itemId}`} value={r.state} disabled={locked} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, state: e.target.value }))}>
                          {r.offer.choices.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        r.state
                      )}
                    </span>
                  ) : (
                    <span className="db-left" role="group" aria-label={`Time left on #${r.offer.itemId}`}>
                      <span className="muted">Left</span>
                      {LEFT_PICKS.map(([m, label]) => (
                        <button key={m} type="button" className={`mini${!r.leftText.trim() && r.left === m ? " on" : ""}`} aria-pressed={!r.leftText.trim() && r.left === m} disabled={locked} onClick={() => set(r.offer.pickId, (x) => ({ ...x, left: m, leftText: "" }))}>
                          {label}
                        </button>
                      ))}
                      <input className="db-left-text" aria-label={`Other time left on #${r.offer.itemId}`} placeholder="3h" value={r.leftText} disabled={locked} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, leftText: e.target.value }))} />
                    </span>
                  )}
                  <input className="db-comment" aria-label={`Comment on #${r.offer.itemId}`} placeholder={`Comment (optional): ${commentPlaceholder(r.outcome)}`} maxLength={4000} value={r.comment} disabled={locked} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, comment: e.target.value }))} />
                </div>
              )}
              {p && <span className={"error" in p ? "db-fail" : "db-pv muted"}>{"error" in p ? p.error : p.previews.length ? p.summary : (p.refused[0]?.error ?? p.nothing[0] ?? "Nothing to change in DevOps")}</span>}
              {r.result && <span className={r.result.ok ? "db-ok" : "db-fail"}>{r.result.ok && <><Icon name="done" /> </>}{r.result.message}</span>}
            </li>
          );
        })}
      </ul>
      {mentions.length > 0 && (
        <div className="wrap-mentions" role="alert">
          <p>This names {mentions.length === 1 ? "another client" : "other clients"}: {mentions.join(", ")}. The item's client can read it.</p>
          <button type="button" className="mini" disabled={busy} onClick={() => void preview(true)}>
            Replace with "another client"
          </button>
          <label>
            <input type="checkbox" checked={mentionsOk} onChange={(e) => setMentionsOk(e.target.checked)} /> Send it as it is
          </label>
        </div>
      )}
      <p className="db-foot">
        {done < n &&
          (previews ? (
            <>
              <button type="button" className="mini primary" disabled={busy || !shown.length || (mentions.length > 0 && !mentionsOk)} onClick={() => void confirm()}>
                {busy ? "Writing…" : ready.length ? `Confirm ${ready.length}` : "Confirm"}
              </button>
              <button type="button" className="mini" disabled={busy} onClick={() => setPreviews(null)}>
                Change
              </button>
            </>
          ) : (
            <button type="button" className="mini primary" disabled={busy || !todo.length || bad} onClick={() => void preview()}>
              {busy ? "Reading…" : `Preview ${todo.length || ""}`.trim()}
            </button>
          ))}
        <span className="muted">{done < n ? (previews ? "Nothing is written until Confirm; each only if the item hasn't changed in DevOps since. " : "Nothing is written before the preview. ") : ""}Undo is in Settings › Data.</span>
      </p>
    </div>
  );
}
