// FN-1: Wrap it up, the one sheet for finishing work on a DevOps story. A tick anywhere (Today, the Board, Plan today,
// the focus timer's Done, the midday check-in's Done) lands at once, as before, and then this sheet opens over it for a
// to-do with a DevOps item on a client where I have DevOps writes and "When I tick a story" is "ask". The story card's
// Wrap it up opens it for the item with no to-do. Finished proposes the type's done state (the one I use most on that
// client); Made progress keeps the state (New moves to its In Progress state) and asks what's left. A comment, with
// Suggest. One preview of every write, then Confirm; nothing reaches DevOps before it. Closing it, or Skip DevOps, keeps
// the tick and writes nothing. Undo puts the tick back and offers each DevOps write's own undo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevOpsPreview, UndoOffer, WrapOffer } from "../actions/types.ts";
import { commentPlaceholder, LEFT_PICKS, leftHours, parseLeftText, type WrapOutcome } from "../plan/wrapup.ts";
import { ActionRefusal, call } from "./api.ts";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import type { DoneOfferEnv } from "./DoneOffer.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { TextBox } from "./TextBox.tsx";
import { cardStale } from "./WorkLink.tsx";
import { Icon } from "./icons.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const durText = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);

type PickFacts = { id: number; title: string; status: string; date: string; leftMinutes: number; spentMinutes: number; timeboxedMinutes: number };
type OfferData = { pick: PickFacts | null; clientKey: string; itemId: number; offer: WrapOffer | null; why: string | null; code: string | null; setting: "ask" | "never" };
type Preview = { previews: DevOpsPreview[]; refused: { itemId: number | null; error: string; key?: string }[]; nothing: string[]; summary: string };
type Result = { key: string | null; itemId: number | null; ok: boolean; message: string; writeId: number | null; retry: "retry" | "preview" | null };

/** Where the sheet was opened from: a to-do (ticked already) or an item from its card. */
export type WrapTarget = { pickId: number; clientKey?: string | null | undefined; itemId?: number | null | undefined; /** A check-in's Partly: Made progress with this time left, the plan already answered. */ progressLeft?: number | undefined } | { pickId: null; clientKey: string; itemId: number };

/**
 * Owned by App. `env` is what every tick site already calls (PK-1's `ticked`); `open` is the card's Wrap it up.
 * `allowed`: clients with my write PAT. `ask`: Settings' "When I tick a story" is "ask".
 */
export function useWrapUpFlow(o: { allowed: readonly string[]; ask: boolean; onDone: () => void; notice: (text: string) => void; /** Settings › DevOps, where a client's write PAT is set. */ openSettings: () => void }) {
  const [target, setTarget] = useState<{ t: WrapTarget; data: OfferData } | null>(null);
  const [writesOff, setWritesOff] = useState(false);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const opts = useRef(o);
  opts.current = o;
  const seq = useRef(0);
  const load = useCallback(async (t: WrapTarget, quiet: boolean) => {
    const n = ++seq.current;
    try {
      const data = await call<OfferData>("wrapup.offer", t.pickId !== null ? { pickId: t.pickId } : { clientKey: t.clientKey, itemId: t.itemId });
      if (n !== seq.current) return;
      // A tick asks only when there is something to write: an item I can change that isn't done in DevOps already.
      if (quiet && (!data.offer || data.offer.done || !data.offer.canEdit)) return;
      setUndo(null);
      setTarget({ t, data });
    } catch (e) {
      if (!quiet) opts.current.notice(errText(e));
    }
  }, []);
  const ticked = useCallback(
    (pickId: number, done: boolean, clientKey?: string | null, itemId?: number | null) => {
      const { ask, allowed } = opts.current;
      // FN-1: a story ticked on a client with DevOps writes off says so once a session, with the way to turn them on.
      if (done && ask && clientKey && typeof itemId === "number" && !allowed.includes(clientKey) && !hintShown()) {
        markHintShown();
        setWritesOff(true);
      }
      if (itemId === null || (clientKey && !allowed.includes(clientKey))) return;
      setWritesOff(false);
      if (done) {
        if (ask) void load({ pickId, clientKey, itemId }, true);
        return;
      }
      // Unticked: an open sheet for it goes (nothing was written); a DevOps write it made offers its own undo.
      ++seq.current;
      setTarget((c) => (c?.t.pickId === pickId ? null : c));
      void call<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId }).then((r) => r.offer && setUndo(r.offer), () => {});
    },
    [load],
  );
  const open = useCallback((clientKey: string, itemId: number) => void load({ pickId: null, clientKey, itemId }, false), [load]);
  /** A to-do's ⋯ › Wrap it up: the sheet for it, done or not yet (Finished and Made progress tick it). */
  const openPick = useCallback((pickId: number) => void load({ pickId }, false), [load]);
  /** FN-1: a check-in's Partly: Made progress with the time left; the check-in already wrote it on the plan. */
  const progress = useCallback(
    (pickId: number, left: number, clientKey?: string | null, itemId?: number | null) => {
      const { ask, allowed } = opts.current;
      if (!ask || itemId === null || (clientKey && !allowed.includes(clientKey))) return;
      void load({ pickId, clientKey, itemId, progressLeft: left }, true);
    },
    [load],
  );
  const close = useCallback(() => setTarget(null), []);
  const env = useMemo<DoneOfferEnv>(() => ({ ticked, progress }), [ticked, progress]);
  // After one undo lands, the next write this to-do made (newest first) is offered.
  const nextUndo = useCallback((pickId: number) => void call<{ offer: UndoOffer | null }>("devops.undo_offer", { pickId }).then((r) => setUndo(r.offer), () => {}), []);
  const sheet = target ? <WrapUpSheet key={`${target.t.pickId}:${target.data.itemId}`} data={target.data} progressLeft={target.t.pickId !== null ? (target.t.progressLeft ?? null) : null} onClose={close} onDone={o.onDone} notice={o.notice} /> : undo ? <UndoCard offer={undo} onClose={() => setUndo(null)} onUndone={() => nextUndo(undo.pickId)} /> : writesOff ? <WritesOffHint onClose={() => setWritesOff(false)} onSettings={() => (setWritesOff(false), o.openSettings())} /> : null;
  return { env, open, openPick, sheet };
}

const HINT_KEY = "focustime.fn1.writes-off-hint";
let hintSeen = false;
/** Once a browser session (and once a page load where session storage is blocked). */
function hintShown(): boolean {
  try {
    return hintSeen || sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return hintSeen;
  }
}
function markHintShown() {
  hintSeen = true;
  try {
    sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    // Storage blocked: the page's own flag still holds it to once.
  }
}

/** FN-1: the one-line hint when a ticked story's client has DevOps writes off. */
function WritesOffHint({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  return (
    <div className="done-offer wrap-off" role="status">
      <p className="do-title">
        DevOps updates are off for this client.{" "}
        <button type="button" className="link-btn" onClick={onSettings}>
          Turn them on in Settings › DevOps
        </button>
      </p>
      <button type="button" className="mini wrap-off-x icon-btn small" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function UndoCard({ offer: u, onClose, onUndone }: { offer: UndoOffer; onClose: () => void; onUndone: () => void }) {
  const writes = useDevOpsWrite();
  return (
    <div className="done-offer" role="region" aria-label="DevOps update">
      <p className="do-title">
        You set {u.after?.startsWith("Remaining Work") ? `#${u.itemId}'s ${u.after.replace(/ (\S+)$/, " to $1")}` : `#${u.itemId} to ${u.after}`} in DevOps. Undo that too?
      </p>
      <p className="do-item muted">{u.title}</p>
      <div className="do-acts">
        <button type="button" className="mini primary" onClick={() => (onClose(), void writes?.begin(u.clientKey, [{ kind: "undo", writeId: u.writeId }], (r) => r.confirmed && onUndone()))}>
          Undo in DevOps
        </button>
        <button type="button" className="mini" onClick={onClose}>
          Keep it
        </button>
      </div>
    </div>
  );
}

type Stage = "edit" | "preview" | "results";

export function WrapUpSheet({ data, onClose, onDone, notice, progressLeft = null }: { data: OfferData; onClose: () => void; onDone: () => void; notice: (text: string) => void; /** From a check-in's Partly: the plan is already answered; only DevOps is asked. */ progressLeft?: number | null }) {
  useReturnFocus();
  const writes = useDevOpsWrite();
  const offer = data.offer;
  const pick = data.pick;
  const planDone = progressLeft !== null;
  const [outcome, setOutcome] = useState<WrapOutcome>(planDone ? "progress" : "finished");
  const [state, setState] = useState<string | null>(offer?.chosen ?? null);
  const [activate, setActivate] = useState(true);
  const [left, setLeft] = useState<number>(() => {
    const l = progressLeft ?? pick?.leftMinutes ?? 60;
    return Math.min(2400, Math.max(30, Math.round(l / 30) * 30));
  });
  const [leftTyped, setLeftTyped] = useState("");
  const [remaining, setRemaining] = useState(true);
  const [comment, setComment] = useState("");
  const [feature, setFeature] = useState(false);
  const [stage, setStage] = useState<Stage>("edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replace, setReplace] = useState(false);
  const [mentionsOk, setMentionsOk] = useState(false);
  const [results, setResults] = useState<{ results: Result[]; message: string } | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const typedLeft = leftTyped.trim() ? parseLeftText(leftTyped) : null;
  const leftNow = typedLeft ?? left;
  const itemWords = offer ? `#${offer.itemId} ${offer.title}` : `#${data.itemId}`;
  const spec = () => ({
    clientKey: data.clientKey,
    itemId: data.itemId,
    pickId: pick?.id ?? null,
    outcome,
    state: outcome === "finished" ? state : null,
    activate,
    remaining,
    left: outcome === "progress" ? leftNow : null,
    comment,
    feature: feature && !!comment.trim(),
  });
  /** The FocusTime side: Made progress keeps the story's later to-dos and records the time left. Finished keeps the plain tick. */
  const tickHere = async () => {
    if (!pick || planDone) return;
    if (outcome === "progress") {
      const r = await call<{ notice?: string | null }>("wrapup.tick", { pickId: pick.id, outcome: "progress", left: leftNow });
      if (r.notice) notice(r.notice);
    } else if (pick.status !== "done") await call("wrapup.tick", { pickId: pick.id, outcome: "finished" });
  };
  const skip = async () => {
    setBusy("skip");
    try {
      await tickHere();
      onDone();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };
  const doPreview = async (rep = replace) => {
    setBusy("preview");
    setError(null);
    try {
      const r = await call<Preview>("wrapup.preview", { ...spec(), ...(rep ? { mentions: "replace" } : {}) });
      setPreview(r);
      setReplace(rep);
      setMentionsOk(false);
      setStage("preview");
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };
  const confirm = async () => {
    if (!preview) return;
    setBusy("confirm");
    setError(null);
    try {
      await tickHere();
      const r = await call<{ results: Result[]; message: string }>("wrapup.confirm", { previewIds: preview.previews.map((p) => p.previewId), ...(mentionsOk ? { mentionsOk: true } : {}) });
      setResults(r);
      setStage("results");
      onDone();
      cardStale(data.clientKey, data.itemId);
    } catch (e) {
      setError(e instanceof ActionRefusal && e.code === "changed" ? "It changed in DevOps since. Preview again to see it as it is now." : errText(e));
    }
    setBusy(null);
  };
  const retry = async (r: Result) => {
    if (r.retry === "preview") return void doPreview();
    if (r.writeId === null) return;
    setBusy(`retry-${r.writeId}`);
    try {
      const res = await call<{ confirmed: boolean; message: string; entry: { id: number } }>("devops.retry", { id: r.writeId });
      setResults((cur) => (cur ? { ...cur, results: cur.results.map((x) => (x === r ? { ...x, ok: res.confirmed, message: res.message, writeId: res.entry.id, retry: res.confirmed ? null : "retry" } : x)) } : cur));
      onDone();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };
  const undoAll = async () => {
    setBusy("undo");
    try {
      if (pick && !planDone) await call("pick.mark_done", { id: pick.id, done: false });
      const landed = (results?.results ?? []).filter((r) => r.ok && r.writeId !== null);
      onDone();
      onClose();
      // Each DevOps write's own undo, with its preview (the write framework's), newest first.
      if (landed.length) void writes?.begin(data.clientKey, landed.reverse().map((r) => ({ kind: "undo" as const, writeId: r.writeId! })));
      else notice(pick ? "The to-do isn't done any more" : "Nothing to undo");
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };
  const suggest = async () => {
    if (!pick) return;
    setBusy("suggest");
    setHint(null);
    try {
      const r = await call<{ text: string; source: "ai" | "template"; message: string | null; namesRemoved?: string }>("wrapup.suggest", { pickId: pick.id, outcome, ...(outcome === "progress" ? { left: leftNow } : {}) });
      setComment(r.text);
      setHint(r.namesRemoved ?? r.message ?? null);
    } catch (e) {
      setHint(errText(e));
    }
    setBusy(null);
  };
  const close = () => {
    if (busy) return;
    // After a write, closing is Done; before it, closing is Skip DevOps (the tick stays, nothing written).
    if (stage === "results" || !pick) return onClose();
    void skip();
  };
  const mentions = [...new Set((preview?.previews ?? []).flatMap((p) => p.mentions ?? []))];
  const leftWords = durText(leftNow);
  return (
    <div className="cap-backdrop wrap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="cap-dialog wrap-sheet"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wrap-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2 id="wrap-title">Wrap it up</h2>
          <span className="muted wrap-item">
            {itemWords}
            {offer ? ` · ${offer.clientName}` : ""}
          </span>
          <CloseButton onClose={close} disabled={!!busy} title={stage === "results" ? "Close (Esc)" : "Close: keep the tick, skip DevOps (Esc)"} />
        </div>
        {!offer ? (
          <>
            <p className="wrap-note">{data.why ?? "DevOps can't be changed for this client from here."}</p>
            <div className="wrap-foot">
              <button type="button" className="mini primary" ref={first} onClick={onClose}>
                OK
              </button>
            </div>
          </>
        ) : stage === "edit" ? (
          <>
            {!offer.canEdit && <p className="wrap-note">{offer.editNote ?? "You can't change this item in DevOps."}</p>}
            <div className="wrap-outcome" role="radiogroup" aria-label="How did it go?">
              {(planDone ? (["progress"] as const) : (["finished", "progress"] as const)).map((k) => (
                <button key={k} ref={k === outcome ? first : undefined} type="button" role="radio" aria-checked={outcome === k} className="wrap-choice" onClick={() => setOutcome(k)}>
                  <span className="wrap-choice-name">{k === "finished" ? "Finished" : "Made progress"}</span>
                  <span className="muted">{k === "finished" ? (state ? `${offer.state} → ${state}` : "Done in FocusTime") : offer.activate ? `${offer.state} → ${offer.activate}` : `Stays ${offer.state}`}</span>
                </button>
              ))}
            </div>
            {outcome === "finished" ? (
              <>
                {offer.choices.length > 1 && (
                  <label className="set-field wrap-state">
                    <span className="set-label">State</span>
                    <select value={state ?? ""} onChange={(e) => setState(e.target.value)}>
                      {offer.choices.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                )}
                {!offer.choices.length && <p className="wrap-note muted">{offer.type} has no done state in this process; only a comment goes to DevOps.</p>}
                {offer.hasRemaining && offer.remaining !== 0 && (
                  <label className="wrap-check">
                    <input type="checkbox" checked={remaining} onChange={(e) => setRemaining(e.target.checked)} /> Set Remaining Work to 0
                  </label>
                )}
              </>
            ) : (
              <>
                {offer.activate && (
                  <label className="wrap-check">
                    <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Move it to {offer.activate}
                  </label>
                )}
                <div className="set-field">
                  <span className="set-label" id="wrap-left">
                    About how much is left?
                  </span>
                  <div className="wrap-left" role="group" aria-labelledby="wrap-left">
                    {LEFT_PICKS.map(([m, label]) => (
                      <button key={m} type="button" className="chip-btn" aria-pressed={!leftTyped.trim() && left === m} onClick={() => (setLeft(m), setLeftTyped(""))}>
                        {label}
                      </button>
                    ))}
                    <input className="wrap-left-typed" aria-label="Time left, typed (for example 3h or 45m)" placeholder="Other: 3h" value={leftTyped} onChange={(e) => setLeftTyped(e.target.value)} />
                  </div>
                  {leftTyped.trim() && typedLeft === null && <span className="wrap-error">Type a time like 3h, 2h 30m or 45m</span>}
                </div>
                {offer.hasRemaining && (
                  <label className="wrap-check">
                    <input type="checkbox" checked={remaining} onChange={(e) => setRemaining(e.target.checked)} /> Set Remaining Work to {leftHours(leftNow)}h
                  </label>
                )}
              </>
            )}
            <label className="set-field">
              <span className="set-label wrap-comment-label">
                Comment in DevOps <span className="muted">(optional)</span>
                {pick && (
                  <button type="button" className="mini quiet" disabled={!!busy} onClick={() => void suggest()}>
                    {busy === "suggest" ? "Suggesting…" : "Suggest"}
                  </button>
                )}
              </span>
              <TextBox value={comment} minRows={2} maxRows={8} maxLength={4000} placeholder={commentPlaceholder(outcome)} onChange={(e) => setComment(e.target.value)} />
            </label>
            {hint && <p className="wrap-hint muted">{hint}</p>}
            {offer.parent && (
              <label className="wrap-check">
                <input type="checkbox" checked={feature} disabled={!comment.trim()} onChange={(e) => setFeature(e.target.checked)} /> Also add to {offer.parent.title}'s status for Monday
              </label>
            )}
            {error && <p className="wrap-error" role="alert">{error}</p>}
            <div className="wrap-foot">
              {pick && (
                <button type="button" className="mini" disabled={!!busy} onClick={() => void skip()}>
                  {busy === "skip" ? "Saving…" : "Skip DevOps"}
                </button>
              )}
              <button type="button" className="mini primary" disabled={!!busy || !offer.canEdit || (outcome === "progress" && leftTyped.trim() !== "" && typedLeft === null)} onClick={() => void doPreview()}>
                {busy === "preview" ? "Preparing…" : "Preview"}
              </button>
            </div>
            <p className="wrap-fine muted">
              {planDone ? "Your check-in kept the time left on your plan." : outcome === "progress" ? `The to-do is done for today; the story stays on your plan with about ${leftWords} left.` : "The to-do is done; the story's later to-dos come off your plan."} Nothing goes to DevOps before you confirm.
            </p>
          </>
        ) : stage === "preview" && preview ? (
          <>
            {preview.previews.length ? (
              <>
                <p className="wrap-summary">{preview.summary}</p>
                <ul className="wrap-previews">
                  {preview.previews.map((p) => (
                    <li key={p.previewId}>
                      <span className="wrap-pv-what">{p.summary}</span>
                      <dl className="do-preview">
                        {p.fields
                          .filter((f) => f.changed)
                          .map((f) => (
                            <div key={f.label} className="wrap-pv-row">
                              <dt>{f.label}</dt>
                              <dd>{f.label === "Comment" || f.before === null ? (f.after ?? "") : `${f.before} → ${f.after ?? ""}`}</dd>
                            </div>
                          ))}
                      </dl>
                    </li>
                  ))}
                </ul>
                <p className="muted wrap-as">
                  As {preview.previews[0]!.identity.replace(/\s*<[^>]*>$/, "")}, in {offer.clientName}'s DevOps ({preview.previews[0]!.visibility}). Each only if the item hasn't changed since. Undo is in Settings › Data.
                </p>
              </>
            ) : (
              <p className="wrap-note">{preview.nothing[0] ?? "Nothing to change in DevOps"}</p>
            )}
            {preview.refused.map((r, i) => (
              <p key={i} className="wrap-error">
                {r.error}
              </p>
            ))}
            {mentions.length > 0 && (
              <div className="wrap-mentions" role="alert">
                <p>
                  This names {mentions.length === 1 ? "another client" : "other clients"}: {mentions.join(", ")}. {offer.clientName}'s people can read it.
                </p>
                <button type="button" className="mini" disabled={!!busy} onClick={() => void doPreview(true)}>
                  Replace with "another client"
                </button>
                <label className="wrap-check">
                  <input type="checkbox" checked={mentionsOk} onChange={(e) => setMentionsOk(e.target.checked)} /> Send it as it is
                </label>
              </div>
            )}
            {error && <p className="wrap-error" role="alert">{error}</p>}
            <div className="wrap-foot">
              <button type="button" className="mini" ref={first} disabled={!!busy} onClick={() => setStage("edit")}>
                Back
              </button>
              <button type="button" className="mini primary" disabled={!!busy || !preview.previews.length || (mentions.length > 0 && !mentionsOk)} onClick={() => void confirm()}>
                {busy === "confirm" ? "Writing…" : "Confirm"}
              </button>
            </div>
          </>
        ) : results ? (
          <>
            <p className="wrap-summary" role="status">
              {results.message}
            </p>
            <ul className="wrap-results">
              {results.results.map((r, i) => (
                <li key={i} className={r.ok ? "db-ok" : "db-fail"}>
                  {r.ok && <><Icon name="done" /> </>}{r.message}
                  {!r.ok && r.retry && (
                    <button type="button" className="mini" disabled={!!busy} onClick={() => void retry(r)}>
                      {r.retry === "preview" ? "Preview again" : "Retry"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {error && <p className="wrap-error" role="alert">{error}</p>}
            <div className="wrap-foot">
              <button type="button" className="mini" disabled={!!busy} onClick={() => void undoAll()}>
                Undo
              </button>
              <button type="button" className="mini primary" ref={first} disabled={!!busy} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
