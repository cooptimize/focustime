// IB-1: the Inbox's one read model on the server. Gathers conversations and my chat promises (conversation-actions'
// own rules), my promises from follow_ups (called follow-ups before IB-1; no rows moved), sends to me, captures and
// drafts, then lets plan/inbox-items.ts decide each item's views and the Needs you count. inbox.count is the nav
// badge; inbox.list gives every item's key, kind, client and views with the per-view counts, so the badge, the rail
// and every view header read the same number.
import type { AppConfig } from "../config/schema.ts";
import { itemKey, needsYouCount, parseKey, viewCounts, viewsOf, type InboxFacts, type InboxView, type Mark } from "../plan/inbox-items.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse } from "./types.ts";

export const INBOX_ACTIONS = ["inbox.list", "inbox.count", "inbox.seen"] as const;
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

export type InboxItemView = { key: string; kind: InboxFacts["kind"]; clientKey: string | null; at: string; views: InboxView[] };
export type InboxListData = { today: IsoDate; items: InboxItemView[]; counts: Record<InboxView, number>; needsYou: number };

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
    facts.push({ key, kind: "promise", clientKey: f.clientKey, at: f.openedAt, done: false, due: f.due, linked: f.itemId !== null, byMe: f.byHand });
  }
  for (const f of withDone ? await plan.recentlyClosedFollowUps(new Date(Date.parse(now) - DONE_SHOWN_MS).toISOString()) : []) {
    facts.push({ key: itemKey("followUp", f.id), kind: "promise", clientKey: f.clientKey, at: f.closedAt ?? f.openedAt, done: true, due: f.due, linked: f.itemId !== null, byMe: f.byHand });
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
    ...captures.map((c): InboxFacts => ({ key: itemKey("capture", c.id), kind: "capture", clientKey: c.clientKey, at: c.createdAt, done: false })),
    ...drafts.map((d): InboxFacts => ({ key: itemKey("draft", d.id), kind: "draft", clientKey: d.clientKey, at: d.createdAt, done: false })),
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
      const items = g.items.map((i): InboxItemView => ({ key: i.facts.key, kind: i.facts.kind, clientKey: i.facts.clientKey, at: i.facts.at, views: viewsOf(i.facts, i.mark, g.today, g.now) }));
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
  }
}
