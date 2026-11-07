// IB-1 slice 4: Merge into… in the detail pane. First the other open conversations of the same chat to pick from, then
// the before → after: which one absorbs which (Swap turns it round), what moves (messages, commitments, suggestions,
// people, the linked item) and the one that stays afterwards. Merge runs CV-2's merge for everyone on the chat, with
// Undo in the notice. Counts and titles only, never message text.
import { useEffect, useState } from "react";
import type { ConversationCard } from "../../plan/conversation-views.ts";
import { contentsLine, movesLines, type MergePreview, type MergeSide } from "../../plan/merge-preview.ts";
import { call } from "../api.ts";
import { whenText } from "../labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

function Side({ s, label, gone }: { s: MergeSide; label: string; gone?: boolean }) {
  return (
    <div className={`mg-side${gone ? " mg-gone" : ""}`}>
      <p className="mg-label">{label}</p>
      <p className="mg-title">{s.title}</p>
      <p className="muted">{contentsLine(s)}</p>
      <p className="muted">{s.item ? `#${s.item.id}${s.item.title ? ` · ${s.item.title}` : ""}` : "No linked item"}</p>
    </div>
  );
}

export function MergePane({ c, others, tz, onMerge, onCancel }: { c: ConversationCard; others: readonly ConversationCard[]; tz: string; onMerge: (fromId: number, into: ConversationCard) => Promise<void>; onCancel: () => void }) {
  const [other, setOther] = useState<ConversationCard | null>(others.length === 1 ? others[0]! : null);
  // Swapped: the picked one is absorbed into this one, instead of this one into it.
  const [swapped, setSwapped] = useState(false);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = other ? (swapped ? other : c) : null;
  const into = other ? (swapped ? c : other) : null;

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!from || !into) return;
    let live = true;
    call<MergePreview>("conversations.merge_preview", { id: from.id, into: into.id }).then((p) => live && setPreview(p), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [from?.id, into?.id]);

  const keys = (e: React.KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onCancel());

  if (!other)
    return (
      <div className="ib-form ib-merge" role="group" aria-label={`Merge ${c.title} with another conversation`} onKeyDown={keys}>
        <p className="ib-form-label">Merge with…</p>
        <p className="muted">Open conversations in {c.chatName}. Pick one to see what moves before anything changes.</p>
        <ul className="mg-list">
          {others.map((o, i) => (
            <li key={o.id}>
              <button type="button" className="mg-choice" autoFocus={i === 0} onClick={() => setOther(o)}>
                <strong>{o.title}</strong> <span className="muted">· {o.statusLine} · {whenText(o.lastAt, tz)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mg-buttons">
          <button type="button" className="mini quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <div className="ib-form ib-merge" role="group" aria-label="Merge preview" onKeyDown={keys}>
      <p className="ib-form-label">Merge preview</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!preview && !error && <p className="muted">Reading both conversations…</p>}
      {preview && (
        <>
          <div className="mg-before" aria-label="Before">
            <Side s={preview.from} label="Moves out of" gone />
            <span className="mg-arrow" aria-hidden="true">→</span>
            <Side s={preview.into} label="Into" />
          </div>
          <p className="mg-label">What moves</p>
          <ul className="mg-moves">
            {movesLines(preview).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="mg-after" aria-label="After">
            <p className="mg-label">After</p>
            <p className="mg-title">{preview.after.title}</p>
            <p className="muted">
              {contentsLine(preview.after)} · {preview.after.people.length} {preview.after.people.length === 1 ? "person" : "people"}
              {preview.after.item.kind !== "none" ? ` · #${preview.after.item.item.id}` : ""}
            </p>
            <p className="muted">"{preview.from.title}" is no longer listed. Everyone on the chat sees the change. You can undo it.</p>
          </div>
        </>
      )}
      <div className="mg-buttons">
        <button
          type="button"
          className="mini primary"
          disabled={!preview || busy}
          onClick={() => {
            if (!from || !into) return;
            setBusy(true);
            void onMerge(from.id, into).finally(() => setBusy(false));
          }}
        >
          Merge
        </button>
        <button type="button" className="mini quiet" disabled={busy} onClick={() => setSwapped((s) => !s)} title="Keep the other one instead">
          Swap: keep "{(swapped ? other : c).title}"
        </button>
        {others.length > 1 && (
          <button type="button" className="mini quiet" disabled={busy} onClick={() => (setOther(null), setSwapped(false))}>
            Pick another
          </button>
        )}
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
