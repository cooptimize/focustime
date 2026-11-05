// The Inbox's counts. IB-1: the nav badge is inbox.count's Needs you (one rule on the server for conversations,
// promises and sends). Until IB-1's new Inbox replaces the mode switch, its Conversations and Promises tab counts still
// come from the count-only conversations.count.
import { useEffect, useState } from "react";
import { call } from "./api.ts";

export const INBOX_COUNT_MS = 5 * 60_000;

/**
 * IB-1: the Inbox badge: the Needs you count from the server's one rule (plan/inbox-items.ts), the same number as the
 * Needs you view and its header. Read on load, after every reload of the week (a follow-up closed on Today counts at
 * once), after Inbox changes and every 5 minutes; a failed read keeps the last number.
 */
export function useInboxCount(version: number, reloaded: unknown): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void call<{ needsYou: number }>("inbox.count", {}, { background: true }).then((d) => live && setCount(d.needsYou), () => undefined);
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
 * Needs you and my open promises (the Inbox's tab counts), read with the count-only call. Conversations and My promises
 * set them too when they load their lists. A failed read keeps the last numbers.
 */
export function useConversationCount(version: number): [number | null, (n: number) => void, number | null, (n: number) => void] {
  const [count, setCount] = useState<number | null>(null);
  const [promises, setPromises] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void call<{ needsYou: number; myPromisesOpen: number }>("conversations.count", {}, { background: true }).then((d) => live && (setCount(d.needsYou), setPromises(d.myPromisesOpen)), () => undefined);
    read();
    const id = setInterval(() => !document.hidden && read(), INBOX_COUNT_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [version]);
  return [count, setCount, promises, setPromises];
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
