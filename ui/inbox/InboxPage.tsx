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
import { DraftEditorCtx } from "../drafteditor-ctx.tsx";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { markSeen } from "../inboxcount.ts";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "../keys.ts";
import { ASK_KEY_EVENT } from "../menu.ts";
import { clientColor } from "../labels.ts";
import { hashOf, INBOX_LIST_NAMES, INBOX_LISTS, listOfKey, navOf, type InboxList, type LateFilter, type Nav } from "../nav.ts";
import { Stamp } from "../Stamp.tsx";
import { usePhone } from "../viewport.ts";
import { entryOf, useInboxData, type Entry } from "./data.ts";
import { Detail, FormArea, Lead } from "./Detail.tsx";
import { actsFor, ITEM_KEYS, type FormId } from "./ItemActions.tsx";
import { chipHint, chipName, dueWords, headCount, lateText, needCounts, needNoClient, NO_CLIENT } from "./model.ts";
import { SuggestionForms, SuggestionOpen, SuggestionWhy, suggestionActs, type SuggestionForm } from "./Suggestion.tsx";
import { needsQueue } from "../../plan/phone-now.ts";
import { screen } from "../screens.ts";
import "./inbox.css";
import { Icon } from "../icons.tsx";

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

/** A promise's person, as its row says it. */
export const forWho = (who: string | null) => (who ? `For ${who}` : "For no one named");

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
  // PH-2: on the phone, the bare #/inbox and #/inbox/one show what needs me one at a time (ui/phone/InboxOne.tsx).
  const PhoneM = phone ? screen("phone") : null;
  const oneAsked = !!PhoneM && (!!nav.one || (!nav.view && !nav.item && !nav.late));
  const oneRef = useRef(oneAsked);
  oneRef.current = oneAsked;
  /** An action was taken one at a time: once nothing is left, the end line shows above the lists. */
  const [worked, setWorked] = useState(false);

  // The list I chose is remembered (my Inbox setting); an address with a list wins while it's there.
  useEffect(() => {
    if (!nav.view || nav.view === lastList) return;
    setLastList(nav.view);
    chosenThisSession = nav.view;
    void call("ui.set_inbox", { view: LIST_PREF[nav.view] }, { background: true }).catch(() => undefined);
  }, [nav.view, lastList]);
  const chooseList = (l: InboxList) => (setKept(null), onNav({ tab: "inbox", view: l, item: null }));
  // UC-2: the "No client" chip, chosen beside the clients. Kept for this visit only: the stored choice is client keys.
  const [noClient, setNoClient] = useState(false);
  const toggleClient = (k: string | null) => {
    if (k === null) setNoClient(false);
    const next = k === null ? [] : clients.includes(k) ? clients.filter((x) => x !== k) : [...clients, k];
    setClients(next);
    void call("ui.set_inbox", { clients: next }, { background: true }).catch(() => undefined);
  };
  const inClients = useCallback((k: string | null) => (!clients.length && !noClient) || (k === null ? noClient : clients.includes(k)), [clients, noClient]);

  // ---- the three lists ----
  const items = useMemo(() => src.list?.items ?? [], [src.list]);
  // PH-2: what the Inbox counts as needing me, in the one thing's order (plan/phone-now.ts), and the one shown.
  const queue = useMemo(() => (PhoneM ? needsQueue(items, today) : []), [PhoneM, items, today]);
  const qKeys = queue.map((r) => r.key);
  const [cur, setCur] = useState<string | null>(nav.one ? nav.item : null);
  useEffect(() => {
    if (nav.one) setCur(nav.item);
  }, [nav.one, nav.item]);
  const prevKeys = useRef<string[]>([]);
  let oneIdx = qKeys.length ? (cur ? qKeys.indexOf(cur) : 0) : -1;
  if (cur && qKeys.length && oneIdx < 0) {
    // The one shown has left (dealt with): the next one after it that is still here, else the one before it.
    const old = prevKeys.current;
    const i = old.indexOf(cur);
    const k = i < 0 ? undefined : (old.slice(i + 1).find((x) => qKeys.includes(x)) ?? [...old.slice(0, i)].reverse().find((x) => qKeys.includes(x)));
    oneIdx = k ? qKeys.indexOf(k) : 0;
  }
  // While a form is open on the item shown, it stays, even if a reread drops it (a teammate's link): what I typed
  // there is never taken away under me, as on the lists. It goes when the form closes.
  const heldRef = useRef<(typeof queue)[number] | null>(null);
  const holding = oneAsked && !!(form || sForm) && !!heldRef.current && heldRef.current.key === cur && !qKeys.includes(cur ?? "");
  const curRow = holding ? heldRef.current : oneIdx >= 0 ? queue[oneIdx]! : null;
  useEffect(() => {
    if (!holding) prevKeys.current = qKeys;
    heldRef.current = curRow;
    if (oneAsked && curRow && curRow.key !== cur) setCur(curRow.key);
  });
  const curRef = useRef<string | null>(null);
  curRef.current = oneAsked ? (curRow?.key ?? null) : null;
  // The open suggestion stays while its form is open, even if a reread would drop it (a new message, a teammate's
  // link): what I typed there is never taken away under me. It goes when the form closes.
  const openKey = !oneAsked && nav.item && listOfKey(nav.item) === list ? nav.item : null;
  const keptRef = useRef<SuggestionRow | null>(null);
  const suggestions = useMemo(() => {
    const now = (src.chats?.suggestions ?? []).filter((s) => inClients(s.clientKey));
    const held = keptRef.current;
    return sForm && held && openKey === `v${held.id}` && !now.some((s) => s.id === held.id) ? [...now, held] : now;
  }, [src.chats, inClients, sForm, openKey]);
  const promiseRows = useMemo(
    () => items.filter((r) => r.kind === "promise" && !r.done && r.views.length > 0 && inClients(r.clientKey) && (!late || (r.late && (late.client === null || r.clientKey === late.client)))).sort(promiseOrder),
    [items, inClients, late],
  );
  const captureRows = useMemo(() => items.filter((r) => (r.kind === "capture" || r.kind === "draft") && r.views.length > 0 && inClients(r.clientKey)), [items, inClients]);
  const counts: Record<InboxList, number> = { chats: suggestions.length, promises: promiseRows.length, captures: captureRows.length };
  // UC-1: each chip's number is what needs me in that client, counted as the tab counts; All clients shows the tab's.
  // The phone's Inbox is unchanged: no numbers on its chips.
  const need = useMemo(() => (phone ? new Map<string, number>() : needCounts(items)), [items, phone]);
  // UC-3: the rows the tab counts, for the group headings (the same rule as the chips').
  const needKeys = useMemo(() => new Set(items.filter((r) => r.views.includes("needs_you")).map((r) => r.key)), [items]);
  const allNeed = phone ? 0 : (src.list?.needsYou ?? 0);
  // UC-2: what the tab counts with no client, as its own chip after the clients (so the chips add up to the tab).
  const noClientNeed = phone ? 0 : needNoClient(items);
  // The chosen No client goes only once nothing in any list lacks a client (its rows may no longer need me but still show).
  const anyNoClient = !phone && items.some((i) => !i.clientKey);
  useEffect(() => {
    if (!anyNoClient && noClient) setNoClient(false);
  }, [anyNoClient, noClient]);
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
  const openSuggestion = openKey?.startsWith("v") ? (suggestions.find((s) => `v${s.id}` === openKey) ?? null) : null;
  keptRef.current = openSuggestion;
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
        // PH-2: one at a time, Undo comes back to the item it undid (read before the call: Next may be tapped meanwhile).
        const acted = curRef.current;
        if (action !== "inbox.list") await call(action, input);
        if (oneRef.current) setWorked(true);
        setError(null);
        setForm(null);
        setSForm(null);
        const undoRun = typeof undo === "function" ? undo : undo ? () => call(undo.action, undo.input) : null;
        setNotice(
          undoRun ? (
            <>
              {msg}.{" "}
              <button type="button" className="mini quiet" onClick={() => void undoRun().then(() => (setNotice("Undone"), void reloadAll().then(() => void (acted && oneRef.current && setCur(acted)))), (e) => setError(errText(e)))}>
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
        if (oneRef.current) setWorked(true);
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
  /** On the lists, the row after the one that left opens; one at a time, the next item takes its place by itself. */
  const moveOn = (key: string) => void (!oneRef.current && open(after(key)));
  const dismiss = (s: SuggestionRow) => {
    moveOn(`v${s.id}`);
    void run("conversations.dismiss", { id: s.id }, "Dismissed for you", { action: "conversations.undismiss", input: { id: s.id } });
  };
  const asPromise = async (s: SuggestionRow) => {
    try {
      const r = await call<{ followUp: { id: number } }>("followup.add", { what: s.title, clientKey: s.clientKey });
      moveOn(`v${s.id}`);
      await run("conversations.dismiss", { id: s.id, as: "promised" }, "Added to your promises", () => Promise.all([call("followup.delete", { id: r.followUp.id }), call("conversations.undismiss", { id: s.id })]));
    } catch (e) {
      setError(errText(e));
    }
  };
  const notWork = (s: SuggestionRow) => {
    moveOn(`v${s.id}`);
    void run("conversations.not_work", { id: s.id }, "Not work: closed for everyone on the chat", { action: "conversations.not_work_undo", input: { id: s.id } });
  };
  const linked = (s: SuggestionRow, itemId: number, comment: boolean) => {
    moveOn(`v${s.id}`);
    void run("conversations.link", { id: s.id, itemId }, `Linked to #${itemId} for everyone on the chat`).then(() => {
      if (comment && writes) void writes.begin(s.clientKey, [{ kind: "conversation_comment", conversationId: s.id, itemId }]);
    });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const actEnv = {
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
      };
  const acts = entry ? actsFor(entry, actEnv) : [];
  // PH-2: the item shown one at a time: its source, its actions (the same as on the lists) and its form.
  const oneEntry = curRow && curRow.kind === "promise" ? entryOf(curRow, src) : null;
  const sugRef = useRef<SuggestionRow | null>(null);
  const oneSug = curRow && curRow.kind === "conversation" ? (src.chats?.suggestions.find((x) => `v${x.id}` === curRow.key) ?? (sForm && sugRef.current && `v${sugRef.current.id}` === curRow.key ? sugRef.current : null)) : null;
  sugRef.current = oneSug;
  const oneActs = oneEntry ? actsFor(oneEntry, actEnv) : oneSug ? suggestionActs(oneSug, { form: setSForm, dismiss: () => dismiss(oneSug), promise: () => void asPromise(oneSug), notWork: () => notWork(oneSug) }).map((a) => ({ ...a })) : [];
  useEffect(() => {
    if (!oneAsked) return;
    setForm(null);
    setSForm(null);
    if (curRow?.kind === "promise") void markSeen([curRow.key], () => changedRef.current());
  }, [oneAsked, curRow?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keys ----
  const showingOne = !!(oneAsked && PhoneM && curRow);
  const keyRef = useRef({ order, openKey, acts, open, form, sForm, openSuggestion, list, one: showingOne });
  keyRef.current = { order, openKey, acts, open, form, sForm, openSuggestion, list, one: showingOne };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keyRef.current;
      // PH-2: one at a time shows no list; its own buttons move and act (the keys stay the lists').
      if (k.one) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      // The Inbox's keys win over the app's own (C is Capture elsewhere): this listener runs first and stops the rest.
      const done = () => (e.preventDefault(), e.stopImmediatePropagation());
      if (e.key === "?") return void (setKeysOpen((v) => !v), done());
      if (e.key === "Escape" && (k.form || k.sForm)) return void (setForm(null), setSForm(null));
      // While a form is open the other keys do nothing, so nothing typed there is lost to a key press (Escape closes it).
      if (k.form || k.sForm) return;
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
      <span className="ib4-chev"><Icon name={openKey === key ? "up" : "next"} /></span>
    </button>
  );
  // UC-3: a heading counts what needs me there, as its chip and the tab do, and adds its rows when they differ.
  const groupHead = (name: string, n: number, need: number | null) => (
    <h3 className="ib4-group-head">
      {name} <span className="muted">{headCount(need, n)}</span>
    </h3>
  );

  const chatsList = chatGroups.map((g) => (
    <section key={g.clientKey ?? ""} className="ib4-group" aria-label={g.name}>
      {groupHead(g.name, g.rows.length, g.rows.filter((s) => needKeys.has(`v${s.id}`)).length)}
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

  const rowList = (groups: Group<InboxItemView>[], label: (r: InboxItemView) => ReactNode, counts = true) =>
    groups.map((g) => (
      <section key={g.clientKey ?? ""} className="ib4-group" aria-label={g.name}>
        {groupHead(g.name, g.rows.length, counts ? g.rows.filter((r) => needKeys.has(r.key)).length : null)}
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
      {forWho(r.who)}
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
      {rowList(sortGroups, (r) => <Stamp at={r.at} tz={tz} today={today} />, false)}
      {draftGroups.length > 0 && <h2 className="ib4-section">Drafts</h2>}
      {rowList(draftGroups, (r) => r.where ?? "Draft", false)}
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
        Cleared on their own · {cleared.length} <Icon name={clearedOpen ? "up" : "next"} />
      </button>
      {clearedOpen && (
        <ul className="ib4-cleared" aria-label="Cleared on their own">
          {cleared.map((c) => (
            <li key={c.id}>
              <span className="ib4-swatch" aria-hidden="true" style={{ "--c": color(c.clientKey) } as CSSProperties} />
              <span className="ib4-row-main">
                <span className="ib4-row-title">{c.what}</span>
                <span className="ib4-row-sub ib4-cleared-sub muted">
                  <span>{c.reason}</span>
                  <span>
                    {c.clientName}
                    {c.toName ? ` · for ${c.toName}` : ""} · <Stamp at={c.clearedAt} tz={tz} today={today} />
                  </span>
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

  const noticeEl = (
    <>
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
    </>
  );

  // PH-2: one at a time, on the phone, while something needs me.
  if (oneAsked && PhoneM && loaded && curRow) {
    const where =
      oneEntry?.kind === "chatPromise" && oneEntry.promise ? (
        <>
          {oneEntry.promise.chatName}
          {oneEntry.promise.conversationTitle ? ` · ${oneEntry.promise.conversationTitle}` : ""} · <Stamp at={oneEntry.promise.createdAt} tz={tz} today={today} />
        </>
      ) : oneEntry?.kind === "followUp" && oneEntry.followUp ? (
        <>
          {oneEntry.followUp.byHand ? "You added it, " : "Opened "}
          <Stamp at={oneEntry.followUp.openedAt} tz={tz} today={today} />
        </>
      ) : curRow.where ? (
        <>
          {curRow.where} · <Stamp at={curRow.at} tz={tz} today={today} />
        </>
      ) : null;
    const tag = curRow.kind === "promise" ? promiseTag(curRow) : null;
    const card =
      curRow.kind === "promise" ? (
        <>
          {tag && (
            <p className="io-tag">
              <span className={`ib-tag tone-${tag.tone}`}>{tag.text}</span>
            </p>
          )}
          <p className="io-who">{forWho(curRow.who)}</p>
          {where && <p className="io-where muted">{where}</p>}
          {oneEntry && <Lead entry={oneEntry} acts={[]} form={null} setForm={setForm} data={data} tz={tz} today={today} clientName={clientName} run={run} submit={submit} />}
        </>
      ) : oneSug ? (
        <>
          <SuggestionWhy s={oneSug} />
          <p className="io-where muted">
            {oneSug.people.length ? `${oneSug.people.join(", ")} · ` : ""}
            <Stamp at={oneSug.lastWorkAt} tz={tz} today={today} />
            {oneSug.mentions?.length ? ` · mentions ${oneSug.mentions.join(", ")}` : ""}
          </p>
        </>
      ) : (
        <p className="muted">{src.chatsError ? `From chats couldn't be read: ${src.chatsError}` : "Loading…"}</p>
      );
    const formEl = oneEntry ? (
      <FormArea entry={oneEntry} acts={[]} form={form} setForm={setForm} data={data} tz={tz} today={today} clientName={clientName} run={run} submit={submit} reload={() => void src.reload()} phone finished={(m) => (setForm(null), setNotice(m), setWorked(true), void reloadAll())} />
    ) : oneSug ? (
      <SuggestionForms s={oneSug} form={sForm} setForm={setSForm} onLinked={(id, c) => linked(oneSug, id, c)} />
    ) : null;
    const line = (r: InboxItemView) => ({ key: r.key, client: clientName(r.clientKey), color: color(r.clientKey), title: r.kind === "conversation" ? (src.chats?.suggestions.find((x) => `v${x.id}` === r.key)?.title ?? r.title) : r.title });
    return (
      <PhoneM.InboxOne
        index={oneIdx}
        count={queue.length}
        current={line(curRow)}
        card={card}
        acts={oneActs}
        form={formEl}
        notice={noticeEl}
        upNext={queue.slice(oneIdx + 1).map(line)}
        lists={INBOX_LISTS.map((l) => ({ id: l, label: INBOX_LIST_NAMES[l], count: counts[l] }))}
        onList={(l) => chooseList(l as InboxList)}
        onPrev={() => oneIdx > 0 && setCur(qKeys[oneIdx - 1]!)}
        onNext={() => oneIdx < qKeys.length - 1 && setCur(qKeys[oneIdx + 1]!)}
        onPick={setCur}
        onShown={(key) => {
          // The address follows the item shown, without a new history entry (a reload lands on it).
          const h = hashOf({ nav: navOf.inboxOne(key), overlay: null });
          if (location.hash !== h) history.replaceState(history.state, "", h);
        }}
      />
    );
  }

  return (
    <main className="ib4" aria-label="Inbox">
      {/* PH-2: the end of one at a time says so; the lists' way back while something still needs me. */}
      <header className="ib4-head">
        {PhoneM && !oneAsked && queue.length > 0 && <PhoneM.InboxBack onBack={() => onNav(navOf.inboxOne())} />}
        <h1 className="ib4-title">Inbox</h1>
        {PhoneM && oneAsked && loaded && !queue.length && (worked || nav.one) && <PhoneM.InboxEnd />}
        <div className="ib4-switch" role="tablist" aria-label="Lists" data-tour="ib-rail">
          {INBOX_LISTS.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={list === l} className={`ib4-tab${list === l ? " on" : ""}`} onClick={() => chooseList(l)}>
              <Icon name={l === "chats" ? "chats" : l === "promises" ? "promise" : "to-sort"} />
              {INBOX_LIST_NAMES[l]} <span className="ib4-count">{counts[l]}</span>
            </button>
          ))}
        </div>
      </header>
      {chipClients.length + (noClientNeed > 0 || noClient ? 1 : 0) > 1 && (
        <div className="ib4-chips" role="group" aria-label="Clients">
          <button type="button" className={`ib4-chip${clients.length || noClient ? "" : " on"}`} aria-pressed={!clients.length && !noClient} aria-label={chipName("All clients", allNeed)} title={chipHint(null, allNeed) ?? undefined} onClick={() => toggleClient(null)}>
            All clients
            {allNeed > 0 && <span className="ib4-count">{allNeed}</span>}
          </button>
          {chipClients.map((k) => (
            <button key={k} type="button" className={`ib4-chip${clients.includes(k) ? " on" : ""}`} aria-pressed={clients.includes(k)} aria-label={chipName(clientName(k), need.get(k) ?? 0)} title={chipHint(clientName(k), need.get(k) ?? 0) ?? undefined} onClick={() => toggleClient(k)} style={{ "--c": color(k) } as CSSProperties}>
              <span className="dot" aria-hidden="true" />
              {clientName(k)}
              {(need.get(k) ?? 0) > 0 && <span className="ib4-count">{need.get(k)}</span>}
            </button>
          ))}
          {(noClientNeed > 0 || noClient) && (
            <button type="button" className={`ib4-chip ib4-chip-none${noClient ? " on" : ""}`} data-chip="no-client" aria-pressed={noClient} aria-label={chipName(NO_CLIENT, noClientNeed)} title={chipHint(NO_CLIENT, noClientNeed) ?? undefined} onClick={() => setNoClient((v) => !v)}>
              {NO_CLIENT}
              <span className="ib4-count">{noClientNeed}</span>
            </button>
          )}
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
      {noticeEl}
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
      {!phone && !(list === "chats" ? !chatGroups.length : list === "promises" ? !promiseGroups.length : !captureRows.length) && (
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
