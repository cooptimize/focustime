// IB-1 slice 2: the new Inbox's pure rules for the list. inbox.list (actions/inbox-actions.ts) decides each item's
// views and the counts; this filters by view and clients, groups (client, due date, kind), orders late items first,
// and says what each row's tag and second line show. No calls, no React: ui/inbox/model.test.ts covers it.
import type { InboxItemView, InboxListData, InboxView } from "../../plan/inbox-items.ts";

export type { InboxItemView, InboxListData };

/** The rail's views, in order, with their names (the same words in every header, key help and the Guide). */
export const VIEWS: readonly { id: InboxView; label: string }[] = [
  { id: "needs_you", label: "Needs you" },
  { id: "promises", label: "Promises" },
  { id: "waiting", label: "Waiting on" },
  { id: "in_progress", label: "In progress" },
  { id: "captures", label: "Captures and drafts" },
  { id: "teammates", label: "Handled by teammates" },
  { id: "done", label: "Done" },
  { id: "chatter", label: "Chatter" },
];
export const viewLabel = (v: InboxView) => VIEWS.find((x) => x.id === v)?.label ?? "Inbox";

export type Group = "client" | "due" | "kind";
export const GROUPS: readonly { id: Group; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "due", label: "Due date" },
  { id: "kind", label: "Kind" },
];

export const KIND_LABEL: Record<InboxItemView["kind"], string> = { conversation: "Conversations", promise: "Promises", send: "Sent to you", capture: "Captures", draft: "Drafts" };
export const KIND_WORD: Record<InboxItemView["kind"], string> = { conversation: "Conversation", promise: "Promise", send: "Sent to you", capture: "Capture", draft: "Draft" };

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
 * The list's groups. By client: clients with a late item first, then by name; by due date: Late, Today, Tomorrow, This
 * week, Later, No due date; by kind: conversations, promises, sends, captures, drafts. Inside a group: late first.
 */
export function groupRows(rows: readonly InboxItemView[], group: Group, clientName: (k: string) => string, today: string): RowGroup[] {
  const map = new Map<string, RowGroup & { order: number | string }>();
  for (const r of rows) {
    let id: string, label: string, order: number | string, clientKey: string | null = null;
    if (group === "client") {
      id = r.clientKey ?? "none";
      label = r.clientKey ? clientName(r.clientKey) : "No client";
      clientKey = r.clientKey;
      order = r.clientKey ? label.toLowerCase() : "~";
    } else if (group === "due") {
      ({ id, label, order } = dueBucket(r, today));
    } else {
      id = r.kind;
      label = KIND_LABEL[r.kind];
      order = ["conversation", "promise", "send", "capture", "draft"].indexOf(r.kind);
    }
    const g = map.get(id) ?? { id, label, clientKey, rows: [], order };
    g.rows.push(r);
    map.set(id, g);
  }
  const out = [...map.values()];
  for (const g of out) g.rows.sort(byUrgency);
  const late = (g: RowGroup) => g.rows.some((r) => r.late);
  out.sort((a, b) => (group === "client" && late(a) !== late(b) ? (late(a) ? -1 : 1) : typeof a.order === "number" && typeof b.order === "number" ? a.order - b.order : String(a.order).localeCompare(String(b.order))));
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

/**
 * Old Inbox addresses to an item key (they keep working): a conversation (#/inbox/conversation/<id>), a promise found
 * in a chat (#/inbox/promise/<id>) and a follow-up (#/inbox/<id>, now a promise).
 */
export function keyOfOldLink(kind: "conversation" | "promise" | "followup", id: number): string {
  return kind === "conversation" ? `v${id}` : kind === "promise" ? `c${id}` : `f${id}`;
}
