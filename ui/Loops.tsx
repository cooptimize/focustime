// Loops (step 6c): what I owe people. For now the ones flex sessions open ("Post the update to <client>").
// Close one by hand with an optional note; closed ones are hidden unless asked for. Full rules come with Close out.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoopView } from "../actions/types.ts";
import { call } from "./api.ts";

type Props = { clientName: (key: string) => string; timeZone: string; onClose: () => void; onChanged: () => void };

const zoned = (iso: string, tz: string) => (iso.includes("[") ? Temporal.ZonedDateTime.from(iso) : Temporal.Instant.from(iso).toZonedDateTimeISO(tz)).withTimeZone(tz);
const dayOf = (z: Temporal.ZonedDateTime) => z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (z: Temporal.ZonedDateTime) => `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
const when = (iso: string, tz: string) => {
  const z = zoned(iso, tz);
  return `${dayOf(z)}, ${clock(z)}`;
};
/** "Tue, Nov 3, 3:00 PM to 6:00 PM": the session a loop came from. */
const span = (s: { start: string; end: string }, tz: string) => {
  const a = zoned(s.start, tz);
  const b = zoned(s.end, tz);
  return `${dayOf(a)}, ${clock(a)} to ${clock(b)}`;
};

export function Loops({ clientName, timeZone, onClose, onChanged }: Props) {
  const [loops, setLoops] = useState<LoopView[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ loops: LoopView[] }>("loops.list", { includeClosed: showClosed });
      setLoops(r.loops);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load loops");
    }
  }, [showClosed]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => head.current?.focus(), []);

  const close = async (id: number) => {
    try {
      await call("loop.close", { id, note: note.trim() || null });
      setClosing(null);
      setNote("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close it");
    }
  };

  const open = loops?.filter((l) => !l.closedAt) ?? [];
  const closed = loops?.filter((l) => l.closedAt) ?? [];
  const row = (l: LoopView) => (
    <li key={l.id} className={`loop${l.closedAt ? " closed" : ""}`}>
      <div className="loop-main">
        <span className="loop-who">{l.clientKey ? clientName(l.clientKey) : "Someone"}</span>
        <span className="loop-what">{l.what}</span>
        <span className="muted loop-when">
          {l.session ? `Flex session ${span(l.session, timeZone)} · ` : ""}opened {when(l.openedAt, timeZone)}
          {l.due ? ` · due ${l.due}` : ""}
          {l.closedAt ? ` · closed ${when(l.closedAt, timeZone)}${l.closeNote ? `: ${l.closeNote}` : ""}` : ""}
        </span>
      </div>
      {!l.closedAt &&
        (closing === l.id ? (
          <form
            className="loop-close"
            onSubmit={(e) => {
              e.preventDefault();
              void close(l.id);
            }}
          >
            <input autoFocus value={note} maxLength={500} placeholder="Note (optional), e.g. posted in Teams" onChange={(e) => setNote(e.target.value)} aria-label="Closing note" />
            <button type="submit" className="mini primary">
              Close loop
            </button>
            <button type="button" className="mini" onClick={() => setClosing(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="mini" onClick={() => { setClosing(l.id); setNote(""); }}>
            Close…
          </button>
        ))}
    </li>
  );

  return (
    <main className="loops" aria-label="Loops">
      <div className="loops-head">
        <h2 ref={head} tabIndex={-1}>
          Loops <span className="muted">{loops ? `${open.length} open` : ""}</span>
        </h2>
        <label className="set-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        <button type="button" className="top-btn" onClick={onClose}>
          Back to the week <kbd>Esc</kbd>
        </button>
      </div>
      <p className="muted loops-note">Things you owe someone. For now: the update after each flex session. Closing is local; nothing is posted anywhere.</p>
      {error && <p className="set-problem">{error}</p>}
      {loops && !open.length && <p className="loops-empty">No open loops.</p>}
      <ul className="loop-list">{open.map(row)}</ul>
      {showClosed && closed.length > 0 && (
        <>
          <h3>Closed</h3>
          <ul className="loop-list">{closed.map(row)}</ul>
        </>
      )}
    </main>
  );
}
