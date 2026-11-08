// IB-1 slice 2: the Inbox as one list with views (no modes). Desktop: three panes per docs/ux/ib1 (the rail with
// clients and views, the list grouped by client, due date or kind, and the detail pane with every action). Phone: View
// and Clients as two full-width buttons that open one picker sheet, rows that wrap, and an item sheet with its main
// action as a big button. The view, clients and grouping are remembered per person (ui.set_inbox). The counts come
// from inbox.list, so the badge, the rail and the header read the same number. Keys (never while typing): J and K move,
// Enter opens, C, L, F, W, H, N and E run the item's own actions, ? shows them.
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { InboxPrefs } from "../../config/schema.ts";
import type { InboxItemView, InboxView } from "../../plan/inbox-items.ts";
import type { ConversationCard, ConversationsData } from "../../plan/conversation-views.ts";
import { unsortedSentence } from "../../plan/conversations.ts";
import { userZone } from "../../week/zone.ts";
import { call } from "../api.ts";
import { CaptureBox, captureClients } from "../Capture.tsx";
import { CreateDraftCtx } from "../createdraft-ctx.ts";
import { DraftEditorCtx } from "../DraftEditor.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { Fading, FollowUpForm } from "../FollowUps.tsx";
import { markSeen } from "../inboxcount.ts";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "../keys.ts";
import { clientColor, whenText } from "../labels.ts";
import { ASK_KEY_EVENT } from "../menu.ts";
import { navOf, type LateFilter, type Nav } from "../nav.ts";
import { usePhone } from "../viewport.ts";
import { chatterRows, entryOf, useInboxData, type ChatterRow, type Entry } from "./data.ts";
import { ChatterDetail, Detail } from "./Detail.tsx";
import { HeldBack } from "./HeldBack.tsx";
import { actsFor, ItemActions, ITEM_KEYS, notWorkUndo, type Act, type FormId } from "./ItemActions.tsx";
import { flatOrder, GROUPS, groupRows, inView, rowSub, rowTag, summaryLine, viewLabel, VIEWS, clientCounts, type Group } from "./model.ts";

/** The letters the Inbox's items answer to (ItemActions' keys). */
const INBOX_LETTERS = new Set(ITEM_KEYS.map((k) => k.key).filter((k) => k.length === 1 && k !== "J" && k !== "K"));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const KIND_ICON: Record<InboxItemView["kind"], string> = { conversation: "💬", promise: "⚑", send: "⇥", capture: "▤", draft: "▤", commitment: "⏳", sent: "⇤", ask: "⏳" };

/** The item an address asks for, else the view's first. */
function pickView(nav: Extract<Nav, { tab: "inbox" }>, prefs: InboxPrefs, items: readonly InboxItemView[] | null): InboxView {
  if (nav.view) return nav.view;
  if (nav.item && items) {
    const it = items.find((i) => i.key === nav.item);
    if (it && !it.views.includes(prefs.view)) return it.views[0] ?? prefs.view;
  }
  return prefs.view;
}

export function InboxPage({ nav, data, version, onNav, onChanged, onFeedback }: { nav: Extract<Nav, { tab: "inbox" }>; data: WeekLoadData; version: number; onNav: (n: Nav) => void; onChanged: () => void; onFeedback?: () => void }): ReactNode {
  const phone = usePhone();
  const tz = userZone(data);
  // A DevOps write (create, link comment, mark done) reads the Inbox again, as Conversations did (its version).
  const writes = useDevOpsWrite();
  const src = useInboxData(`${version}:${writes?.version ?? 0}`);
  const [prefs, setPrefs] = useState<InboxPrefs>(data.ui.inbox ?? { view: "needs_you", clients: [], group: "client" });
  const view = pickView(nav, prefs, src.list?.items ?? null);
  const [form, setForm] = useState<FormId | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [keysOpen, setKeysOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The item open now stays in the list until another is opened, even after it leaves the view (no jumping). */
  const [sticky, setSticky] = useState<string | null>(null);
  const createDraft = useContext(CreateDraftCtx);
  const editDraft = useContext(DraftEditorCtx);
  const today = src.list?.today ?? data.planDay.date;
  const clientList = useMemo(() => captureClients(data), [data]);
  const clientName = useCallback((k: string | null) => (k ? (clientList.find((c) => c.clientKey === k)?.clientName ?? k) : "No client"), [clientList]);

  // The view, clients and grouping, remembered for me (Settings rows); the address's view wins while it's there.
  // UI-9: a Week card's "N late" chip opens Promises narrowed to late ones for its client; kept while I open its items,
  // never saved, and gone once I choose a view or clients myself.
  const lateKey = nav.late ? `late:${nav.late.client ?? ""}` : null;
  const [late, setLate] = useState<LateFilter | null>(nav.late ?? null);
  useEffect(() => {
    if (nav.late) setLate(nav.late);
    else if (!nav.item) setLate(null);
  }, [lateKey, nav.item]);
  const save = useCallback((p: Partial<InboxPrefs>) => {
    if (p.clients || p.view) setLate(null);
    setPrefs((cur) => ({ ...cur, ...p }));
    void call("ui.set_inbox", p, { background: true }).catch(() => undefined);
  }, []);
  const chooseView = (v: InboxView) => {
    save({ view: v });
    setSticky(null);
    onNav(navOf.inboxView(v));
  };
  const clients = late ? (late.client ? [late.client] : []) : prefs.clients;

  const items = src.list?.items ?? [];
  const chatter = useMemo(() => chatterRows(src.convs, clients), [src.convs, clients]);
  const rows = useMemo(() => {
    const inv = inView(items, view, clients).filter((i) => !late || i.late);
    const s = sticky && !inv.some((i) => i.key === sticky) ? items.find((i) => i.key === sticky && !i.snoozedUntil) : undefined;
    const all = s ? [...inv, s] : inv;
    const q = filter.trim().toLowerCase();
    return q ? all.filter((i) => `${i.title} ${i.who ?? ""} ${i.where ?? ""} ${clientName(i.clientKey)}`.toLowerCase().includes(q)) : all;
  }, [items, view, clients, sticky, filter, clientName, late]);
  const groups = useMemo(() => groupRows(rows, prefs.group, (k) => clientName(k), today), [rows, prefs.group, clientName, today]);
  // Slice 3: snoozed items are in no view and no count; one folded group at the foot brings them back to look at.
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Slice 3: In progress shows each linked item's live state (CV-5's, from the cards already read).
  const liveState = useMemo(() => {
    const m = new Map<string, { id: number; state: string | null; closed: boolean }>();
    const convs = src.convs ? [...src.convs.needsYou, ...src.convs.inProgress, ...src.convs.teammates, ...src.convs.closed] : [];
    for (const c of convs) if (c.item) m.set(`v${c.id}`, { id: c.item.id, state: c.item.state ?? null, closed: !!c.item.closed });
    for (const pr of src.promises?.promises ?? []) if (pr.item) m.set(`c${pr.id}`, { id: pr.item.id, state: pr.item.state ?? null, closed: !!pr.item.closed });
    return m;
  }, [src.convs, src.promises]);
  const snoozed = useMemo(() => items.filter((i) => i.snoozedUntil && !i.done && (!clients.length || (i.clientKey !== null && clients.includes(i.clientKey)))), [items, clients]);
  const order = useMemo(() => flatOrder(groups), [groups]);
  const viewCount = (v: InboxView) => (v === "chatter" ? chatterRows(src.convs, clients).length : inView(items, v, clients).length);
  const byClient = useMemo(() => clientCounts(items, view), [items, view]);
  const chatterByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of chatterRows(src.convs, [])) m.set(r.clientKey, (m.get(r.clientKey) ?? 0) + 1);
    return m;
  }, [src.convs]);

  // The open item: the address's, else (desktop) the view's first. Chatter rows are local (h<client>:<chat>).
  const [chatterKey, setChatterKey] = useState<string | null>(null);
  const openKey = view === "chatter" ? null : (nav.item ?? (phone ? null : (order[0]?.key ?? null)));
  const openRow = openKey ? (items.find((i) => i.key === openKey) ?? null) : null;
  const entry: Entry | null = openRow ? entryOf(openRow, src) : null;
  const openChatter = view === "chatter" ? (chatter.find((c) => c.key === chatterKey) ?? (phone ? null : chatter[0]) ?? null) : null;
  const missing = !!nav.item && !!src.list && !openRow;

  // Seen when opened in the detail pane (an address, a click, J or K), not when the list loads (IB-1 slice 2).
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  useEffect(() => {
    if (!nav.item || !openRow || openRow.kind !== "promise") return;
    void markSeen([openRow.key], () => changedRef.current());
  }, [nav.item, openRow]);
  // LP-1: the assistant's link (#/inbox/item/<key>/loop) opens the promise with its Close the loop draft, once.
  const loopNav = nav.loop === true;
  useEffect(() => setForm(loopNav && openRow?.kind === "promise" && openRow.key === openKey ? "close" : null), [openKey, loopNav, openRow?.kind]);
  // Going back to a view's own address (no item) lets the item I had open leave the list.
  useEffect(() => {
    if (!nav.item) setSticky(null);
  }, [nav.item]);

  const open = useCallback(
    (key: string) => {
      setSticky(key);
      onNav(navOf.inboxItem(key, nav.view));
    },
    [onNav, nav.view],
  );

  const reloadAll = useCallback(async () => {
    await src.reload();
    onChanged();
  }, [src, onChanged]);
  const run = useCallback(
    async (action: string, input: Record<string, unknown>, msg: string, undo?: { action: string; input: Record<string, unknown> }) => {
      try {
        if (action !== "inbox.list") await call(action, input);
        setError(null);
        setForm(null);
        setNotice(
          undo ? (
            <>
              {msg}.{" "}
              <button type="button" className="mini quiet" onClick={() => void call(undo.action, undo.input).then(() => (setNotice("Undone"), void reloadAll()), (e) => setError(errText(e)))}>
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
  // Merge (CV-2): one conversation into another of the same chat, for everyone on it, with Undo.
  const allConvs = useMemo(() => (src.convs ? [...src.convs.needsYou, ...src.convs.inProgress, ...src.convs.teammates, ...src.convs.closed] : []), [src.convs]);
  const mergeOthers = entry?.kind === "conversation" && entry.card ? allConvs.filter((x) => x.chatId === entry.card!.chatId && x.id !== entry.card!.id && !x.closed) : [];
  const merge = useCallback(
    async (id: number, into: ConversationCard) => {
      try {
        const r = await call<{ merges: number[] }>("conversations.merge", { ids: [id], into: into.id });
        setError(null);
        setForm(null);
        setNotice(
          <>
            Merged into "{into.title}" for everyone on the chat.{" "}
            <button type="button" className="mini quiet" onClick={() => void call("conversations.unmerge", { merges: r.merges }).then(() => (setNotice("Merge undone"), void reloadAll()), (e) => setError(errText(e)))}>
              Undo
            </button>
          </>,
        );
        onNav(navOf.inboxItem(`v${into.id}`, nav.view));
        await reloadAll();
      } catch (e) {
        setError(errText(e));
      }
    },
    [reloadAll, onNav, nav.view],
  );
  const acts: Act[] = entry
    ? actsFor(entry, {
        run,
        form: setForm,
        createDraft: (id) => createDraft?.(id),
        editDraft: (id) => {
          const d = src.caps?.drafts.find((x) => x.id === id);
          if (d) editDraft?.(d);
        },
        planWeek: () => onNav(navOf.planDay()),
        canMerge: mergeOthers.length > 0,
        today,
      })
    : [];

  // Keys, only here and never while typing or behind a dialog.
  const keyRef = useRef({ order, openKey, acts, open, phone, form });
  keyRef.current = { order, openKey, acts, open, phone, form };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      const k = keyRef.current;
      if (e.key === "?") {
        setKeysOpen((v) => !v);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Escape" && k.form) return void setForm(null);
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === "J" || key === "K") {
        if (!k.order.length) return;
        const i = k.openKey ? k.order.findIndex((r) => r.key === k.openKey) : -1;
        const next = k.order[Math.max(0, Math.min(k.order.length - 1, i + (key === "J" ? 1 : -1)))]!;
        k.open(next.key);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (key === "Enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        if (k.openKey) document.querySelector<HTMLElement>(".ib-detail-title")?.focus();
        else if (k.order[0]) k.open(k.order[0].key);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // The Inbox's own letters: here they are the item's actions, never the window's other uses of the same keys
      // (N capture, L promises, W plan, H timelines…), so they stop here whether or not this item has that action.
      if (!INBOX_LETTERS.has(key)) return;
      e.preventDefault();
      e.stopPropagation();
      k.acts.find((x) => x.key === key)?.run();
    };
    // The command menu's Inbox keys (menu.ts ASK_KEYS) arrive as the act they stand for.
    const onCommand = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const k = keyRef.current;
      const i = k.openKey ? k.order.findIndex((r) => r.key === k.openKey) : -1;
      if (id === "next" || id === "prev") {
        const next = k.order[Math.max(0, Math.min(k.order.length - 1, i + (id === "next" ? 1 : -1)))];
        if (next) k.open(next.key);
      } else if (id === "open") {
        if (!k.openKey && k.order[0]) k.open(k.order[0].key);
      } else k.acts.find((x) => x.id === id)?.run();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener(ASK_KEY_EVENT, onCommand);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener(ASK_KEY_EVENT, onCommand);
    };
  }, []);

  const header = (
    <div className="ib-list-head">
      <h2>
        {viewLabel(view)} <span className="muted">{late ? rows.length : viewCount(view)}</span>
      </h2>
      {late && (
        <p className="ib-late-line" role="status">
          Late{late.client ? ` for ${clientName(late.client)}` : ""}
          <button type="button" className="link-btn" onClick={() => (setLate(null), onNav(navOf.inboxView(view)))}>
            Show all
          </button>
        </p>
      )}
      {view === "promises" && (
        <button type="button" className="mini" onClick={() => setAdding((v) => !v)}>
          + New promise
        </button>
      )}
    </div>
  );
  const onWork = (m: ChatterRow["messages"][number]) => void run("conversations.this_is_work", { chatId: m.chatId, messageId: m.messageId }, "Moved into its own conversation");
  const onSocial = (chatId: string, on: boolean) => void run("chats.social", { chatId, on }, on ? "Marked a Social chat. Its new messages skip AI" : "Not a Social chat any more. Its new messages are sorted again");

  const list = (
    <>
      {view === "captures" && (
        <section className="ib-capture" aria-label="Capture">
          <CaptureBox data={data} onChanged={() => void reloadAll()} defaultClient={prefs.clients.length === 1 ? prefs.clients[0]! : null} large />
        </section>
      )}
      {adding && view === "promises" && (
        <FollowUpForm clients={captureClients(data)} onCancel={() => setAdding(false)} onSaved={() => (setAdding(false), setNotice("Promise added"), void reloadAll())} />
      )}
      {missing && <p className="conv-link-note" role="status">That item isn't here any more: it was done or closed more than a day ago, or its chat is no longer registered.</p>}
      {view === "chatter" ? (
        <ChatterList rows={chatter} tz={tz} open={openChatter?.key ?? null} onOpen={setChatterKey} colors={data.clients} phone={phone} />
      ) : (
        <ListGroups groups={groups} openKey={openKey} onOpen={open} today={today} tz={tz} colors={data.clients} phone={phone} group={prefs.group} reasons={view === "needs_you"} live={view === "in_progress" ? liveState : null} onNotWork={view === "done" ? undefined : (id) => void run("conversations.not_work", { id }, "Moved to Chatter for everyone on the chat", notWorkUndo(id))} />
      )}
      {view !== "chatter" && showSnoozed && snoozed.length > 0 && (
        <ListGroups groups={[{ id: "snoozed", label: "Snoozed", clientKey: null, rows: snoozed }]} openKey={openKey} onOpen={open} today={today} tz={tz} colors={data.clients} phone={phone} group="kind" reasons={false} live={null} />
      )}
      {src.list && view !== "chatter" && !rows.length && <EmptyView view={view} />}
      {src.convs && src.convs.unsorted.count > 0 && (view === "needs_you" || view === "chatter") && (
        <Unsorted u={src.convs.unsorted} sort={() => void run("conversations.sort_unsorted", {}, "Sorted again")} {...(onFeedback ? { onFeedback } : {})} />
      )}
      {src.convs && (src.convs.heldCount ?? 0) > 0 && (view === "needs_you" || view === "chatter") && <HeldBack count={src.convs.heldCount ?? 0} tz={tz} onChanged={() => void reloadAll()} />}
    </>
  );

  if (phone) return (
    <main className="ib ib-phone" aria-label="Inbox">
      <div className="ib-phone-top">
        <h1>Inbox</h1>
      </div>
      <div className="ib-phone-pick" data-tour="ib-rail">
        <button type="button" className="ib-pick-btn" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <span className="muted">View</span>
          <strong>
            {viewLabel(view)} · {viewCount(view)}
          </strong>
        </button>
        <button type="button" className="ib-pick-btn" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <span className="muted">Clients</span>
          <strong>{clients.length ? clients.map((c) => clientName(c)).join(", ") : "All clients"}</strong>
        </button>
      </div>
      {view !== "chatter" && (
        <p className="ib-summary-line">
          {summaryLine(rows, today).map((x) => (
            <span key={x.text} className={`tone-${x.tone}`}>
              <b>{x.n}</b> {x.text}
            </span>
          ))}
        </p>
      )}
      {error && <p className="set-problem" role="alert">{error}</p>}
      <Fading text={notice} onGone={() => setNotice(null)} ms={8000} />
      {list}
      {picker && (
        <PickerSheet
          view={view}
          clients={clients}
          group={prefs.group}
          clientList={clientList}
          count={(v, cs) => (v === "chatter" ? chatterRows(src.convs, cs).length : inView(items, v, cs).length)}
          colors={data.clients}
          onClose={() => setPicker(false)}
          onApply={(p) => {
            save(p);
            setPicker(false);
            onNav(navOf.inboxView(p.view));
          }}
        />
      )}
      {entry && (
        <ItemSheet onBack={() => onNav(navOf.inboxView(view))} entry={entry} acts={acts} form={form} title={`Inbox · ${viewLabel(view)}`}>
          <Detail entry={entry} acts={acts} form={form} setForm={setForm} data={data} tz={tz} today={today} clientName={clientName} run={run} submit={submit} finished={(m) => (setForm(null), setNotice(m), void reloadAll())} reload={() => void reloadAll()} mergeOthers={mergeOthers} merge={merge} snoozeChoices={src.list?.snoozeChoices} phone />
        </ItemSheet>
      )}
      {openChatter && (
        <ItemSheet onBack={() => setChatterKey(null)} entry={null} acts={[]} form={null} title="Inbox · Chatter">
          <ChatterDetail row={openChatter} tz={tz} color={clientColor(openChatter.clientKey, data.clients)} onWork={onWork} chat={src.convs?.chats?.find((c) => c.chatId === openChatter.chatId)} admin={!!src.convs?.admin} onSocial={(on) => onSocial(openChatter.chatId, on)} />
        </ItemSheet>
      )}
    </main>
  );

  return (
    <main className="ib" aria-label="Inbox">
      <nav className="ib-rail" data-tour="ib-rail" aria-label="Inbox views and clients">
        <h3 className="ib-section">Clients</h3>
        <ul className="ib-clients">
          <li>
            <label>
              <input type="checkbox" checked={!clients.length} onChange={() => save({ clients: [] })} /> <span className="dot" style={{ "--c": "var(--client-none)" } as CSSProperties} /> All clients
              <span className="count">{view === "chatter" ? chatter.length : viewCount(view)}</span>
            </label>
          </li>
          {clientList.map((c) => (
            <li key={c.clientKey}>
              <label>
                <input
                  type="checkbox"
                  checked={clients.includes(c.clientKey)}
                  onChange={(e) => save({ clients: e.target.checked ? [...clients, c.clientKey] : clients.filter((x) => x !== c.clientKey) })}
                />{" "}
                <span className="dot" style={{ "--c": clientColor(c.clientKey, data.clients) } as CSSProperties} /> {c.clientName}
                <span className="count">{(view === "chatter" ? chatterByClient.get(c.clientKey) : byClient.get(c.clientKey)) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
        <h3 className="ib-section">Views</h3>
        <ul className="ib-views">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <button type="button" aria-current={v.id === view ? "page" : undefined} onClick={() => chooseView(v.id)}>
                {v.label} <span className="count">{viewCount(v.id)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ib-keys-box" data-tour="ib-keys">
          <strong>Keys</strong>
          <p>
            <kbd>J</kbd> <kbd>K</kbd> move · <kbd>Enter</kbd> open
            <br />
            <kbd>C</kbd> create item · <kbd>L</kbd> close the loop
            <br />
            <kbd>F</kbd> due · <kbd>W</kbd> my week · <kbd>E</kbd> done
            <br />
            <kbd>?</kbd> all keys
          </p>
        </div>
      </nav>
      <section className="ib-list" data-tour="ib-list" aria-label={viewLabel(view)}>
        {header}
        <div className="ib-list-tools">
          <input type="search" className="ib-filter" placeholder="Filter" aria-label="Filter the list" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="ib-group">
            Group{" "}
            <select value={prefs.group} onChange={(e) => save({ group: e.target.value as Group })}>
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="set-problem" role="alert">{error}</p>}
        <Fading text={notice} onGone={() => setNotice(null)} ms={8000} />
        <div className="ib-list-body">{list}</div>
        <p className="ib-list-foot">
          {viewCount("teammates") > 0 && view !== "teammates" && (
            <button type="button" className="linkish" onClick={() => chooseView("teammates")}>
              {viewCount("teammates")} handled by teammates
            </button>
          )}
          {viewCount("done") > 0 && view !== "done" && (
            <button type="button" className="linkish" onClick={() => chooseView("done")}>
              {viewCount("done")} done
            </button>
          )}
          {chatter.length > 0 && view !== "chatter" && (
            <button type="button" className="linkish" onClick={() => chooseView("chatter")}>
              {chatter.length} filtered as chatter
            </button>
          )}
          {snoozed.length > 0 && view !== "chatter" && (
            <button type="button" className="linkish" aria-expanded={showSnoozed} onClick={() => setShowSnoozed((v) => !v)}>
              {showSnoozed ? "Hide snoozed" : `${snoozed.length} snoozed`}
            </button>
          )}
          {src.convs?.lastPoll && <span className="muted">Chats last checked {whenText(src.convs.lastPoll, tz)}</span>}
          <RefreshChats run={run} />
        </p>
      </section>
      <section className="ib-pane" data-tour="ib-pane" aria-label="Item">
        {entry ? (
          <Detail entry={entry} acts={acts} form={form} setForm={setForm} data={data} tz={tz} today={today} clientName={clientName} run={run} submit={submit} finished={(m) => (setForm(null), setNotice(m), void reloadAll())} reload={() => void reloadAll()} mergeOthers={mergeOthers} merge={merge} snoozeChoices={src.list?.snoozeChoices} />
        ) : openChatter ? (
          <ChatterDetail row={openChatter} tz={tz} color={clientColor(openChatter.clientKey, data.clients)} onWork={onWork} chat={src.convs?.chats?.find((c) => c.chatId === openChatter.chatId)} admin={!!src.convs?.admin} onSocial={(on) => onSocial(openChatter.chatId, on)} />
        ) : (
          <p className="muted ib-pane-empty">{src.list ? "Nothing open. Pick an item from the list." : "Loading…"}</p>
        )}
      </section>
      {keysOpen && <KeyHelp onClose={() => setKeysOpen(false)} />}
    </main>
  );
}

/**
 * Slice 3: messages not sorted yet, one line per reason in plain words. Sort again only when the reason passes on its
 * own; a switch says who fixes it and where, with no button; a guard hold has no button and no override, only feedback.
 */
function Unsorted({ u, sort, onFeedback }: { u: ConversationsData["unsorted"]; sort: () => void; onFeedback?: () => void }): ReactNode {
  const retry = u.reasons.filter((r) => (r.does ?? "retry") === "retry").reduce((n, r) => n + r.count, 0);
  const held = u.reasons.some((r) => r.does === "held");
  const n = (c: number) => (c === 1 ? "1 message" : `${c} messages`);
  return (
    <div className="conv-unsorted" role="status" aria-label="Not sorted yet">
      <p className="ib-unsorted-head">{n(u.count)} not sorted yet</p>
      <ul className="ib-unsorted">
        {u.reasons.map((r) => (
          <li key={r.text} className={`does-${r.does ?? "retry"}`}>
            <span>{unsortedSentence(r.count, r)}</span>
            {r.fix && <span className="muted"> {r.fix}</span>}
          </li>
        ))}
      </ul>
      {(retry > 0 || (held && onFeedback)) && (
        <p className="ib-unsorted-acts">
          {retry > 0 && (
            <button type="button" className="mini" onClick={sort}>
              Sort again ({retry})
            </button>
          )}
          {held && onFeedback && (
            <button type="button" className="mini quiet" onClick={onFeedback}>
              Send feedback
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Reads the registered chats now (only new messages), as Conversations' Refresh did. */
function RefreshChats({ run }: { run: (a: string, i: Record<string, unknown>, notice: string) => Promise<void> }): ReactNode {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="linkish" aria-label="Refresh conversations" title="Read your clients' registered chats now (only new messages)" disabled={busy} onClick={async () => {
      setBusy(true);
      await run("conversations.refresh", {}, "Chats read");
      setBusy(false);
    }}>
      {busy ? "Reading…" : "Refresh"}
    </button>
  );
}

function ListGroups({ groups, openKey, onOpen, today, tz, colors, phone, group, reasons, live, onNotWork }: { groups: ReturnType<typeof groupRows>; openKey: string | null; onOpen: (k: string) => void; today: string; tz: string; colors: Record<string, string>; phone: boolean; group: Group; reasons: boolean; live: ReadonlyMap<string, { id: number; state: string | null; closed: boolean }> | null; /** QF-1: a conversation row's ⋯ › Not work-related. */ onNotWork?: ((id: number) => void) | undefined }): ReactNode {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} className="ib-group-sec" aria-label={g.label}>
          <h3 className="ib-group-head">
            {group === "client" && <span className="dot" style={{ "--c": clientColor(g.clientKey ?? undefined, colors) } as CSSProperties} />}
            {g.label} <span className="muted">{g.rows.length}</span>
          </h3>
          <ul className="ib-rows">
            {g.rows.map((r) => {
              const it = live?.get(r.key);
              const tag = it ? { text: it.closed ? `#${it.id} closed · Mark done?` : `#${it.id}${it.state ? ` · ${it.state}` : ""}`, tone: it.closed ? ("soon" as const) : ("plain" as const) } : rowTag(r, today);
              return (
                <li key={r.key}>
                  <button type="button" className={`ib-row${r.key === openKey ? " open" : ""}${r.late ? " late" : ""}`} data-key={r.key} aria-current={r.key === openKey ? "true" : undefined} onClick={() => onOpen(r.key)}>
                    <span className={`ib-icon kind-${r.kind}`} aria-hidden="true">{KIND_ICON[r.kind]}</span>
                    <span className="ib-row-main">
                      <span className="ib-row-title">{r.title || "(no title)"}</span>
                      <span className="ib-row-sub">
                        {r.mentions?.map((n) => (
                          <span key={n} className="ib-tag tone-plain mention-tag">
                            mentions {n}
                          </span>
                        ))}
                        {phone && tag && <span className={`ib-tag tone-${tag.tone}`}>{tag.text}</span>}
                        <span className="muted">
                          {reasons && r.reason ? r.reason : rowSub(r)}
                          {r.kind === "conversation" ? ` · ${whenText(r.at, tz).split(", ")[1] ?? ""}` : ""}
                        </span>
                      </span>
                    </span>
                    {!phone && tag && <span className={`ib-tag tone-${tag.tone}`}>{tag.text}</span>}
                  </button>
                  {onNotWork && r.kind === "conversation" && !r.done && (
                    <span className="fu-more ib-row-more">
                      <button type="button" className="ib-act quiet" aria-haspopup="menu" aria-expanded={menuFor === r.key} aria-label={`More for ${r.title}`} onClick={() => setMenuFor((k) => (k === r.key ? null : r.key))}>
                        ⋯
                      </button>
                      {menuFor === r.key && (
                        <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenuFor(null))}>
                          <button type="button" role="menuitem" onClick={() => (setMenuFor(null), onNotWork(Number(r.key.slice(1))))}>
                            Not work-related
                          </button>
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function ChatterList({ rows, tz, open, onOpen, colors, phone }: { rows: ChatterRow[]; tz: string; open: string | null; onOpen: (k: string) => void; colors: Record<string, string>; phone: boolean }): ReactNode {
  if (!rows.length) return <EmptyView view="chatter" />;
  const byClient = new Map<string, ChatterRow[]>();
  for (const r of rows) byClient.set(r.clientKey, [...(byClient.get(r.clientKey) ?? []), r]);
  return (
    <>
      <p className="muted ib-view-note">No ask, promise or work in these. They never count toward Needs you.</p>
      {[...byClient.entries()].map(([k, rs]) => (
        <section key={k} className="ib-group-sec" aria-label={rs[0]!.clientName}>
          <h3 className="ib-group-head">
            <span className="dot" style={{ "--c": clientColor(k, colors) } as CSSProperties} />
            {rs[0]!.clientName} <span className="muted">{rs.length}</span>
          </h3>
          <ul className="ib-rows">
            {rs.map((r) => (
              <li key={r.key}>
                <button type="button" className={`ib-row${r.key === open ? " open" : ""}`} onClick={() => onOpen(r.key)}>
                  <span className="ib-icon" aria-hidden="true">💬</span>
                  <span className="ib-row-main">
                    <span className="ib-row-title">{r.title}</span>
                    <span className="ib-row-sub muted">
                      {r.messages.length} {r.messages.length === 1 ? "message" : "messages"} · {whenText(r.lastAt, tz).split(", ")[1] ?? ""}
                    </span>
                  </span>
                  {!phone && null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const EMPTY: Record<InboxView, string> = {
  needs_you: "Nothing needs you. New promises, asks and sends show up here.",
  promises: "No open promises. Ones found in chats and ones you add live here together.",
  waiting: "Nothing you're waiting on.",
  in_progress: "Nothing in progress. Items with a linked DevOps item show here.",
  captures: "Nothing to sort. Capture something above.",
  teammates: "Nothing handled by teammates.",
  done: "Nothing done in the last day.",
  chatter: "No chatter.",
};
function EmptyView({ view }: { view: InboxView }): ReactNode {
  return <p className="ib-empty muted">{EMPTY[view]}</p>;
}

/** Phone: one sheet for View (radio rows), Clients (a wrapping grid) and Group by, with Reset and Show N. */
function PickerSheet(p: {
  view: InboxView; clients: string[]; group: Group; clientList: { clientKey: string; clientName: string }[]; colors: Record<string, string>;
  count: (v: InboxView, clients: string[]) => number; onClose: () => void; onApply: (p: InboxPrefs) => void;
}): ReactNode {
  const [view, setView] = useState(p.view);
  const [clients, setClients] = useState(p.clients);
  const [group, setGroup] = useState(p.group);
  // Focus moves into the sheet so Esc closes it (and a screen reader starts there).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="ib-sheet-back" data-overlay="modal" onClick={p.onClose}>
      <div ref={ref} tabIndex={-1} className="ib-sheet" role="dialog" aria-modal="true" aria-label="View and clients" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), p.onClose())}>
        <span className="ib-grip" aria-hidden="true" />
        <fieldset className="ib-sheet-views">
          <legend className="ib-section">View</legend>
          {VIEWS.map((v) => (
            <label key={v.id} className={v.id === view ? "on" : undefined}>
              <input type="radio" name="ib-view" checked={v.id === view} onChange={() => setView(v.id)} /> {v.label}
              <span className="count">{p.count(v.id, clients)}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ib-sheet-clients">
          <legend className="ib-section">Clients</legend>
          <label className={!clients.length ? "on" : undefined}>
            <input type="checkbox" checked={!clients.length} onChange={() => setClients([])} /> All
          </label>
          {p.clientList.map((c) => (
            <label key={c.clientKey} className={clients.includes(c.clientKey) ? "on" : undefined}>
              <input type="checkbox" checked={clients.includes(c.clientKey)} onChange={(e) => setClients(e.target.checked ? [...clients, c.clientKey] : clients.filter((x) => x !== c.clientKey))} />{" "}
              <span className="dot" style={{ "--c": clientColor(c.clientKey, p.colors) } as CSSProperties} /> <span className="ib-clip">{c.clientName}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ib-sheet-group">
          <legend className="ib-section">Group by</legend>
          <div className="ib-seg" role="radiogroup">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" role="radio" aria-checked={g.id === group} onClick={() => setGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="ib-sheet-foot">
          <button type="button" className="ib-act" onClick={() => (setView("needs_you"), setClients([]), setGroup("client"))}>
            Reset
          </button>
          <button type="button" className="ib-act primary" onClick={() => p.onApply({ view, clients, group })}>
            Show {p.count(view, clients)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Phone: an item as a sheet: Back, the item, and its main action as a big button with the others under it. */
function ItemSheet({ onBack, entry, acts, form, title, children }: { onBack: () => void; entry: Entry | null; acts: Act[]; form: FormId | null; title: string; children: ReactNode }): ReactNode {
  const primary = acts.find((a) => a.primary);
  const rest = acts.filter((a) => !a.primary);
  return (
    <div className="ib-sheet-back item" data-overlay="details">
      <p className="ib-sheet-title muted">{title}</p>
      <div className="ib-sheet tall" role="dialog" aria-modal="true" aria-label={entry?.row.title ?? "Chatter"} onKeyDown={(e) => e.key === "Escape" && onBack()}>
        <span className="ib-grip" aria-hidden="true" />
        <div className="ib-sheet-top">
          <button type="button" className="linkish" onClick={onBack}>
            ‹ Back
          </button>
        </div>
        <div className="ib-sheet-scroll">{children}</div>
        {!form && acts.length > 0 && (
          <div className="ib-sheet-acts">
            {primary && (
              <button type="button" className="ib-act primary big" data-act={primary.id} onClick={primary.run}>
                {primary.label}
                {entry?.row.who && primary.id === "close" ? ` with ${entry.row.who}` : ""}
              </button>
            )}
            <ItemActions acts={rest} phone label={entry?.row.title ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}

function KeyHelp({ onClose }: { onClose: () => void }): ReactNode {
  return (
    <div className="ib-keyhelp" role="dialog" aria-label="Inbox keys" data-overlay="details" onKeyDown={(e) => (e.key === "Escape" || e.key === "?") && onClose()}>
      <h3>Inbox keys</h3>
      <dl>
        {ITEM_KEYS.map((k) => (
          <div key={k.key}>
            <dt>
              <kbd>{k.key}</kbd>
            </dt>
            <dd>{k.does}</dd>
          </div>
        ))}
        <div>
          <dt>
            <kbd>?</kbd>
          </dt>
          <dd>Show or hide these keys</dd>
        </div>
      </dl>
      <button type="button" className="mini" autoFocus onClick={onClose}>
        Close
      </button>
    </div>
  );
}
