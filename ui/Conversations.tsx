// CV-1: Inbox › Conversations. What my clients' registered chats are talking about, one card per topic, kept by the
// shared pipeline for everyone on the chat: Needs you (new ones on my clients, ones that mention me, ones I own or
// committed to, unclaimed ones on clients I lead), Handled by teammates (collapsed, one line each) and Closed. A card:
// title, client and chat, who's in it, last activity, a 2 to 4 line summary, one status (New, In discussion, <Name>
// committed, Tracked #id, Resolved, Closed; amber Waiting on <Name>), "Updated" when it changed since I looked, and
// one primary action (Create item, Link, Resolve, Take it over) with the rest under ⋯. Show messages renders the
// messages like Teams (CV-2, ui/MessageThread.tsx): grouped by person with avatars, mine on the other side, quotes,
// reactions, the latest 20 with Show earlier. Merge into… (or Select several) moves one topic into another, with Undo. Keys: J and K move, Enter the primary action, X messages, R resolve. Nothing is
// posted in Teams. Chat text shows only on its own client's card.
import { TypeIcon } from "./TypeIcon.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ModeArea } from "./ModeSwitch.tsx";
import type { WeekLoadData } from "../actions/types.ts";
import type { ConversationCard, ConversationMessage, ConversationMessages, ConversationsData } from "../plan/conversation-views.ts";
import { ImageViewer } from "./ImageViewer.tsx";
import { MessageThread } from "./MessageThread.tsx";
import { usePhotos } from "./Presence.tsx";
import type { ItemDraft } from "../plan/conversations.ts";
import { acceptanceText, pathOfAction } from "../plan/conversation-draft.ts";
import { userZone } from "../week/zone.ts";
import { call } from "./api.ts";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { Fading } from "./FollowUps.tsx";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "./keys.ts";
import { clientColor, whenText } from "./labels.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
type CardForm = "link" | "not_request" | "draft" | "merge";
const PRIMARY_WORD = { create: "Create DevOps item", link: "Link", resolve: "Resolve", take_over: "Take it over", reopen: "Open again", mark_done: "Mark done" } as const;

export function Conversations({ data, version, onCount, onPromiseCount, onChanged, openSettings, select = null, switcher = null }: { switcher?: ReactNode; data: WeekLoadData; version: number; onCount: (n: number) => void; onPromiseCount?: (n: number) => void; onChanged?: () => void; openSettings: (section: string) => void; select?: number | null }) {
  const [state, setState] = useState<ConversationsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [busy, setBusy] = useState<"refresh" | "sort" | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ id: number; kind: CardForm; commitmentId?: number } | null>(null);
  /** CV-2: conversations picked for a merge (Select), and the deep link's note when its one isn't here. */
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
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
  // CV-2: a deep link (#/inbox/conversation/<id>, the urgent strip's lines): that one selected, its fold open, scrolled to.
  const scrolledTo = useRef<number | null>(null);
  useEffect(() => {
    if (select === null) return;
    let live = true;
    void call<ConversationsData>("conversations.list", { select }).then((d) => {
      if (!live) return;
      show(d);
      const s = d.selected;
      if (!s?.found) {
        setLinkNote("That conversation isn't here any more, or it's in a chat you aren't in. Here are the others.");
        return;
      }
      setLinkNote(null);
      if (s.where === "teammates") setTeammatesOpen(true);
      if (s.where === "closed") setClosedOpen(true);
      setSel(s.id);
      scrolledTo.current = null;
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`.conv-card[data-conv="${s.id}"], .conv-line[data-conv="${s.id}"]`);
        if (el && scrolledTo.current !== s.id) {
          el.scrollIntoView({ block: "center" });
          el.focus({ preventScroll: true });
          scrolledTo.current = s.id;
        }
      });
    }, (e) => live && setError(errText(e)));
    return () => void (live = false);
  }, [select, show]);
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
  /** CV-2: Merge into… (one from its ⋯, or the ones picked), with Undo for all of them at once. */
  const merge = async (ids: number[], into: ConversationCard) => {
    try {
      const r = await call<ConversationsData & { merges: number[] }>("conversations.merge", { ids, into: into.id });
      show(r);
      setError(null);
      setForm(null);
      setPicked(null);
      setSel(into.id);
      onChanged?.();
      setNotice(
        <>
          {ids.length === 1 ? "Merged" : `${ids.length} merged`} into "{into.title}" for everyone on the chat.{" "}
          <button type="button" className="mini quiet" onClick={() => void run("conversations.unmerge", { merges: r.merges }, "Merge undone")}>
            Undo
          </button>
        </>,
      );
    } catch (e) {
      setError(errText(e));
    }
  };
  const order = useMemo(() => [...(state?.needsYou ?? []), ...(state?.inProgress ?? []), ...(teammatesOpen ? (state?.teammates ?? []) : []), ...(closedOpen ? (state?.closed ?? []) : [])], [state, teammatesOpen, closedOpen]);
  const current = order.find((c) => c.id === sel) ?? state?.needsYou[0] ?? null;
  const all = useMemo(() => [...(state?.needsYou ?? []), ...(state?.inProgress ?? []), ...(state?.teammates ?? []), ...(state?.closed ?? [])], [state]);
  const pickedCards = all.filter((c) => picked?.has(c.id));
  const oneChat = pickedCards.length > 1 && pickedCards.every((c) => c.chatId === pickedCards[0]!.chatId);

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
    if (c.primary === "resolve" || c.primary === "mark_done") return resolve(c);
    if (c.primary === "reopen") return void run("conversations.reopen", { id: c.id }, "Open again");
    if (c.primary === "link") return setForm({ id: c.id, kind: "link" });
    if (c.primary === "take_over") {
      const k = c.commitments.find((x) => x.state === "open" && x.impliesItem && !x.mine);
      return k ? void run("conversations.take_over", { commitmentId: k.id }, `It's yours now. ${k.whoName.split(" ")[0]} is told quietly.`) : undefined;
    }
    // CV-5: the form opens with or without write access; without it, it says how to turn writes on and sends nothing.
    if (c.primary === "create") return openDraft(c);
  };
  const openDraft = (c: ConversationCard) => {
    const mine = c.commitments.find((x) => x.mine && x.state === "open" && x.impliesItem && !x.item);
    setForm({ id: c.id, kind: "draft", ...(mine ? { commitmentId: mine.id } : {}) });
  };
  /** CV-5: Link to item (FocusTime only, with Unlink as its undo), then the optional comment through the comment write. */
  const link = async (c: ConversationCard, itemId: number, comment: boolean) => {
    await run("conversations.link", { id: c.id, itemId }, (
      <>
        Linked to #{itemId} for everyone on the chat.{" "}
        <button type="button" className="mini quiet" onClick={() => void run("conversations.unlink", { id: c.id }, "Unlinked")}>
          Undo
        </button>
      </>
    ));
    if (comment && writes) void writes.begin(c.clientKey, [{ kind: "conversation_comment", conversationId: c.id, itemId }]);
  };
  /** CV-5: chatter's ⋯ › Create DevOps item: This is work first, then the draft on the conversation it made. */
  const createFromChatter = async (m: ConversationsData["chatter"][number]["messages"][number]) => {
    try {
      const r = await call<ConversationsData & { conversationId: number }>("conversations.this_is_work", { chatId: m.chatId, messageId: m.messageId });
      show(r);
      setError(null);
      setSel(r.conversationId);
      setForm({ id: r.conversationId, kind: "draft" });
      onChanged?.();
    } catch (e) {
      setError(errText(e));
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
      onDraft={() => openDraft(c)}
      onLink={(id, comment) => void link(c, id, comment)}
      onRun={run}
      form={form?.id === c.id ? form : null}
      onForm={(f) => setForm(f ? { id: c.id, ...f } : null)}
      others={all.filter((x) => x.chatId === c.chatId && x.id !== c.id)}
      onMerge={(into) => void merge([c.id], into)}
      picked={picked ? picked.has(c.id) : null}
      onPicked={(on) => setPicked((s) => {
        const n = new Set(s ?? []);
        if (on) n.add(c.id);
        else n.delete(c.id);
        return n;
      })}
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
        <button type="button" className="mini quiet" aria-pressed={picked !== null} title="Pick conversations of one chat to merge" onClick={() => setPicked((p) => (p ? null : new Set()))}>
          {picked ? "Done selecting" : "Select"}
        </button>
        <button type="button" className="mini" aria-label="Refresh conversations" title="Read your clients' registered chats now (only new messages)" disabled={!!busy} onClick={async () => {
          setBusy("refresh");
          await run("conversations.refresh", {});
          setBusy(null);
        }}>
          {busy === "refresh" ? "Reading Teams…" : "Refresh"}
        </button>
        {switcher && <ModeArea>{switcher}</ModeArea>}
      </div>
      {error && (
        <p className="set-problem" role="alert">
          {error}
        </p>
      )}
      <Fading text={notice} onGone={clearNotice} ms={8000} />
      {linkNote && (
        <p className="conv-link-note" role="status">
          {linkNote}{" "}
          <button type="button" className="mini quiet" onClick={() => setLinkNote(null)}>
            OK
          </button>
        </p>
      )}
      {picked && (
        <div className="conv-merge-bar" role="region" aria-label="Merge the picked conversations">
          {pickedCards.length < 2 ? (
            <span className="muted">Pick two or more conversations of one chat, then choose the one to keep.</span>
          ) : !oneChat ? (
            <span className="muted">These are in different chats. Merge only conversations of one chat.</span>
          ) : (
            <>
              <span>Merge {pickedCards.length} into:</span>
              {pickedCards.map((t) => (
                <button key={t.id} type="button" className="mini" onClick={() => void merge(pickedCards.filter((x) => x.id !== t.id).map((x) => x.id), t)}>
                  {t.title}
                </button>
              ))}
            </>
          )}
          <button type="button" className="mini quiet" onClick={() => setPicked(null)}>
            Cancel
          </button>
        </div>
      )}
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
          {state.needsYou.length + state.inProgress.length + state.teammates.length + state.closed.length === 0 && (
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
      {state && state.inProgress.length > 0 && (
        <section aria-label="In progress">
          <h3 className="conv-section">In progress</h3>
          <ul className="conv-list">{state.inProgress.map((c) => card(c))}</ul>
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
      {state?.chatter.map((g) => <Chatter key={g.clientKey} g={g} tz={tz} color={clientColor(g.clientKey, data.clients)} onWork={(m) => void run("conversations.this_is_work", { chatId: m.chatId, messageId: m.messageId }, "Moved into its own conversation")} onCreate={(m) => void createFromChatter(m)} />)}
      {state?.lastPoll && <p className="requests-poll muted" role="status">Last checked {whenText(state.lastPoll, tz)} · every {state.pollMinutes ?? 5} {state.pollMinutes === 1 ? "minute" : "minutes"} in working hours</p>}
    </main>
  );
}

type Suggest = ConversationCard["suggestions"][number];
function ConvCard(p: {
  c: ConversationCard; tz: string; color: string; compact: boolean; selected: boolean; expanded: boolean;
  onSelect: () => void; onToggle: () => void; onPrimary: () => void; onDraft: () => void; onLink: (itemId: number, comment: boolean) => void; onRun: (action: string, input: Record<string, unknown>, done?: ReactNode) => Promise<void>;
  form: { kind: CardForm; commitmentId?: number } | null; onForm: (f: { kind: CardForm; commitmentId?: number } | null) => void;
  /** CV-2: the same chat's other conversations (Merge into…), and the Select checkbox when picking several. */
  others: ConversationCard[]; onMerge: (into: ConversationCard) => void; picked: boolean | null; onPicked: (on: boolean) => void;
  onEnable: () => void; onSuggestion: (s: Suggest, includeInternal: boolean) => void; onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void;
}) {
  const { c } = p;
  const [menu, setMenu] = useState(false);
  const waiting = !!c.waiting;
  const style = { "--c": p.color } as CSSProperties;
  const pick = p.picked !== null && (
    <input type="checkbox" className="conv-pick" aria-label={`Pick ${c.title} to merge`} checked={p.picked} onClick={(e) => e.stopPropagation()} onChange={(e) => p.onPicked(e.target.checked)} />
  );
  if (p.compact && !p.selected && !p.expanded) {
    return (
      <li className="conv-line" style={style} data-conv={c.id} tabIndex={-1} onFocus={p.onSelect} onClick={p.onSelect}>
        {pick}
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
    ...(c.primary !== "link" && !c.item ? [{ label: "Link to item…", run: () => p.onForm({ kind: "link" }) }] : []),
    ...(c.primary !== "create" && !c.item ? [{ label: "Create DevOps item…", run: p.onDraft }] : []),
    ...(c.item ? [{ label: `Unlink #${c.item.id}`, run: () => void p.onRun("conversations.unlink", { id: c.id }, "Unlinked") }] : []),
    ...(p.others.length ? [{ label: "Merge into…", run: () => p.onForm({ kind: "merge" }) }] : []),
    { label: c.hidden ? "Show for me" : "Hide for me", run: () => void p.onRun("conversations.hide", { id: c.id, hidden: !c.hidden }, c.hidden ? "Shown again" : "Hidden for you. Nobody else's view changes") },
    ...(c.closed && c.primary !== "reopen" ? [{ label: "Open again", run: () => void p.onRun("conversations.reopen", { id: c.id }, "Open again") }] : []),
  ];
  return (
    <li className={`conv-card${p.selected ? " selected" : ""}${c.closed ? " resolved" : ""}`} style={style} data-conv={c.id} tabIndex={p.selected ? 0 : -1} aria-label={c.title} onFocus={p.onSelect} onClick={p.onSelect}>
      <div className="conv-head">
        {pick}
        <span className="swatch" aria-hidden="true" />
        <strong className="conv-title">{c.title}</strong>
        {c.updated && <span className="conv-updated" title={c.updated}>Updated</span>}
        <span className={`conv-status${waiting ? " waiting" : ""}`}>{c.statusLine}</span>
      </div>
      <p className="conv-sub muted">
        {c.clientName} · {c.chatName} · <time dateTime={c.lastAt}>{whenText(c.lastAt, p.tz)}</time>
        {c.images ? <span className="conv-images"> · {c.images === 1 ? "1\u00a0image" : `${c.images}\u00a0images`}{c.imageNote ? `: ${c.imageNote}` : ""}</span> : null}
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
      {c.summary.trim() ? (
        <p className="conv-summary">
          {c.summary.split("\n").slice(0, 4).map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </p>
      ) : (
        // CV-3: grouped by rules (AI off for this client): no summary; Show messages has them all.
        <p className="conv-summary muted">Grouped without AI, so there's no summary. Show messages to read it.</p>
      )}
      {c.item && <LinkedItem item={c.item} tz={p.tz} lead="Tracked as" />}
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
      {p.form?.kind === "merge" && <MergeInto c={c} others={p.others} tz={p.tz} onPick={p.onMerge} onCancel={() => p.onForm(null)} />}
      {p.form?.kind === "link" && <ConvLink c={c} onPick={p.onLink} onCancel={() => p.onForm(null)} />}
      {p.form?.kind === "draft" && <DraftItem c={c} commitmentId={p.form.commitmentId ?? null} onCreate={p.onCreate} onCancel={() => p.onForm(null)} />}
      {p.expanded && <Messages c={c} tz={p.tz} />}
    </li>
  );
}

/** CV-2: Merge into…: the same chat's other conversations; the one picked keeps its place, this one moves into it. */
function MergeInto({ c, others, tz, onPick, onCancel }: { c: ConversationCard; others: ConversationCard[]; tz: string; onPick: (into: ConversationCard) => void; onCancel: () => void }) {
  return (
    <div className="ask-form conv-merge" role="group" aria-label={`Merge ${c.title} into another conversation`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <p className="conv-suggest-head">Merge into…</p>
      <p className="muted">Its messages, commitments and suggestions move into the one you pick, for everyone on the chat. The summary is written again. You can undo it.</p>
      <ul className="conv-merge-list">
        {others.map((o, i) => (
          <li key={o.id}>
            <button type="button" className="mini quiet" autoFocus={i === 0} onClick={() => onPick(o)}>
              <strong>{o.title}</strong> <span className="muted">· {o.statusLine} · {whenText(o.lastAt, tz)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mini quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
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

/**
 * CV-5: a linked item with its live state from the central store: "#id title · Active · Dana · changed Tue"; when it
 * closed in DevOps, "Item closed" (Mark done is the card's primary, never done automatically).
 */
export function LinkedItem({ item, tz, lead }: { item: NonNullable<ConversationCard["item"]>; tz: string; lead: string }) {
  return (
    <p className={`conv-item${item.closed ? " closed" : ""}`}>
      {item.closed ? <strong className="conv-item-closed">Item closed</strong> : lead}{" "}
      <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer">
        #{item.id} {item.title ?? ""}
      </a>
      {item.state && (
        <span className="muted">
          {" "}
          · {item.state} · {item.assignee ?? "Unassigned"}
          {item.changedAt ? <> · changed {whenText(item.changedAt, tz)}</> : null}
        </span>
      )}
    </p>
  );
}

/** CV-5: "Also add a comment on the item", off by default; the comment goes through its own preview and confirm. */
export function AlsoComment({ on, set, disabled }: { on: boolean; set: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="conv-internal-toggle">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} /> Also add a comment on the item, with a link back to Teams
      {disabled && <span className="muted"> (needs DevOps writes)</span>}
    </label>
  );
}

function ConvLink({ c, onPick, onCancel }: { c: ConversationCard; onPick: (id: number, comment: boolean) => void; onCancel: () => void }) {
  const [q, setQ] = useState(c.likely ? `#${c.likely.id}` : "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [comment, setComment] = useState(false);
  const pick = (id: number) => onPick(id, comment && c.canCreate);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void call<{ available: boolean; items: Hit[] }>("conversations.search_items", { id: c.id, query: q }).then(
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
        <input autoFocus value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or #id" onKeyDown={(e) => e.key === "Enter" && hits?.[0] && (e.preventDefault(), pick(hits[0].id))} />
      </label>
      {!available && <p className="set-problem">DevOps couldn't be read for {c.clientName}. Try again in a moment.</p>}
      {hits && available && (
        <ul className="ask-hits" aria-label="Open items">
          {hits.length === 0 && <li className="muted">No open items match</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="mini quiet" onClick={() => pick(h.id)}>
                <TypeIcon clientKey={c.clientKey} type={h.type} /> #{h.id} {h.title} <span className="muted">· {h.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AlsoComment on={comment} set={setComment} disabled={!c.canCreate} />
      <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
    </div>
  );
}

type TypeChoices = { choices: { type: string; bug: boolean }[]; type: string | null };
type DraftData = { draft: ItemDraft; notSorted: string | null; features: { id: number; title: string; type: string }[]; types?: Record<string, TypeChoices>; internalChat: boolean; canCreate: boolean };
/**
 * Create DevOps item (CV-1, CV-5): one form for any conversation or promise. The AI's draft from that conversation only
 * (title, path of action, acceptance criteria, type, parent) when AI may run for the client; otherwise empty for me to
 * fill in. Me or nobody as the assignee. Without my write access it says how to turn writes on, and sends nothing.
 */
export function DraftItem({ c, commitmentId, onCreate, onCancel }: { c: Pick<ConversationCard, "id" | "clientName" | "clientKey">; commitmentId: number | null; onCreate: (change: import("./DevOpsWrite.tsx").DevOpsChange) => void; onCancel: () => void }) {
  const writes = useDevOpsWrite();
  const [d, setD] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<ItemDraft["level"]>("story");
  const [type, setType] = useState<string>("");
  const [parent, setParent] = useState<string>("");
  const [path, setPath] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [assignMe, setAssignMe] = useState(true);
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const fill = useCallback(async (regenerate: boolean) => {
    setBusy(true);
    try {
      const r = await call<DraftData>("conversations.draft", { id: c.id, ...(commitmentId ? { commitmentId } : {}), ...(regenerate ? { regenerate: true } : {}) });
      setD(r);
      setTitle(r.draft.title);
      setLevel(r.draft.level);
      const p = r.draft.parentId ? String(r.draft.parentId) : "";
      setParent(p);
      setType(r.types?.[p || "none"]?.type ?? "");
      setPath(pathOfAction(r.draft));
      setAcceptance(acceptanceText(r.draft));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [c.id, commitmentId]);
  useEffect(() => void fill(false), [fill]);
  // WT-1: only the valid child types under the chosen parent, the most common first.
  const options = d?.types?.[parent || "none"];
  const chosen = options?.choices.find((x) => x.type === type) ?? null;
  const pickParent = (p: string) => {
    setParent(p);
    const next = d?.types?.[p || "none"];
    if (next && !next.choices.some((x) => x.type === type)) setType(next.type ?? "");
  };
  const canSend = !!d?.canCreate && !!writes;
  return (
    <form
      className="ask-form conv-draft"
      aria-label="Create DevOps item"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || !canSend) return;
        onCreate({
          kind: "conversation_create", conversationId: c.id, ...(commitmentId ? { commitmentId } : {}), title: title.trim(), description: path, level: chosen?.bug ? "bug" : level === "bug" ? "story" : level,
          ...(type ? { type } : {}), ...(parent ? { parentId: Number(parent) } : {}), ...(include ? { includeInternal: true } : {}), ...(acceptance.trim() ? { acceptance: acceptance.trim() } : {}), ...(assignMe ? {} : { assign: "none" }),
        });
      }}
    >
      <p className="conv-suggest-head">Create DevOps item</p>
      {error && <p className="set-problem">{error}</p>}
      {!d && !error && <p className="muted">Getting the form ready…</p>}
      {d && (
        <>
          {d.notSorted && <p className="muted">{d.draft.byAi ? null : <>Not drafted by AI ({d.notSorted}). Fill it in below.</>}</p>}
          {!canSend && (
            <p className="conv-turn-on" role="status">
              Turn on DevOps writes for {c.clientName} to create it. Nothing is sent until you do.{" "}
              {writes && (
                <button type="button" className="linkish" onClick={() => writes.enable(c.clientKey)}>
                  Settings › Clients
                </button>
              )}
            </p>
          )}
          <label>
            Title
            <input autoFocus maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Parent
            <select value={parent} onChange={(e) => pickParent(e.target.value)}>
              <option value="">None (the project's default area and iteration)</option>
              {d.features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.type} #{f.id} {f.title}
                </option>
              ))}
            </select>
          </label>
          {options && options.choices.length > 0 ? (
            <fieldset className="conv-types">
              <legend>Type</legend>
              {options.choices.map((x) => (
                <label key={x.type} className={`conv-type${x.type === type ? " on" : ""}`}>
                  <input type="radio" name={`conv-type-${c.id}`} value={x.type} checked={x.type === type} onChange={() => setType(x.type)} />
                  <TypeIcon clientKey={c.clientKey} type={x.type} decorative /> {x.type}
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Type
              <select value={level} onChange={(e) => (setLevel(e.target.value as ItemDraft["level"]), setType(""))}>
                <option value="bug">Bug</option>
                <option value="story">Story</option>
                <option value="feature">Feature</option>
              </select>
            </label>
          )}
          <label>
            Description <span className="muted">(the conversation's messages, who and when, and the Teams link are added below it)</span>
            <textarea rows={8} maxLength={8000} value={path} onChange={(e) => setPath(e.target.value)} />
          </label>
          <label>
            Acceptance criteria <span className="muted">(one per line; only where the type has them)</span>
            <textarea rows={4} maxLength={8000} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
          </label>
          <label className="conv-internal-toggle">
            <input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} /> Assign it to me (otherwise unassigned)
          </label>
          {d.internalChat && (
            <label className="conv-internal-toggle">
              <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} /> Include the messages from this internal chat (left out by default)
            </label>
          )}
          <div className="ask-actions">
            <button type="submit" className="mini primary" disabled={!canSend || !title.trim()}>
              Preview in DevOps
            </button>
            <button type="button" className="mini quiet" disabled={busy} onClick={() => void fill(true)}>
              {busy ? "Drafting…" : "Draft again"}
            </button>
            <button type="button" className="mini quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** CV-2: Show messages: the latest page, rendered like Teams (ui/MessageThread.tsx), with Show earlier. */
function Messages({ c, tz }: { c: ConversationCard; tz: string }) {
  const [ms, setMs] = useState<ConversationMessage[] | string | null>(null);
  const [earlier, setEarlier] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    void call<ConversationMessages>("conversations.messages", { id: c.id }).then((r) => live && (setMs(r.messages), setEarlier(r.earlier)), (e) => live && setMs(errText(e)));
    return () => void (live = false);
  }, [c.id]);
  const emails = useMemo(() => (Array.isArray(ms) ? [...new Set(ms.map((m) => m.email).filter((e): e is string => !!e))] : []), [ms]);
  const photos = usePhotos({ emails });
  // CV-2: every image loaded so far, in thread order, for the viewer's Previous and Next.
  const viewable = useMemo(() => (Array.isArray(ms) ? ms.flatMap((m) => (m.images ?? []).flatMap((i) => (i.src ? [{ id: i.id, src: i.src }] : []))) : []), [ms]);
  const [viewing, setViewing] = useState<number | null>(null);
  if (ms === null) return <p className="muted">Loading…</p>;
  if (typeof ms === "string") return <p className="set-problem">{ms}</p>;
  const more = async () => {
    if (!earlier) return;
    setLoading(true);
    try {
      const r = await call<ConversationMessages>("conversations.messages", { id: c.id, before: earlier });
      setMs((cur) => [...r.messages, ...(Array.isArray(cur) ? cur : [])]);
      setEarlier(r.earlier);
    } catch (e) {
      setMs(errText(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="conv-messages" onClick={(e) => e.stopPropagation()}>
      <MessageThread messages={ms} tz={tz} photoFor={(e) => photos.photoFor(e)} earlier={!!earlier} loadingEarlier={loading} onEarlier={() => void more()} onImage={(id) => setViewing(Math.max(0, viewable.findIndex((i) => i.id === id)))} />
      {viewing !== null && viewable.length > 0 && <ImageViewer images={viewable} at={viewing} onAt={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

type ChatterMessage = ConversationsData["chatter"][number]["messages"][number];
function Chatter({ g, tz, color, onWork, onCreate }: { g: ConversationsData["chatter"][number]; tz: string; color: string; onWork: (m: ChatterMessage) => void; onCreate: (m: ChatterMessage) => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
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
              {/* CV-5: Create DevOps item only under ⋯ for chatter: This is work first, then the draft. */}
              <span className="fu-more">
                <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu === m.messageId} aria-label={`More for the message from ${m.author}`} onClick={() => setMenu((x) => (x === m.messageId ? null : m.messageId))}>
                  ⋯
                </button>
                {menu === m.messageId && (
                  <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(null))}>
                    <button type="button" role="menuitem" autoFocus onClick={() => (setMenu(null), onCreate(m))}>
                      Create DevOps item…
                    </button>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
