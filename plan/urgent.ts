// NV-1: Today's urgent strip, mine only: urgent requests from client chats (AI urgency "now") and my promises due today
// or overdue. Others' "Waiting on" stays in the Inbox; Musts sent to me join when they exist. Pure.
import type { UrgentAsk } from "../actions/types.ts";
import type { DayPromise } from "./conversation-views.ts";
import type { IsoDate } from "../week/types.ts";

export type UrgentLine =
  | { kind: "conversation"; key: string; who: string; what: string; ask: UrgentAsk }
  | { kind: "promise"; key: string; who: string; what: string; overdue: boolean; dueAt: string | null; promise: DayPromise };

/** The strip's lines, conversations first, then promises overdue, then due today by time; empty hides the strip. */
export function urgentLines(urgent: readonly UrgentAsk[], promises: readonly DayPromise[], today: IsoDate): UrgentLine[] {
  const asks: UrgentLine[] = urgent.map((u) => ({ kind: "conversation", key: `c:${u.chatId}|${u.messageId}`, who: u.clientName, what: u.title, ask: u }));
  const due = promises
    .filter((p) => p.overdue || p.dueDate <= today)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))
    .map((p): UrgentLine => ({ kind: "promise", key: `p:${p.id}`, who: p.toName ?? p.clientName, what: p.what, overdue: p.overdue, dueAt: p.dueAt, promise: p }));
  return [...asks, ...due];
}
