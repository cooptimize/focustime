// Inbox › Requests (was Asks; shared polling, D508 to D512). Messages from people outside Cooptimize in the client
// chats registered for the person's clients (shown to members who follow the client), by client, newest first. A
// request's state is shared: resolved by anyone, it's resolved for everyone, with their name. Each card: the client's color, who (with "External"), when, the text (4 lines, Show more),
// attachments, "Matched: <rule>", Show context (the 5 messages before, folded), Open in Teams, and the resolutions:
// Create bug, story or feature (the write framework's preview; only with that client's DevOps write access), Link to
// an open item, Handled (an optional note) and Dismiss, with Undo. Keys: J and K move, Enter the first action, H
// handled, D dismiss, X context. Nothing is posted in Teams. Chat text shows only on its own client's card.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { RequestChatStatus, RequestView, RequestsData, ContextMessage } from "../plan/asks.ts";
import { KIND_WORD, URGENCY_WORD } from "../plan/asks-ai.ts";
import type { WeekLoadData } from "../actions/types.ts";
import { userZone } from "../week/zone.ts";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { Fading } from "./FollowUps.tsx";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "./keys.ts";
import { ASK_KEY_EVENT, type AskKeyId } from "./menu.ts";
import { clientColor, whenText } from "./labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const keyOf = (a: { chatId: string; messageId: string }) => `${a.chatId}|${a.messageId}`;

/** The cards in screen order: clients by their newest open request, each client's newest first; resolved ones last. */
export function requestGroups(requests: readonly RequestView[]): { clientKey: string; clientName: string; requests: RequestView[] }[] {
  const groups = new Map<string, { clientKey: string; clientName: string; requests: RequestView[] }>();
  const sorted = [...requests].sort((a, b) => (a.status === "open") !== (b.status === "open") ? (a.status === "open" ? -1 : 1) : Date.parse(b.at) - Date.parse(a.at));
  for (const a of sorted) (groups.get(a.clientKey) ?? groups.set(a.clientKey, { clientKey: a.clientKey, clientName: a.clientName, requests: [] }).get(a.clientKey)!).requests.push(a);
  return [...groups.values()];
}

export type InboxTab = "inbox" | "requests" | "promises";
/** The Inbox's tabs: "Inbox", "Requests" and (AP-2) "Promises", each with its open count (hidden at none). */
export function InboxTabs({ tab, count, promiseCount = null, onPick }: { tab: InboxTab; count: number | null; promiseCount?: number | null; onPick: (tab: InboxTab) => void }) {
  return (
    <div className="inbox-tabs" role="tablist" aria-label="Inbox">
      <button type="button" role="tab" aria-selected={tab === "inbox"} className={tab === "inbox" ? "on" : ""} onClick={() => onPick("inbox")}>
        Inbox
      </button>
      <button type="button" role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "on" : ""} onClick={() => onPick("requests")}>
        Requests{count ? <span className="tab-count" aria-label={`${count} open`}>{count}</span> : null}
      </button>
      <button type="button" role="tab" aria-selected={tab === "promises"} className={tab === "promises" ? "on" : ""} onClick={() => onPick("promises")}>
        Promises{promiseCount ? <span className="tab-count" aria-label={`${promiseCount} open`}>{promiseCount}</span> : null}
      </button>
    </div>
  );
}

/** The open requests and promises counts for the tabs, read when the Inbox opens and after changes. */
export function useRequestCount(version: number, enabled: boolean): [number | null, (n: number) => void, number | null, (n: number) => void] {
  const [count, setCount] = useState<number | null>(null);
  const [promises, setPromises] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void call<RequestsData>("requests.list", {}).then((d) => live && (setCount(d.open), setPromises(d.promisesOpen ?? null)), () => undefined);
    return () => void (live = false);
  }, [version, enabled]);
  return [count, setCount, promises, setPromises];
}

export function Requests({ data, version, onCount, onPromiseCount, onChanged, openSettings }: { data: WeekLoadData; version: number; onCount: (n: number) => void; onPromiseCount?: (n: number) => void; onChanged?: () => void; openSettings: (section: string) => void }) {
  const [state, setState] = useState<RequestsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [context, setContext] = useState<Record<string, ContextMessage[] | "loading" | string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [noting, setNoting] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const writes = useDevOpsWrite();
  const tz = userZone(data);
  const clearNotice = useCallback(() => setNotice(null), []);
  // A selected request resolved elsewhere (Create in DevOps's preview) hands the selection to the next open one.
  const selRef = useRef<string | null>(null);
  const show = useCallback(
    (d: RequestsData) => {
      setState((prev) => {
        const was = prev?.requests.find((x) => keyOf(x) === selRef.current);
        const now = d.requests.find((x) => keyOf(x) === selRef.current);
        if (was?.status === "open" && now && now.status !== "open") {
          const next = requestGroups(d.requests).flatMap((g) => g.requests).find((x) => x.status === "open");
          setSel(next ? keyOf(next) : null);
        }
        return d;
      });
      onCount(d.open);
      onPromiseCount?.(d.promisesOpen);
    },
    [onCount, onPromiseCount],
  );

  // AP-2: a change here can add or clear an urgent request on Today (and Check-in's count): the app's data reloads quietly.
  const changed = (d: RequestsData) => (show(d), onChanged?.());
  const load = useCallback(async () => {
    try {
      show(await call<RequestsData>("requests.list", {}));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [show]);
  // A DevOps write (a create from a request, or its undo) resolves or reopens it: read again.
  useEffect(() => void load(), [load, version, writes?.version]);
  useEffect(() => head.current?.focus(), []);

  const groups = useMemo(() => requestGroups(state?.requests ?? []), [state]);
  const order = useMemo(() => groups.flatMap((g) => g.requests), [groups]);
  const current = order.find((a) => keyOf(a) === sel) ?? order.find((a) => a.status === "open") ?? null;
  selRef.current = current ? keyOf(current) : null;

  const refresh = async () => {
    setBusy(true);
    try {
      changed(await call<RequestsData>("requests.refresh", {}));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (a: RequestView, status: "linked" | "handled" | "dismissed", extra: { note?: string; itemId?: number } = {}) => {
    try {
      changed(await call<RequestsData>("requests.resolve", { chatId: a.chatId, messageId: a.messageId, status, ...extra }));
      setLinking(null);
      setNoting(null);
      const what = status === "linked" ? `Linked to #${extra.itemId}` : status === "handled" ? "Marked handled" : "Dismissed";
      setNotice(
        <>
          {what}.{" "}
          <button type="button" className="mini quiet" onClick={() => void reopen(a)}>
            Undo
          </button>
        </>,
      );
      // On to the next open request.
      const next = order.slice(order.indexOf(a) + 1).find((x) => x.status === "open") ?? order.find((x) => x.status === "open" && keyOf(x) !== keyOf(a));
      setSel(next ? keyOf(next) : null);
    } catch (e) {
      setError(errText(e));
    }
  };
  const reopen = async (a: RequestView) => {
    try {
      changed(await call<RequestsData>("requests.reopen", { chatId: a.chatId, messageId: a.messageId }));
      setNotice("Open again");
      setSel(keyOf(a));
    } catch (e) {
      setError(errText(e));
    }
  };
  const toggleContext = async (a: RequestView) => {
    const k = keyOf(a);
    if (context[k]) return setContext(({ [k]: _gone, ...rest }) => rest);
    setContext((c) => ({ ...c, [k]: "loading" }));
    try {
      const r = await call<{ messages: ContextMessage[] }>("requests.context", { chatId: a.chatId, messageId: a.messageId });
      setContext((c) => ({ ...c, [k]: r.messages }));
    } catch (e) {
      setContext((c) => ({ ...c, [k]: errText(e) }));
    }
  };
  const canWrite = (a: RequestView) => !!state?.writeClients.includes(a.clientKey) && !!writes;
  const create = (a: RequestView, level: "bug" | "story" | "feature") => {
    if (!canWrite(a)) return setNotice(`Add DevOps write access for ${a.clientName} in Settings`);
    void writes!.begin(a.clientKey, [{ kind: "request_create", chatId: a.chatId, messageId: a.messageId, level }]);
  };
  /** AP-2: the AI's suggested item type leads (a bug when it suggested none). */
  const suggested = (a: RequestView): "bug" | "story" | "feature" => a.sort?.itemType ?? "bug";
  const primary = (a: RequestView) => (canWrite(a) ? create(a, suggested(a)) : setLinking(keyOf(a)));
  const [sorting, setSorting] = useState<string | null>(null);
  const sortAgain = async (a: RequestView) => {
    setSorting(keyOf(a));
    try {
      changed(await call<RequestsData>("requests.sort_again", { chatId: a.chatId, messageId: a.messageId }));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSorting(null);
    }
  };
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const showAnyway = async (a: RequestView) => {
    try {
      changed(await call<RequestsData>("requests.show", { chatId: a.chatId, messageId: a.messageId, shown: true }));
      setNotice("Shown on Requests");
      setSel(keyOf(a));
    } catch (e) {
      setError(errText(e));
    }
  };

  // Keys (only here, not while typing or behind a dialog): J/K move, Enter the first action, H, D, X.
  const keys = useRef({ order, current, primary, resolve, toggleContext, noting, linking });
  keys.current = { order, current, primary, resolve, toggleContext, noting, linking };
  useEffect(() => {
    /** One key's work; true when it did something. */
    const act = (id: AskKeyId): boolean => {
      const { order: list, current: cur, primary: go, resolve: res, toggleContext: ctxOf } = keys.current;
      if (id === "ask.next" || id === "ask.prev") {
        if (!list.length) return false;
        const i = cur ? list.indexOf(cur) : -1;
        const next = list[Math.max(0, Math.min(list.length - 1, i + (id === "ask.next" ? 1 : -1)))]!;
        setSel(keyOf(next));
        document.querySelector<HTMLElement>(`.ask-card[data-ask="${CSS.escape(keyOf(next))}"]`)?.focus();
        return true;
      }
      if (!cur) return false;
      if (id === "ask.context") return void ctxOf(cur), true;
      if (cur.status !== "open") return false;
      if (id === "ask.primary") go(cur);
      else if (id === "ask.handled") setNoting(keyOf(cur));
      else if (id === "ask.dismiss") void res(cur, "dismissed");
      return true;
    };
    const BY_KEY: Record<string, AskKeyId> = { j: "ask.next", k: "ask.prev", enter: "ask.primary", h: "ask.handled", d: "ask.dismiss", x: "ask.context" };
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      if (keys.current.noting || keys.current.linking) return;
      const id = BY_KEY[e.key.toLowerCase()];
      // Enter on a button or link is that button's own.
      if (!id || (id === "ask.primary" && (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement))) return;
      if (act(id)) e.preventDefault();
    };
    const onCommand = (e: Event) => void act((e as CustomEvent<AskKeyId>).detail);
    window.addEventListener("keydown", onKey);
    window.addEventListener(ASK_KEY_EVENT, onCommand);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(ASK_KEY_EVENT, onCommand);
    };
  }, []);

  const open = state?.open ?? 0;
  const problems = (state?.chats ?? []).flatMap((c) => {
    const line = chatProblem(c, tz);
    return line ? [{ c, line }] : [];
  });
  return (
    <main className="inbox asks" aria-label="Requests">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Requests {state && open > 0 && <span className="muted">{open} open</span>}
        </h2>
        <button type="button" className="mini" aria-label="Refresh requests" title="Read your clients' registered chats now (only new messages)" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Reading Teams…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <Fading text={notice} onGone={clearNotice} ms={8000} />
      {problems.map(({ c, line }) => (
        <p key={c.chatId} className="ask-chat-problem" role="status">
          {c.clientName} · {c.chatName}: {line}
        </p>
      ))}
      {state && open === 0 && (
        <div className="asks-empty">
          <p>No open requests</p>
          {state.chats.length === 0 && (
            <p className="muted">
              Add a client's Teams chat in{" "}
              <button type="button" className="linkish" onClick={() => openSettings("clients")}>
                Settings › Clients
              </button>
              . Questions and requests from people outside Cooptimize then show up here for everyone on the chat.
            </p>
          )}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.clientKey} className="ask-group" aria-label={`Requests from ${g.clientName}`} style={{ "--c": clientColor(g.clientKey, data.clients) } as CSSProperties}>
          <h3>
            <span className="swatch" aria-hidden="true" />
            {g.clientName} <span className="muted">{g.requests.filter((a) => a.status === "open").length || ""}</span>
          </h3>
          <ul className="ask-list">
            {g.requests.map((a) => (
              <AskCard
                key={keyOf(a)}
                a={a}
                tz={tz}
                selected={current ? keyOf(current) === keyOf(a) : false}
                onSelect={() => setSel(keyOf(a))}
                context={context[keyOf(a)] ?? null}
                onContext={() => void toggleContext(a)}
                canWrite={canWrite(a)}
                onCreate={(level) => create(a, level)}
                onEnable={() => openSettings("clients")}
                linking={linking === keyOf(a)}
                onLink={(on) => setLinking(on ? keyOf(a) : null)}
                onLinked={(id) => void resolve(a, "linked", { itemId: id })}
                noting={noting === keyOf(a)}
                onNote={(on) => setNoting(on ? keyOf(a) : null)}
                onHandled={(note) => void resolve(a, "handled", note ? { note } : {})}
                onDismiss={() => void resolve(a, "dismissed")}
                onUndo={() => void reopen(a)}
                suggested={suggested(a)}
                sorting={sorting === keyOf(a)}
                onSortAgain={() => void sortAgain(a)}
              />
            ))}
          </ul>
        </section>
      ))}
      {(state?.hidden.length ?? 0) > 0 && (
        <section className="asks-hidden" aria-label="Hidden by AI">
          <button type="button" className="link-btn" aria-expanded={hiddenOpen} onClick={() => setHiddenOpen((o) => !o)}>
            Hidden by AI ({state!.hidden.length})
          </button>
          {hiddenOpen && (
            <ul className="ask-hidden-list">
              {state!.hidden.map((a) => (
                <li key={keyOf(a)} className="ask-hidden" style={{ "--c": clientColor(a.clientKey, data.clients) } as CSSProperties}>
                  <span className="swatch" aria-hidden="true" />
                  <span className="ask-hidden-who">
                    {a.clientName} · {a.author} · <time dateTime={a.at}>{whenText(a.at, tz)}</time>
                  </span>
                  <span className="ask-hidden-text">{a.text || "(no text)"}</span>
                  {a.sort?.reason && <span className="muted ask-hidden-why">{a.sort.reason}</span>}
                  <button type="button" className="mini" onClick={() => void showAnyway(a)}>
                    Show it anyway
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {state && state.chats.length > 0 && (
        <p className="requests-poll muted" role="status">
          {pollLine(state, tz)}
        </p>
      )}
    </main>
  );
}

const hm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });

/** A chat's line when something needs saying: who it's read through, needs reconnecting, or a wait. */
export function chatProblem(c: RequestChatStatus, tz: string): string | null {
  if (c.state === "reconnect") return `Needs reconnecting. ${c.fetchedAt ? `Last fetched ${whenText(c.fetchedAt, tz)}` : "Not fetched yet"}. Anyone on the chat who follows the client can sign in with Microsoft again`;
  if (c.state === "retry") return `${c.note ?? "Teams didn't answer"}. Trying again${c.retryAt ? ` at ${hm(c.retryAt, tz)}` : ""}`;
  return null;
}

/** The footer: the last poll and how the chats are read ("Polling via <name>" when someone else's sign-in reads one). */
export function pollLine(d: Pick<RequestsData, "chats" | "lastPoll" | "lastFetch" | "pollMinutes">, tz: string): string {
  const n = d.chats.length;
  const via = [...new Set(d.chats.flatMap((c) => (c.state === "via" && c.via ? [c.via] : [])))];
  const parts = [
    d.lastPoll ? `Last checked ${whenText(d.lastPoll, tz)}` : "Not checked yet",
    d.lastFetch && d.lastFetch !== d.lastPoll ? `last fetched ${whenText(d.lastFetch, tz)}` : null,
    `${n} ${n === 1 ? "chat" : "chats"}, every ${d.pollMinutes} minutes in working hours`,
    via.length ? `polling via ${via.join(", ")}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function AskCard(p: {
  a: RequestView; tz: string; selected: boolean; onSelect: () => void;
  context: ContextMessage[] | "loading" | string | null; onContext: () => void;
  canWrite: boolean; onCreate: (level: "bug" | "story" | "feature") => void; onEnable: () => void;
  linking: boolean; onLink: (on: boolean) => void; onLinked: (id: number) => void;
  noting: boolean; onNote: (on: boolean) => void; onHandled: (note: string) => void;
  onDismiss: () => void; onUndo: () => void;
  suggested: "bug" | "story" | "feature"; sorting: boolean; onSortAgain: () => void;
}) {
  const { a } = p;
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const [long, setLong] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = text.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [a.text]);
  const open = a.status === "open";
  return (
    <li className={`ask-card${p.selected ? " selected" : ""}${open ? "" : " resolved"}`} data-ask={keyOf(a)} tabIndex={p.selected ? 0 : -1} aria-label={`Request from ${a.author}`} onFocus={p.onSelect} onClick={p.onSelect}>
      <div className="ask-head">
        <strong>{a.author}</strong>
        {a.external && <span className="ask-ext">External</span>}
        <span className="muted">
          · <time dateTime={a.at}>{whenText(a.at, p.tz)}</time> · {a.chatName}
        </span>
        {a.sort && (
          <span className="ask-labels">
            <button type="button" className={`ask-label kind-${a.sort.kind}`} title={a.sort.reason} aria-expanded={why} onClick={(e) => (e.stopPropagation(), setWhy((w) => !w))}>
              {KIND_WORD[a.sort.kind]}
            </button>
            <span className={`ask-label urgency-${a.sort.urgency}`} title={a.sort.reason}>
              {URGENCY_WORD[a.sort.urgency]}
            </span>
          </span>
        )}
      </div>
      {why && a.sort && <p className="ask-why muted">Why: {a.sort.reason}</p>}
      <p ref={text} className={`ask-text${more ? "" : " clamp"}`}>
        {a.text || <span className="muted">(no text)</span>}
      </p>
      {(long || more) && (
        <button type="button" className="mini quiet" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? "Show less" : "Show more"}
        </button>
      )}
      <p className="ask-meta muted">
        {a.hasImage && <span className="ask-attach">Image attached</span>}
        {a.hasFile && <span className="ask-attach">File attached</span>}
        <span>Matched: {a.matched}</span>
        {a.notSorted && (
          <span className="ask-not-sorted">
            Not sorted: {a.notSorted}
            {open && (
              <button type="button" className="mini quiet" disabled={p.sorting} onClick={p.onSortAgain}>
                {p.sorting ? "Sorting…" : "Sort again"}
              </button>
            )}
          </span>
        )}
        <a href={a.link} target="_blank" rel="noopener noreferrer">
          Open in Teams
        </a>
      </p>
      {(a.likely || a.promised || (a.sort && a.sort.kind !== "none" && a.sort.title)) && (
        <div className="ask-ai">
          {a.likely && (
            <p className="ask-likely">
              Looks like{" "}
              {a.likely.url ? (
                <a href={a.likely.url} target="_blank" rel="noopener noreferrer">
                  #{a.likely.id} {a.likely.title ?? ""}
                </a>
              ) : (
                <>
                  #{a.likely.id} {a.likely.title ?? ""}
                </>
              )}
            </p>
          )}
          {a.sort && a.sort.kind !== "none" && a.sort.title && open && (
            <p className="ask-draft muted">
              Draft: <span className="ask-draft-title">{a.sort.title}</span>
            </p>
          )}
          {a.promised && <p className="ask-promised">Promised: {a.promised}</p>}
        </div>
      )}
      <div className="ask-context">
        <button type="button" className="mini quiet" aria-expanded={!!p.context} onClick={p.onContext}>
          {p.context ? "Hide context" : "Show context"} <kbd>X</kbd>
        </button>
        {Array.isArray(p.context) && (
          <ol className="ask-context-list" aria-label="The messages before it">
            {p.context.length === 0 && <li className="muted">No earlier messages stored (FocusTime reads from when you switched it on).</li>}
            {p.context.map((m) => (
              <li key={m.messageId} className={m.mine ? "mine" : ""}>
                <span className="ask-ctx-who">
                  {m.author}
                  {m.external && <span className="ask-ext">External</span>}
                  <span className="muted"> · {whenText(m.at, p.tz)}</span>
                </span>
                <span className="ask-ctx-text">{m.text || (m.hasImage || m.hasFile ? "(attachment)" : "")}</span>
              </li>
            ))}
          </ol>
        )}
        {p.context === "loading" && <p className="muted">Loading…</p>}
        {typeof p.context === "string" && p.context !== "loading" && <p className="set-problem">{p.context}</p>}
      </div>
      {open ? (
        <div className="ask-actions">
          {p.canWrite ? (
            <>
              {[p.suggested, ...(["bug", "story", "feature"] as const).filter((l) => l !== p.suggested)].map((l, i) => (
                <button key={l} type="button" className={`mini${i === 0 ? " primary" : ""}`} onClick={() => p.onCreate(l)}>
                  Create {l} {i === 0 && p.selected && <kbd>Enter</kbd>}
                </button>
              ))}
            </>
          ) : (
            <button type="button" className="mini quiet" onClick={p.onEnable}>
              Add DevOps write access for {a.clientName} in Settings
            </button>
          )}
          <button type="button" className={`mini${p.canWrite ? "" : " primary"}`} aria-expanded={p.linking} onClick={() => p.onLink(!p.linking)}>
            Link to an item…
          </button>
          <button type="button" className="mini" aria-expanded={p.noting} onClick={() => p.onNote(!p.noting)}>
            Handled <kbd>H</kbd>
          </button>
          <button type="button" className="mini quiet" onClick={p.onDismiss}>
            Dismiss <kbd>D</kbd>
          </button>
        </div>
      ) : (
        <p className="ask-done">
          {a.status === "created" && a.item ? (
            <>
              Created{" "}
              <a href={a.item.url ?? undefined} target="_blank" rel="noopener noreferrer">
                #{a.item.id} {a.item.title}
              </a>
            </>
          ) : a.status === "linked" && a.item ? (
            <>
              Linked to{" "}
              <a href={a.item.url ?? undefined} target="_blank" rel="noopener noreferrer">
                #{a.item.id} {a.item.title}
              </a>
            </>
          ) : a.status === "handled" ? (
            <>Handled{a.note ? `: ${a.note}` : ""}</>
          ) : (
            <>Dismissed</>
          )}
          {a.resolvedBy && <span className="muted"> by {a.resolvedBy}</span>}
          {a.status !== "created" && (
            <button type="button" className="mini quiet" onClick={p.onUndo}>
              Undo
            </button>
          )}
        </p>
      )}
      {open && p.noting && <HandledNote onSave={p.onHandled} onCancel={() => p.onNote(false)} />}
      {open && p.linking && <LinkPicker a={a} onPick={p.onLinked} onCancel={() => p.onLink(false)} />}
    </li>
  );
}

function HandledNote({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <form
      className="ask-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(note.trim());
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
    >
      <label>
        How was it handled? <span className="muted">(optional)</span>
        <input autoFocus maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Answered in the chat" />
      </label>
      <button type="submit" className="mini primary">Mark handled</button>
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </form>
  );
}

type Hit = { id: number; title: string; type: string; state: string; url: string };
export function LinkPicker({ a, onPick, onCancel }: { a: { chatId: string; messageId: string; clientName: string; likely?: { id: number } | null }; onPick: (id: number) => void; onCancel: () => void }) {
  // AP-2: the likely existing item is filled in (the person still picks it).
  const [q, setQ] = useState(a.likely ? `#${a.likely.id}` : "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void call<{ available: boolean; items: Hit[] }>("requests.search", { chatId: a.chatId, messageId: a.messageId, query: q }).then(
        (r) => live && (setAvailable(r.available), setHits(r.items)),
        () => live && (setAvailable(false), setHits([])),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, a.chatId, a.messageId]);
  return (
    <div className="ask-form ask-link" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <label>
        Link to one of {a.clientName}'s open items
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), onPick(hits[0].id))} />
      </label>
      {!available && <p className="set-problem">DevOps couldn't be read for {a.clientName}. Try again in a moment.</p>}
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
