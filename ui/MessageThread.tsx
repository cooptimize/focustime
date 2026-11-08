// CV-2: a conversation's messages as Teams shows them. Each group (one person's consecutive messages, a few minutes
// apart) has their avatar, name and time once; mine sit on the other side with no avatar; a reply shows the quoted
// message as a quote block (its author and first line); the body is the server's sanitized HTML (tables, links, bold,
// lists, code, mentions as chips); reactions sit small under the message, as counts. "Show earlier" loads the page
// before. Pasted images (CV-2) sit under their message as thumbnails from FocusTime's own address, never Graph's; one
// that isn't shown says why. CV-4: read from Teams when shown, never kept; one that can't be read now shows "Image in
// Teams" with Open in Teams, and the AI's short description sits under it when there is one. Rendering only: the caller loads the messages and photos and opens the viewer.
import { useState } from "react";
import type { ConversationMessage } from "../plan/conversation-views.ts";
import { Avatar } from "./Presence.tsx";
import { Stamp } from "./Stamp.tsx";

/** A new group starts with another person, or after this long between one person's messages. */
export const GROUP_GAP_MINUTES = 10;

export type MessageGroup = { key: string; authorKey: string; author: string; name: string; email: string | null; external: boolean; mine: boolean; at: string; messages: ConversationMessage[] };

/** Consecutive messages from one person, each within GROUP_GAP_MINUTES of the one before, as one group. */
export function groupMessages(ms: readonly ConversationMessage[]): MessageGroup[] {
  const out: MessageGroup[] = [];
  for (const m of ms) {
    const g = out.at(-1);
    const last = g?.messages.at(-1);
    if (g && last && g.authorKey === m.authorKey && (Date.parse(m.at) - Date.parse(last.at)) / 60_000 <= GROUP_GAP_MINUTES) g.messages.push(m);
    else out.push({ key: m.messageId, authorKey: m.authorKey, author: m.author, name: m.name, email: m.email, external: m.external, mine: m.mine, at: m.at, messages: [m] });
  }
  return out;
}

export function MessageThread({ messages, tz, photoFor, earlier, loadingEarlier = false, onEarlier, onImage }: {
  messages: readonly ConversationMessage[];
  tz: string;
  photoFor: (email: string | null) => string | null;
  /** Older messages exist: "Show earlier" asks for them. */
  earlier: boolean;
  loadingEarlier?: boolean;
  onEarlier: () => void;
  /** CV-2: a thumbnail was clicked: open the viewer on it. */
  onImage?: (id: number) => void;
}) {
  // CV-4: images Teams couldn't give us just now (the server answered 404).
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  return (
    <div className="tm-thread">
      {earlier && (
        <button type="button" className="mini quiet tm-earlier" disabled={loadingEarlier} onClick={onEarlier}>
          {loadingEarlier ? "Loading…" : "Show earlier"}
        </button>
      )}
      <ol className="tm-groups" aria-label="The messages">
        {groupMessages(messages).map((g) => (
          <li key={g.key} className={`tm-group${g.mine ? " mine" : ""}`}>
            {!g.mine && <Avatar name={g.name} photo={g.external ? null : photoFor(g.email)} size={28} />}
            <div className="tm-stack">
              <p className="tm-head">
                {!g.mine && <span className="tm-name">{g.author}</span>}
                {g.external && <span className="ask-ext">External</span>}
                <Stamp className="muted" at={g.at} tz={tz} />
              </p>
              {g.messages.map((m) => (
                <div key={m.messageId} className="tm-bubble" data-message={m.messageId}>
                  {m.quote && (
                    <blockquote className="tm-quote">
                      {m.quote.author ? (
                        <>
                          <span className="tm-quote-who">{m.quote.author}</span>
                          <span className="tm-quote-text">{m.quote.text || "A message"}</span>
                        </>
                      ) : (
                        <span className="tm-quote-text muted">Quoted an earlier message</span>
                      )}
                    </blockquote>
                  )}
                  {/* Sanitized on the server (plan/sanitize.ts): allowlisted tags, links only, mentions as chips. */}
                  <div className="conv-msg-body" dangerouslySetInnerHTML={{ __html: m.html }} />
                  {m.images && m.images.length > 0 && (
                    <ul className="tm-images" aria-label={m.images.length === 1 ? "1 image" : `${m.images.length} images`}>
                      {m.images.map((i, n) => (
                        <li key={i.id}>
                          {i.src && !failed.has(i.id) ? (
                            <button type="button" className="tm-thumb" aria-label={i.description ? `Open image ${n + 1} of ${m.images!.length}: ${i.description}` : `Open image ${n + 1} of ${m.images!.length}`} onClick={() => onImage?.(i.id)}>
                              <img src={i.src} alt={i.description ?? ""} loading="lazy" decoding="async" onError={() => setFailed((f) => new Set(f).add(i.id))} />
                            </button>
                          ) : i.src ? (
                            // CV-4: read from Teams when shown; when it can't be (a sign-in ran out, the message is gone), Teams has it.
                            <span className="tm-image-gone">
                              <span className="muted">Image in Teams</span>
                              {i.link && (
                                <a href={i.link} target="_blank" rel="noreferrer noopener">
                                  Open in Teams
                                </a>
                              )}
                            </span>
                          ) : (
                            <span className="tm-image-note muted">{i.note}</span>
                          )}
                          {i.description && <span className="tm-image-desc muted">{i.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.reactions.length > 0 && (
                    <p className="tm-reactions" aria-label={m.reactions.map((r) => `${r.emoji} ${r.count}`).join(", ")}>
                      {m.reactions.map((r) => (
                        <span key={r.emoji} className="tm-reaction">
                          {r.emoji}
                          {r.count > 1 && <span className="tm-reaction-n">{r.count}</span>}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
