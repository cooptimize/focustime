// CV-1's promise pieces, shared by the Inbox (IB-1, ui/inbox/): a promise's due in words and Link to item for a
// promise, with or without a conversation (likely items first, then whatever is typed).
import { TypeIcon } from "./TypeIcon.tsx";
import { useEffect, useState } from "react";
import type { PromiseCard } from "../plan/conversation-views.ts";
import { call } from "./api.ts";
import { AlsoComment } from "./Conversations.tsx";


type Hit = { id: number; title: string; type: string; state: string; url: string; reason: string };
/** CV-3: Link existing… with or without a conversation: likely items first (with why), then whatever is typed. */
export function PromiseLink({ p, canComment, onPick: pickIt, onCancel }: { p: PromiseCard; canComment: boolean; onPick: (id: number, comment: boolean) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [comment, setComment] = useState(false);
  const onPick = (id: number) => pickIt(id, comment && canComment);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void call<{ available: boolean; items: Hit[] }>("my_promises.search", { id: p.id, query: q }).then(
          (r) => live && (setHits(r.items), setAvailable(r.available)),
          () => live && setHits([]),
        ),
      q ? 150 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, p.id]);
  return (
    <div className="ask-form ask-link" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Link to one of {p.clientName}'s open items
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), onPick(hits[0].id))} />
      </label>
      {hits && (
        <ul className="ask-hits" aria-label={q ? "Open items" : "Likely items"}>
          {!available && <li className="muted">DevOps couldn't be read for {p.clientName} just now</li>}
          {available && hits.length === 0 && <li className="muted">{q ? "No open items match" : "No likely items. Search by title or #id"}</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="mini quiet" onClick={() => onPick(h.id)}>
                <TypeIcon clientKey={p.clientKey} type={h.type} /> #{h.id} {h.title} <span className="muted">· {h.state}</span>
              </button>
              <span className="ask-hit-why muted">{h.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <AlsoComment on={comment} set={setComment} disabled={!canComment} />
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}
