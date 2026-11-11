// IB-1 slice 2: what the new Inbox reads. inbox.list is the list (rows, views, counts: the one read model); the
// sources give the detail pane what it shows and acts on (a conversation's card, a chat promise's card, a promise I
// added, a capture, a draft). Rows and sources join by item key (plan/inbox-items.ts). A source that fails leaves its
// rows in the list and says so in the pane; it never empties the list.
import { useDevOpsChanged } from "../DevOpsFresh.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureState, FollowUpView } from "../../actions/types.ts";
import type { ConversationCard, ConversationsData, MyPromisesData, PromiseCard } from "../../plan/conversation-views.ts";
import type { InboxItemView, InboxListData } from "../../plan/inbox-items.ts";
import type { Capture, DraftStory } from "../../plan/types.ts";
import { call } from "../api.ts";

export type Entry =
  | { kind: "conversation"; row: InboxItemView; card: ConversationCard | null }
  | { kind: "chatPromise"; row: InboxItemView; promise: PromiseCard | null }
  | { kind: "followUp"; row: InboxItemView; followUp: FollowUpView | null }
  | { kind: "send"; row: InboxItemView }
  /** Slice 3: what I wait on (someone's commitment to me, my send, my Ask to look); the row is all there is. */
  | { kind: "waiting"; row: InboxItemView }
  | { kind: "capture"; row: InboxItemView; capture: Capture | null }
  | { kind: "draft"; row: InboxItemView; draft: DraftStory | null };

export type InboxSources = {
  list: InboxListData | null;
  convs: ConversationsData | null;
  promises: MyPromisesData | null;
  followUps: FollowUpView[] | null;
  caps: CaptureState | null;
  error: string | null;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : "Could not load the Inbox");

/** Loads the list and its sources; `reload` reads them all again (after any action). */
export function useInboxData(version: number | string): InboxSources & { reload: () => Promise<void>; setConvs: (d: ConversationsData) => void; setPromises: (d: MyPromisesData) => void } {
  const [s, setS] = useState<InboxSources>({ list: null, convs: null, promises: null, followUps: null, caps: null, error: null });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    const [list, convs, promises, fus, caps] = await Promise.allSettled([
      call<InboxListData>("inbox.list", {}),
      call<ConversationsData>("conversations.list", {}),
      call<MyPromisesData>("my_promises.list", {}),
      call<{ followUps: FollowUpView[] }>("followups.list", { includeClosed: true, includeSnoozed: true }),
      call<CaptureState>("capture.load", {}),
    ]);
    if (n !== seq.current) return;
    const v = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    setS((cur) => ({
      list: v(list) ?? cur.list,
      convs: v(convs) ?? cur.convs,
      promises: v(promises) ?? cur.promises,
      followUps: v(fus)?.followUps ?? cur.followUps,
      caps: v(caps) ?? cur.caps,
      error: list.status === "rejected" ? errText(list.reason) : null,
    }));
  }, []);
  useEffect(() => void reload(), [reload, version]);
  // DV-2: a change in DevOps (a linked item's state) rereads the Inbox quietly.
  useDevOpsChanged(null, () => void reload(), { gapMs: 60_000 });
  const setConvs = useCallback((d: ConversationsData) => setS((c) => ({ ...c, convs: d })), []);
  const setPromises = useCallback((d: MyPromisesData) => setS((c) => ({ ...c, promises: d })), []);
  return { ...s, reload, setConvs, setPromises };
}

/** A row with what its source says about it (null while the source is loading or couldn't be read). */
export function entryOf(row: InboxItemView, s: InboxSources): Entry {
  const id = Number(row.key.slice(1));
  if (row.kind === "commitment" || row.kind === "sent" || row.kind === "ask") return { kind: "waiting", row };
  const convs = s.convs ? [...s.convs.needsYou, ...s.convs.inProgress, ...s.convs.teammates, ...s.convs.closed] : [];
  switch (row.key[0]) {
    case "v":
      return { kind: "conversation", row, card: convs.find((c) => c.id === id) ?? null };
    case "c":
      return { kind: "chatPromise", row, promise: s.promises?.promises.find((p) => p.id === id) ?? null };
    case "f":
      return { kind: "followUp", row, followUp: s.followUps?.find((f) => f.id === id) ?? null };
    case "s":
      return { kind: "send", row };
    case "k":
      return { kind: "capture", row, capture: s.caps?.inbox.find((c) => c.id === id) ?? null };
    default:
      return { kind: "draft", row, draft: s.caps?.drafts.find((d) => d.id === id) ?? null };
  }
}

/** Chatter: the messages filtered as chatter, one row per chat (never counted, never in Needs you). */
export type ChatterRow = { key: string; clientKey: string; clientName: string; chatId: string; title: string; messages: ConversationsData["chatter"][number]["messages"]; lastAt: string };
/** IB-2: a chat's chatter as a row of the timeline, status Chatter. Its key stays in the page and never reaches an address. */
export function chatterItem(r: ChatterRow): InboxItemView {
  return { key: r.key, kind: "conversation", clientKey: r.clientKey, at: r.lastAt, views: ["chatter"], title: r.title, who: null, where: `${r.messages.length} ${r.messages.length === 1 ? "message" : "messages"}`, due: null, dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null };
}

export function chatterRows(convs: ConversationsData | null, clients: readonly string[]): ChatterRow[] {
  if (!convs) return [];
  const pick = new Set(clients);
  const out: ChatterRow[] = [];
  for (const g of convs.chatter) {
    if (pick.size && !pick.has(g.clientKey)) continue;
    const byChat = new Map<string, ChatterRow["messages"]>();
    for (const m of g.messages) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
    for (const [chatId, ms] of byChat) {
      const sorted = [...ms].sort((a, b) => a.at.localeCompare(b.at));
      out.push({ key: `h${g.clientKey}:${chatId}`, clientKey: g.clientKey, clientName: g.clientName, chatId, title: sorted[0]!.text.slice(0, 80) || "Chatter", messages: sorted, lastAt: sorted.at(-1)!.at });
    }
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
