// TX-1: the progress check-in. It rides on the two moments that already exist: the top of Today's Midday check-in and of
// Close out. One row per to-do whose timebox ended: Done, Partly (quick picks for the time left, or type) or Didn't get
// to it, and "All went to plan" at the top. Answers apply at once and stay on screen with Undo. Nothing shows when
// nothing qualifies, and there are no badges or reminders anywhere else. ProgressOffer is the end of day DevOps offer.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AppliedSession, DoneOffer, ProgressOffer, SessionView } from "../actions/types.ts";
import { durationText, LEFT_CHOICES, parseLeft, progressAsk } from "../plan/progress.ts";
import { call } from "./api.ts";
import { useDevOpsWrite, type DevOpsChange } from "./DevOpsWrite.tsx";
import { partsLine, partsOf } from "../plan/preview-parts.ts";
import { DoneBatch, useDoneOffer } from "./DoneOffer.tsx";
import { Icon } from "./icons.tsx";

type Answered = { text: string; ids: number[]; done: boolean };
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
/** A Done's words on its row, with the one line about later to-dos it took off the plan. */
const doneText = (notice: string | null | undefined) => (notice ? `Done · ${notice}` : "Done");

export function TimeboxCheckin({ date, moment, color, onChanged, onError }: { date: string; moment: "midday" | "end"; color: (clientKey: string) => string; onChanged: () => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<SessionView[]>([]);
  const [answered, setAnswered] = useState<Map<number, Answered>>(new Map());
  const [asking, setAsking] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const [batch, setBatch] = useState<DoneOffer[]>([]);
  const { ticked, progress } = useDoneOffer();
  useEffect(() => {
    let live = true;
    setAnswered(new Map());
    setAsking(null);
    setAllError(null);
    setBatch([]);
    void call<{ rows: SessionView[] }>("checkin.sessions", { date, moment }).then((r) => live && setRows(r.rows), () => live && setRows([]));
    return () => void (live = false);
  }, [date, moment]);
  const mark = (pickId: number, a: Answered | null) =>
    setAnswered((m) => {
      const next = new Map(m);
      if (a) next.set(pickId, a);
      else next.delete(pickId);
      return next;
    });
  const answer = async (r: SessionView, answer: "done" | "partly" | "none", left?: number) => {
    setBusy(true);
    try {
      const out = await call<{ timeboxIds: number[]; notice: string | null }>("checkin.answer", { date, moment, pickId: r.pickId, answer, ...(left ? { left } : {}) });
      mark(r.pickId, { text: answer === "done" ? doneText(out.notice) : answer === "partly" ? `${durationText(left!)} left` : "Back to not timeboxed", ids: out.timeboxIds, done: answer === "done" });
      setAsking(null);
      setTyped("");
      onChanged();
      // PK-1's offer for one Done. Close out asks once for the whole day instead (its own batch).
      if (answer === "done" && moment === "midday") ticked(r.pickId, true, r.clientKey, r.itemId);
      // FN-1: Partly is Made progress: the same sheet, on the time left (the plan side is answered already).
      if (answer === "partly" && left && moment === "midday") progress?.(r.pickId, left, r.clientKey, r.itemId);
    } catch (e) {
      onError(errText(e));
    }
    setBusy(false);
  };
  const undo = async (r: SessionView) => {
    const a = answered.get(r.pickId);
    if (!a) return;
    setBusy(true);
    try {
      await call("checkin.undo", { timeboxIds: a.ids });
      mark(r.pickId, null);
      setBatch((b) => b.filter((o) => o.pickId !== r.pickId));
      onChanged();
      if (a.done && moment === "midday") ticked(r.pickId, false, r.clientKey, r.itemId);
    } catch (e) {
      onError(errText(e));
    }
    setBusy(false);
  };
  const allToPlan = async () => {
    setBusy(true);
    setAllError(null);
    try {
      const out = await call<{ applied: AppliedSession[]; done: number[] }>("checkin.all_to_plan", { date, moment });
      // The server read the rows afresh: what stays is what was answered here and what it just applied. A row answered
      // elsewhere leaves, and a timebox that ended since this page opened joins with its own Undo.
      const here = rows.filter((r) => answered.has(r.pickId) && !out.applied.some((a) => a.pickId === r.pickId));
      setRows([...here, ...out.applied]);
      setAnswered((m) => {
        const next = new Map(m);
        for (const a of out.applied) next.set(a.pickId, { text: a.as === "done" ? doneText(a.notice) : `${durationText(a.left)} left`, ids: a.timeboxIds, done: a.as === "done" });
        return next;
      });
      onChanged();
      // PK-1's offer for what this marked done, one batch; Close out asks once for the whole day instead.
      if (moment === "midday" && out.done.length)
        void call<{ offers: DoneOffer[]; off: boolean }>("devops.done_offer", { pickIds: out.done.slice(0, 30) }).then((r) => setBatch(r.off ? [] : r.offers), () => setBatch([]));
    } catch (e) {
      setAllError(errText(e));
    }
    setBusy(false);
  };
  if (!rows.length) return null;
  const open = rows.filter((r) => !answered.has(r.pickId));
  const typedLeft = parseLeft(typed);
  return (
    <section className="tc-box" aria-label="Timeboxes that ended">
      <header className="tc-head">
        <h3>Timeboxes that ended</h3>
        {open.length > 0 && (
          <button type="button" className="mini primary tc-btn" disabled={busy} onClick={() => void allToPlan()} title="To-dos whose timebox covered their time left are done. The others count the timebox as time spent.">
            All went to plan
          </button>
        )}
      </header>
      {allError && (
        <p className="tc-error" role="alert">
          {allError}. Nothing was changed.{" "}
          <button type="button" className="mini tc-btn" disabled={busy} onClick={() => void allToPlan()}>Retry</button>
        </p>
      )}
      <ul className="tc-rows">
        {rows.map((r) => {
          const a = answered.get(r.pickId);
          return (
            <li key={r.pickId} className={`tc-row${a ? " answered" : ""}`} style={{ "--c": color(r.clientKey) } as CSSProperties}>
              <div className="tc-what">
                <span className="tc-title">{r.title}</span>
                <span className="muted tc-sub">{r.clientName} · {durationText(r.minutes)} timeboxed · {durationText(r.remaining)} left before</span>
              </div>
              {a ? (
                <div className="tc-acts">
                  <span className="tc-said">{a.text}</span>
                  <button type="button" className="mini tc-btn" disabled={busy} onClick={() => void undo(r)}>Undo</button>
                </div>
              ) : asking === r.pickId ? (
                <div className="tc-acts" role="group" aria-label={`How much is left on ${r.title}`}>
                  {LEFT_CHOICES.map((m) => (
                    <button key={m} type="button" className="mini tc-btn" disabled={busy} onClick={() => void answer(r, "partly", m)}>{durationText(m)}</button>
                  ))}
                  <input className="tc-left" aria-label="Time left" placeholder="45m" value={typed} autoFocus inputMode="text" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && typedLeft) void answer(r, "partly", typedLeft); if (e.key === "Escape") setAsking(null); }} />
                  <button type="button" className="mini tc-btn" disabled={busy || !typedLeft} onClick={() => typedLeft && void answer(r, "partly", typedLeft)}>Set</button>
                  <button type="button" className="mini quiet tc-btn" onClick={() => setAsking(null)}>Back</button>
                </div>
              ) : (
                <div className="tc-acts">
                  <button type="button" className="mini tc-btn" disabled={busy} onClick={() => void answer(r, "done")}>Done</button>
                  <button type="button" className="mini tc-btn" disabled={busy} onClick={() => (setTyped(""), setAsking(r.pickId))}>Partly</button>
                  <button type="button" className="mini quiet tc-btn" disabled={busy} onClick={() => void answer(r, "none")}>Didn't get to it</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {batch.length > 0 && <DoneBatch offers={batch} dayWords="today" onDone={onChanged} />}
    </section>
  );
}

type RowOutcome = { ok: boolean; message: string; entryId: number | null };
type Chosen = { offer: ProgressOffer; note: string | null; result: RowOutcome | null };

/**
 * TX-1: the end of day offer, once: one line with Review and Skip. OP-1: Review opens the app's one preview (each
 * story's Remaining Work before and after, or its comment), a client at a time and 10 at most in each; only its
 * Confirm writes, each story read back and logged. Each row then says what happened to it, with Undo (or Retry when its
 * answer was lost). Skip is one click, and once anything is written it isn't offered again that day.
 */
export function ProgressOfferCard({ date, version, onDone }: { date: string; /** Bumped by an answer: the list may have changed. */ version: number; onDone: () => void }) {
  const [offers, setOffers] = useState<ProgressOffer[]>([]);
  const [list, setList] = useState<Chosen[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = useDevOpsWrite();
  useEffect(() => {
    let live = true;
    if (list || gone) return;
    void call<{ offers: ProgressOffer[] }>("devops.progress_offer", { date }).then((r) => live && setOffers(r.offers), () => live && setOffers([]));
    return () => void (live = false);
  }, [date, version, list, gone]);
  const counts = useMemo(() => ({ remaining: offers.filter((o) => o.mode === "remaining").length, comment: offers.filter((o) => o.mode === "comment").length }), [offers]);
  const close = useCallback(() => {
    setGone(true);
    void call("checkin.offer_close", { date }).catch(() => undefined);
  }, [date]);
  const changeOf = (o: ProgressOffer): DevOpsChange => (o.mode === "remaining" ? { key: String(o.pickId), kind: "remaining_work", itemId: o.itemId, hours: o.hours, pickId: o.pickId } : { key: String(o.pickId), kind: "comment", itemId: o.itemId, text: o.text });
  const parts = partsOf(offers, (o) => o.clientKey);
  const partsSaid = partsLine(offers.length, parts.length, new Set(parts.map((p) => p.clientKey)).size, "update");
  const review = () => {
    if (!write) return;
    setBusy(true);
    setError(null);
    write.series(
      parts.map((p) => ({ clientKey: p.clientKey, changes: p.items.map(changeOf) })),
      (end) => {
        setBusy(false);
        if (!end.results.length && !end.refused.length) return void (end.errors[0] && setError(end.errors[0]));
        const by = new Map(end.results.map((r) => [r.key, r]));
        const refused = new Map(end.refused.map((r) => [r.key, r.error]));
        // A refused row doesn't stop the others: each row says what happened to it.
        setList(
          offers.map((offer) => {
            const r = by.get(String(offer.pickId));
            return { offer, note: refused.get(String(offer.pickId)) ?? (r ? null : end.stopped ? "Not sent" : "Nothing to change"), result: r ? { ok: r.confirmed, message: r.confirmed ? "Saved" : r.message, entryId: r.writeId } : null };
          }),
        );
        if (end.results.length) close();
        onDone();
      },
    );
  };
  const retry = async (r: Chosen) => {
    if (r.result?.entryId == null || !write) return;
    setBusy(true);
    const res = await write.retry(r.result.entryId);
    if (res) setList((l) => l?.map((x) => (x === r ? { ...x, result: { ok: res.confirmed, message: res.confirmed ? "Saved" : res.message, entryId: res.entry.id } } : x)) ?? null);
    setBusy(false);
  };
  if (gone && !list) return null;
  if (!list && !offers.length) return null;
  const ask = progressAsk(counts.remaining, counts.comment);
  if (!list)
    return (
      <div className="tc-offer" role="group" aria-label="Update DevOps">
        <span>{ask}</span>
        {partsSaid && <span className="muted">{partsSaid}</span>}
        <button type="button" className="mini primary tc-btn" disabled={busy || !write} onClick={review}>Review</button>
        <button type="button" className="mini quiet tc-btn" disabled={busy} onClick={close}>Skip</button>
        {error && <span className="db-fail">{error}</span>}
      </div>
    );
  return (
    <div className="done-batch tc-preview" role="group" aria-label="DevOps updates">
      <p className="db-ask">{ask}</p>
      <ul className="db-rows">
        {list.map((r) => (
          <li key={r.offer.pickId}>
            <span className="db-what">#{r.offer.itemId} {r.offer.title}</span>
            <span className="db-state muted">{r.note ?? (r.offer.mode === "remaining" ? `Remaining Work ${r.offer.hours}h` : r.offer.text)}</span>
            {r.result && (
              <span className={r.result.ok ? "db-ok" : "db-fail"}>
                {r.result.ok && <><Icon name="done" /> </>}{r.result.message}
                {r.result.ok && r.result.entryId !== null && <button type="button" className="mini" onClick={() => void write?.begin(r.offer.clientKey, [{ kind: "undo", writeId: r.result!.entryId! }])}>Undo</button>}
                {!r.result.ok && r.result.entryId !== null && <button type="button" className="mini" disabled={busy} onClick={() => void retry(r)}>Retry</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="db-foot">
        <span className="muted">Undo is also in Settings › Activity.</span>
      </p>
    </div>
  );
}
