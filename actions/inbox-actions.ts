// IB-1: the Inbox's one read model on the server. Gathers conversations and my chat promises (conversation-actions'
// own rules), my promises from follow_ups (called follow-ups before IB-1; no rows moved), sends to me, captures and
// drafts, then lets plan/inbox-items.ts decide each item's views and the Needs you count. inbox.count is the nav
// badge; inbox.list gives every item's key, kind, client and views with the per-view counts, so the badge, the rail
// and every view header read the same number.
import type { AppConfig } from "../config/schema.ts";
import { isLate, itemKey, needsYouCount, parseKey, viewCounts, viewsOf, type InboxFacts, type InboxItemView, type InboxListData, type Mark } from "../plan/inbox-items.ts";
export type { InboxItemView, InboxListData };
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse } from "./types.ts";

export const INBOX_ACTIONS = ["inbox.list", "inbox.count", "inbox.seen", "inbox.hide"] as const;
export type InboxAction = (typeof INBOX_ACTIONS)[number];

export type InboxContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  now: () => string;
  /** Conversations and my chat promises (conversation-actions' inboxFacts); [] where chats aren't set up. */
  conversations: (cfg: AppConfig) => Promise<InboxFacts[]>;
  /** Sends to me (team-actions' sendFacts); [] without the team store. */
  sends: () => Promise<InboxFacts[]>;
};



const bad = (error: string, status = 400): ActionResponse => ({ ok: false, error, status });
const DONE_SHOWN_MS = 24 * 3600_000;

/** My promises from follow_ups: open ones, and the ones closed in the last day (Done). */
async function promiseFacts(plan: PlanStore, now: string, withDone: boolean): Promise<{ facts: InboxFacts[]; snoozed: Map<string, IsoDate> }> {
  const snoozed = new Map<string, IsoDate>();
  const facts: InboxFacts[] = [];
  const open = await plan.openFollowUps();
  for (const f of open) {
    const key = itemKey("followUp", f.id);
    if (f.snoozedUntil) snoozed.set(key, f.snoozedUntil);
    facts.push({ key, kind: "promise", clientKey: f.clientKey, at: f.openedAt, done: false, due: f.due, linked: f.itemId !== null, byMe: f.byHand, title: f.what, who: f.who || null, where: null, itemId: f.itemId });
  }
  for (const f of withDone ? await plan.recentlyClosedFollowUps(new Date(Date.parse(now) - DONE_SHOWN_MS).toISOString()) : []) {
    facts.push({ key: itemKey("followUp", f.id), kind: "promise", clientKey: f.clientKey, at: f.closedAt ?? f.openedAt, done: true, due: f.due, linked: f.itemId !== null, byMe: f.byHand, title: f.what, who: f.who || null, where: null, itemId: f.itemId });
  }
  return { facts, snoozed };
}

/** Everything in the Inbox for me now, each with my marks. */
async function gather(ctx: InboxContext, cfg: AppConfig, withDone = true): Promise<{ today: IsoDate; now: string; items: { facts: InboxFacts; mark?: Mark }[] }> {
  const plan = ctx.plan!;
  const now = ctx.now();
  const zone = userZone(cfg);
  const today = localToday(now, zone);
  const [convs, sends, promises, captures, drafts, marks] = await Promise.all([
    ctx.conversations(cfg).catch((): InboxFacts[] => []),
    ctx.sends().catch((): InboxFacts[] => []),
    promiseFacts(plan, now, withDone),
    plan.inbox(),
    plan.drafts(),
    plan.inboxMarks(),
  ]);
  const facts: InboxFacts[] = [
    ...convs,
    ...promises.facts,
    ...sends,
    ...captures.map((c): InboxFacts => ({ key: itemKey("capture", c.id), kind: "capture", clientKey: c.clientKey, at: c.createdAt, done: false, title: c.text, where: "Your capture" })),
    ...drafts.map((d): InboxFacts => ({ key: itemKey("draft", d.id), kind: "draft", clientKey: d.clientKey, at: d.createdAt, done: false, title: d.title, where: d.level === "feature" ? "Draft feature" : "Draft story" })),
  ];
  const items = facts.map((f) => {
    const m = marks.get(f.key);
    // A former follow-up keeps its own snooze (a date): asleep until that day starts in my zone.
    const day = promises.snoozed.get(f.key);
    const snoozedUntil = day ? Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: zone }).toInstant().toString() : null;
    const mark: Mark | undefined = m || snoozedUntil ? { seenAt: m?.seenAt ?? null, hiddenAt: m?.hiddenAt ?? null, snoozedUntil: laterOf(m?.snoozedUntil ?? null, snoozedUntil) } : undefined;
    return mark ? { facts: f, mark } : { facts: f };
  });
  return { today, now, items };
}

/** What the list shows for one item (plan/inbox-items.ts decides the views; this only carries the facts across). */
export function rowOf(i: { facts: InboxFacts; mark?: Mark | undefined }, today: IsoDate, now: string): InboxItemView {
  const f = i.facts;
  const asleep = i.mark?.snoozedUntil && Date.parse(i.mark.snoozedUntil) > Date.parse(now) ? i.mark.snoozedUntil : null;
  return {
    key: f.key, kind: f.kind, clientKey: f.clientKey, at: f.at, views: viewsOf(f, i.mark, today, now),
    title: f.title ?? "", who: f.who ?? null, where: f.where ?? null, due: f.due ?? null, dueAt: f.dueAt ?? null, itemId: f.itemId ?? null,
    late: isLate(f, today, now), done: f.done, snoozedUntil: asleep,
    ...(f.sendState ? { sendState: f.sendState } : {}), ...(f.conversationView ? { conversationView: f.conversationView } : {}),
    ...(f.mentionsMe ? { mentionsMe: true } : {}), ...(f.workRequest ? { workRequest: true } : {}), ...(f.must ? { must: true } : {}), ...(f.weekStart ? { weekStart: f.weekStart } : {}),
  };
}

const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

export async function inboxAction(ctx: InboxContext, action: InboxAction, input: unknown): Promise<ActionResponse> {
  if (!ctx.plan) return bad("The plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  switch (action) {
    case "inbox.count": {
      if (Object.keys(o).length) return bad("inbox.count takes {}");
      const g = await gather(ctx, cfg, false);
      return { ok: true, data: { needsYou: needsYouCount(g.items, g.today, g.now) } };
    }
    case "inbox.list": {
      if (Object.keys(o).length) return bad("inbox.list takes {}");
      const g = await gather(ctx, cfg);
      const items = g.items.map((i) => rowOf(i, g.today, g.now));
      const data: InboxListData = { today: g.today, items, counts: viewCounts(g.items, g.today, g.now), needsYou: needsYouCount(g.items, g.today, g.now) };
      return { ok: true, data };
    }
    case "inbox.seen": {
      // Seen: a promise stops being New. Only keys of items I have (the list decides); others are refused.
      const keys = Array.isArray(o.keys) && Object.keys(o).length === 1 && o.keys.length <= 200 && o.keys.every((k) => typeof k === "string" && parseKey(k)) ? (o.keys as string[]) : null;
      if (!keys) return bad("inbox.seen takes { keys: [key, ...] }");
      const g = await gather(ctx, cfg);
      const mine = new Set(g.items.map((i) => i.facts.key));
      const ok = [...new Set(keys)].filter((k) => mine.has(k));
      return { ok: true, data: { seen: await ctx.plan.markInbox(ok, { seen: true }) } };
    }
    case "inbox.hide": {
      // H: hidden for me only (an inbox mark). A conversation keeps CV-1's Hide for me (conversations.hide).
      const key = typeof o.key === "string" ? parseKey(o.key) : null;
      if (!key || typeof o.hidden !== "boolean" || Object.keys(o).length !== 2) return bad("inbox.hide takes { key, hidden }");
      if (key.source === "conversation") return bad("Hide a conversation with conversations.hide");
      const g = await gather(ctx, cfg);
      if (!g.items.some((i) => i.facts.key === o.key)) return bad("That isn't in your Inbox", 404);
      await ctx.plan.markInbox([o.key as string], { hidden: o.hidden });
      return { ok: true, data: { hidden: o.hidden } };
    }
  }
}
