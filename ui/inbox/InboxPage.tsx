// IB-4: the slim Inbox. One page with a switch, From chats · Promises · Captures, each with its count; the client
// chips filter all three; rows are grouped by client and open in place. From chats: conversations in my chats that ask
// for a DevOps item no one has made, quiet for 4 working hours (Create item, Already covered, Dismiss). Promises: what I
// owe, late first, then by due, then no date; the ones that cleared on their own fold at the foot with Put back.
// Captures: the capture box, what's left to sort and the drafts to add in DevOps. The list I used last is remembered.
// Keys (never while typing): J and K move, Enter opens or closes, C, L and X on From chats, D on Promises, ? the help.
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { ClearedPromise, ConversationMessages, SuggestionRow } from "../../plan/conversation-views.ts";
import type { InboxItemView } from "../../plan/inbox-items.ts";
import { userZone } from "../../week/zone.ts";
import { call } from "../api.ts";
import { CaptureBox, captureClients } from "../Capture.tsx";
import { CreateDraftCtx } from "../createdraft-ctx.ts";
import { DraftEditorCtx } from "../DraftEditor.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { markSeen } from "../inboxcount.ts";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "../keys.ts";
import { ASK_KEY_EVENT } from "../menu.ts";
import { clientColor } from "../labels.ts";
import { INBOX_LIST_NAMES, INBOX_LISTS, listOfKey, navOf, type InboxList, type LateFilter, type Nav } from "../nav.ts";
import { Stamp } from "../Stamp.tsx";
import { usePhone } from "../viewport.ts";
import { entryOf, useInboxData, type Entry } from "./data.ts";
import { Detail } from "./Detail.tsx";
import { actsFor, ITEM_KEYS, type FormId } from "./ItemActions.tsx";
import { dueWords, lateText } from "./model.ts";
import { SuggestionOpen, type SuggestionForm } from "./Suggestion.tsx";
import "./inbox.css";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
/** The remembered list is the person's Inbox setting (ui.set_inbox's view): From chats is stored as Needs you. */
const LIST_PREF: Record<InboxList, "needs_you" | "promises" | "captures"> = { chats: "needs_you", promises: "promises", captures: "captures" };
const listOfPref = (v: string | undefined): InboxList => (v === "promises" ? "promises" : v === "captures" ? "captures" : "chats");
/** The list I chose this session, so coming back to #/inbox lands there before my saved setting is read again. */
let chosenThisSession: InboxList | null = null;
const EMPTY: Record<InboxList, string> = { chats: "Nothing from your chats needs an item.", promises: "No promises open.", captures: "Nothing to sort." };

type Group<T> = { clientKey: string | null; name: string; rows: T[] };
function byClient<T>(rows: readonly T[], keyOf: (r: T) => string | null, name: (k: string | null) => string): Group<T>[] {
  const m = new Map<string, Group<T>>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k ?? "") ?? { clientKey: k, name: name(k), rows: [] };
    g.rows.push(r);
    m.set(k ?? "", g);
  }
  return [...m.values()].sort((a, b) => (a.clientKey === null ? 1 : b.clientKey === null ? -1 : a.name.localeCompare(b.name)));
}

/** Promises: late first, then by due (a time before a day), then no date, newest first. */
export function promiseOrder(a: InboxItemView, b: InboxItemView): number {
  const due = (r: InboxItemView) => r.dueAt ?? (r.due ? `${r.due}T23:59` : null);
  if (a.late !== b.late) return a.late ? -1 : 1;
  const x = due(a);
  const y = due(b);
  if (x && y) return x.localeCompare(y);
  if (x || y) return x ? -1 : 1;
  return b.at.localeCompare(a.at);
}

export function InboxPage({ nav, data, version, onNav, onChanged }: { nav: Extract<Nav, { tab: "inbox" }>; data: WeekLoadData; version: number; onNav: (n: Nav) => void; onChanged: () => void; onFeedback?: () => void }): ReactNode {
  const phone = usePhone();
  const tz = userZone(data);
  const writes = useDevOpsWrite();
  const src = useInboxData(`${version}:${writes?.version ?? 0}`);
  const createDraft = useContext(CreateDraftCtx);
  const editDraft = useContext(DraftEditorCtx);
  const today = src.list?.today ?? data.planDay.date;
  const clientList = useMemo(() => captureClients(data), [data]);
  const clientName = useCallback((k: string | null) => (k ? (clientList.find((c) => c.clientKey === k)?.clientName ?? k) : "No client"), [clientList]);
  const [lastList, setLastList] = useState<InboxList>(chosenThisSession ?? listOfPref(data.ui.inbox?.view));
  const list: InboxList = nav.view ?? (nav.item ? (listOfKey(nav.item) ?? lastList) : lastList);
  const [clients, setClients] = useState<string[]>(data.ui.inbox?.clients ?? []);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormId | null>(null);
  const [sForm, setSForm] = useState<SuggestionForm>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [clearedOpen, setClearedOpen] = useState(false);
  // UI-9's late filter stays while I open and close its rows (their addresses carry no filter); choosing a list ends it.
  const [kept, setKept] = useState<LateFilter | null>(nav.late ?? null);
  useEffect(() => {
    if (nav.late) setKept(nav.late);
    else if (nav.view !== "promises" || !nav.item) setKept(null);
  }, [nav.late?.client, nav.view, nav.item]); // eslint-disable-line react-hooks/exhaustive-deps
  const late = nav.late ?? (nav.view === "promises" && nav.item ? kept : null);

  // The list I chose is remembered (my Inbox setting); an address with a list wins while it's there.
  useEffect(() => {
    if (!nav.view || nav.view === lastList) return;
    setLastList(nav.view);
    chosenThisSession = nav.view;
    void call("ui.set_inbox", { view: LIST_PREF[nav.view] }, { background: true }).catch(() => undefined);
  }, [nav.view, lastList]);
  const chooseList = (l: InboxList) => (setKept(null), onNav({ tab: "inbox", view: l, item: null }));
  const toggleClient = (k: string | null) => {
    const next = k === null ? [] : clients.includes(k) ? clients.filter((x) => x !== k) : [...clients, k];
    setClients(next);
    void call("ui.set_inbox", { clients: next }, { background: true }).catch(() => undefined);
  };
  const inClients = useCallback((k: string | null) => !clients.length || (k !== null && clients.includes(k)), [clients]);

  // ---- the three lists ----
  const items = useMemo(() => src.list?.items ?? [], [src.list]);
  const suggestions = useMemo(() => (src.chats?.suggestions ?? []).filter((s) => inClients(s.clientKey)), [src.chats, inClients]);
  const promiseRows = useMemo(
    () => items.filter((r) => r.kind === "promise" && !r.done && r.views.length > 0 && inClients(r.clientKey) && (!late || (r.late && (late.client === null || r.clientKey === late.client)))).sort(promiseOrder),
    [items, inClients, late],
  );
  const captureRows = useMemo(() => items.filter((r) => (r.kind === "capture" || r.kind === "draft") && r.views.length > 0 && inClients(r.clientKey)), [items, inClients]);
  const counts: Record<InboxList, number> = { chats: suggestions.length, promises: promiseRows.length, captures: captureRows.length };
  // Every client with something in any list, for the chips.
  const chipClients = useMemo(() => {
    const ks = new Set<string>();
    for (const s of src.chats?.suggestions ?? []) ks.add(s.clientKey);
    for (const r of items) if (r.clientKey && (r.kind === "promise" || r.kind === "capture" || r.kind === "draft") && !r.done) ks.add(r.clientKey);
    for (const k of clients) ks.add(k);
    return [...ks].sort((a, b) => clientName(a).localeCompare(clientName(b)));
  }, [src.chats, items, clients, clientName]);

  const chatGroups = useMemo(() => byClient(suggestions, (s) => s.clientKey, clientName), [suggestions, clientName]);
  const promiseGroups = useMemo(() => byClient(promiseRows, (r) => r.clientKey, clientName), [promiseRows, clientName]);
  const sortGroups = useMemo(() => byClient(captureRows.filter((r) => r.kind === "capture"), (r) => r.clientKey, clientName), [captureRows, clientName]);
  const draftGroups = useMemo(() => byClient(captureRows.filter((r) => r.kind === "draft"), (r) => r.clientKey, clientName), [captureRows, clientName]);
  /** The keys in the order J and K walk them. */
  const order = useMemo(
    () => (list === "chats" ? chatGroups.flatMap((g) => g.rows.map((s) => `v${s.id}`)) : list === "promises" ? promiseGroups.flatMap((g) => g.rows.map((r) => r.key)) : [...sortGroups, ...draftGroups].flatMap((g) => g.rows.map((r) => r.key))),
    [list, chatGroups, promiseGroups, sortGroups, draftGroups],
  );

  // ---- the open row ----
  const openKey = nav.item && listOfKey(nav.item) === list ? nav.item : null;
  const openSuggestion = openKey?.startsWith("v") ? (src.chats?.suggestions.find((s) => `v${s.id}` === openKey) ?? null) : null;
  const openRow = openKey && !openKey.startsWith("v") ? (items.find((r) => r.key === openKey) ?? null) : null;
  const entry: Entry | null = openRow ? entryOf(openRow, src) : null;
  useEffect(() => {
    setForm(nav.loop && openRow?.kind === "promise" ? "close" : null);
    setSForm(null);
  }, [openKey, nav.loop, openRow?.kind]);
  const open = useCallback((key: string | null) => onNav(key ? { tab: "inbox", view: listOfKey(key) ?? list, item: key } : late && list === "promises" ? navOf.inboxLate(late.client) : { tab: "inbox", view: list, item: null }), [onNav, list, late]);
  // Seen when opened (a promise stops being new).
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  useEffect(() => {
    if (!openRow || openRow.kind !== "promise") return;
    void markSeen([openRow.key], () => changedRef.current());
  }, [openRow]);
  useEffect(() => {
    if (openKey) document.querySelector(".ib4-row.open")?.scrollIntoView({ block: "nearest" });
  }, [openKey]);

  // A single conversation's address that isn't a suggestion now: say so, with its chat in Teams.
  const [notWaiting, setNotWaiting] = useState<{ id: number; link: string | null } | null>(null);
  const convAsked = nav.item?.startsWith("v") ? Number(nav.item.slice(1)) : null;
  useEffect(() => {
    setNotWaiting(null);
    if (convAsked === null || !src.chats || src.chats.suggestions.some((s) => s.id === convAsked)) return;
    let live = true;
    void call<ConversationMessages>("conversations.messages", { id: convAsked }).then(
      (r) => live && setNotWaiting({ id: convAsked, link: r.chatLink }),
      () => live && setNotWaiting({ id: convAsked, link: null }),
    );
    return () => void (live = false);
  }, [convAsked, src.chats]);

  // ---- running actions ----
  const reloadAll = useCallback(async () => {
    await src.reload();
    onChanged();
  }, [src, onChanged]);
  const run = useCallback(
    async (action: string, input: Record<string, unknown>, msg: string, undo?: { action: string; input: Record<string, unknown> } | (() => Promise<unknown>)) => {
      try {
        if (action !== "inbox.list") await call(action, input);
        setError(null);
        setForm(null);
        setSForm(null);
        const undoRun = typeof undo === "function" ? undo : undo ? () => call(undo.action, undo.input) : null;
        setNotice(
          undoRun ? (
            <>
              {msg}.{" "}
              <button type="button" className="mini quiet" onClick={() => void undoRun().then(() => (setNotice("Undone"), void reloadAll()), (e) => setError(errText(e)))}>
                Undo
              </button>
            </>
          ) : (
            msg
          ),
        );
        await reloadAll();
      } catch (e) {
        setError(errText(e));
        void reloadAll();
      }
    },
    [reloadAll],
  );
  const submit = useCallback(
    async (action: string, input: Record<string, unknown>, msg: string): Promise<string | null> => {
      try {
        await call(action, input);
        setForm(null);
        setNotice(msg);
        await reloadAll();
        return null;
      } catch (e) {
        return errText(e);
      }
    },
    [reloadAll],
  );
  const orderRef = useRef(order);
  orderRef.current = order;
  /** The row to open after one leaves the list: the next, else the one before. */
  const after = (key: string) => {
    const o = orderRef.current;
    const i = o.indexOf(key);
    return i < 0 ? null : (o[i + 1] ?? o[i - 1] ?? null);
  };
  const dismiss = (s: SuggestionRow) => {
    open(after(`v${s.id}`));
    void run("conversations.dismiss", { id: s.id }, "Dismissed for you", { action: "conversations.undismiss", input: { id: s.id } });
  };
  const asPromise = async (s: SuggestionRow) => {
    try {
      const r = await call<{ followUp: { id: number } }>("followup.add", { what: s.title, clientKey: s.clientKey });
      open(after(`v${s.id}`));
      await run("conversations.dismiss", { id: s.id, as: "promised" }, "Added to your promises", () => Promise.all([call("followup.delete", { id: r.followUp.id }), call("conversations.undismiss", { id: s.id })]));
    } catch (e) {
      setError(errText(e));
    }
  };
  const notWork = (s: SuggestionRow) => {
    open(after(`v${s.id}`));
    void run("conversations.not_work", { id: s.id }, "Not work: closed for everyone on the chat", { action: "conversations.not_work_undo", input: { id: s.id } });
  };
  const linked = (s: SuggestionRow, itemId: number, comment: boolean) => {
    open(after(`v${s.id}`));
    void run("conversations.link", { id: s.id, itemId }, `Linked to #${itemId} for everyone on the chat`).then(() => {
      if (comment && writes) void writes.begin(s.clientKey, [{ kind: "conversation_comment", conversationId: s.id, itemId }]);
    });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const acts = entry
    ? actsFor(entry, {
        run,
        form: setForm,
        // QC-1: a draft's Create in DevOps opens the preview directly (the New form is for changing it first).
        createDraft: (id: number) => {
          const d = src.caps?.drafts.find((x) => x.id === id);
          if (d && writes?.can(d.clientKey)) writes.create(d.clientKey, [d]);
          else createDraft?.(id);
        },
        editDraft: (id: number) => {
          const d = src.caps?.drafts.find((x) => x.id === id);
          if (d) editDraft?.(d);
        },
        planWeek: () => onNav(navOf.addWork()),
        today,
      })
    : [];

  // ---- keys ----
  const keyRef = useRef({ order, openKey, acts, open, form, sForm, openSuggestion, list });
  keyRef.current = { order, openKey, acts, open, form, sForm, openSuggestion, list };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keyRef.current;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      // The Inbox's keys win over the app's own (C is Capture elsewhere): this listener runs first and stops the rest.
      const done = () => (e.preventDefault(), e.stopImmediatePropagation());
      if (e.key === "?") return void (setKeysOpen((v) => !v), done());
      if (e.key === "Escape" && (k.form || k.sForm)) return void (setForm(null), setSForm(null));
      if (key === "J" || key === "K") {
        if (!k.order.length) return;
        const i = k.openKey ? k.order.indexOf(k.openKey) : -1;
        k.open(k.order[Math.max(0, Math.min(k.order.length - 1, i + (key === "J" ? 1 : -1)))]!);
        return done();
      }
      if (e.key === "Enter" && (e.target as HTMLElement | null)?.tagName !== "BUTTON" && (e.target as HTMLElement | null)?.tagName !== "A") {
        if (k.openKey) k.open(null);
        else if (k.order[0]) k.open(k.order[0]);
        else return;
        return done();
      }
      if (k.list === "chats" && k.openSuggestion) {
        if (key === "C") return void (setSForm("create"), done());
        if (key === "L") return void (setSForm("link"), done());
        if (key === "X") return void (dismissRef.current(k.openSuggestion), done());
      }
      if (k.list === "promises" && key === "D") {
        const a = k.acts.find((x) => x.id === "done");
        if (a) return void (a.run(), done());
      }
    };
    // The command menu's Inbox commands send the same keys.
    const KEY_OF: Record<string, string> = { next: "J", prev: "K", open: "Enter", create: "C", link: "L", dismiss: "X", done: "D" };
    const onCmd = (e: Event) => {
      const key = KEY_OF[String((e as CustomEvent).detail)];
      if (key) onKey(new KeyboardEvent("keydown", { key: key === "Enter" ? "Enter" : key.toLowerCase() }));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(ASK_KEY_EVENT, onCmd);
    return () => (window.removeEventListener("keydown", onKey, true), window.removeEventListener(ASK_KEY_EVENT, onCmd));
  }, []);

  // ---- rendering ----
  const color = (k: string | null) => clientColor(k ?? undefined, data.clients);
  const detail = (e: Entry) => (
    <Detail entry={e} acts={acts} form={form} setForm={setForm} data={data} tz={tz} today={today} clientName={clientName} run={run} submit={submit} reload={() => void src.reload()} phone={phone} inline finished={(m) => (setForm(null), setNotice(m), void reloadAll())} />
  );
  const promiseTag = (r: InboxItemView) => (r.late && r.due ? { text: lateText(r.due, today), tone: "late" } : r.due ? { text: dueWords(r.due, today), tone: r.due <= today ? "soon" : "plain" } : null);
  const loaded = !!src.list;

  const firstCleared = src.promises?.firstCleared ?? null;
  const cleared: ClearedPromise[] = (src.promises?.cleared ?? []).filter((c) => inClients(c.clientKey));
  const showCleared = () => {
    setClearedOpen(true);
    if (firstCleared) void call("my_promises.cleared_seen", {}).then(() => void src.reload(), () => undefined);
    setTimeout(() => document.querySelector(".ib4-cleared")?.scrollIntoView({ block: "start" }), 50);
  };

  const rowHead = (key: string, title: string, sub: ReactNode, tag: { text: string; tone: string } | null, clientKey: string | null, hover?: string) => (
    <button type="button" className="ib4-row-head" aria-expanded={openKey === key} onClick={() => open(openKey === key ? null : key)} title={hover}>
      <span className="ib4-swatch" aria-hidden="true" style={{ "--c": color(clientKey) } as CSSProperties} />
      <span className="ib4-row-main">
        <span className="ib4-row-title">{title || "(no title)"}</span>
        <span className="ib4-row-sub muted">{sub}</span>
      </span>
      {tag && <span className={`ib-tag tone-${tag.tone}`}>{tag.text}</span>}
      <span className="ib4-chev" aria-hidden="true">{openKey === key ? "⌃" : "›"}</span>
    </button>
  );
  const groupHead = (name: string, n: number) => (
    <h3 className="ib4-group-head">
      {name} <span className="muted">{n}</span>
    </h3>
  );

  const chatsList = chatGroups.map((g) => (
    <section key={g.clientKey ?? ""} className="ib4-group" aria-label={g.name}>
      {groupHead(g.name, g.rows.length)}
      <ul className="ib4-rows">
        {g.rows.map((s) => {
          const key = `v${s.id}`;
          const isOpen = openKey === key;
          return (
            <li key={key} className={`ib4-row${isOpen ? " open" : ""}`} data-key={key}>
              {rowHead(
                key,
                s.title,
                <>
                  {/* Open, the summary shows in full below; never twice. */}
                  {!isOpen && <span className="ib4-summary">{s.summary.split("\n").slice(0, 2).join(" ") || s.conversationTitle}</span>}
                  <span className="ib4-who">
                    {s.people.length ? `${s.people.join(", ")} · ` : ""}
                    <Stamp at={s.lastWorkAt} tz={tz} today={today} />
                    {s.mentions?.length ? ` · mentions ${s.mentions.join(", ")}` : ""}
                  </span>
                </>,
                null,
                s.clientKey,
                s.why ? `Why: ${s.why}` : undefined,
              )}
              {isOpen && (
                <SuggestionOpen s={s} form={sForm} setForm={setSForm} tz={tz} color={color(s.clientKey)} phone={phone} onDismiss={() => dismiss(s)} onPromise={() => void asPromise(s)} onNotWork={() => notWork(s)} onLinked={(id, c) => linked(s, id, c)} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  ));

  const rowList = (groups: Group<InboxItemView>[], label: (r: InboxItemView) => ReactNode) =>
    groups.map((g) => (
      <section key={g.clientKey ?? ""} className="ib4-group" aria-label={g.name}>
        {groupHead(g.name, g.rows.length)}
        <ul className="ib4-rows">
          {g.rows.map((r) => {
            const isOpen = openKey === r.key;
            return (
              <li key={r.key} className={`ib4-row${isOpen ? " open" : ""}${r.late ? " late" : ""}`} data-key={r.key}>
                {rowHead(r.key, r.title, label(r), r.kind === "promise" ? promiseTag(r) : null, r.clientKey)}
                {isOpen && entry && entry.row.key === r.key && detail(entry)}
              </li>
            );
          })}
        </ul>
      </section>
    ));

  const firstLine = firstCleared ? (
    <p className="ib4-first-cleared" role="status">
      {firstCleared} older {firstCleared === 1 ? "promise" : "promises"} from chats {firstCleared === 1 ? "was" : "were"} cleared.{" "}
      <button type="button" className="link-btn" onClick={showCleared}>
        Show
      </button>
    </p>
  ) : null;
  const promisesList = rowList(promiseGroups, (r) => (
    <>
      {r.who ? `For ${r.who}` : "For no one named"}
      {r.where ? ` · ${r.where}` : ""}
      {r.itemId ? ` · #${r.itemId}` : ""}
    </>
  ));
  const capturesList = (
    <>
      <section className="ib-capture ib4-capture" aria-label="Capture">
        <CaptureBox data={data} onChanged={() => void reloadAll()} defaultClient={clients.length === 1 ? clients[0]! : null} large={!phone} />
      </section>
      {sortGroups.length > 0 && <h2 className="ib4-section">To sort</h2>}
      {rowList(sortGroups, (r) => <Stamp at={r.at} tz={tz} today={today} />)}
      {draftGroups.length > 0 && <h2 className="ib4-section">Drafts</h2>}
      {rowList(draftGroups, (r) => r.where ?? "Draft")}
    </>
  );

  const chatsFoot = (
    <footer className="ib4-foot" aria-label="About From chats">
      <p className="muted">
        {src.chats?.foot.lastPoll ? (
          <>
            Chats last checked <Stamp at={src.chats.foot.lastPoll} tz={tz} today={today} />. A conversation shows here once it has been quiet for 4 working hours.
          </>
        ) : (
          "Your clients' chats haven't been read yet. A conversation shows here once it has been quiet for 4 working hours."
        )}{" "}
        <button type="button" className="link-btn" onClick={() => void run("conversations.refresh", {}, "Checked your chats")}>
          Refresh
        </button>
      </p>
      {(src.chats?.foot.cannot ?? []).filter((c) => inClients(c.clientKey)).map((c) => (
        <p key={c.clientKey} className="muted ib4-cannot">
          {c.clientName} can't get suggestions now: {c.text.replace(/\.$/, "")}.{c.fix ? ` ${c.fix}` : ""}
        </p>
      ))}
      {src.chatsError && <p className="set-problem">From chats couldn't be read: {src.chatsError}</p>}
    </footer>
  );
  const promisesFoot = cleared.length ? (
    <footer className="ib4-foot" aria-label="Cleared on their own">
      <button type="button" className="link-btn ib4-cleared-toggle" aria-expanded={clearedOpen} onClick={() => (clearedOpen ? setClearedOpen(false) : showCleared())}>
        Cleared on their own · {cleared.length} {clearedOpen ? "⌃" : "›"}
      </button>
      {clearedOpen && (
        <ul className="ib4-cleared" aria-label="Cleared on their own">
          {cleared.map((c) => (
            <li key={c.id}>
              <span className="ib4-swatch" aria-hidden="true" style={{ "--c": color(c.clientKey) } as CSSProperties} />
              <span className="ib4-row-main">
                <span className="ib4-row-title">{c.what}</span>
                <span className="ib4-row-sub muted">
                  {c.reason} · {c.clientName}
                  {c.toName ? ` · for ${c.toName}` : ""} · <Stamp at={c.clearedAt} tz={tz} today={today} />
                </span>
              </span>
              <button type="button" className="mini" onClick={() => void run("my_promises.put_back", { id: c.id }, "Put back: it stays until you close it")}>
                Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </footer>
  ) : null;

  return (
    <main className="ib4" aria-label="Inbox">
      <header className="ib4-head">
        <h1 className="ib4-title">Inbox</h1>
        <div className="ib4-switch" role="tablist" aria-label="Lists" data-tour="ib-rail">
          {INBOX_LISTS.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={list === l} className={`ib4-tab${list === l ? " on" : ""}`} onClick={() => chooseList(l)}>
              {INBOX_LIST_NAMES[l]} <span className="ib4-count">{counts[l]}</span>
            </button>
          ))}
        </div>
      </header>
      {chipClients.length > 1 && (
        <div className="ib4-chips" role="group" aria-label="Clients">
          <button type="button" className={`ib4-chip${clients.length ? "" : " on"}`} aria-pressed={!clients.length} onClick={() => toggleClient(null)}>
            All clients
          </button>
          {chipClients.map((k) => (
            <button key={k} type="button" className={`ib4-chip${clients.includes(k) ? " on" : ""}`} aria-pressed={clients.includes(k)} onClick={() => toggleClient(k)} style={{ "--c": color(k) } as CSSProperties}>
              <span className="dot" aria-hidden="true" />
              {clientName(k)}
            </button>
          ))}
        </div>
      )}
      {late && list === "promises" && (
        <p className="ib4-late-note muted">
          Late promises{late.client ? ` for ${clientName(late.client)}` : ""} only.{" "}
          <button type="button" className="link-btn" onClick={() => chooseList("promises")}>
            Show all promises
          </button>
        </p>
      )}
      {notice && (
        <p className="ib-notice ib4-notice" role="status">
          {notice}
        </p>
      )}
      {(error || src.error) && (
        <p className="set-problem" role="alert">
          {error ?? src.error}
        </p>
      )}
      {notWaiting && list === "chats" && (
        <p className="ib4-not-waiting" role="status">
          This conversation isn't waiting for anything.{" "}
          {notWaiting.link && (
            <a href={notWaiting.link} target="_blank" rel="noopener noreferrer">
              Open in Teams
            </a>
          )}
        </p>
      )}
      <div className="ib4-list" data-tour="ib-list" role="tabpanel" aria-label={INBOX_LIST_NAMES[list]}>
        {!loaded ? (
          <p className="muted ib4-empty">Loading…</p>
        ) : list === "chats" ? (
          suggestions.length ? chatsList : <p className="ib4-empty">{EMPTY.chats}</p>
        ) : list === "promises" ? (
          <>
            {firstLine}
            {promiseRows.length ? promisesList : <p className="ib4-empty">{EMPTY.promises}</p>}
          </>
        ) : (
          <>
            {capturesList}
            {!captureRows.length && <p className="ib4-empty">{EMPTY.captures}</p>}
          </>
        )}
      </div>
      {loaded && list === "chats" && chatsFoot}
      {loaded && list === "promises" && promisesFoot}
      {!phone && (
        <p className="ib4-keys muted" data-tour="ib-keys">
          <kbd>J</kbd> <kbd>K</kbd> move · <kbd>Enter</kbd> open
          {list === "chats" ? (
            <>
              {" · "}
              <kbd>C</kbd> create · <kbd>L</kbd> already covered · <kbd>X</kbd> dismiss
            </>
          ) : list === "promises" ? (
            <>
              {" · "}
              <kbd>D</kbd> done
            </>
          ) : null}
          {" · "}
          <button type="button" className="link-btn" onClick={() => setKeysOpen((v) => !v)}>
            <kbd>?</kbd> all keys
          </button>
        </p>
      )}
      {keysOpen && (
        <section className="ib4-keyhelp" aria-label="Inbox keys">
          <ul>
            {ITEM_KEYS.map((k) => (
              <li key={k.key}>
                <kbd>{k.key}</kbd> {k.does}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
