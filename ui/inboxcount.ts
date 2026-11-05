// NV-1: the Inbox badge. Conversations that need me (the count-only conversations.count, on load, after changes and
// every 5 minutes like the week's quiet refresh) plus my items due today or overdue: follow-ups and promises. Open
// follow-ups not yet due and captures don't count here; the Inbox shows them on its own tab.
import { useEffect, useState } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import type { IsoDate } from "../week/types.ts";
import { urgentFollowUps } from "../plan/today.ts";
import { call } from "./api.ts";

export const INBOX_COUNT_MS = 5 * 60_000;

/** My promises due today or overdue (the day's list from the week load). */
export function duePromises(ps: WeekLoadData["promises"], today: IsoDate): number {
  return (ps ?? []).filter((p) => p.overdue || p.dueDate <= today).length;
}

/** The badge's number: Needs you, plus follow-ups and promises due today or overdue. */
export function inboxBadge(needsYou: number | null, data: Pick<WeekLoadData, "followUps" | "promises">, today: IsoDate): number {
  return (needsYou ?? 0) + urgentFollowUps(data.followUps, today).length + duePromises(data.promises, today);
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
