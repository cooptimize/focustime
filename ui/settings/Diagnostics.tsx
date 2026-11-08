// DX-1: Settings › Data › Diagnostics. Counts only, for my own chats: the promises check (why a committed conversation
// has no promise of mine) and the chatter filter check (where my chats' messages were sorted). Titles of my own
// conversations show here; Copy as text copies counts only. Never message text.
import { useRef, useState } from "react";
import { call } from "../api.ts";
import { copy } from "../FollowUps.tsx";
import { diagnosticsText, extractionWords, PROMISE_REASON_WORDS, PROMISE_REASONS, type Diagnostics } from "../../plan/diagnostics.ts";
import { CONVERSATION_STATUSES, STATUS_WORD, unsortedCount } from "../../plan/conversations.ts";
import { KIND_NAME, type ChatKind } from "../../plan/chats.ts";

const kindName = (k: string) => KIND_NAME[k as ChatKind] ?? k;

export function DiagnosticsPanel() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      setD(await call<Diagnostics>("diagnostics.check", {}));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't check");
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    setNote("Sorting waiting messages again…");
    try {
      await call("conversations.sort_unsorted", {});
      await run();
      setNote("Sorted again. The counts are fresh.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't sort again");
    }
  };
  const text = d ? diagnosticsText(d) : "";
  return (
    <section className="write-log dx" id="diagnostics" aria-label="Diagnostics">
      <h3>Diagnostics</h3>
      <p className="muted">Counts for your own chats only, to answer "why is a promise missing" and "why wasn't this filtered as chatter". No message text is shown or copied.</p>
      <div className="dx-actions">
        <button type="button" className="mini primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : d ? "Check again" : "Run checks"}
        </button>
        {d && (
          <button
            type="button"
            className="mini"
            onClick={() => void copy(text, area.current).then((ok) => setNote(ok ? "Copied: counts only, no titles." : "Select the text below and copy it."))}
          >
            Copy as text
          </button>
        )}
        {note && <span className="set-hint" role="status">{note}</span>}
      </div>
      {d && (
        <>
          <h4>Promises check</h4>
          <p className="dx-line">
            {CONVERSATION_STATUSES.map((s) => `${STATUS_WORD[s]} ${d.promises.byStatus[s]}`).join(" · ")}
          </p>
          <ul className="dx-counts" aria-label="Why my promise is missing, by conversation">
            <li className="dx-counts-head">
              <span>{'Conversations showing "<Name> committed"'}</span>
              <span className="num">{d.promises.committed}</span>
            </li>
            {PROMISE_REASONS.map((r) => (
              <li key={r} className={d.promises.byReason[r] && r !== "shown" && r !== "someone_else" ? "dx-gap" : ""}>
                <span>{PROMISE_REASON_WORDS[r]}</span>
                <span className="num">{d.promises.byReason[r]}</span>
              </li>
            ))}
          </ul>
          {d.promises.rows.length > 0 && (
            <ul className="dx-rows" aria-label="Conversations with no promise of mine">
              {d.promises.rows.map((r) => (
                <li key={r.conversationId}>
                  <span className="dx-client">{r.clientName}</span> <span>{r.title}</span> <span className="muted">{PROMISE_REASON_WORDS[r.reason]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="dx-line">
            Messages of mine that read like a promise, last {d.days} days: {d.promises.extraction.checked}.{" "}
            {Object.keys(d.promises.extraction.byReason).length ? "With no promise of mine:" : "Each has a promise of mine."}
          </p>
          {d.promises.extraction.rows.length > 0 && (
            <ul className="dx-rows" aria-label="Messages of mine with no promise">
              {d.promises.extraction.rows.map((r, i) => (
                <li key={i}>
                  <span className="dx-client">{r.clientName}</span> <span>{r.title}</span> <span className="muted">{extractionWords(r.reason)} ({d.promises.extraction.byReason[r.reason]})</span>
                  {r.retry && (
                    <button type="button" className="mini" onClick={() => void retry()}>
                      Retry extraction
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h4>Chatter filter check, last {d.days} days</h4>
          {!d.chats.length && <p className="muted">No registered chats you're in.</p>}
          {d.chats.length > 0 && (
            <div className="dx-scroll dx-chat-table">
              <table className="wl-table dx-table" aria-label="Messages by outcome per chat">
                <thead>
                  <tr>
                    <th>Chat</th>
                    <th className="num">Messages</th>
                    <th className="num" title="Sorted to a conversation by the AI, by rules, by a person">To a conversation</th>
                    <th className="num" title="GIFs, stickers, emoji, empty and short acks">Chatter: rule</th>
                    <th className="num">Chatter: AI</th>
                    <th className="num">Chatter: Social chat</th>
                    <th className="num">Not work-related</th>
                    <th>Unsorted</th>
                    <th className="num">Not placed</th>
                    <th>My marks</th>
                  </tr>
                </thead>
                <tbody>
                  {d.chats.map((c, i) => {
                    const o = c.outcomes;
                    const unsorted = Object.entries(o.unsorted);
                    return (
                      <tr key={i}>
                        <td>
                          <span className="dx-client">{c.clientName}</span> {c.chatName}
                          <span className="muted"> · {kindName(c.kind)}{c.social ? " · Social chat" : ""}</span>
                        </td>
                        <td className="num">{c.total}</td>
                        <td className="num">AI {o.sorted.ai} · rules {o.sorted.rules} · person {o.sorted.person}{o.workNoConversation ? ` · loose ${o.workNoConversation}` : ""}</td>
                        <td className="num">{o.chatter.rule}</td>
                        <td className="num">{o.chatter.ai}</td>
                        <td className="num">{o.chatter.social}</td>
                        <td className="num">{o.chatter.notWork}</td>
                        <td>{unsorted.length ? unsorted.map(([k, n]) => unsortedCount(n, k, c.clientName)).join(", ") : "0"}</td>
                        <td className="num">{o.notPlaced}</td>
                        <td>
                          This is work {c.marks.thisIsWork} · moved {c.marks.movedByMe} · Not work-related {c.marks.notWorkConversations}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {d.chats.length > 0 && (
            <ul className="dx-chat-list" aria-label="Messages by outcome per chat, as a list">
              {d.chats.map((c, i) => {
                const o = c.outcomes;
                const unsorted = Object.entries(o.unsorted);
                return (
                  <li key={i}>
                    <p><span className="dx-client">{c.clientName}</span> {c.chatName}<span className="muted"> · {kindName(c.kind)}{c.social ? " · Social chat" : ""}</span></p>
                    <p>{c.total} messages · to a conversation: AI {o.sorted.ai}, rules {o.sorted.rules}, person {o.sorted.person}{o.workNoConversation ? `, loose ${o.workNoConversation}` : ""}</p>
                    <p>Chatter: rule {o.chatter.rule} · AI {o.chatter.ai} · Social chat {o.chatter.social} · Not work-related {o.chatter.notWork}</p>
                    <p>Unsorted: {unsorted.length ? unsorted.map(([k, n]) => unsortedCount(n, k, c.clientName)).join(", ") : "0"} · not placed {o.notPlaced}</p>
                    <p className="muted">My marks: This is work {c.marks.thisIsWork} · moved {c.marks.movedByMe} · Not work-related {c.marks.notWorkConversations}</p>
                  </li>
                );
              })}
            </ul>
          )}
          <textarea ref={area} className="dx-copy" readOnly value={text} aria-label="Diagnostics as text" rows={4} />
        </>
      )}
    </section>
  );
}
