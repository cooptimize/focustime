// IB-1: Close the loop, one component wherever a promise shows (the Inbox, Week's and Today's detail panel, Close out,
// the phone). Today it records how I told them (optional: Teams, Email, DevOps, Call) and a note; nothing is sent.
// The seam for LP-1 is `onSubmit`: it gets the choice and the note and says whether it worked, so a later sender can
// draft, preview and send without this form changing shape. The channels wrap (four across when wide, two by two when
// narrow) and the note has its own full-width row, so the form never makes its container scroll sideways.
import { useId, useState } from "react";
import { CLOSE_HOW, type CloseHow } from "../plan/types.ts";

export const HOW_LABEL: Record<CloseHow, string> = { teams: "Teams", email: "Email", devops: "DevOps", call: "Call" };

/** What Close the loop hands on: how I told them (or null) and the note (or null). */
export type CloseLoopValue = { how: CloseHow | null; note: string | null };

export function CloseLoop({ who, initialHow = null, onSubmit, onCancel, compact = false }: {
  /** Who it's owed to ("Close the loop with Dana"), or null for no name. */
  who: string | null;
  initialHow?: CloseHow | null;
  /** Records it (today) or, from LP-1, sends it. Returns the error to show, or null when done. */
  onSubmit: (v: CloseLoopValue) => Promise<string | null>;
  onCancel: () => void;
  /** In a narrow panel: no heading, smaller gaps. */
  compact?: boolean;
}) {
  const [how, setHow] = useState<CloseHow | null>(initialHow);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className={`close-loop${compact ? " compact" : ""}`}
      aria-label={who ? `Close the loop with ${who}` : "Close the loop"}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await onSubmit({ how, note: note.trim() || null });
        setBusy(false);
        setError(err);
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
    >
      {!compact && <h4 className="close-loop-title">{who ? `Close the loop with ${who}` : "Close the loop"}</h4>}
      <fieldset className="close-loop-how">
        <legend className="close-loop-label">How you told them (optional)</legend>
        {CLOSE_HOW.map((h) => (
          <button key={h} type="button" className="close-loop-choice" aria-pressed={how === h} onClick={() => setHow(how === h ? null : h)}>
            {HOW_LABEL[h]}
          </button>
        ))}
      </fieldset>
      <label className="close-loop-note" htmlFor={`${id}-note`}>
        <span className="close-loop-label">Note (optional)</span>
        <textarea
          id={`${id}-note`}
          autoFocus
          value={note}
          maxLength={500}
          rows={2}
          placeholder="What you told them"
          onChange={(e) => setNote(e.target.value)}
          // Enter closes it, as the one-line note did; Shift+Enter starts a new line.
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), e.currentTarget.form?.requestSubmit())}
        />
      </label>
      <div className="close-loop-buttons">
        <button type="submit" className="mini primary" disabled={busy}>{busy ? "Closing…" : "Close the loop"}</button>
        <button type="button" className="mini" onClick={onCancel}>Cancel</button>
        {error && <span className="set-problem" role="alert">{error}</span>}
      </div>
    </form>
  );
}
