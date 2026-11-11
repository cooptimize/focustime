// IB-2: one model. Everything is the timeline of every item by latest activity, with status chips; a view on the left is
// the same list with only that status on. The sort, chips and grouping are remembered per person.
// IB-1 slice 2: the Inbox as one list with views (no modes). Desktop: three panes per docs/ux/ib1 (the rail with
// clients and views, the list grouped by client, due date or kind, and the detail pane with every action). Phone: View
// and Clients as two full-width buttons that open one picker sheet, rows that wrap, and an item sheet with its main
// action as a big button. The view, clients and grouping are remembered per person (ui.set_inbox). The counts come
// from inbox.list, so the badge, the rail and the header read the same number. Keys (never while typing): J and K move,
// Enter opens, C, L, F, W, H, N and E run the item's own actions, ? shows them.
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WeekLoadData } from "../../actions/types.ts";
import type { InboxPrefs } from "../../config/schema.ts";
import { statusOf, type InboxItemView, type InboxPlace, type InboxView } from "../../plan/inbox-items.ts";
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
import { clientColor } from "../labels.ts";
import { ASK_KEY_EVENT } from "../menu.ts";
import { navOf, type LateFilter, type Nav } from "../nav.ts";
import { Stamp } from "../Stamp.tsx";
import { usePhone } from "../viewport.ts";
import { chatterItem, chatterRows, entryOf, useInboxData, type ChatterRow, type Entry } from "./data.ts";
import { ChatterDetail, Detail } from "./Detail.tsx";
import { HeldBack } from "./HeldBack.tsx";
import { actsFor, ItemActions, ITEM_KEYS, notWorkUndo, type Act, type FormId } from "./ItemActions.tsx";
import { clientCountsFor, ownerTag, detailTag, dividerBefore, flatOrder, GROUPS, groupRows, inStatuses, isNewSince, rowSub, sliceGroups, STATUS_TAG, statusCounts, summaryLine, viewLabel, VIEWS, type Group, type Sort } from "./model.ts";

/** The letters the Inbox's items answer to (ItemActions' keys). */
const INBOX_LETTERS = new Set(ITEM_KEYS.map((k) => k.key).filter((k) => k.length === 1 && k !== "J" && k !== "K"));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
/** How many rows render at first and with each step as the list is scrolled (IB-2). */
const PAGE = 120;
/** Keys of a chat's chatter rows: they stay in the page, never in an address. */
const isChatterKey = (k: string | null | undefined) => !!k && k.startsWith("h");

export function InboxPage({ nav, data, version, onNav, onChanged, onFeedback }: { nav: Extract<Nav, { tab: "inbox" }>; data: WeekLoadData; version: number; onNav: (n: Nav) => void; onChanged: () => void; onFeedback?: () => void }): ReactNode {
  const phone = usePhone();
  const tz = userZone(data);
  // A DevOps write (create, link comment, mark done) reads the Inbox again, as Conversations did (its version).
  const writes = useDevOpsWrite();
  const src = useInboxData(`${version}:${writes?.version ?? 0}`);
  const [prefs, setPrefs] = useState<InboxPrefs>(data.ui.inbox ?? { view: "needs_you", clients: [], group: "client", sort: "newest", statuses: ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done"], grouping: "day" });
  // IB-2: where I am comes from the address. An item's address carries no view, so while one is open the place stays
  // what it was; the bare #/inbox and a cold deep link are Everything.
  const held = useRef<InboxPlace>("everything");
  if (nav.view) held.current = nav.view;
  else if (!nav.item) held.current = "everything";
  const place: InboxPlace = held.current;
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
  /** A view on the left, or Everything: the address says which; only the chips are remembered. */
  const chooseView = (v: InboxPlace) => {
    setLate(null);
    setSticky(null);
    setChatterKey(null);
    onNav(navOf.inboxView(v));
  };
  const clients = late ? (late.client ? [late.client] : []) : prefs.clients;

  const items = src.list?.items ?? [];
  const chatterAll = useMemo(() => chatterRows(src.convs, []), [src.convs]);
  // One list: the rows from inbox.list and the chats' chatter, each with the statuses it's in.
  const timeline = useMemo(() => [...(src.list?.items ?? []), ...chatterAll.map(chatterItem)], [src.list, chatterAll]);
  // Part 0: Teammate has it is out of Everything's active part, folded at its foot until asked for.
  const [teammatesOpen, setTeammatesOpen] = useState(false);
  const activeStatuses = useMemo<InboxView[]>(() => prefs.statuses.filter((v) => v !== "teammates" || teammatesOpen), [prefs.statuses, teammatesOpen]);
  const statuses = useMemo<InboxView[]>(() => (place === "everything" ? activeStatuses : [place]), [place, activeStatuses]);
  const inStatus = useMemo(() => inStatuses(timeline, statuses, clients).filter((i) => !late || i.late), [timeline, statuses, clients, late]);
  const matches = useCallback((i: InboxItemView, q: string) => `${i.title} ${i.who ?? ""} ${i.where ?? ""} ${clientName(i.clientKey)}`.toLowerCase().includes(q), [clientName]);
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // The item open now stays in the list, even when it has left this filter (an action moved it, or a deep link).
    const keep = sticky ?? nav.item;
    const s = keep && !inStatus.some((i) => i.key === keep) ? items.find((i) => i.key === keep && !i.snoozedUntil) : undefined;
    const all = s ? [...inStatus, s] : inStatus;
    return q ? all.filter((i) => matches(i, q)) : all;
  }, [inStatus, items, sticky, nav.item, filter, matches]);
  const groups = useMemo(() => groupRows(rows, prefs.grouping, (k) => clientName(k), today, { tz, sort: prefs.sort }), [rows, prefs.grouping, prefs.sort, clientName, today, tz]);
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
  const chipCounts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return statusCounts(q ? timeline.filter((i) => matches(i, q)) : timeline, clients);
  }, [timeline, clients, filter, matches]);
  const railCounts = useMemo(() => statusCounts(timeline, clients), [timeline, clients]);
  const viewCount = (v: InboxView) => railCounts[v];
  const everythingCount = useMemo(() => inStatuses(timeline, activeStatuses, clients).length, [timeline, activeStatuses, clients]);
  const placeCount = place === "everything" ? everythingCount : viewCount(place);
  const byClient = useMemo(() => clientCountsFor(timeline, statuses), [timeline, statuses]);

  // The list renders as it's scrolled: the first page, then more when the end comes near (never past what J and K reach).
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [place, prefs.sort, prefs.grouping, statuses, clients, filter]);
  const loadMore = useCallback(() => setLimit((n) => n + PAGE), []);

  // The open item: the address's, a chat's chatter I opened (local), else (desktop) the list's first.
  const [chatterKey, setChatterKey] = useState<string | null>(null);
  const openKey = nav.item ?? chatterKey ?? (phone ? null : (order[0]?.key ?? null));
  const openRow = openKey && !isChatterKey(openKey) ? (items.find((i) => i.key === openKey) ?? null) : null;
  const entry: Entry | null = openRow ? entryOf(openRow, src) : null;
  const openChatter = isChatterKey(openKey) ? (chatterAll.find((c) => c.key === openKey) ?? null) : null;
  const missing = !!nav.item && !!src.list && !openRow;
  const openIndex = openKey ? order.findIndex((r) => r.key === openKey) : -1;
  const shown = useMemo(() => sliceGroups(groups, Math.max(limit, openIndex + 20)), [groups, limit, openIndex]);
  const shownCount = useMemo(() => shown.reduce((n, g) => n + g.rows.length, 0), [shown]);

  // IB-2: "New since you last looked". The marker is read from the server when Everything opens and held for the visit,
  // so reloads don't move the divider under me. It moves on the server once I've seen the divider, or at once when
  // there is no divider to reach; what arrived after this visit's read stays new.
  const visit = useRef<string | null>(null);
  const marked = useRef<string | null>(null);
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => {
    if (place !== "everything") {
      visit.current = null;
      return;
    }
    if (!src.list || visit.current) return;
    visit.current = src.list.now ?? null;
    setSince(marked.current ?? src.list.lastLooked ?? null);
  }, [place, src.list]);
  const newSince = since ?? src.list?.lastLooked ?? null;
  const dividerKey = prefs.grouping === "day" ? dividerBefore(order, newSince, prefs.sort) : null;
  const look = useCallback(() => {
    const at = visit.current;
    if (!at || marked.current === at) return;
    marked.current = at;
    void call("inbox.looked", { at }, { background: true }).catch(() => (marked.current = null));
  }, []);
  useEffect(() => {
    if (place === "everything" && src.list && !dividerKey) look();
  }, [place, src.list, dividerKey, look]);

  // J and K keep the open row in sight in a long list.
  const keyMove = useRef(false);
  useEffect(() => {
    if (!keyMove.current) return;
    keyMove.current = false;
    document.querySelector(".ib-row.open")?.scrollIntoView({ block: "nearest" });
  }, [openKey, shownCount]);

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
      if (isChatterKey(key)) {
        // A chat's chatter opens here in the page: its key holds a chat id, which never goes in an address.
        setChatterKey(key);
        setSticky(null);
        onNav(navOf.inboxView(held.current));
        return;
      }
      setChatterKey(null);
      setSticky(key);
      onNav(navOf.inboxItem(key, held.current));
    },
    [onNav],
  );

  // Once there has been something held back it stays mounted: HeldBack itself goes when it's closed and empty, and an
  // open list can say "Nothing held back now." after the last one goes.
  const heldEver = useRef(false);
  if ((src.convs?.heldCount ?? 0) > 0) heldEver.current = true;
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
        // Part 0: refused because someone got there first ("Eric has this"): show who has it now.
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
        onNav(navOf.inboxItem(`v${into.id}`, held.current));
        await reloadAll();
      } catch (e) {
        setError(errText(e));
      }
    },
    [reloadAll, onNav],
  );
  const acts: Act[] = entry
    ? actsFor(entry, {
        run,
        form: setForm,
        // QC-1: a draft's Create in DevOps opens the preview directly (the New form is for changing it first).
        createDraft: (id) => {
          const d = src.caps?.drafts.find((x) => x.id === id);
          if (d && writes?.can(d.clientKey)) writes.create(d.clientKey, [d]);
          else createDraft?.(id);
        },
        editDraft: (id) => {
          const d = src.caps?.drafts.find((x) => x.id === id);
          if (d) editDraft?.(d);
        },
        planWeek: () => onNav(navOf.addWork()),
        canMerge: mergeOthers.length > 0,
        today,
        openItem: open,
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
        keyMove.current = true;
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
      // QC-1: Shift+N is the window's New (a new work item in DevOps), here too.
      if (!INBOX_LETTERS.has(key) || (key === "N" && e.shiftKey)) return;
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
        if (next) {
          keyMove.current = true;
          k.open(next.key);
        }
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

  // Phone: the page scrolls under the sticky top bar, so day headings stick just below it.
  const phoneMain = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".app.phone > .topbar");
    const main = phoneMain.current;
    if (!phone || !bar || !main) return;
    const fit = () => main.style.setProperty("--ib-phone-top", `${bar.offsetHeight}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [phone]);
  const notWork = useCallback((id: number) => void run("conversations.not_work", { id }, "Moved to Chatter for everyone on the chat", notWorkUndo(id)), [run]);
  // A chip changes the remembered set; from a view on the left it lands on Everything. A view's own chip takes me back.
  const toggleStatus = (v: InboxView) => {
    if (place === "everything" && v === "teammates") return setTeammatesOpen((x) => !x);
    if (place !== "everything" && statuses.includes(v) && statuses.length === 1) return chooseView("everything");
    const next = VIEWS.map((x) => x.id).filter((x) => (x === v ? !statuses.includes(v) : statuses.includes(x)));
    save({ statuses: next });
    if (place !== "everything") chooseView("everything");
  };
  const header = (
    <div className="ib-list-head">
      <h2>
        {viewLabel(place)} <span className="muted">{late ? rows.length : placeCount}</span>
      </h2>
      {late && (
        <p className="ib-late-line" role="status">
          Late{late.client ? ` for ${clientName(late.client)}` : ""}
          <button type="button" className="link-btn" onClick={() => (setLate(null), onNav(navOf.inboxView(place)))}>
            Show all
          </button>
        </p>
      )}
      {place === "promises" && (
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
      {place === "captures" && (
        <section className="ib-capture" aria-label="Capture">
          <CaptureBox data={data} onChanged={() => void reloadAll()} defaultClient={prefs.clients.length === 1 ? prefs.clients[0]! : null} large />
        </section>
      )}
      {adding && place === "promises" && (
        <FollowUpForm clients={captureClients(data)} onCancel={() => setAdding(false)} onSaved={() => (setAdding(false), setNotice("Promise added"), void reloadAll())} />
      )}
      {missing && <p className="conv-link-note" role="status">That item isn't here any more: it was done or closed a while ago, or its chat is no longer registered.</p>}
      {place === "chatter" && rows.length > 0 && <p className="muted ib-view-note">No ask, promise or work in these. They never count toward Needs you.</p>}
      <ListGroups groups={shown} openKey={openKey} onOpen={open} today={today} tz={tz} colors={data.clients} phone={phone} group={prefs.grouping} reasons={place === "needs_you"} live={place === "in_progress" ? liveState : null} onNotWork={place === "done" ? undefined : notWork} since={newSince} dividerKey={dividerKey} onDividerSeen={look} />
      {shownCount < order.length && <MoreRows onMore={loadMore} left={order.length - shownCount} />}
      {showSnoozed && snoozed.length > 0 && (
        <ListGroups groups={[{ id: "snoozed", label: "Snoozed", clientKey: null, rows: snoozed }]} openKey={openKey} onOpen={open} today={today} tz={tz} colors={data.clients} phone={phone} group="status" reasons={false} live={null} since={null} dividerKey={null} />
      )}
      {src.list && !rows.length && <EmptyView place={place} noStatuses={!statuses.length} />}
      {src.convs && src.convs.unsorted.count > 0 && (place === "everything" || place === "needs_you" || place === "chatter") && (
        <Unsorted u={src.convs.unsorted} sort={() => void run("conversations.sort_unsorted", {}, "Sorted again")} {...(onFeedback ? { onFeedback } : {})} />
      )}
      {src.convs && heldEver.current && (place === "everything" || place === "needs_you" || place === "chatter") && <HeldBack count={src.convs.heldCount ?? 0} tz={tz} today={today} onChanged={() => void reloadAll()} />}
    </>
  );

  if (phone) return (
    <main ref={phoneMain} className="ib ib-phone" aria-label="Inbox">
      <div className="ib-phone-top">
        <h1>Inbox</h1>
      </div>
      <div className="ib-phone-pick" data-tour="ib-rail">
        <button type="button" className="ib-pick-btn" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <span className="muted">View</span>
          <strong>
            {viewLabel(place)} · {placeCount}
          </strong>
        </button>
        <button type="button" className="ib-pick-btn" aria-haspopup="dialog" onClick={() => setPicker(true)}>
          <span className="muted">Clients</span>
          <strong>{clients.length ? clients.map((c) => clientName(c)).join(", ") : "All clients"}</strong>
        </button>
      </div>
      {place !== "chatter" && (
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
          place={place}
          clients={clients}
          group={prefs.grouping}
          sort={prefs.sort}
          statuses={prefs.statuses}
          clientList={clientList}
          count={(v, cs) => (v === "everything" ? inStatuses(timeline, activeStatuses, cs).length : statusCounts(timeline, cs)[v])}
          chips={(cs) => statusCounts(timeline, cs)}
          colors={data.clients}
          onClose={() => setPicker(false)}
          onApply={(p) => {
            save({ clients: p.clients, grouping: p.grouping, sort: p.sort, statuses: p.statuses });
            setPicker(false);
            chooseView(p.place);
          }}
        />
      )}
      {entry && (
        <ItemSheet onBack={() => onNav(navOf.inboxView(place))} entry={entry} acts={acts} form={form} title={`Inbox · ${viewLabel(place)}`}>
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
              <span className="count">{placeCount}</span>
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
                <span className="count">{byClient.get(c.clientKey) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
        <h3 className="ib-section">Views</h3>
        <ul className="ib-views">
          <li>
            <button type="button" aria-current={place === "everything" ? "page" : undefined} onClick={() => chooseView("everything")}>
              Everything <span className="count">{everythingCount}</span>
            </button>
          </li>
          {VIEWS.map((v) => (
            <li key={v.id}>
              <button type="button" aria-current={v.id === place ? "page" : undefined} onClick={() => chooseView(v.id)}>
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
      <section className="ib-list" data-tour="ib-list" aria-label={viewLabel(place)}>
        {header}
        <div className="ib-list-tools">
          <input type="search" className="ib-filter" placeholder="Filter" aria-label="Filter the list" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <SortToggle sort={prefs.sort} onChange={(sort) => save({ sort })} />
          <label className="ib-group">
            Group{" "}
            <select value={prefs.grouping} onChange={(e) => save({ grouping: e.target.value as Group })}>
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <StatusChips on={statuses} counts={chipCounts} onToggle={toggleStatus} />
        {error && <p className="set-problem" role="alert">{error}</p>}
        <Fading text={notice} onGone={() => setNotice(null)} ms={8000} />
        <div className="ib-list-body">{list}</div>
        <p className="ib-list-foot">
          {viewCount("teammates") > 0 && !statuses.includes("teammates") && (
            <button type="button" className="linkish" aria-expanded={false} onClick={() => (place === "everything" ? setTeammatesOpen(true) : chooseView("teammates"))}>
              {viewCount("teammates")} with a teammate
            </button>
          )}
          {viewCount("done") > 0 && !statuses.includes("done") && (
            <button type="button" className="linkish" onClick={() => chooseView("done")}>
              {viewCount("done")} done
            </button>
          )}
          {viewCount("chatter") > 0 && !statuses.includes("chatter") && (
            <button type="button" className="linkish" onClick={() => chooseView("chatter")}>
              {viewCount("chatter")} filtered as chatter
            </button>
          )}
          {snoozed.length > 0 && (
            <button type="button" className="linkish" aria-expanded={showSnoozed} onClick={() => setShowSnoozed((v) => !v)}>
              {showSnoozed ? "Hide snoozed" : `${snoozed.length} snoozed`}
            </button>
          )}
          {src.convs?.lastPoll && <span className="muted">Chats last checked <Stamp at={src.convs.lastPoll} tz={tz} today={today} /></span>}
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

/** IB-2: one row of the timeline; memoized so opening another row doesn't redraw thousands. */
const Row = memo(function Row({ r, open, isNew, onOpen, today, tz, color, phone, reason, live, onNotWork, menuOpen, setMenuFor }: { r: InboxItemView; open: boolean; isNew: boolean; onOpen: (k: string) => void; today: string; tz: string; color: string; phone: boolean; reason: boolean; live: { id: number; state: string | null; closed: boolean } | undefined; onNotWork?: ((id: number) => void) | undefined; menuOpen: boolean; setMenuFor: (f: (k: string | null) => string | null) => void }): ReactNode {
  const status = statusOf(r.views);
  const st = (r.kind === "conversation" ? ownerTag(r) : null) ?? (status ? STATUS_TAG[status] : null);
  const extra = live ? { text: live.closed ? `#${live.id} closed · Mark done?` : `#${live.id}${live.state ? ` · ${live.state}` : ""}`, tone: live.closed ? ("soon" as const) : ("plain" as const) } : detailTag(r, today);
  const sub = isChatterKey(r.key) ? (r.where ?? "") : reason && r.reason ? r.reason : rowSub(r);
  return (
    <li>
      <button type="button" className={`ib-row${open ? " open" : ""}${r.late ? " late" : ""}${isNew ? " new" : ""}`} {...(isChatterKey(r.key) ? {} : { "data-key": r.key })} aria-current={open ? "true" : undefined} onClick={() => onOpen(r.key)}>
        {isNew && <span className="ib-new-dot" title="New since you last looked" aria-label="New" />}
        <span className="ib-row-main">
          <span className={`ib-row-line kind-${r.kind}`}>
            <span className="dot" style={{ "--c": color } as CSSProperties} aria-hidden="true" />
            <span className="ib-row-title">{r.title || "(no title)"}</span>
            <Stamp className="ib-row-when" at={r.at} tz={tz} today={today} dateOnlyIfOld={phone} />
          </span>
          <span className="ib-row-sub">
            {st && <span className={`ib-tag tone-${st.tone}`}>{st.text}</span>}
            {extra && <span className={`ib-tag tone-${extra.tone}`}>{extra.text}</span>}
            {r.mentions?.map((n) => (
              <span key={n} className="ib-tag tone-plain mention-tag">
                mentions {n}
              </span>
            ))}
            {sub && <span className="muted ib-row-who">{sub}</span>}
          </span>
        </span>
      </button>
      {onNotWork && r.kind === "conversation" && !r.done && !isChatterKey(r.key) && (
        <span className="fu-more ib-row-more">
          <button type="button" className="ib-act quiet" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`More for ${r.title}`} onClick={() => setMenuFor((k) => (k === r.key ? null : r.key))}>
            ⋯
          </button>
          {menuOpen && (
            <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenuFor(() => null))}>
              <button type="button" role="menuitem" onClick={() => (setMenuFor(() => null), onNotWork(Number(r.key.slice(1))))}>
                Not work-related
              </button>
            </span>
          )}
        </span>
      )}
    </li>
  );
});

/** The "New since you last looked" line; it tells the page once it has come into view. */
function NewDivider({ onSeen }: { onSeen?: (() => void) | undefined }): ReactNode {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onSeen) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onSeen());
    io.observe(el);
    return () => io.disconnect();
  }, [onSeen]);
  return (
    <li ref={ref} className="ib-new-divider" role="separator" aria-label="New since you last looked">
      <span>New since you last looked</span>
    </li>
  );
}

/** Marks the end of what's drawn: when it comes near the view, more rows follow (IB-2). */
function MoreRows({ onMore, left }: { onMore: () => void; left: number }): ReactNode {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onMore(), { root: el.closest(".ib-list-body"), rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, left]);
  return (
    <button ref={ref} type="button" className="linkish ib-more" onClick={onMore}>
      {left} more
    </button>
  );
}

function SortToggle({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }): ReactNode {
  return (
    <button type="button" className="ib-act quiet ib-sort" aria-label={`Sort: ${sort === "newest" ? "newest" : "oldest"} first. Switch`} title="Switch the order" onClick={() => onChange(sort === "newest" ? "oldest" : "newest")}>
      {sort === "newest" ? "↓ Newest first" : "↑ Oldest first"}
    </button>
  );
}

function StatusChips({ on, counts, onToggle }: { on: readonly InboxView[]; counts: Record<InboxView, number>; onToggle: (v: InboxView) => void }): ReactNode {
  return (
    <div className="ib-chips" role="group" aria-label="Status">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" className="ib-chip" aria-pressed={on.includes(v.id)} data-status={v.id} onClick={() => onToggle(v.id)}>
          {v.label} <span className="count">{counts[v.id]}</span>
        </button>
      ))}
    </div>
  );
}

function ListGroups({ groups, openKey, onOpen, today, tz, colors, phone, group, reasons, live, onNotWork, since, dividerKey, onDividerSeen }: { groups: ReturnType<typeof groupRows>; openKey: string | null; onOpen: (k: string) => void; today: string; tz: string; colors: Record<string, string>; phone: boolean; group: Group; reasons: boolean; live: ReadonlyMap<string, { id: number; state: string | null; closed: boolean }> | null; /** QF-1: a conversation row's ⋯ › Not work-related. */ onNotWork?: ((id: number) => void) | undefined; /** IB-2: the marker, and the row the divider goes above. */ since: string | null; dividerKey: string | null; onDividerSeen?: (() => void) | undefined }): ReactNode {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} className="ib-group-sec" aria-label={g.label}>
          <h3 className={`ib-group-head${group === "day" ? " ib-day-head" : ""}`}>
            {group === "client" && <span className="dot" style={{ "--c": clientColor(g.clientKey ?? undefined, colors) } as CSSProperties} />}
            {g.label} <span className="muted">{g.rows.length}</span>
          </h3>
          <ul className="ib-rows">
            {g.rows.flatMap((r) => [
              ...(r.key === dividerKey ? [<NewDivider key="new-divider" onSeen={onDividerSeen} />] : []),
              <Row key={r.key} r={r} open={r.key === openKey} isNew={isNewSince(r, since)} onOpen={onOpen} today={today} tz={tz} color={clientColor(r.clientKey ?? undefined, colors)} phone={phone} reason={reasons} live={live?.get(r.key)} onNotWork={onNotWork} menuOpen={menuFor === r.key} setMenuFor={setMenuFor} />,
            ])}
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
  teammates: "No teammate has anything right now.",
  done: "Nothing done recently.",
  chatter: "No chatter.",
};
function EmptyView({ place, noStatuses }: { place: InboxPlace; noStatuses: boolean }): ReactNode {
  return <p className="ib-empty muted">{place === "everything" ? (noStatuses ? "No status is on. Turn one on above." : "Nothing here. New conversations, promises and captures show up in time order.") : EMPTY[place]}</p>;
}

/** Phone: one sheet for View (radio rows), Sort, Status chips, Clients (a wrapping grid) and Group by, with Reset and Show N. */
type PickerResult = { place: InboxPlace; clients: string[]; grouping: Group; sort: Sort; statuses: InboxView[] };
function PickerSheet(p: {
  place: InboxPlace; clients: string[]; group: Group; sort: Sort; statuses: InboxView[]; clientList: { clientKey: string; clientName: string }[]; colors: Record<string, string>;
  count: (v: InboxPlace, clients: string[]) => number; chips: (clients: string[]) => Record<InboxView, number>; onClose: () => void; onApply: (p: PickerResult) => void;
}): ReactNode {
  const [place, setPlace] = useState(p.place);
  const [clients, setClients] = useState(p.clients);
  const [group, setGroup] = useState(p.group);
  const [sort, setSort] = useState(p.sort);
  const [statuses, setStatuses] = useState(p.statuses);
  const shownStatuses = place === "everything" ? statuses : [place];
  const toggle = (v: InboxView) => {
    const next = VIEWS.map((x) => x.id).filter((x) => (x === v ? !shownStatuses.includes(v) : shownStatuses.includes(x)));
    setStatuses(next);
    setPlace("everything");
  };
  const reset = () => (setPlace("everything"), setClients([]), setGroup("day"), setSort("newest"), setStatuses(VIEWS.map((v) => v.id).filter((v) => v !== "chatter")));
  // Focus moves into the sheet so Esc closes it (and a screen reader starts there).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="ib-sheet-back" data-overlay="modal" onClick={p.onClose}>
      <div ref={ref} tabIndex={-1} className="ib-sheet" role="dialog" aria-modal="true" aria-label="View and clients" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), p.onClose())}>
        <span className="ib-grip" aria-hidden="true" />
        <fieldset className="ib-sheet-views">
          <legend className="ib-section">View</legend>
          {([{ id: "everything", label: "Everything" }, ...VIEWS] as { id: InboxPlace; label: string }[]).map((v) => (
            <label key={v.id} className={v.id === place ? "on" : undefined}>
              <input type="radio" name="ib-view" checked={v.id === place} onChange={() => setPlace(v.id)} /> {v.label}
              <span className="count">{p.count(v.id, clients)}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ib-sheet-group">
          <legend className="ib-section">Sort</legend>
          <div className="ib-seg" role="radiogroup" aria-label="Sort">
            {(["newest", "oldest"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={s === sort} onClick={() => setSort(s)}>
                {s === "newest" ? "Newest first" : "Oldest first"}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="ib-sheet-status">
          <legend className="ib-section">Status</legend>
          <StatusChips on={shownStatuses} counts={p.chips(clients)} onToggle={toggle} />
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
          <button type="button" className="ib-act" onClick={reset}>
            Reset
          </button>
          <button type="button" className="ib-act primary" onClick={() => p.onApply({ place, clients, grouping: group, sort, statuses })}>
            Show {p.count(place, clients)}
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
