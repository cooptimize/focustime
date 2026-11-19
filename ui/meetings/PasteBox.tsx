// MC-7: Paste, beside the other transcript choices: one box that takes a transcript or the reviewer's notes, says what
// FocusTime took it for and how much, and switches to the other reading on a press. The text is held only in this
// component's memory until the press: never in the browser's storage (no autocomplete, nothing saved), so a reload
// loses it, and leaving the page with text in the box asks first. Plain text only: a textarea takes no formatting,
// and nothing in it is drawn as markup.
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { readPaste, type PasteAs, type PasteRead } from "../../plan/transcript.ts";
import { PASTE_TEXT } from "../../plan/call-words.ts";
import { TextBox } from "../TextBox.tsx";

export type Paste = { text: string; as: PasteAs };

/** The box's state: the text, the reading chosen by a press (null: FocusTime's), and what reading it gives. */
export function usePaste(initial = "") {
  const [text, setText] = useState(initial);
  const [as, setAs] = useState<PasteAs | null>(null);
  const later = useDeferredValue(text);
  const read: PasteRead | null = useMemo(() => (later.trim() ? readPaste(later, as ?? undefined) : null), [later, as]);
  // Settled on what is in the box now (the deferred reading can lag a keystroke).
  const ok = !!read && later === text && !read.tooLong && !read.tooShort;
  // Leaving the page (a reload, closing the tab) with text in the box asks first.
  const dirty = !!text.trim();
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);
  const set = (t: string) => {
    setText(t);
    if (!t.trim()) setAs(null);
  };
  return { text, setText: set, read, ok, dirty, value: (): Paste | null => (read && ok ? { text, as: read.as } : null), flip: () => read && setAs(read.as === "transcript" ? "notes" : "transcript") };
}
export type PasteState = ReturnType<typeof usePaste>;

/** Whether it is all right to drop what is in the box: nothing there, or a yes. */
export const mayDrop = (p: PasteState) => !p.dirty || window.confirm(PASTE_TEXT.leave);

/** The box and its one line: what FocusTime took the text for and how much, with the switch; or why it can't take it. */
export function PasteField({ p, autoFocus = false, children }: { p: PasteState; autoFocus?: boolean; children?: React.ReactNode }) {
  const id = useId();
  const r = p.read;
  return (
    <div className="mtg-paste" data-paste="">
      <label htmlFor={`${id}-box`} className="mtg-paste-label">{PASTE_TEXT.label}</label>
      <TextBox id={`${id}-box`} className="mtg-paste-box" minRows={12} maxRows={24} value={p.text} onChange={(e) => p.setText(e.target.value)} autoComplete="off" autoFocus={autoFocus} aria-describedby={`${id}-hint ${id}-line`} data-paste-box="" />
      <span id={`${id}-hint`} className="mtg-drop-kinds">{PASTE_TEXT.hint}</span>
      <p id={`${id}-line`} className="mtg-paste-line" role="status" aria-live="polite" data-paste-line={r ? (r.tooLong ? "long" : r.tooShort ? "short" : r.as) : ""}>
        {!r ? null : r.tooLong ? (
          <span className="error-line">{PASTE_TEXT.tooLong}</span>
        ) : (
          <>
            <span data-paste-took={r.as}>{r.as === "transcript" ? PASTE_TEXT.transcript(r.lines.length, r.speakers) : PASTE_TEXT.notes(r.lines.length)}</span>
            {r.tooShort ? <span className="muted"> {PASTE_TEXT.tooShort}</span> : (
              <button type="button" className="link-btn mtg-paste-flip" onClick={p.flip} data-paste-flip="">{r.as === "transcript" ? PASTE_TEXT.asNotes : PASTE_TEXT.asTranscript}</button>
            )}
          </>
        )}
      </p>
      {children}
    </div>
  );
}
