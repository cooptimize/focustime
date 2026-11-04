// T-2 and AP-1: Settings > Clients, a client's Delivery chats: every Teams group chat registered for it (several are
// fine; a chat belongs to one client), each labelled Delivery team or Customer collaboration (suggested from its
// members, changeable), with its members (external people flagged by tenant), the count, a warning when the members
// don't fit the label, Open in Teams and Remove. Add a chat opens the picker (search, arrows, Enter, Esc). Saved as
// soon as it changes. Members are read again once a day when the Clients section opens, and on Refresh.
// AP-1: each chat's Read for asks switch (off by default). The first time, Microsoft asks the person to allow Chat.Read
// (D490): FocusTime goes there and back, then switches it on. Delete stored messages forgets a client's chat text.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activityOf, CHAT_KINDS, chatName, filterChats, KIND_HINT, KIND_NAME, memberLine, nameOf, suggestKind, type ChatKind, type ChatPickerData, type ChatsData, type ChatSummary, type DeliveryChatView } from "../../plan/chats.ts";
import { ActionRefusal, call } from "../api.ts";
import type { AsksData } from "../../plan/asks.ts";

/** AP-1: the chat waiting for the Chat.Read consent to come back (this tab only). */
const CONSENT_KEY = "focustime.asksConsent";
const consentUrl = "/auth/microsoft/login?consent=chat_read";
const readPending = () => {
  try {
    return sessionStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
};
const writePending = (chatId: string | null) => {
  try {
    if (chatId) sessionStorage.setItem(CONSENT_KEY, chatId);
    else sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    // Private windows: the switch then needs a second click after coming back.
  }
};

type Chats = {
  data: ChatsData | null;
  loading: boolean;
  problem: string | null;
  run: (action: string, input: unknown) => Promise<boolean>;
  picker: () => Promise<ChatPickerData>;
  /** AP-1: Read for asks on or off; on may go to Microsoft first. Returns a line to show. */
  asks: (chatId: string, on: boolean) => Promise<string | null>;
};
const Ctx = createContext<Chats | null>(null);

/** One load for the whole Clients section: the registered chats, their members read again from Teams. */
export function DeliveryChatsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ChatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const pickerData = useRef<Promise<ChatPickerData> | null>(null);
  const run = useCallback(async (action: string, input: unknown) => {
    setLoading(true);
    try {
      setData(await call<ChatsData>(action, input));
      setProblem(null);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Not saved");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  const asks = useCallback(async (chatId: string, on: boolean): Promise<string | null> => {
    setLoading(true);
    try {
      await call("asks.switch", { chatId, on });
      setData(await call<ChatsData>("chats.registered", {}));
      setProblem(null);
      return on ? "Reading for asks from now on" : "Not read for asks";
    } catch (e) {
      if (e instanceof ActionRefusal && e.code === "consent") {
        // Microsoft asks once; FocusTime comes back here and switches it on.
        writePending(chatId);
        window.location.assign(consentUrl);
        return "Opening Microsoft to allow it…";
      }
      setProblem(e instanceof Error ? e.message : "Not saved");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void run("chats.registered", { refresh: true }).then(async () => {
      // Back from the Chat.Read consent: switch on the chat that asked for it (once).
      const pending = readPending();
      if (!pending) return;
      writePending(null);
      const back = new URL(window.location.href);
      if (back.searchParams.has("allowed")) {
        back.searchParams.delete("allowed");
        window.history.replaceState(window.history.state, "", back.toString());
      }
      try {
        await call("asks.switch", { chatId: pending, on: true });
        setData(await call<ChatsData>("chats.registered", {}));
      } catch (e) {
        setProblem(e instanceof ActionRefusal && e.code === "consent" ? "Microsoft didn't allow FocusTime to read chat messages, so Read for asks stays off." : e instanceof Error ? e.message : "Not saved");
      }
    });
  }, [run]);
  const picker = useCallback(() => {
    pickerData.current ??= call<ChatPickerData>("chats.list", {}).catch((e) => {
      pickerData.current = null;
      throw e;
    });
    return pickerData.current;
  }, []);
  const value = useMemo(() => ({ data, loading, problem, run, picker, asks }), [data, loading, problem, run, picker, asks]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const ACCESS: Record<NonNullable<ChatsData["reason"]>, string> = {
  signed_out: "Sign in with Microsoft to pick a chat.",
  consent: "FocusTime isn't allowed to read your Teams chat names and members yet. It needs the Microsoft permission Chat.ReadBasic: see Settings > Connections.",
  unavailable: "Teams couldn't be reached. Refresh to try again.",
};

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

/** A client's Delivery chats: every Teams chat registered for it, each labelled with its kind, and Add a chat. */
export function DeliveryChatField({ clientKey, clientName }: { clientKey: string; clientName: string }) {
  const ctx = useContext(Ctx);
  const [saved, setSaved] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  if (!ctx) return null;
  const mine = (ctx.data?.chats ?? []).filter((c) => c.clientKey === clientKey);
  const focusAdd = () => requestAnimationFrame(() => addRef.current?.focus());
  const act = async (action: string, input: unknown, done: string) => {
    setSaved(null);
    const ok = await ctx.run(action, input);
    if (ok) setSaved(done);
    return ok;
  };
  return (
    <div className="set-field dchat" role="group" aria-label={`Delivery chats for ${clientName}`}>
      <div className="dchat-head">
        <span className="set-label">Delivery chats</span>
        <span className="muted dchat-hint">Teams group chats for {clientName}. Names and members; messages only from a chat you read for asks.</span>
        {mine.length > 0 && (
          <button type="button" className="mini quiet" disabled={ctx.loading} onClick={() => void act("chats.refresh", { clientKey }, "Members read again")}>
            {ctx.loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
        <span className="set-mark" role="status" aria-live="polite">{saved}</span>
      </div>
      {mine.length === 0 && !picking && <p className="muted dchat-none">No chats yet.</p>}
      {mine.map((c) => (
        <ChatCard
          key={c.chatId}
          c={c}
          busy={ctx.loading}
          onKind={(kind) => void act("chats.kind", { chatId: c.chatId, kind }, `Marked as ${KIND_NAME[kind]}`)}
          onRemove={() => void act("chats.remove", { chatId: c.chatId }, `Removed ${c.displayName}`).then(focusAdd)}
          onAsks={(on) => void ctx.asks(c.chatId, on).then((line) => line && setSaved(line))}
        />
      ))}
      {mine.length > 0 && (
        <button
          type="button"
          className="mini quiet dchat-purge"
          disabled={ctx.loading}
          onClick={() => {
            if (!window.confirm(`Delete every chat message and ask FocusTime stored for ${clientName}? DevOps items made from asks stay.`)) return;
            setSaved(null);
            void call<{ purged: number }>("asks.purge", { clientKey }).then(
              (r) => setSaved(r.purged ? `Deleted ${r.purged} stored ${r.purged === 1 ? "message" : "messages"}` : "Nothing stored"),
              (e: unknown) => setSaved(e instanceof Error ? e.message : "Not deleted"),
            );
          }}
        >
          Delete stored messages
        </button>
      )}
      {picking ? (
        <ChatPicker
          clientName={clientName}
          registered={(ctx.data?.chats ?? []).map((c) => c.chatId)}
          load={ctx.picker}
          onPick={async (c) => {
            setPicking(false);
            await act("chats.add", { clientKey, chatId: c.id }, `Added ${chatName(c)}`);
            focusAdd();
          }}
          onClose={() => {
            setPicking(false);
            focusAdd();
          }}
        />
      ) : (
        // Never disabled: the picker reads Teams on its own, so it opens while the saved chats still load.
        <button ref={addRef} type="button" className="mini dchat-add" onClick={() => setPicking(true)}>
          Add a chat
        </button>
      )}
      {ctx.problem && <p className="field-problem" role="alert">{ctx.problem}</p>}
    </div>
  );
}

function ChatCard({ c, busy, onKind, onRemove, onAsks }: { c: DeliveryChatView; busy: boolean; onKind: (k: ChatKind) => void; onRemove: () => void; onAsks: (on: boolean) => void }) {
  return (
    <div className="dchat-card" role="region" aria-label={c.displayName}>
      <div className="dchat-title">
        <strong>{c.displayName}</strong>
        <select className="dchat-kind" aria-label={`Kind of chat for ${c.displayName}`} value={c.kind} disabled={busy} onChange={(e) => onKind(e.target.value as ChatKind)} title={KIND_HINT[c.kind]}>
          {CHAT_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_NAME[k]}</option>
          ))}
        </select>
        <a className="mini link-btn" href={c.link} target="_blank" rel="noopener noreferrer">Open in Teams</a>
        <button type="button" className="mini quiet" disabled={busy} onClick={onRemove} aria-label={`Remove ${c.displayName}`}>Remove</button>
      </div>
      {c.warning && <p className="dchat-warn" role="note">{c.warning}</p>}
      {c.members ? (
        <details className="dchat-members">
          <summary>
            {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
            {c.externalCount ? <> · <span className="dchat-ext-count">{c.externalCount} external</span></> : " · no external people"}
            {c.fetchedAt && <span className="muted"> · as of {timeOf(c.fetchedAt)}</span>}
          </summary>
          <ul>
            {c.members.map((m, i) => (
              <li key={m.userId ?? `${i}`}>
                <span>{nameOf(m)}</span>
                {m.email && <span className="muted">{m.email}</span>}
                {m.external && <span className="dchat-ext" title={m.guest ? "A guest in this chat" : m.tenantId ? "From another organization (tenant)" : "Tenant unknown, so not shown as Cooptimize"}>External</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="muted">Members not read yet. Refresh to read them.</p>
      )}
      {c.error && <p className="field-problem">{c.error}</p>}
      <label className="set-check dchat-asks">
        <input type="checkbox" role="switch" checked={c.asks.on} disabled={busy} onChange={(e) => onAsks(e.target.checked)} aria-describedby={`asks-${c.chatId}`} />
        Read for asks
      </label>
      <span id={`asks-${c.chatId}`} className="set-hint">
        {c.asks.on
          ? c.asks.status ?? (c.asks.polledAt ? `Last read ${timeOf(c.asks.polledAt)}. New messages from outside Cooptimize that ask for something show in Inbox › Asks.` : "On. Read every few minutes in your working hours, from now on.")
          : "Off. Nothing in this chat is read. On: new messages are read every few minutes in your working hours (no history), and questions or requests from outside Cooptimize show in Inbox › Asks. Nothing is posted."}
      </span>
    </div>
  );
}

/** My group chats: type to search, arrows to move, Enter to add, Esc to close. Most recently active first. */
function ChatPicker({ clientName, registered, load, onPick, onClose }: { clientName: string; registered: string[]; load: () => Promise<ChatPickerData>; onPick: (c: ChatSummary) => void; onClose: () => void }) {
  const [data, setData] = useState<ChatPickerData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useRef(`dchat-list-${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    input.current?.focus();
    load().then(setData, (e) => setProblem(e instanceof Error ? e.message : "Couldn't read your chats"));
  }, [load]);
  const home = data?.homeTenant ?? null;
  // A chat already registered (for any client) isn't offered again.
  const list = useMemo(() => (data ? filterChats(data.chats, q, new Set(registered)) : []), [data, q, registered]);
  useEffect(() => setAt(0), [q]);
  const pick = (i: number) => list[i] && onPick(list[i]);
  return (
    <div className="dchat-picker" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <input
        ref={input}
        type="search"
        value={q}
        placeholder={`Search your group chats to add to ${clientName}`}
        aria-label="Search your Teams group chats"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={list[at] ? `${listId}-${at}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(i + 1, list.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(i - 1, 0)));
          else if (e.key === "Enter") (e.preventDefault(), pick(at));
        }}
      />
      <button type="button" className="mini quiet" onClick={onClose}>Cancel</button>
      {problem && <p className="field-problem">{problem}</p>}
      {!data && !problem && <p className="muted">Reading your Teams group chats…</p>}
      {data && !data.available && <p className="field-problem">{ACCESS[data.reason ?? "unavailable"]}</p>}
      {data?.available && (
        <ul id={listId} role="listbox" className="dchat-options" aria-label="Your Teams group chats">
          {list.length === 0 && <li className="muted">{q ? "No group chat matches." : "No group chats left to add."}</li>}
          {list.slice(0, 50).map((c, i) => (
            <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === at} className={i === at ? "on" : undefined} onMouseEnter={() => setAt(i)} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
              <strong>
                {chatName(c)} {home && <span className={`dchat-fit${suggestKind(c.members, home) === "customer" ? " fits" : ""}`}>{suggestKind(c.members, home) === "delivery" ? "Internal" : "With the client"}</span>}
              </strong>
              <span className="muted">
                {home ? memberLine(c.members, home, c.moreMembers) : `${c.members.length} members`}
                {activityOf(c) && ` · active ${dayOf(activityOf(c))}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings > Connections: every permission FocusTime asks Microsoft for, with its state. */
export function MicrosoftPermissions() {
  type Row = { scope: string; api: string; why: string; admin: boolean; later?: string; state: "granted" | "needs_consent" | "needs_admin" | "missing" | "signed_out" | "unknown" };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    setProblem(null);
    call<{ signedIn: boolean; rows: Row[] }>("permissions.status", {}).then((d) => setRows(d.rows), (e) => setProblem(e instanceof Error ? e.message : "Couldn't check"));
  }, []);
  useEffect(load, [load]);
  const STATE: Record<Row["state"], [string, string]> = {
    granted: ["Allowed", "live"],
    needs_consent: ["Not allowed yet", "cached"],
    needs_admin: ["Needs admin consent", "error"],
    missing: ["Missing", "muted"],
    signed_out: ["Signed out", "muted"],
    unknown: ["Couldn't check", "muted"],
  };
  const admin = rows?.filter((r) => r.state === "needs_admin" || (r.state === "needs_consent" && r.admin)) ?? [];
  return (
    <>
      <h3>Microsoft permissions</h3>
      <p className="muted">Every permission FocusTime asks Microsoft for, on your one sign-in. Read only unless it says so.</p>
      {problem && <p className="field-problem">{problem}</p>}
      {rows && (
        <ul className="set-list sources perms">
          {rows.map((r) => (
            <li key={`${r.api}:${r.scope}`} className={`source ${STATE[r.state][1]}`}>
              <span className="dot" aria-hidden="true" />
              <strong><code>{r.scope}</code></strong>
              <span className={`state ${STATE[r.state][1]}`}>{STATE[r.state][0]}</span>
              <span className="muted">{r.why}{r.api !== "Microsoft Graph" ? ` (${r.api})` : ""}{r.admin ? " · admin consent" : ""}{r.state === "missing" && r.later ? `. ${r.later}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {admin.length > 0 && (
        <p className="set-problem" role="status">
          An admin must allow {admin.map((r) => r.scope).join(", ")} for the Cooptimize tenant (Entra admin center › App registrations › FocusTime › API permissions › Grant admin consent).
        </p>
      )}
      {rows?.some((r) => r.state === "needs_consent" && !r.admin) && (
        <p className="muted">Not allowed yet: sign out and sign in again to allow it, or ask your FocusTime admin to allow it for everyone.</p>
      )}
      <button type="button" className="mini perms-again" onClick={load}>Check again</button>
    </>
  );
}

/** AP-1: Settings > Connections: one line per chat read for asks, with its last read or its problem. One failing chat never hides the others. */
export function AsksConnections() {
  const [d, setD] = useState<AsksData | null>(null);
  useEffect(() => {
    let live = true;
    void call<AsksData>("asks.list", {}).then((x) => live && setD(x), () => undefined);
    return () => void (live = false);
  }, []);
  if (!d || !d.chats.length) return null;
  return (
    <section className="set-asks-conn" aria-label="Chats read for asks">
      <h3>Chats read for asks</h3>
      <ul className="set-sources">
        {d.chats.map((c) => (
          <li key={c.chatId} className={c.status ? "problem" : ""}>
            <strong>{c.clientName}</strong> · {c.chatName}{" "}
            <span className={c.status ? "field-problem" : "muted"}>{c.status ?? (c.polledAt ? `read ${timeOf(c.polledAt)}` : "not read yet (only in your working hours)")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
