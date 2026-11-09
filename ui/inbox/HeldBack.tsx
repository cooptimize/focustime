// GD-2 Part 2: the held-back list. Messages that name another client in a chat with people outside Cooptimize wait
// here, never sent to AI. Each shows its chat, sender, time, the client it names (only to people in that chat, which is
// who can list it) and the message as Teams shows it. Sort for <client> by hand (into an open conversation or a new
// one, no AI), Not work-related (to Chatter), or Leave held (nothing changes; retention purges it as any message).
// GD-3: each row says what it matched, with the word marked in the message; the bulk actions sit at the top, one line
// per client, each behind a confirm that shows the count.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { HeldData, HeldMessage } from "../../plan/conversation-views.ts";
import { HELD_LINE } from "../../plan/boundary.ts";
import { HELD_STAYS } from "../../plan/conversations.ts";
import { call } from "../api.ts";
import { Stamp } from "../Stamp.tsx";

const n = (c: number) => (c === 1 ? "1 message" : `${c} messages`);

export function HeldBack({ count, tz, today, onChanged }: { count: number; tz: string; today?: string; onChanged: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HeldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call<HeldData>("conversations.held", {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read them");
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  // Stays while open, so "Nothing held back now." is there to read after the last one goes.
  if (!count && !open && !data?.messages.length) return null;
  const done = async (action: string, input: unknown) => {
    try {
      await call(action, input);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  return (
    <section className="held-back" aria-label="Held back">
      <button type="button" className="mini held-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {n(count)} held back {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="held-list">
          <p className="muted held-why">{HELD_LINE} {HELD_STAYS} Sorting by hand sends nothing to AI.</p>
          {error && <p className="error" role="alert">{error}</p>}
          {data && !data.messages.length && <p className="muted">Nothing held back now.</p>}
          {!!data?.clients.length && (
            <div className="held-bulk">
              {data.clients.map((c) => (
                <BulkLine key={c.clientKey} client={c} act={done} />
              ))}
            </div>
          )}
          <ul>
            {data?.messages.map((m) => (
              <HeldRow key={`${m.chatId}:${m.messageId}`} m={m} tz={tz} today={today} conversations={data.conversations[m.chatId] ?? []} act={done} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** GD-3: one client's bulk actions; each asks first, with the count it will act on. */
function BulkLine({ client, act }: { client: HeldData["clients"][number]; act: (action: string, input: unknown) => Promise<void> }): ReactNode {
  const [asking, setAsking] = useState<"sort" | "not_work" | null>(null);
  const { clientKey, clientName, count } = client;
  const run = async (mode: "sort" | "not_work") => {
    setAsking(null);
    await act("conversations.held_bulk", { clientKey, mode, count });
  };
  if (asking)
    return (
      <div className="held-bulk-line" role="group" aria-label={`Confirm for ${clientName}`}>
        <p className="held-bulk-ask">
          {asking === "sort" ? `Sort ${n(count)} for ${clientName} by hand? Each chat's go into one new conversation. Nothing is sent to AI.` : `Mark ${n(count)} for ${clientName} not work-related? They move to Chatter.`}
        </p>
        <p className="held-acts">
          <button type="button" className="mini primary" onClick={() => void run(asking)}>
            {asking === "sort" ? `Sort ${n(count)}` : `Mark ${n(count)}`}
          </button>
          <button type="button" className="mini quiet" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </p>
      </div>
    );
  return (
    <div className="held-bulk-line">
      <strong>
        {clientName} · {count}
      </strong>
      <p className="held-acts">
        <button type="button" className="mini" onClick={() => setAsking("sort")}>
          Sort all for {clientName} by hand
        </button>
        <button type="button" className="mini" onClick={() => setAsking("not_work")}>
          Mark all not work-related
        </button>
      </p>
    </div>
  );
}

function HeldRow({ m, tz, today, conversations, act }: { m: HeldMessage; tz: string; today?: string | undefined; conversations: { id: number; title: string }[]; act: (action: string, input: unknown) => Promise<void> }): ReactNode {
  const [sorting, setSorting] = useState(false);
  const [to, setTo] = useState<string>(conversations[0] ? String(conversations[0].id) : "new");
  const [left, setLeft] = useState(false);
  return (
    <li className={`held-row${left ? " left" : ""}`}>
      <p className="held-meta">
        <strong>{m.chatName}</strong>
        <span>{m.author}</span>
        <Stamp at={m.at} tz={tz} today={today} />
        <span className={`ib-tag mention-tag ${m.matched.length ? "tone-soon" : "held-unknown"}`}>{m.reason}</span>
      </p>
      {/* The server's sanitized message HTML (messageView), as the Inbox shows every message. */}
      <div className="conv-msg-body held-text" dangerouslySetInnerHTML={{ __html: m.html }} />
      {sorting ? (
        <p className="held-acts">
          <label>
            <span className="sr-only">Conversation</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {conversations.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.title || "(no title)"}
                </option>
              ))}
              <option value="new">A new conversation</option>
            </select>
          </label>
          <button type="button" className="mini primary" onClick={() => void act("conversations.move", { chatId: m.chatId, messageId: m.messageId, to: to === "new" ? "new" : Number(to) })}>
            Sort here
          </button>
          <button type="button" className="mini quiet" onClick={() => setSorting(false)}>
            Cancel
          </button>
        </p>
      ) : (
        <p className="held-acts">
          <button type="button" className="mini" onClick={() => setSorting(true)}>
            Sort for {m.clientName} by hand
          </button>
          <button type="button" className="mini" onClick={() => void act("conversations.held_not_work", { chatId: m.chatId, messageId: m.messageId })}>
            Not work-related
          </button>
          <button type="button" className="mini quiet" onClick={() => setLeft(true)} disabled={left}>
            {left ? "Left held" : "Leave held"}
          </button>
        </p>
      )}
    </li>
  );
}
