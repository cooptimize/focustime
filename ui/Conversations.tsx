// CV-1: Inbox › Conversations. What my clients' registered chats are talking about, one card per topic, kept by the
// shared pipeline for everyone on the chat: Needs you (new ones on my clients, ones that mention me, ones I own or
// committed to, unclaimed ones on clients I lead), Handled by teammates (collapsed, one line each) and Closed. A card:
// title, client and chat, who's in it, last activity, a 2 to 4 line summary, one status (New, In discussion, <Name>
// committed, Tracked #id, Resolved, Closed; amber Waiting on <Name>), "Updated" when it changed since I looked, and
// one primary action (Create item, Link, Resolve, Take it over) with the rest under ⋯. Show messages renders the
// messages as Teams showed them (sanitized on the server; mentions as chips, images as "Image attached"), collapsed by
// height without cutting a table row. Keys: J and K move, Enter the primary action, X messages, R resolve. Nothing is
// posted in Teams. Chat text shows only on its own client's card.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { ConversationCard, ConversationMessage, ConversationsData } from "../plan/conversation-views.ts";
import type { ItemDraft } from "../plan/conversations.ts";
import { pathOfAction } from "../plan/conversation-draft.ts";
import { userZone } from "../week/zone.ts";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { Fading } from "./FollowUps.tsx";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "./keys.ts";
import { clientColor, whenText } from "./labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const PRIMARY_WORD = { create: "Create item", link: "Link", resolve: "Resolve", take_over: "Take it over", reopen: "Open again" } as const;

export type InboxTab = "inbox" | "conversations" | "my_promises";
/** The Inbox's tabs: Inbox, Conversations and My promises, each with its count (hidden at none). */
export function InboxTabs({ tab, count, promiseCount = null, onPick }: { tab: InboxTab; count: number | null; promiseCount?: number | null; onPick: (tab: InboxTab) => void }) {
  const one = (id: InboxTab, label: string, n: number | null) => (
    <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => onPick(id)}>
      {label}
      {n ? <span className="tab-count" aria-label={`${n} open`}>{n}</span> : null}
    </button>
  );
  return (
    <div className="inbox-tabs" role="tablist" aria-label="Inbox">
      {one("inbox", "Inbox", null)}
      {one("conversations", "Conversations", count)}
      {one("my_promises", "My promises", promiseCount)}
    </div>
  );
}

/** Needs you and my open promises, for the tabs: read when the Inbox opens and after changes. */
export function useConversationCount(version: number, enabled: boolean): [number | null, (n: number) => void, number | null, (n: number) => void] {
  const [count, setCount] = useState<number | null>(null);
  const [promises, setPromises] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void call<ConversationsData>("conversations.list", {}).then((d) => live && (setCount(d.needsYou.length), setPromises(d.myPromisesOpen)), () => undefined);
    return () => void (live = false);
  }, [version, enabled]);
  return [count, setCount, promises, setPromises];
}

export function Conversations({ data, version, onCount, onPromiseCount, onChanged, openSettings }: { data: WeekLoadData; version: number; onCount: (n: number) => void; onPromiseCount?: (n: number) => void; onChanged?: () => void; openSettings: (section: string) => void }) {
  const [state, setState] = useState<ConversationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [busy, setBusy] = useState<"refresh" | "sort" | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ id: number; kind: "link" | "not_request" | "draft"; commitmentId?: number } | null>(null);
  const [teammatesOpen, setTeammatesOpen] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const writes = useDevOpsWrite();
  const tz = userZone(data);
  const clearNotice = useCallback(() => setNotice(null), []);
  const show = useCallback(
    (d: ConversationsData) => {
      setState(d);
      onCount(d.needsYou.length);
      onPromiseCount?.(d.myPromisesOpen);
    },
    [onCount, onPromiseCount],
  );
  const load = useCallback(async () => {
    try {
      show(await call<ConversationsData>("conversations.list", {}));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [show]);
  useEffect(() => void load(), [load, version, writes?.version]);
  useEffect(() => head.current?.focus(), []);

  const run = async (action: string, input: Record<string, unknown>, done?: ReactNode) => {
    try {
      show(await call<ConversationsData>(action, input));
      setError(null);
      setForm(null);
      if (done) setNotice(done);
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    }
  };
  const order = useMemo(() => [...(state?.needsYou ?? []), ...(teammatesOpen ? (state?.teammates ?? []) : []), ...(closedOpen ? (state?.closed ?? []) : [])], [state, teammatesOpen, closedOpen]);
  const current = order.find((c) => c.id === sel) ?? state?.needsYou[0] ?? null;

  const resolve = (c: ConversationCard) =>
    void run("conversations.resolve", { id: c.id }, (
      <>
        Resolved for everyone on the chat.{" "}
        <button type="button" className="mini quiet" onClick={() => void run("conversations.reopen", { id: c.id }, "Open again")}>
          Undo
        </button>
      </>
    ));
  const primary = (c: ConversationCard) => {
    if (c.primary === "resolve") return resolve(c);
    if (c.primary === "reopen") return void run("conversations.reopen", { id: c.id }, "Open again");
    if (c.primary === "link") return setForm({ id: c.id, kind: "link" });
    if (c.primary === "take_over") {
      const k = c.commitments.find((x) => x.state === "open" && x.impliesItem && !x.mine);
      return k ? void run("conversations.take_over", { commitmentId: k.id }, `It's yours now. ${k.whoName.split(" ")[0]} is told quietly.`) : undefined;
    }
    if (c.primary === "create") {
      if (!c.canCreate || !writes) return setNotice(`Add DevOps write access for ${c.clientName} in Settings`);
      const mine = c.commitments.find((x) => x.mine && x.state === "open" && x.impliesItem);
      setForm({ id: c.id, kind: "draft", ...(mine ? { commitmentId: mine.id } : {}) });
    }
  };
  const toggle = (c: ConversationCard) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(c.id)) n.delete(c.id);
      else {
        n.add(c.id);
        if (c.updated) void call("conversations.seen", { id: c.id }).catch(() => {});
      }
      return n;
    });

  // Keys (only here, not while typing or behind a dialog): J/K move, Enter primary, X messages, R resolve.
  const keys = useRef({ order, current, primary, toggle, resolve, form });
  keys.current = { order, current, primary, toggle, resolve, form };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      const k = keys.current;
      if (k.form) return;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        if (!k.order.length) return;
        const i = k.current ? k.order.indexOf(k.current) : -1;
        const next = k.order[Math.max(0, Math.min(k.order.length - 1, i + (key === "j" ? 1 : -1)))]!;
        setSel(next.id);
        document.querySelector<HTMLElement>(`.conv-card[data-conv="${next.id}"]`)?.focus();
        e.preventDefault();
        return;
      }
      if (!k.current) return;
      if (key === "enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) (k.primary(k.current), e.preventDefault());
      else if (key === "x") (k.toggle(k.current), e.preventDefault());
      else if (key === "r" && !k.current.closed) (k.resolve(k.current), e.preventDefault());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const card = (c: ConversationCard, compact = false) => (
    <ConvCard
      key={c.id}
      c={c}
      tz={tz}
      color={clientColor(c.clientKey, data.clients)}
      compact={compact}
      selected={current?.id === c.id}
      expanded={expanded.has(c.id)}
      onSelect={() => setSel(c.id)}
      onToggle={() => toggle(c)}
      onPrimary={() => primary(c)}
      onRun={run}
      form={form?.id === c.id ? form : null}
      onForm={(f) => setForm(f ? { id: c.id, ...f } : null)}
      onEnable={() => openSettings("clients")}
      onSuggestion={(s, include) => {
        if (!writes) return setNotice(`Add DevOps write access for ${c.clientName} in Settings`);
        void writes.begin(c.clientKey, [s.kind === "comment" ? { kind: "conversation_comment", suggestionId: s.id, ...(include ? { includeInternal: true } : {}) } : { kind: "description_update", suggestionId: s.id }]);
      }}
      onCreate={(change) => {
        if (!writes) return;
        setForm(null);
        void writes.begin(c.clientKey, [change]);
      }}
    />
  );

  return (
    <main className="inbox conversations" aria-label="Conversations">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Conversations {state && state.needsYou.length > 0 && <span className="muted">{state.needsYou.length} need you</span>}
        </h2>
        <button type="button" className="mini" aria-label="Refresh conversations" title="Read your clients' registered chats now (only new messages)" disabled={!!busy} onClick={async () => {
          setBusy("refresh");
          await run("conversations.refresh", {});
          setBusy(null);
        }}>
          {busy === "refresh" ? "Reading Teams…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <Fading text={notice} onGone={clearNotice} ms={8000} />
      {state && state.unsorted.count > 0 && (
        <p className="conv-unsorted" role="status">
          {state.unsorted.count} {state.unsorted.count === 1 ? "message waits" : "messages wait"} to be sorted: {state.unsorted.reasons.map((r) => r.text).join("; ")}.{" "}
          <button type="button" className="mini" disabled={!!busy} onClick={async () => {
            setBusy("sort");
            await run("conversations.sort_unsorted", {});
            setBusy(null);
          }}>
            {busy === "sort" ? "Sorting…" : `Sort unsorted (${state.unsorted.count})`}
          </button>
        </p>
      )}
      {state && state.needsYou.length === 0 && (
        <div className="asks-empty">
          <p>Nothing needs you</p>
          {state.needsYou.length + state.teammates.length + state.closed.length === 0 && (
            <p className="muted">
              Conversations from your clients' registered Teams chats show here for everyone on the chat. A FocusTime admin adds a chat in{" "}
              <button type="button" className="linkish" onClick={() => openSettings("clients")}>
                Settings › Clients
              </button>
              .
            </p>
          )}
        </div>
      )}
      {state && state.needsYou.length > 0 && (
        <section aria-label="Needs you">
          <h3 className="conv-section">Needs you</h3>
          <ul className="conv-list">{state.needsYou.map((c) => card(c))}</ul>
        </section>
      )}
      {state && state.teammates.length > 0 && (
        <section aria-label="Handled by teammates" className="conv-fold">
          <button type="button" className="link-btn" aria-expanded={teammatesOpen} onClick={() => setTeammatesOpen((o) => !o)}>
            {teammatesOpen ? "▾" : "▸"} Handled by teammates ({state.teammates.length})
          </button>
          {teammatesOpen && <ul className="conv-list">{state.teammates.map((c) => card(c, true))}</ul>}
        </section>
      )}
      {state && state.closed.length > 0 && (
        <section aria-label="Closed" className="conv-fold">
          <button type="button" className="link-btn" aria-expanded={closedOpen} onClick={() => setClosedOpen((o) => !o)}>
            {closedOpen ? "▾" : "▸"} Closed ({state.closed.length})
          </button>
          {closedOpen && <ul className="conv-list">{state.closed.map((c) => card(c, true))}</ul>}
        </section>
      )}
      {state && state.hiddenCount > 0 && <p className="muted conv-hidden">{state.hiddenCount} hidden for you. Open one from its ⋯ in the chat's other cards, or ask a teammate.</p>}
      {state?.chatter.map((g) => <Chatter key={g.clientKey} g={g} tz={tz} color={clientColor(g.clientKey, data.clients)} onWork={(m) => void run("conversations.this_is_work", { chatId: m.chatId, messageId: m.messageId }, "Moved into its own conversation")} />)}
      {state?.lastPoll && <p className="requests-poll muted" role="status">Last checked {whenText(state.lastPoll, tz)} · every 5 minutes in working hours</p>}
    </main>
  );
}

type Suggest = ConversationCard["suggestions"][number];
function ConvCard(p: {
  c: ConversationCard; tz: string; color: string; compact: boolean; selected: boolean; expanded: boolean;
  onSelect: () => void; onToggle: () => void; onPrimary: () => void; onRun: (action: string, input: Record<string, unknown>, done?: ReactNode) => Promise<void>;
  form: { kind: "link" | "not_request" | "draft"; commitmentId?: number } | null; onForm: (f: { kind: "link" | "not_request" | "draft"; commitmentId?: number } | null) => void;
  onEnable: () => void; onSuggestion: (s: Suggest, includeInternal: boolean) => void; onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void;
}) {
  const { c } = p;
  const [menu, setMenu] = useState(false);
  const waiting = !!c.waiting;
  const style = { "--c": p.color } as CSSProperties;
  if (p.compact && !p.selected && !p.expanded) {
    return (
      <li className="conv-line" style={style} data-conv={c.id} tabIndex={-1} onFocus={p.onSelect} onClick={p.onSelect}>
        <span className="swatch" aria-hidden="true" />
        <span className="conv-line-title">{c.title}</span>
        <span className={`conv-status${waiting ? " waiting" : ""}`}>{c.statusLine}</span>
        <span className="muted">{c.clientName} · {whenText(c.lastAt, p.tz)}</span>
      </li>
    );
  }
  const more: { label: string; run: () => void; danger?: boolean }[] = [
    ...(c.primary !== "resolve" && !c.closed ? [{ label: "Resolve", run: () => void p.onRun("conversations.resolve", { id: c.id }, "Resolved") }] : []),
    ...(!c.closed ? [{ label: "Not a request…", run: () => p.onForm({ kind: "not_request" }) }] : []),
    ...(c.primary !== "link" && !c.item ? [{ label: "Link to an item…", run: () => p.onForm({ kind: "link" }) }] : []),
    ...(c.primary !== "create" && !c.item && c.canCreate ? [{ label: "Create item…", run: () => p.onForm({ kind: "draft" }) }] : []),
    { label: c.hidden ? "Show for me" : "Hide for me", run: () => void p.onRun("conversations.hide", { id: c.id, hidden: !c.hidden }, c.hidden ? "Shown again" : "Hidden for you. Nobody else's view changes") },
    ...(c.closed && c.primary !== "reopen" ? [{ label: "Open again", run: () => void p.onRun("conversations.reopen", { id: c.id }, "Open again") }] : []),
  ];
  return (
    <li className={`conv-card${p.selected ? " selected" : ""}${c.closed ? " resolved" : ""}`} style={style} data-conv={c.id} tabIndex={p.selected ? 0 : -1} aria-label={c.title} onFocus={p.onSelect} onClick={p.onSelect}>
      <div className="conv-head">
        <span className="swatch" aria-hidden="true" />
        <strong className="conv-title">{c.title}</strong>
        {c.updated && <span className="conv-updated" title={c.updated}>Updated</span>}
        <span className={`conv-status${waiting ? " waiting" : ""}`}>{c.statusLine}</span>
      </div>
      <p className="conv-sub muted">
        {c.clientName} · {c.chatName} · <time dateTime={c.lastAt}>{whenText(c.lastAt, p.tz)}</time>
        {c.internalChat && <span className="conv-internal">Internal chat</span>}
      </p>
      <p className="conv-people" aria-label="People in it">
        {c.participants.map((x) => (
          <span key={x.name} className={`conv-avatar${x.external ? " external" : ""}`} title={`${x.name}${x.external ? " (External)" : ""}`}>
            {initials(x.name)}
          </span>
        ))}
        {c.participants.some((x) => x.external) && <span className="ask-ext">External</span>}
      </p>
      <p className="conv-summary">
        {c.summary.split("\n").slice(0, 4).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </p>
      {c.item && (
        <p className="conv-item">
          Tracked as{" "}
          <a href={c.item.url ?? undefined} target="_blank" rel="noopener noreferrer">
            #{c.item.id} {c.item.title ?? ""}
          </a>
        </p>
      )}
      {c.likely && !c.item && (
        <p className="ask-likely">
          Looks like{" "}
          <a href={c.likely.url ?? undefined} target="_blank" rel="noopener noreferrer">
            #{c.likely.id} {c.likely.title ?? ""}
          </a>
        </p>
      )}
      {c.windDown && !c.closed && (
        <p className="conv-wind">
          Looks wrapped up. Resolve?{" "}
          <button type="button" className="mini" onClick={(e) => (e.stopPropagation(), void p.onRun("conversations.resolve", { id: c.id }, "Resolved"))}>
            Resolve <kbd>R</kbd>
          </button>
        </p>
      )}
      {c.closed && (
        <p className="ask-done">
          {c.closed.kind === "resolved" ? "Resolved" : "Not a request"} by {c.closed.by} · {whenText(c.closed.at, p.tz)}
          {c.closed.reason ? `: ${c.closed.reason}` : ""}
        </p>
      )}
      {c.suggestions.filter((s) => s.mine).map((s) => (
        <SuggestionBox key={s.id} s={s} onPost={(inc) => p.onSuggestion(s, inc)} onSkip={() => void p.onRun("suggestions.skip", { id: s.id }, "Skipped")} />
      ))}
      <div className="ask-actions">
        {c.primary && (
          <button type="button" className="mini primary" onClick={(e) => (e.stopPropagation(), p.onPrimary())}>
            {PRIMARY_WORD[c.primary]} {p.selected && <kbd>Enter</kbd>}
          </button>
        )}
        <button type="button" className="mini quiet" aria-expanded={p.expanded} onClick={(e) => (e.stopPropagation(), p.onToggle())}>
          {p.expanded ? "Hide messages" : "Show messages"} <kbd>X</kbd>
        </button>
        <a className="mini quiet" href={c.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          Open in Teams
        </a>
        <span className="fu-more">
          <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for: ${c.title}`} onClick={(e) => (e.stopPropagation(), setMenu((v) => !v))}>
            ⋯
          </button>
          {menu && (
            <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
              {more.map((m, i) => (
                <button key={m.label} type="button" role="menuitem" autoFocus={i === 0} onClick={(e) => (e.stopPropagation(), setMenu(false), m.run())}>
                  {m.label}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
      {p.form?.kind === "not_request" && <NotRequest onSave={(reason) => void p.onRun("conversations.not_request", { id: c.id, ...(reason ? { reason } : {}) }, "Moved to Closed for everyone on the chat")} onCancel={() => p.onForm(null)} />}
      {p.form?.kind === "link" && <ConvLink c={c} onPick={(id) => void p.onRun("conversations.link", { id: c.id, itemId: id }, `Linked to #${id}`)} onCancel={() => p.onForm(null)} />}
      {p.form?.kind === "draft" && <DraftItem c={c} commitmentId={p.form.commitmentId ?? null} onCreate={p.onCreate} onCancel={() => p.onForm(null)} />}
      {p.expanded && <Messages c={c} tz={p.tz} />}
    </li>
  );
}

function SuggestionBox({ s, onPost, onSkip }: { s: Suggest; onPost: (includeInternal: boolean) => void; onSkip: () => void }) {
  const [include, setInclude] = useState(false);
  const lines = [...(s.body ? s.body.split("\n") : []), ...(include ? s.internal : [])];
  return (
    <div className="conv-suggest" onClick={(e) => e.stopPropagation()}>
      <p className="conv-suggest-head">{s.kind === "comment" ? <>Suggested update for #{s.itemId}</> : <>Description change for #{s.itemId}</>}</p>
      {s.kind === "comment" ? (
        <>
          <ul className="conv-suggest-lines">
            {lines.length ? lines.map((l, i) => <li key={i}>{l}</li>) : <li className="muted">Discussed in an internal chat.</li>}
          </ul>
          {s.internal.length > 0 && (
            <label className="conv-internal-toggle">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include {s.internal.length === 1 ? "the line" : `the ${s.internal.length} lines`} from the internal chat
            </label>
          )}
        </>
      ) : (
        <p>Adds below the current description: "{s.body}". You see the whole before and after first.</p>
      )}
      <div className="ask-actions">
        <button type="button" className="mini primary" onClick={() => onPost(include)}>
          {s.kind === "comment" ? "Post comment" : "Review the change"}
        </button>
        <button type="button" className="mini quiet" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function NotRequest({ onSave, onCancel }: { onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <form className="ask-form" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), onSave(reason.trim()))} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Why isn't it a request? <span className="muted">(optional, everyone on the chat sees it)</span>
        <input autoFocus maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Answered on a call" />
      </label>
      <button type="submit" className="mini primary">Not a request</button>
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}

type Hit = { id: number; title: string; type: string; state: string; url: string };
function ConvLink({ c, onPick, onCancel }: { c: ConversationCard; onPick: (id: number) => void; onCancel: () => void }) {
  const [q, setQ] = useState(c.likely ? `#${c.likely.id}` : "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void call<{ available: boolean; items: Hit[] }>("conversations.search", { id: c.id, query: q }).then(
        (r) => live && (setAvailable(r.available), setHits(r.items)),
        () => live && (setAvailable(false), setHits([])),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, c.id]);
  return (
    <div className="ask-form ask-link" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Link to one of {c.clientName}'s open items
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), onPick(hits[0].id))} />
      </label>
      {!available && <p className="set-problem">DevOps couldn't be read for {c.clientName}. Try again in a moment.</p>}
      {hits && available && (
        <ul className="ask-hits" aria-label="Open items">
          {hits.length === 0 && <li className="muted">No open items match</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="mini quiet" onClick={() => onPick(h.id)}>
                #{h.id} {h.title} <span className="muted">· {h.type} · {h.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}

type DraftData = { draft: ItemDraft; notSorted: string | null; features: { id: number; title: string }[]; internalChat: boolean; canCreate: boolean };
/** "Create the DevOps item?": the draft from the whole conversation (title, type, parent feature, path of action). */
export function DraftItem({ c, commitmentId, onCreate, onCancel }: { c: Pick<ConversationCard, "id" | "clientName">; commitmentId: number | null; onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void; onCancel: () => void }) {
  const [d, setD] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<ItemDraft["level"]>("story");
  const [parent, setParent] = useState<string>("");
  const [path, setPath] = useState("");
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const fill = useCallback(async (regenerate: boolean) => {
    setBusy(true);
    try {
      const r = await call<DraftData>("conversations.draft", { id: c.id, ...(commitmentId ? { commitmentId } : {}), ...(regenerate ? { regenerate: true } : {}) });
      setD(r);
      setTitle(r.draft.title);
      setLevel(r.draft.level);
      setParent(r.draft.parentId ? String(r.draft.parentId) : "");
      setPath(pathOfAction(r.draft));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [c.id, commitmentId]);
  useEffect(() => void fill(false), [fill]);
  return (
    <form
      className="ask-form conv-draft"
      aria-label="Create the DevOps item"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onCreate({ kind: "conversation_create", conversationId: c.id, ...(commitmentId ? { commitmentId } : {}), title: title.trim(), description: path, level, ...(parent ? { parentId: Number(parent) } : {}), ...(include ? { includeInternal: true } : {}) });
      }}
    >
      <p className="conv-suggest-head">Create the DevOps item?</p>
      {error && <p className="set-problem">{error}</p>}
      {!d && !error && <p className="muted">Drafting from the conversation…</p>}
      {d && (
        <>
          {d.notSorted && <p className="muted">Drafted without AI: {d.notSorted}.</p>}
          <label>
            Title
            <input autoFocus maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Type
            <select value={level} onChange={(e) => setLevel(e.target.value as ItemDraft["level"])}>
              <option value="bug">Bug</option>
              <option value="story">Story</option>
              <option value="feature">Feature</option>
            </select>
          </label>
          {level !== "feature" && (
            <label>
              Under feature
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">None (the project's default area and iteration)</option>
                {d.features.map((f) => (
                  <option key={f.id} value={f.id}>
                    #{f.id} {f.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Path of action <span className="muted">(the conversation's messages, who and when, and the Teams link are added below it)</span>
            <textarea rows={8} maxLength={8000} value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          {d.internalChat && (
            <label className="conv-internal-toggle">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include the messages from this internal chat (left out by default)
            </label>
          )}
          <div className="ask-actions">
            <button type="submit" className="mini primary" disabled={!d.canCreate || !title.trim()}>
              Preview in DevOps
            </button>
            <button type="button" className="mini quiet" disabled={busy} onClick={() => void fill(true)}>
              {busy ? "Drafting…" : "Draft again"}
            </button>
            <button type="button" className="mini quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
          {!d.canCreate && <p className="muted">Add DevOps write access for {c.clientName} in Settings to create it.</p>}
        </>
      )}
    </form>
  );
}

/** The collapsed height of the messages; the cut lands after a whole message, paragraph or table row, never inside one. */
const COLLAPSED_PX = 320;
export function cutHeight(container: HTMLElement, limit = COLLAPSED_PX): number | null {
  if (container.scrollHeight <= limit + 24) return null;
  const top = container.getBoundingClientRect().top;
  let best = 0;
  for (const el of container.querySelectorAll<HTMLElement>(".conv-msg, .conv-msg-body > *, tr")) {
    if (el.tagName === "TABLE" || el.closest("table") && el.tagName !== "TR") continue;
    const bottom = el.getBoundingClientRect().bottom - top;
    if (bottom <= limit && bottom > best) best = bottom;
  }
  return best > 0 ? Math.ceil(best) : limit;
}

function Messages({ c, tz }: { c: ConversationCard; tz: string }) {
  const [ms, setMs] = useState<ConversationMessage[] | string | null>(null);
  const [all, setAll] = useState(false);
  const [cut, setCut] = useState<number | null>(null);
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    let live = true;
    void call<{ messages: ConversationMessage[] }>("conversations.messages", { id: c.id }).then((r) => live && setMs(r.messages), (e) => live && setMs(errText(e)));
    return () => void (live = false);
  }, [c.id]);
  useLayoutEffect(() => {
    if (box.current && Array.isArray(ms)) setCut(cutHeight(box.current));
  }, [ms]);
  if (ms === null) return <p className="muted">Loading…</p>;
  if (typeof ms === "string") return <p className="set-problem">{ms}</p>;
  return (
    <div className="conv-messages" onClick={(e) => e.stopPropagation()}>
      <ol ref={box} className="conv-msgs" aria-label="The messages" style={cut && !all ? { maxHeight: cut, overflow: "hidden" } : undefined}>
        {ms.map((m) => (
          <li key={m.messageId} className={`conv-msg${m.mine ? " mine" : ""}`}>
            <span className="ask-ctx-who">
              {m.author}
              {m.external && <span className="ask-ext">External</span>}
              <span className="muted"> · {whenText(m.at, tz)}</span>
            </span>
            {/* Sanitized on the server (plan/sanitize.ts): allowlisted tags, links only, mentions and images replaced. */}
            <div className="conv-msg-body" dangerouslySetInnerHTML={{ __html: m.html }} />
          </li>
        ))}
      </ol>
      {cut && (
        <button type="button" className="mini quiet" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function Chatter({ g, tz, color, onWork }: { g: ConversationsData["chatter"][number]; tz: string; color: string; onWork: (m: ConversationsData["chatter"][number]["messages"][number]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="conv-fold conv-chatter" aria-label={`Filtered as chatter, ${g.clientName}`} style={{ "--c": color } as CSSProperties}>
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {g.clientName}: Filtered as chatter ({g.messages.length})
      </button>
      {open && (
        <ul className="ask-hidden-list">
          {g.messages.map((m) => (
            <li key={m.messageId} className="ask-hidden">
              <span className="ask-hidden-who">
                {m.author} · <time dateTime={m.at}>{whenText(m.at, tz)}</time>
              </span>
              <span className="ask-hidden-text">{m.text}</span>
              <button type="button" className="mini" onClick={() => onWork(m)}>
                This is work
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
