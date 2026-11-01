// Loops (step 6c, step 7): what I owe people. Opened by rules (pick done but DevOps not updated, slipped work, a
// blocked item, a flex session) or by hand; closed by a DevOps signal or "mark as told" with an optional note. Closed
// ones are hidden unless asked for. Local only: nothing is posted anywhere; heads-up drafts are copied by hand.
import { useCallback, useEffect, useRef, useState } from "react";
import type { LoopView } from "../actions/types.ts";
import { call } from "./api.ts";

type Props = { timeZone: string; onClose: () => void; onChanged: () => void };

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

const KIND_LABEL: Record<string, string> = { devops_update: "DevOps update", slip: "Heads-up", blocked: "Blocker", flex_update: "Flex session", manual: "Added by me" };

/** Copies text; falls back to selecting it when the clipboard isn't available. */
async function copy(text: string, el: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    el?.focus();
    el?.select();
    return false;
  }
}

/** One loop: who, what, when; its heads-up draft to copy; "Mark as told" with an optional note. */
export function LoopRow({ l, timeZone, onClosed }: { l: LoopView; timeZone: string; onClosed: (note: string | null) => Promise<boolean> }) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <li className={`loop${l.closedAt ? " closed" : ""}${l.isNew && !l.closedAt ? " new" : ""}`}>
      <div className="loop-main">
        <span className="loop-kind">{KIND_LABEL[l.kind] ?? "Loop"}</span>
        {l.isNew && !l.closedAt && <span className="loop-new">New today</span>}
        <span className="loop-who">{l.who}</span>
        <span className="loop-what">{l.what}</span>
        <span className="muted loop-when">
          {l.session ? `Flex session ${span(l.session, timeZone)} · ` : ""}opened {when(l.openedAt, timeZone)}
          {l.due ? ` · due ${dayOf(Temporal.PlainDate.from(l.due).toZonedDateTime(timeZone))}` : ""}
          {l.closedAt ? ` · ${l.closedBy === "signal" ? "closed by DevOps" : "told"} ${when(l.closedAt, timeZone)}${l.closeNote ? `: ${l.closeNote}` : ""}` : ""}
        </span>
        {l.draft && showDraft && (
          <div className="loop-draft">
            <textarea ref={area} readOnly value={l.draft} rows={Math.min(8, l.draft.split("\n").length + 1)} aria-label="Heads-up draft" />
          </div>
        )}
      </div>
      <div className="loop-actions">
        {l.draft && (
          <>
            <button type="button" className="mini" aria-expanded={showDraft} onClick={() => setShowDraft((v) => !v)}>
              {showDraft ? "Hide draft" : "Draft"}
            </button>
            <button
              type="button"
              className="mini"
              onClick={async () => {
                setShowDraft(true);
                setCopied((await copy(l.draft!, area.current)) ? "Copied" : "Selected, press Ctrl C");
              }}
            >
              {copied ?? "Copy heads-up"}
            </button>
          </>
        )}
        {!l.closedAt &&
          (closing ? (
            <form
              className="loop-close"
              onSubmit={(e) => {
                e.preventDefault();
                void onClosed(note.trim() || null).then((ok) => ok && setClosing(false));
              }}
            >
              <input autoFocus value={note} maxLength={500} placeholder="Note (optional), e.g. posted in Teams" onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <button type="submit" className="mini primary">
                Mark as told
              </button>
              <button type="button" className="mini" onClick={() => setClosing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="mini" onClick={() => { setClosing(true); setNote(""); }}>
              Mark as told…
            </button>
          ))}
      </div>
    </li>
  );
}

/** "Add a loop": who, what, optional due date. */
export function AddLoop({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ who: "", what: "", due: "" });
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" className="mini" onClick={() => setOpen(true)}>
        Add a loop
      </button>
    );
  return (
    <form
      className="loop-add"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await call("loop.add", { who: v.who, what: v.what, ...(v.due ? { due: v.due } : {}) });
          setV({ who: "", what: "", due: "" });
          setOpen(false);
          setError(null);
          onAdded();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not add it");
        }
      }}
    >
      <label>
        Who <input autoFocus required maxLength={100} value={v.who} placeholder="e.g. CSC, or a person" onChange={(e) => setV({ ...v, who: e.target.value })} />
      </label>
      <label>
        What I owe <input required maxLength={200} value={v.what} placeholder="e.g. Send the mapping notes" onChange={(e) => setV({ ...v, what: e.target.value })} />
      </label>
      <label>
        Due <input type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />
      </label>
      <button type="submit" className="mini primary">
        Add
      </button>
      <button type="button" className="mini" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <span className="set-problem">{error}</span>}
    </form>
  );
}

export function Loops({ timeZone, onClose, onChanged }: Props) {
  const [loops, setLoops] = useState<LoopView[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
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

  const close = async (id: number, note: string | null) => {
    try {
      await call("loop.close", { id, note });
      await load();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close it");
      return false;
    }
  };

  const open = loops?.filter((l) => !l.closedAt) ?? [];
  const closed = loops?.filter((l) => l.closedAt) ?? [];
  const row = (l: LoopView) => <LoopRow key={l.id} l={l} timeZone={timeZone} onClosed={(n) => close(l.id, n)} />;

  return (
    <main className="loops" aria-label="Loops">
      <div className="loops-head">
        <h2 ref={head} tabIndex={-1}>
          Loops <span className="muted">{loops ? `${open.length} open` : ""}</span>
        </h2>
        <AddLoop onAdded={() => { void load(); onChanged(); }} />
        <label className="set-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        <button type="button" className="top-btn" onClick={onClose}>
          Back to the week <kbd>Esc</kbd>
        </button>
      </div>
      <p className="muted loops-note">Things you owe someone, newest first. Rules open them: a pick done but its DevOps item not updated, work that slipped, a blocked item, a flex session. A later DevOps fetch closes the DevOps ones. Nothing is posted anywhere.</p>
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
