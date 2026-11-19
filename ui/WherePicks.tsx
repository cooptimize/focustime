// RB-3b: the New form's and the draft editor's memory of which words in "Where is it?" were picked from which client's
// code (plan/where-picks.ts). It lives in this hook's memory only, while the form is open: nothing of it is saved,
// sent with a draft or a create, put in the browser's storage, or kept after the form closes. When the form's client
// changes, the other client's picks still in the box as written are taken out, the typed words stay, and one line
// says so with Undo. A create or a save is never held up by any of this.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { picksAfterEdit, PICKS_TEXT, putBack, spotAfterEdit, takeOut, type TakenOut, type WherePick } from "../plan/where-picks.ts";

/** What the box reports after a pick: where its words start in the text it wrote, and the words. */
export type Picked = { start: number; text: string; /** The box's whole text with the pick in it. */ in: string };

type Line = { kind: "taken"; n: number; from: string[]; to: string; taken: TakenOut[]; /** The client before the change, and its name. */ was: string | null; wasName: string } | { kind: "back"; text: string } | null;

/**
 * The picks for one form. `where` is the box's text, `setWhere` sets it (as the form's own state); `clientKey` and
 * `clientName` are the form's client now.
 */
export function useWherePicks(where: string, setWhere: (v: string) => void, clientKey: string | null, clientName: string, /** UC-3: puts the form's client (and what changed with it) back, for Undo. */ restore?: (was: string) => void) {
  const picks = useRef<WherePick[]>([]);
  const last = useRef(where);
  const pending = useRef<(Picked & { client: string; clientName: string })[]>([]);
  const client = useRef(clientKey);
  const clientNameRef = useRef(clientName);
  const [line, setLine] = useState<Line>(null);
  const lineRef = useRef<Line>(null);
  const show = (l: Line) => ((lineRef.current = l), setLine(l));

  // Every change to the box's text keeps the picks true: an edited pick is typed text from then on, and Undo's places
  // move with the text.
  useLayoutEffect(() => {
    const before = last.current;
    if (before === where) return;
    picks.current = picksAfterEdit(picks.current, before, where);
    const l = lineRef.current;
    if (l?.kind === "taken") lineRef.current = { ...l, taken: l.taken.map((x) => ({ ...x, at: spotAfterEdit(x.at, before, where) })) };
    last.current = where;
    // A pick the box just wrote becomes one once its text is the box's.
    const mine = pending.current.filter((p) => p.in === where);
    pending.current = [];
    for (const p of mine) picks.current = [...picks.current.filter((x) => x.start + x.text.length <= p.start || x.start >= p.start + p.text.length), { start: p.start, text: p.text, client: p.client, clientName: p.clientName }].sort((a, b) => a.start - b.start);
  }, [where]);

  // A client change: the other client's picks go, with one line and Undo. Changing back puts nothing back by itself.
  useLayoutEffect(() => {
    const was = client.current;
    const wasName = clientNameRef.current;
    client.current = clientKey;
    clientNameRef.current = clientName;
    if (was === clientKey) return;
    pending.current = [];
    const r = takeOut(last.current, picks.current, clientKey);
    if (!r) {
      // An Undo from an earlier change is only for that change.
      if (lineRef.current) show(null);
      return;
    }
    picks.current = r.kept;
    last.current = r.text;
    setWhere(r.text);
    show({ kind: "taken", n: r.taken.length, from: r.taken.map((x) => x.pick.clientName), to: clientName, taken: r.taken, was, wasName });
  }, [clientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPicked = useCallback((p: Picked) => {
    if (client.current) pending.current.push({ ...p, client: client.current, clientName });
    // UC-3 review: a pick under the new client ends the change's Undo, which would otherwise put the old client back
    // over this client's names.
    if (lineRef.current?.kind === "taken") show(null);
  }, [clientName]);

  // UC-3: with `restore`, Undo puts the client back first (so the names never sit under another client), then the names.
  const withClient = !!restore;
  const undo = () => {
    const l = lineRef.current;
    if (l?.kind !== "taken") return;
    const back = restore && l.was !== null && l.was !== client.current ? l.was : null;
    if (back !== null) {
      // The client goes back before the names, and this hook already knows it: the change back takes nothing out.
      client.current = back;
      clientNameRef.current = l.wasName;
      restore!(back);
    }
    const r = putBack(last.current, picks.current, l.taken);
    picks.current = r.picks;
    last.current = r.text;
    setWhere(r.text);
    show({ kind: "back", text: back !== null ? PICKS_TEXT.putBackWithClient(l.n, l.wasName) : PICKS_TEXT.putBack(l.n, l.from, l.to) });
  };

  return { onPicked, line, undo, withClient };
}

/** The one line after a client change, with Undo; screen readers hear it (a polite status that is always there). */
export function WherePicksLine({ state, className }: { state: ReturnType<typeof useWherePicks>; className?: string }) {
  const l = state.line;
  const words = l === null ? "" : l.kind === "taken" ? PICKS_TEXT.takenOut(l.n, l.from) : l.text;
  return (
    <span className={`wp-line${className ? ` ${className}` : ""}`} data-where-picks="">
      <span className="sr-only" role="status" aria-live="polite">
        {words}
      </span>
      {l && (
        <span className="muted" aria-hidden="true">
          {words}
        </span>
      )}
      {l?.kind === "taken" && (
        <>
          {" "}
          <button
            type="button"
            className="link-btn"
            aria-label={state.withClient ? PICKS_TEXT.undoWithClient(l.n) : PICKS_TEXT.undoLabel(l.n)}
            onClick={(e) => {
              // The button goes once it is used: focus goes to the box the names went back into (review 3).
              const box = e.currentTarget.closest("[role=dialog]")?.querySelector<HTMLTextAreaElement>('textarea[data-question="where"]');
              state.undo();
              requestAnimationFrame(() => box?.isConnected && box.focus());
            }}
          >
            {PICKS_TEXT.undo}
          </button>
        </>
      )}
    </span>
  );
}
