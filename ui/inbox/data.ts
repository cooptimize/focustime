// IB-4: what the slim Inbox reads. inbox.list gives the rows of Promises and Captures (keys, clients, due, late) with the
// tab's count; the sources give an open row what it shows and acts on: From chats' suggestions, a chat promise's card,
// a promise I added, a capture, a draft. Rows and sources join by item key (plan/inbox-items.ts). A source that fails
// leaves its rows in the list and says so where it opens; it never empties a list.
import { useDevOpsChanged } from "../DevOpsFresh.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureState, FollowUpView } from "../../actions/types.ts";
import type { MyPromisesData, PromiseCard, SuggestionsData } from "../../plan/conversation-views.ts";
import type { InboxItemView, InboxListData } from "../../plan/inbox-items.ts";
import type { Capture, DraftStory } from "../../plan/types.ts";
import { call } from "../api.ts";

export type Entry =
  | { kind: "chatPromise"; row: InboxItemView; promise: PromiseCard | null }
  | { kind: "followUp"; row: InboxItemView; followUp: FollowUpView | null }
  | { kind: "send"; row: InboxItemView }
  | { kind: "capture"; row: InboxItemView; capture: Capture | null }
  | { kind: "draft"; row: InboxItemView; draft: DraftStory | null };

export type InboxSources = {
  list: InboxListData | null;
  chats: SuggestionsData | null;
  promises: MyPromisesData | null;
  followUps: FollowUpView[] | null;
  caps: CaptureState | null;
  error: string | null;
  /** From chats couldn't be read (its own line; the other lists still show). */
  chatsError: string | null;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : "Could not load the Inbox");

/** Loads the lists and their sources; `reload` reads them all again (after any action). */
export function useInboxData(version: number | string): InboxSources & { reload: () => Promise<void>; setChats: (d: SuggestionsData) => void; setPromises: (d: MyPromisesData) => void } {
  const [s, setS] = useState<InboxSources>({ list: null, chats: null, promises: null, followUps: null, caps: null, error: null, chatsError: null });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    // Promises first: reading them settles the ones that cleared on their own, so the list read after agrees.
    const promises = await call<MyPromisesData>("my_promises.list", {}).then((v) => ({ status: "fulfilled" as const, value: v }), (reason: unknown) => ({ status: "rejected" as const, reason }));
    const [list, chats, fus, caps] = await Promise.allSettled([
      call<InboxListData>("inbox.list", {}),
      call<SuggestionsData>("conversations.suggestions", {}),
      call<{ followUps: FollowUpView[] }>("followups.list", { includeClosed: false, includeSnoozed: true }),
      call<CaptureState>("capture.load", {}),
    ]);
    if (n !== seq.current) return;
    const v = <T,>(r: PromiseSettledResult<T> | { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown }) => (r.status === "fulfilled" ? r.value : null);
    setS((cur) => ({
      list: v(list) ?? cur.list,
      chats: v(chats) ?? cur.chats,
      promises: v(promises) ?? cur.promises,
      followUps: v(fus)?.followUps ?? cur.followUps,
      caps: v(caps) ?? cur.caps,
      error: list.status === "rejected" ? errText(list.reason) : null,
      chatsError: chats.status === "rejected" ? errText(chats.reason) : null,
    }));
  }, []);
  useEffect(() => void reload(), [reload, version]);
  // DV-2: a change in DevOps (a linked item finished) rereads the Inbox quietly; a promise may clear.
  useDevOpsChanged(null, () => void reload(), { gapMs: 60_000 });
  const setChats = useCallback((d: SuggestionsData) => setS((c) => ({ ...c, chats: d })), []);
  const setPromises = useCallback((d: MyPromisesData) => setS((c) => ({ ...c, promises: d })), []);
  return { ...s, reload, setChats, setPromises };
}

/** A row with what its source says about it (null while the source is loading or couldn't be read). */
export function entryOf(row: InboxItemView, s: InboxSources): Entry {
  const id = Number(row.key.slice(1));
  switch (row.key[0]) {
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
