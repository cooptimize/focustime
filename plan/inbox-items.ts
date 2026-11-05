// IB-1: the Inbox as one list of items that need a decision, with one lifecycle and one count rule. Pure: the server
// gathers conversations, promises (chat commitments and former follow-ups), sends to me, captures and drafts, and this
// decides each item's lifecycle, the views it shows in, and the Needs you count that the nav badge, the rail and every
// view header share.
//
// Item keys are stable across both promise stores (no rows moved): `c<id>` a promise found in a chat (commitments),
// `f<id>` a promise I added or a rule opened (follow_ups, called follow-ups before IB-1), `v<id>` a conversation,
// `s<id>` a send to me, `k<id>` a capture, `d<id>` a draft story or feature to add in DevOps.
import type { IsoDate } from "../week/types.ts";

export const INBOX_KINDS = ["conversation", "promise", "send", "capture", "draft"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_VIEWS = ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done", "chatter"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** The one lifecycle: New, Needs you, In progress (an item linked or on my week), Waiting on someone, Done. */
export type Lifecycle = "new" | "needs_you" | "in_progress" | "waiting" | "teammates" | "open" | "done";

const PREFIX = { conversation: "v", chatPromise: "c", followUp: "f", send: "s", capture: "k", draft: "d" } as const;
export type KeySource = keyof typeof PREFIX;
export const itemKey = (source: KeySource, id: number) => `${PREFIX[source]}${id}`;

/** A key back to its source and id; null for anything that isn't one. */
export function parseKey(key: string): { source: KeySource; id: number } | null {
  const m = /^([vcfskd])([1-9]\d{0,9})$/.exec(key);
  if (!m) return null;
  const source = (Object.keys(PREFIX) as KeySource[]).find((s) => PREFIX[s] === m[1])!;
  return { source, id: Number(m[2]) };
}

/** My marks on an item (inbox_marks): seen, snoozed until an instant, hidden. Absent: none. */
export type Mark = { seenAt: string | null; snoozedUntil: string | null; hiddenAt: string | null };

/** What the rules need to know about one item; the server fills it from each source. */
export type InboxFacts = {
  key: string;
  kind: InboxKind;
  clientKey: string | null;
  /** When it last changed, for the order inside a group (newest first). */
  at: string;
  /** Closed for good: resolved, done, not needed, answered, sorted. */
  done: boolean;
  /** Conversation: the view CV-1's rules put it in. */
  conversationView?: "needs" | "progress" | "teammates" | "closed";
  /** Promise: due date (my zone), linked to a DevOps item, on my week (Today or a pick). */
  due?: IsoDate | null;
  linked?: boolean;
  onWeek?: boolean;
  /** Promise: I added it myself (never "new" to me). */
  byMe?: boolean;
  /** Send to me: waiting for my answer (Needs you) or accepted or scheduled (In progress). */
  sendState?: "waiting" | "accepted" | "done";
  /** Waiting on someone else (IB-1 slice 3: commitments to me, my sends, my Ask to look). */
  waitingOn?: boolean;
  /** Slice 2: what a row shows. The title; the person (to whom a promise is, who sent it, who's asking); where it came from. */
  title?: string;
  who?: string | null;
  where?: string | null;
  /** A promise's due instant when a time was stated (else `due` is the day). */
  dueAt?: string | null;
  /** The linked or created DevOps item. */
  itemId?: number | null;
  /** Conversation: it names me; a work request with no item yet. Send: a Must. */
  mentionsMe?: boolean;
  workRequest?: boolean;
  must?: boolean;
  /** Send: the week it's for. */
  weekStart?: IsoDate;
};

/** Late: a promise past its due (the instant when one was stated, else the day before today). */
export function isLate(f: Pick<InboxFacts, "kind" | "done" | "due" | "dueAt">, today: IsoDate, now: string): boolean {
  if (f.kind !== "promise" || f.done) return false;
  if (f.dueAt) return Date.parse(f.dueAt) < Date.parse(now);
  return !!f.due && f.due < today;
}

/** Seen, or already acted on (a due, a link, on my week): not New any more. */
const triaged = (f: InboxFacts, m: Mark | undefined) => !!m?.seenAt || !!f.byMe || !!f.linked || !!f.onWeek;

/** Snoozed until a later instant, or hidden for me: in no view and in no count until it's back. */
export function asleep(m: Mark | undefined, now: string): boolean {
  if (!m) return false;
  if (m.hiddenAt) return true;
  return !!m.snoozedUntil && Date.parse(m.snoozedUntil) > Date.parse(now);
}

/** An item's place in the lifecycle. */
export function lifecycleOf(f: InboxFacts, m: Mark | undefined, today: IsoDate): Lifecycle {
  if (f.done) return "done";
  switch (f.kind) {
    case "conversation":
      if (f.conversationView === "closed") return "done";
      if (f.conversationView === "progress") return "in_progress";
      if (f.conversationView === "teammates") return f.waitingOn ? "waiting" : "teammates";
      return "needs_you";
    case "promise": {
      if (!triaged(f, m)) return "new";
      if (f.due && f.due <= today) return "needs_you";
      if (f.linked || f.onWeek) return "in_progress";
      return "open";
    }
    case "send":
      return f.sendState === "waiting" ? "needs_you" : f.sendState === "accepted" ? "in_progress" : "done";
    case "capture":
    case "draft":
      return "open";
  }
}

/**
 * The one Needs you rule (IB-1): conversations CV-1's rules say need me, sends waiting for my answer, and promises that
 * are new (not seen or acted on) or due today or overdue. Later promises live only in Promises. Captures, drafts and
 * chatter never count. Snoozed and hidden items never count.
 */
export function needsYou(f: InboxFacts, m: Mark | undefined, today: IsoDate, now: string): boolean {
  if (asleep(m, now) || f.done) return false;
  if (f.kind === "promise") {
    if (!triaged(f, m)) return true;
    return !!f.due && f.due <= today;
  }
  const l = lifecycleOf(f, m, today);
  return l === "needs_you" || l === "new";
}

/** Every view an item shows in (Chatter holds messages, not items, so never here). */
export function viewsOf(f: InboxFacts, m: Mark | undefined, today: IsoDate, now: string): InboxView[] {
  const l = lifecycleOf(f, m, today);
  if (l === "done") return ["done"];
  if (asleep(m, now)) return [];
  const out: InboxView[] = [];
  if (needsYou(f, m, today, now)) out.push("needs_you");
  if (f.kind === "promise") out.push("promises");
  if (l === "in_progress" || (f.kind === "promise" && (f.linked || f.onWeek))) out.push("in_progress");
  if (l === "waiting" || f.waitingOn) out.push("waiting");
  if (l === "teammates") out.push("teammates");
  if (f.kind === "capture" || f.kind === "draft") out.push("captures");
  return [...new Set(out)];
}

/** Items per view, for the rail; `needs_you` is the badge's and the header's number too. */
export function viewCounts(items: readonly { facts: InboxFacts; mark?: Mark | undefined }[], today: IsoDate, now: string): Record<InboxView, number> {
  const out = Object.fromEntries(INBOX_VIEWS.map((v) => [v, 0])) as Record<InboxView, number>;
  for (const i of items) for (const v of viewsOf(i.facts, i.mark, today, now)) out[v]++;
  return out;
}

/** The Needs you count alone (the nav badge): the same rule as the view, nothing else added. */
export function needsYouCount(items: readonly { facts: InboxFacts; mark?: Mark | undefined }[], today: IsoDate, now: string): number {
  return items.filter((i) => needsYou(i.facts, i.mark, today, now)).length;
}

/** One row of the Inbox: what the list shows, the views it's in, and whether it's late. Never message text. */
export type InboxItemView = {
  key: string;
  kind: InboxFacts["kind"];
  clientKey: string | null;
  at: string;
  views: InboxView[];
  title: string;
  who: string | null;
  where: string | null;
  due: IsoDate | null;
  dueAt: string | null;
  itemId: number | null;
  late: boolean;
  done: boolean;
  sendState?: InboxFacts["sendState"];
  conversationView?: InboxFacts["conversationView"];
  mentionsMe?: boolean;
  workRequest?: boolean;
  must?: boolean;
  weekStart?: IsoDate;
  snoozedUntil: string | null;
};
export type InboxListData = { today: IsoDate; items: InboxItemView[]; counts: Record<InboxView, number>; needsYou: number };
