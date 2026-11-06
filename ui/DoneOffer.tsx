// PK-1: checking off a to-do offers the DevOps update, never automatically. After a tick on Today or the Board, a
// small card asks "Set #<id> to <done state>?" with the write's own preview (the state before and after, who it writes
// as) and Confirm, which is the existing state write (test /rev, read back, audit log, undo). Not now writes nothing.
// Unchecking a to-do whose item its offer just set offers that write's Undo (the write framework's undo preview).
// Close out asks once for the day's done to-dos (DoneBatch). Offers come from devops.done_offer: only items I can
// change, not done already, with my write PAT; Settings › Planning's "never ask" turns them off.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DevOpsPreview, DevOpsResult, DoneOffer, UndoOffer } from "../actions/types.ts";
import { ActionRefusal, call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** What a place that ticks a to-do tells the offer: which to-do, and done or not. */
export type DoneOfferEnv = { ticked: (pickId: number, done: boolean, clientKey: string, itemId: number | null) => void };
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
    (pickId: number, done: boolean, clientKey: string, itemId: number | null) => {
      if (!opts.current.ask || itemId === null || !opts.current.allowed.includes(clientKey)) return;
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
            ×
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

type BatchRow = { offer: DoneOffer; on: boolean; state: string; result: { ok: true; message: string } | { ok: false; message: string; entryId: number | null } | null };

/** "3 to-dos done today; set their items to Closed?" for Close out: a checkbox per item, one Confirm, a result per item. */
export function DoneBatch({ offers, dayWords, onDone }: { offers: DoneOffer[]; dayWords: string; onDone: () => void }): ReactNode {
  const [rows, setRows] = useState<BatchRow[]>(() => offers.map((offer) => ({ offer, on: true, state: offer.choices[0]!, result: null })));
  const [busy, setBusy] = useState(false);
  const key = offers.map((x) => `${x.pickId}:${x.state}`).join(",");
  useEffect(() => setRows((prev) => offers.map((offer) => prev.find((r) => r.offer.pickId === offer.pickId) ?? { offer, on: true, state: offer.choices[0]!, result: null })), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (pickId: number, f: (r: BatchRow) => BatchRow) => setRows((rs) => rs.map((r) => (r.offer.pickId === pickId ? f(r) : r)));
  const states = [...new Set(rows.filter((r) => r.on && !r.result?.ok).map((r) => r.state))];
  const todo = rows.filter((r) => r.on && !r.result?.ok);
  const n = rows.length;
  /** Preview and confirm the chosen rows, per client in tens; each row gets its own result. */
  const write = async (list: BatchRow[]) => {
    setBusy(true);
    const byClient = new Map<string, BatchRow[]>();
    for (const r of list) byClient.set(r.offer.clientKey, [...(byClient.get(r.offer.clientKey) ?? []), r]);
    for (const [clientKey, all] of byClient)
      for (let i = 0; i < all.length; i += 10) {
        const chunk = all.slice(i, i + 10);
        try {
          const pv = await call<{ previews: DevOpsPreview[]; nothing: string[]; refused?: { itemId: number | null; error: string; key?: string }[] }>("devops.preview", { clientKey, changes: chunk.map((r) => ({ kind: "state", itemId: r.offer.itemId, state: r.state, pickId: r.offer.pickId, ...(r.offer.followUpId !== null ? { followUpId: r.offer.followUpId } : {}), key: String(r.offer.pickId) })) });
          for (const x of pv.refused ?? []) if (x.key) set(Number(x.key), (r) => ({ ...r, result: { ok: false, message: x.error, entryId: null } }));
          const keyed = pv.previews.filter((p) => p.key);
          for (const r of chunk) if (!keyed.some((p) => p.key === String(r.offer.pickId)) && !(pv.refused ?? []).some((x) => x.key === String(r.offer.pickId))) set(r.offer.pickId, (x) => ({ ...x, result: { ok: true, message: `Already ${r.state}` } }));
          if (!keyed.length) continue;
          const out = await call<{ results: (DevOpsResult | { error: string; status: number })[] }>("devops.confirm", { previewIds: keyed.map((p) => p.previewId) });
          keyed.forEach((p, j) => {
            const res = out.results[j];
            set(Number(p.key), (r) => ({ ...r, result: res && "confirmed" in res ? (res.confirmed ? { ok: true, message: `${r.state} in DevOps` } : { ok: false, message: res.message, entryId: res.entry.id }) : { ok: false, message: res?.error ?? "Not written", entryId: null } }));
          });
        } catch (e) {
          for (const r of chunk) set(r.offer.pickId, (x) => ({ ...x, result: { ok: false, message: errText(e), entryId: null } }));
        }
      }
    setBusy(false);
    onDone();
  };
  const retry = async (r: BatchRow) => {
    if (r.result && !r.result.ok && r.result.entryId !== null) {
      setBusy(true);
      try {
        const res = await call<DevOpsResult>("devops.retry", { id: r.result.entryId });
        set(r.offer.pickId, (x) => ({ ...x, result: res.confirmed ? { ok: true, message: `${x.state} in DevOps` } : { ok: false, message: res.message, entryId: res.entry.id } }));
      } catch (e) {
        set(r.offer.pickId, (x) => ({ ...x, result: { ok: false, message: errText(e), entryId: null } }));
      }
      setBusy(false);
      return onDone();
    }
    await write([r]);
  };
  const done = rows.filter((r) => r.result?.ok).length;
  if (!n) return null;
  return (
    <div className="done-batch" role="group" aria-label="Set items to done in DevOps">
      <p className="db-ask">
        {n} {n === 1 ? "to-do" : "to-dos"} done {dayWords}; set {n === 1 ? "its item" : "their items"} to {states.length === 1 ? states[0] : "done"}?
      </p>
      <ul className="db-rows">
        {rows.map((r) => (
          <li key={r.offer.pickId}>
            <label className="db-check">
              <input type="checkbox" checked={r.on} disabled={busy || !!r.result?.ok} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, on: e.target.checked }))} />
              <span className="db-what">
                #{r.offer.itemId} {r.offer.title}
              </span>
            </label>
            <span className="db-state muted">
              {r.offer.state} →{" "}
              {r.offer.choices.length > 1 && !r.result?.ok ? (
                <select aria-label={`State for #${r.offer.itemId}`} value={r.state} disabled={busy || !r.on} onChange={(e) => set(r.offer.pickId, (x) => ({ ...x, state: e.target.value }))}>
                  {r.offer.choices.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              ) : (
                r.state
              )}
            </span>
            {r.result && (
              <span className={r.result.ok ? "db-ok" : "db-fail"}>
                {r.result.ok ? `✓ ${r.result.message}` : r.result.message}
                {!r.result.ok && (
                  <button type="button" className="mini" disabled={busy} onClick={() => void retry(r)}>
                    Retry
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="db-foot">
        <button type="button" className="mini primary" disabled={busy || !todo.length} onClick={() => void write(todo)}>
          {busy ? "Writing…" : todo.length ? `Confirm ${todo.length}` : done === n ? "All set" : "Confirm"}
        </button>
        <span className="muted">Written as you, each only if the item hasn't changed in DevOps since. Undo is in Settings › Data.</span>
      </p>
    </div>
  );
}
