// T-2: Settings > Clients, "Delivery chat" on each client: the Teams group chats registered for it (the first is the
// primary), each with its members (external people flagged by tenant), the count and Open in Teams; a picker of my
// group chats (search, arrows, Enter) to add one; Clear and Make primary. Saved as soon as it changes. Members are read
// again when the Clients section opens and on Refresh, never on a timer. No messages anywhere.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { activityOf, chatName, filterChats, memberLine, nameOf, type ChatPickerData, type ChatsData, type ChatSummary, type DeliveryChatView } from "../../plan/chats.ts";
import { call } from "../api.ts";

type Chats = {
  data: ChatsData | null;
  loading: boolean;
  problem: string | null;
  run: (action: string, input: unknown) => Promise<boolean>;
  picker: () => Promise<ChatPickerData>;
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
  useEffect(() => {
    void run("chats.registered", { refresh: true });
  }, [run]);
  const picker = useCallback(() => {
    pickerData.current ??= call<ChatPickerData>("chats.list", {}).catch((e) => {
      pickerData.current = null;
      throw e;
    });
    return pickerData.current;
  }, []);
  const value = useMemo(() => ({ data, loading, problem, run, picker }), [data, loading, problem, run, picker]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const ACCESS: Record<NonNullable<ChatsData["reason"]>, string> = {
  signed_out: "Sign in with Microsoft to pick a chat.",
  consent: "FocusTime isn't allowed to read your Teams chat names and members yet. It needs the Microsoft permission Chat.ReadBasic: see Settings > Connections.",
  unavailable: "Teams couldn't be reached. Refresh to try again.",
};

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

/** The "Delivery chat" field of one client. */
export function DeliveryChatField({ clientKey, clientName }: { clientKey: string; clientName: string }) {
  const ctx = useContext(Ctx);
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  if (!ctx) return null;
  const mine = (ctx.data?.chats ?? []).filter((c) => c.clientKey === clientKey);
  const act = async (action: string, input: unknown, done: string) => {
    setSaved(null);
    if (await ctx.run(action, input)) setSaved(done);
  };
  return (
    <div className="set-field dchat" role="group" aria-label={`Delivery chat for ${clientName}`}>
      <div className="dchat-head">
        <span className="set-label">Delivery chat</span>
        {mine.length > 0 && (
          <button type="button" className="mini quiet" disabled={ctx.loading} onClick={() => void act("chats.refresh", { clientKey }, "Members read again")}>
            {ctx.loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
        <span className="set-mark" role="status" aria-live="polite">{saved}</span>
      </div>
      {mine.length === 0 && !picking && <p className="muted dchat-none">No chat yet. Pick the Teams group chat you and {clientName} work in.</p>}
      {mine.map((c) => (
        <ChatCard key={c.chatId} c={c} busy={ctx.loading} onPrimary={() => void act("chats.primary", { chatId: c.chatId }, "Saved")} onClear={() => void act("chats.remove", { chatId: c.chatId }, "Cleared").then(() => addRef.current?.focus())} />
      ))}
      {picking ? (
        <ChatPicker
          clientName={clientName}
          registered={(ctx.data?.chats ?? []).map((c) => c.chatId)}
          load={ctx.picker}
          onPick={async (chat) => {
            setPicking(false);
            await act("chats.add", { clientKey, chatId: chat.id }, mine.length ? "Added" : "Saved as the primary chat");
            addRef.current?.focus();
          }}
          onClose={() => {
            setPicking(false);
            requestAnimationFrame(() => addRef.current?.focus());
          }}
        />
      ) : (
        <button ref={addRef} type="button" className="mini" disabled={ctx.loading && !ctx.data} onClick={() => setPicking(true)}>
          {mine.length ? "Add another chat" : "Pick a chat"}
        </button>
      )}
      {ctx.problem && <p className="field-problem" role="alert">{ctx.problem}</p>}
    </div>
  );
}

function ChatCard({ c, busy, onPrimary, onClear }: { c: DeliveryChatView; busy: boolean; onPrimary: () => void; onClear: () => void }) {
  return (
    <div className={`dchat-card${c.primary ? " primary" : ""}`}>
      <div className="dchat-title">
        <strong>{c.displayName}</strong>
        {c.primary ? <span className="dchat-badge">Primary</span> : (
          <button type="button" className="mini quiet" disabled={busy} onClick={onPrimary}>Make primary</button>
        )}
        <a className="mini link-btn" href={c.link} target="_blank" rel="noopener noreferrer">Open in Teams</a>
        <button type="button" className="mini quiet" disabled={busy} onClick={onClear} aria-label={`Clear ${c.displayName}`}>Clear</button>
      </div>
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
                {m.external && <span className="dchat-ext" title={m.tenantId ? "From another organization (tenant)" : "Tenant unknown, so not shown as Cooptimize"}>External</span>}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="muted">Members not read yet. Refresh to read them.</p>
      )}
      {c.error && <p className="field-problem">{c.error}</p>}
    </div>
  );
}

/** My group chats: type to search, arrows to move, Enter to pick, Esc to close. */
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
  // A chat already registered (for any client, mine included) isn't offered again: one chat, one client.
  const list = useMemo(() => (data ? filterChats(data.chats, q, new Set(registered)) : []), [data, q, registered]);
  useEffect(() => setAt(0), [q]);
  const home = data?.homeTenant ?? null;
  const pick = (i: number) => list[i] && onPick(list[i]);
  return (
    <div className="dchat-picker" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <input
        ref={input}
        type="search"
        value={q}
        placeholder={`Search your group chats for ${clientName}`}
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
          {list.length === 0 && <li className="muted">{q ? "No group chat matches." : "No group chats left to pick."}</li>}
          {list.slice(0, 50).map((c, i) => (
            <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === at} className={i === at ? "on" : undefined} onMouseEnter={() => setAt(i)} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
              <strong>{chatName(c)}</strong>
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
  type Row = { scope: string; api: string; why: string; admin: boolean; state: "granted" | "needs_consent" | "needs_admin" | "signed_out" | "unknown" };
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
              <span className="muted">{r.why}{r.api !== "Microsoft Graph" ? ` (${r.api})` : ""}{r.admin ? " · admin consent" : ""}</span>
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
