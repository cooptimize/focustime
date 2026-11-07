// The Inbox's count. IB-1: the nav badge is the server's Needs you (one rule on the server for conversations,
// promises and sends), the same number as the rail's Needs you and its header. Slice 4: one read (inbox.today) gives
// the badge and the rows Today's urgent strip and Week's rail show, so they can never disagree.
import { useEffect, useState } from "react";
import type { InboxTodayData } from "../plan/inbox-items.ts";
import { call } from "./api.ts";

export const INBOX_COUNT_MS = 5 * 60_000;

/**
 * IB-1: the Inbox badge: the Needs you count from the server's one rule (plan/inbox-items.ts), the same number as the
 * Needs you view and its header. Read on load, after every reload of the week (a follow-up closed on Today counts at
 * once), after Inbox changes and every 5 minutes; a failed read keeps the last number.
 */
export function useInboxToday(version: number, reloaded: unknown): InboxTodayData | null {
  const [count, setCount] = useState<InboxTodayData | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void call<InboxTodayData>("inbox.today", {}, { background: true }).then((d) => live && setCount(d), () => undefined);
    read();
    const id = setInterval(() => !document.hidden && read(), INBOX_COUNT_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [version, reloaded]);
  return count;
}

/**
 * IB-1: the promises I'm looking at are seen (a new one stops counting in Needs you). Calls `changed` only when one
 * was newly seen, so the badge reads again; a failed call changes nothing.
 */
export async function markSeen(keys: readonly string[], changed: () => void): Promise<void> {
  if (!keys.length) return;
  const r = await call<{ seen: number }>("inbox.seen", { keys: keys.slice(0, 200) }, { background: true }).catch(() => null);
  if (r && r.seen > 0) changed();
}
