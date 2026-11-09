// IB-1 slice 2: the new Inbox's pure rules for the list. inbox.list (actions/inbox-actions.ts) decides each item's
// views and the counts; this filters by view and clients, groups (client, due date, kind), orders late items first,
// and says what each row's tag and second line show. No calls, no React: ui/inbox/model.test.ts covers it.
import { statusOf, type InboxItemView, type InboxListData, type InboxPlace, type InboxView } from "../../plan/inbox-items.ts";
import { dayHeading, stampDay } from "../stamp.ts";

export type { InboxItemView, InboxListData, InboxPlace };

/** The rail's views, in order, with their names (the same words in every header, key help and the Guide). */
export const VIEWS: readonly { id: InboxView; label: string }[] = [
  { id: "needs_you", label: "Needs you" },
  { id: "promises", label: "Promises" },
  { id: "waiting", label: "Waiting on" },
  { id: "in_progress", label: "In progress" },
  { id: "captures", label: "Captures and drafts" },
  { id: "teammates", label: "Teammate has it" },
  { id: "done", label: "Done" },
  { id: "chatter", label: "Chatter" },
];
export const viewLabel = (v: InboxPlace) => (v === "everything" ? "Everything" : (VIEWS.find((x) => x.id === v)?.label ?? "Inbox"));

/** IB-2: a row's status tag, in the views' own colors (the tones). */
export const STATUS_TAG: Record<InboxView, { text: string; tone: Tone }> = {
  needs_you: { text: "Needs you", tone: "ask" },
  promises: { text: "Promise", tone: "work" },
  waiting: { text: "Waiting on", tone: "soon" },
  in_progress: { text: "In progress", tone: "work" },
  captures: { text: "Capture", tone: "plain" },
  teammates: { text: "Teammate has it", tone: "plain" },
  done: { text: "Done", tone: "done" },
  chatter: { text: "Chatter", tone: "plain" },
};

export type Sort = "newest" | "oldest";
export type Group = "day" | "client" | "due" | "status";
export const GROUPS: readonly { id: Group; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "client", label: "Client" },
  { id: "due", label: "Due date" },
  { id: "status", label: "Status" },
];

const msOf = (stamp: string) => Date.parse(stamp.replace(/\[.*\]$/, ""));

/** Rows by their latest activity, in the chosen direction; the key breaks ties so the order never flickers. */
export function byActivity(rows: readonly InboxItemView[], sort: Sort): InboxItemView[] {
  const at = new Map(rows.map((r) => [r, msOf(r.at)]));
  const dir = sort === "newest" ? -1 : 1;
  return [...rows].sort((a, b) => dir * (at.get(a)! - at.get(b)!) || a.key.localeCompare(b.key));
}

/** Rows in any of the statuses, for the chosen clients (none chosen: all). */
export function inStatuses(rows: readonly InboxItemView[], statuses: readonly InboxView[], clients: readonly string[]): InboxItemView[] {
  const on = new Set(statuses);
  const pick = new Set(clients);
  return rows.filter((i) => i.views.some((v) => on.has(v)) && (!pick.size || (i.clientKey !== null && pick.has(i.clientKey))));
}

/** One count per status chip: the rows that a chip alone would show, for these clients. */
export function statusCounts(rows: readonly InboxItemView[], clients: readonly string[]): Record<InboxView, number> {
  const out = Object.fromEntries(VIEWS.map((v) => [v.id, 0])) as Record<InboxView, number>;
  const pick = new Set(clients);
  for (const r of rows) if (!pick.size || (r.clientKey !== null && pick.has(r.clientKey))) for (const v of r.views) out[v]++;
  return out;
}

/** Per client, how many rows the statuses hold (the rail's client counts). */
export function clientCountsFor(rows: readonly InboxItemView[], statuses: readonly InboxView[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of inStatuses(rows, statuses, [])) if (i.clientKey) out.set(i.clientKey, (out.get(i.clientKey) ?? 0) + 1);
  return out;
}

/** Arrived after I last looked (null: never looked, so nothing is new yet). */
export const isNewSince = (r: Pick<InboxItemView, "at">, since: string | null): boolean => !!since && msOf(r.at) > msOf(since);

/**
 * The row the "New since you last looked" divider goes above, in a list by day: above the first older row when newest
 * first, above the first new row when oldest first. Null when nothing is new or everything is (no boundary to mark).
 */
export function dividerBefore(order: readonly InboxItemView[], since: string | null, sort: Sort): string | null {
  if (!since) return null;
  const firstNew = order.findIndex((r) => isNewSince(r, since));
  const firstOld = order.findIndex((r) => !isNewSince(r, since));
  if (firstNew < 0 || firstOld < 0) return null;
  return order[sort === "newest" ? firstOld : firstNew]!.key;
}

/** The first `n` rows of the groups, for the list that renders as it's scrolled. */
export function sliceGroups(groups: readonly RowGroup[], n: number): RowGroup[] {
  const out: RowGroup[] = [];
  let left = n;
  for (const g of groups) {
    if (left <= 0) break;
    out.push(g.rows.length <= left ? g : { ...g, rows: g.rows.slice(0, left) });
    left -= g.rows.length;
  }
  return out;
}

export const KIND_WORD: Record<InboxItemView["kind"], string> = { conversation: "Conversation", promise: "Promise", send: "Sent to you", capture: "Capture", draft: "Draft", commitment: "Promised to you", sent: "You sent", ask: "Ask to look" };

/** Items in a view, for the chosen clients (none chosen: all). */
export function inView(items: readonly InboxItemView[], view: InboxView, clients: readonly string[]): InboxItemView[] {
  const pick = new Set(clients);
  return items.filter((i) => i.views.includes(view) && (!pick.size || (i.clientKey !== null && pick.has(i.clientKey))));
}

/** Per client, how many items the view holds (the rail's client counts follow the view, as in the mockups). */
export function clientCounts(items: readonly InboxItemView[], view: InboxView): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) if (i.views.includes(view) && i.clientKey) out.set(i.clientKey, (out.get(i.clientKey) ?? 0) + 1);
  return out;
}

/** Late first, then due soonest, then newest. */
export function byUrgency(a: InboxItemView, b: InboxItemView): number {
  if (a.late !== b.late) return a.late ? -1 : 1;
  const da = a.dueAt ?? (a.due ? `${a.due}T23:59` : null);
  const db = b.dueAt ?? (b.due ? `${b.due}T23:59` : null);
  if (da && db && da !== db) return da.localeCompare(db);
  if (!!da !== !!db) return da ? -1 : 1;
  return b.at.localeCompare(a.at);
}

export type RowGroup = { id: string; label: string; clientKey: string | null; rows: InboxItemView[] };

/** "Late", "Today", "Tomorrow", "This week", "Later", "No due date": a due date bucket for Group by due date. */
export function dueBucket(i: InboxItemView, today: string): { id: string; label: string; order: number } {
  if (i.late) return { id: "late", label: "Late", order: 0 };
  const day = i.due;
  if (!day) return { id: "none", label: "No due date", order: 5 };
  if (day === today) return { id: "today", label: "Today", order: 1 };
  const t = Temporal.PlainDate.from(today);
  if (day === t.add({ days: 1 }).toString()) return { id: "tomorrow", label: "Tomorrow", order: 2 };
  if (day <= t.add({ days: 7 - t.dayOfWeek }).toString()) return { id: "week", label: "This week", order: 3 };
  return { id: "later", label: "Later", order: 4 };
}

/**
 * The list's groups. By day (Today, Yesterday, then the date): days in the chosen direction. By client: clients with a
 * late item first, then by name. By due date: Late, Today, Tomorrow, This week, Later, No due date. By status: the
 * rail's order. Inside a group rows follow the sort by latest activity, except by due date: late first, then soonest.
 */
export function groupRows(rows: readonly InboxItemView[], group: Group, clientName: (k: string) => string, today: string, o: { tz: string; sort: Sort }): RowGroup[] {
  const map = new Map<string, RowGroup & { order: number | string }>();
  const statusOrder = VIEWS.map((v) => v.id as InboxView);
  for (const r of rows) {
    let id: string, label: string, order: number | string, clientKey: string | null = null;
    if (group === "day") {
      id = stampDay(r.at, o.tz) ?? today;
      label = dayHeading(id, today);
      order = id;
    } else if (group === "client") {
      id = r.clientKey ?? "none";
      label = r.clientKey ? clientName(r.clientKey) : "No client";
      clientKey = r.clientKey;
      order = r.clientKey ? label.toLowerCase() : "~";
    } else if (group === "due") {
      ({ id, label, order } = dueBucket(r, today));
    } else {
      const st = statusOf(r.views);
      id = st ?? "none";
      label = st ? viewLabel(st) : "Other";
      order = st ? statusOrder.indexOf(st) : statusOrder.length;
    }
    const g = map.get(id) ?? { id, label, clientKey, rows: [], order };
    g.rows.push(r);
    map.set(id, g);
  }
  const out = [...map.values()];
  for (const g of out) g.rows = group === "due" ? g.rows.sort(byUrgency) : byActivity(g.rows, o.sort);
  const late = (g: RowGroup) => g.rows.some((r) => r.late);
  out.sort((a, b) => {
    if (group === "day") return (o.sort === "newest" ? -1 : 1) * String(a.order).localeCompare(String(b.order));
    if (group === "client" && late(a) !== late(b)) return late(a) ? -1 : 1;
    return typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order));
  });
  return out.map(({ order: _o, ...g }) => g);
}

/** The flat order J and K walk: the groups' rows in order. */
export const flatOrder = (groups: readonly RowGroup[]): InboxItemView[] => groups.flatMap((g) => g.rows);

export type Tone = "late" | "soon" | "ask" | "work" | "plain" | "done";
const SHORT_DAY = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });

/** "1 day late", "3 days late" (whole days since the due day). */
export function lateText(due: string, today: string): string {
  const n = Math.max(1, Temporal.PlainDate.from(due).until(Temporal.PlainDate.from(today)).days);
  return `${n} ${n === 1 ? "day" : "days"} late`;
}

/** A due day in words: Today, Tomorrow, Due Fri (this week), Due Nov 18. */
export function dueWords(due: string, today: string): string {
  if (due === today) return "Due today";
  const t = Temporal.PlainDate.from(today);
  if (due === t.add({ days: 1 }).toString()) return "Due tomorrow";
  if (due > today && due <= t.add({ days: 6 }).toString()) return `Due ${SHORT_DAY(due)}`;
  return `Due ${Temporal.PlainDate.from(due).toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}

/** Part 0: a conversation's status tag from the shared owner: the same words wherever the row shows. Null for anything else. */
export function ownerTag(i: Pick<InboxItemView, "personView" | "ownerName">): { text: string; tone: Tone } | null {
  switch (i.personView) {
    case "asked_you": return { text: "Asked you", tone: "ask" };
    case "up_for_grabs": return { text: "Up for grabs", tone: "work" };
    case "yours": return { text: "You're on it", tone: "work" };
    case "teammate": return { text: i.ownerName ? `${i.ownerName.split(/\s+/)[0]} has it` : "Teammate has it", tone: "plain" };
    default: return null;
  }
}

/** IB-2: the extra word beside who and where, when it says more than the status tag (late, due, an item, a Must…). */
export function detailTag(i: InboxItemView, today: string): { text: string; tone: Tone } | null {
  const t = rowTag(i, today);
  return t && !["Done", "Needs you", "Teammates", "In progress", "Waiting", "New", "Asked you"].includes(t.text) ? t : null;
}

/** The one tag a row shows beside who and when; never more than one. */
export function rowTag(i: InboxItemView, today: string): { text: string; tone: Tone } | null {
  if (i.done) return { text: "Done", tone: "done" };
  switch (i.kind) {
    case "promise":
      if (i.late && i.due) return { text: lateText(i.due, today), tone: "late" };
      if (i.due) return { text: dueWords(i.due, today), tone: i.due <= Temporal.PlainDate.from(today).add({ days: 1 }).toString() ? "soon" : "plain" };
      if (i.itemId) return { text: `#${i.itemId}`, tone: "plain" };
      return i.views.includes("needs_you") ? { text: "New", tone: "ask" } : null;
    case "conversation":
      if (i.conversationView === "progress") return i.itemId ? { text: `#${i.itemId}`, tone: "plain" } : { text: "In progress", tone: "plain" };
      if (i.conversationView === "teammates") return { text: "Teammates", tone: "plain" };
      if (i.mentionsMe) return { text: "Asked you", tone: "ask" };
      if (i.workRequest) return { text: "Work request", tone: "work" };
      return i.conversationView === "needs" ? { text: "Needs you", tone: "ask" } : null;
    case "send":
      return i.sendState === "waiting" ? { text: i.must ? "Must · Accept?" : "Accept?", tone: "ask" } : { text: "Accepted", tone: "plain" };
    case "capture":
      return { text: "To sort", tone: "plain" };
    case "draft":
      return { text: "Review draft", tone: "plain" };
    case "commitment":
      if (i.late && i.due) return { text: lateText(i.due, today), tone: "soon" };
      return i.due ? { text: dueWords(i.due, today), tone: "plain" } : { text: "Waiting", tone: "plain" };
    case "sent":
      return { text: "No answer yet", tone: "plain" };
    case "ask":
      return { text: "No reply yet", tone: "plain" };
  }
}

/** The row's second line: who, where, the item; never message text. */
export function rowSub(i: InboxItemView): string {
  switch (i.kind) {
    case "promise":
      return [i.who ? `For ${i.who}` : "For no one named", i.where ? `from ${i.where}` : null, i.itemId ? `#${i.itemId}` : i.views.includes("needs_you") && !i.where ? null : !i.itemId ? "no item yet" : null].filter(Boolean).join(" · ");
    case "conversation":
      return [i.who, i.where].filter(Boolean).join(" · ");
    case "send":
      return [i.who ? `From ${i.who}` : null, `${i.must ? "Must" : "Suggested"} ${i.where ?? ""}`.trim()].filter(Boolean).join(" · ");
    case "capture":
      return "Your capture";
    case "draft":
      return i.where ?? "Draft";
    case "commitment":
      return [i.who ? `${i.who} promised it` : null, i.where].filter(Boolean).join(" · ");
    case "sent":
      return [i.who ? `To ${i.who}` : null, i.where].filter(Boolean).join(" · ");
    case "ask":
      return [i.who ? `Asked ${i.who} to look` : "Asked a lead to look", i.where].filter(Boolean).join(" · ");
  }
}

/** Phone: "1 late · 1 due this week · 2 asked of you" over the list (only the parts that aren't zero). */
export function summaryLine(rows: readonly InboxItemView[], today: string): { n: number; text: string; tone: Tone }[] {
  const t = Temporal.PlainDate.from(today);
  const end = t.add({ days: 7 - t.dayOfWeek }).toString();
  const late = rows.filter((r) => r.late).length;
  const week = rows.filter((r) => !r.late && r.due && r.due <= end).length;
  const asked = rows.filter((r) => r.kind === "conversation" && r.mentionsMe).length;
  return [
    { n: late, text: "late", tone: "late" as const },
    { n: week, text: "due this week", tone: "soon" as const },
    { n: asked, text: "asked of you", tone: "ask" as const },
  ].filter((x) => x.n > 0);
}
