// CV-2: a conversation's messages as Teams shows them. Each group (one person's consecutive messages, a few minutes
// apart) has their avatar, name and time once; mine sit on the other side with no avatar; a reply shows the quoted
// message as a quote block (its author and first line); the body is the server's sanitized HTML (tables, links, bold,
// lists, code, mentions as chips); reactions sit small under the message, as counts. "Show earlier" loads the page
// before. Pure rendering: the caller loads the messages and photos.
import type { ReactNode } from "react";
import type { ConversationMessage } from "../plan/conversation-views.ts";
import { Avatar } from "./Presence.tsx";
import { whenText } from "./labels.ts";

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

export function MessageThread({ messages, tz, photoFor, earlier, loadingEarlier = false, onEarlier, extra }: {
  messages: readonly ConversationMessage[];
  tz: string;
  photoFor: (email: string | null) => string | null;
  /** Older messages exist: "Show earlier" asks for them. */
  earlier: boolean;
  loadingEarlier?: boolean;
  onEarlier: () => void;
  /** Anything a message carries below its body (CV-2's images). */
  extra?: (m: ConversationMessage) => ReactNode;
}) {
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
                <time className="muted" dateTime={g.at}>
                  {whenText(g.at, tz)}
                </time>
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
                  {extra?.(m)}
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
