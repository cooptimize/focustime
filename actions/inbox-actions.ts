// IB-1: the Inbox's one read model on the server. Gathers conversations and my chat promises (conversation-actions'
// own rules), my promises from follow_ups (called follow-ups before IB-1; no rows moved), sends to me, captures and
// drafts, then lets plan/inbox-items.ts decide each item's views and the Needs you count. inbox.count is the nav
// badge; inbox.list gives every item's key, kind, client and views with the per-view counts, so the badge, the rail
// and every view header read the same number.
import type { AppConfig } from "../config/schema.ts";
import { forToday, isLate, itemKey, needsYouCount, parseKey, reasonOf, snoozeChoices, snoozeUntil, viewCounts, viewsOf, type InboxFacts, type InboxItemView, type InboxListData, type InboxTodayData, type Mark, type SnoozeChoice, type SnoozeDay } from "../plan/inbox-items.ts";
export type { InboxItemView, InboxListData, InboxTodayData };
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse, UrgentAsk } from "./types.ts";

export const INBOX_ACTIONS = ["inbox.list", "inbox.count", "inbox.today", "inbox.seen", "inbox.hide", "inbox.snooze"] as const;
export type InboxAction = (typeof INBOX_ACTIONS)[number];

export type InboxContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  now: () => string;
  /** Conversations and my chat promises (conversation-actions' inboxFacts); [] where chats aren't set up. */
  conversations: (cfg: AppConfig) => Promise<InboxFacts[]>;
  /** Sends to me (team-actions' sendFacts); [] without the team store. */
  sends: () => Promise<InboxFacts[]>;
  /** Slice 3: my working hours and PTO days, for Snooze (escalationHours); null when the config can't say. */
  snoozeDay: () => Promise<SnoozeDay | null>;
  /**
   * Slice 4: requests the AI sorted as needing someone now, in the chats I see (AP-2's urgent asks), each with the
   * conversation its message is in. They mark that conversation urgent; absent or failing, none is.
   */
  urgent?: (cfg: AppConfig) => Promise<UrgentAsk[]>;
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
  const [convs, sends, promises, captures, drafts, marks, urgent] = await Promise.all([
    ctx.conversations(cfg).catch((): InboxFacts[] => []),
    ctx.sends().catch((): InboxFacts[] => []),
    promiseFacts(plan, now, withDone),
    plan.inbox(),
    plan.drafts(),
    plan.inboxMarks(),
    ctx.urgent ? ctx.urgent(cfg).catch((): UrgentAsk[] => []) : Promise.resolve([] as UrgentAsk[]),
  ]);
  // Slice 4: a conversation is urgent when it holds an urgent request (the newest one is the one Start focus uses).
  const urgentIn = new Map<number, UrgentAsk>();
  for (const u of [...urgent].sort((a, b) => a.at.localeCompare(b.at))) if (u.conversationId) urgentIn.set(u.conversationId, u);
  for (const c of convs) {
    const id = c.kind === "conversation" ? Number(c.key.slice(1)) : 0;
    if (urgentIn.has(id)) c.urgent = urgentIn.get(id)!;
  }
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
    key: f.key, kind: f.kind, clientKey: f.clientKey, at: f.at, views: viewsOf(f, i.mark, today, now), reason: reasonOf(f, i.mark, today, now),
    title: f.title ?? "", who: f.who ?? null, where: f.where ?? null, due: f.due ?? null, dueAt: f.dueAt ?? null, itemId: f.itemId ?? null,
    late: isLate(f, today, now), done: f.done, snoozedUntil: asleep,
    ...(f.sendState ? { sendState: f.sendState } : {}), ...(f.conversationView ? { conversationView: f.conversationView } : {}),
    ...(f.mentionsMe ? { mentionsMe: true } : {}), ...(f.mentions?.length ? { mentions: f.mentions } : {}), ...(f.workRequest ? { workRequest: true } : {}), ...(f.must ? { must: true } : {}), ...(f.weekStart ? { weekStart: f.weekStart } : {}),
    ...(f.urgent ? { urgent: f.urgent } : {}),
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
    case "inbox.today": {
      // Slice 4: Today's urgent strip and Week's rail read these rows, and the badge reads `needsYou` from the same gather.
      if (Object.keys(o).length) return bad("inbox.today takes {}");
      const g = await gather(ctx, cfg, false);
      const data: InboxTodayData = { today: g.today, needsYou: needsYouCount(g.items, g.today, g.now), items: g.items.map((i) => rowOf(i, g.today, g.now)).filter(forToday) };
      return { ok: true, data };
    }
    case "inbox.list": {
      if (Object.keys(o).length) return bad("inbox.list takes {}");
      const g = await gather(ctx, cfg);
      const items = g.items.map((i) => rowOf(i, g.today, g.now));
      const day = await ctx.snoozeDay().catch(() => null);
      const data: InboxListData = { today: g.today, items, counts: viewCounts(g.items, g.today, g.now), needsYou: needsYouCount(g.items, g.today, g.now), snoozeChoices: day ? snoozeChoices(g.now, day) : ["tomorrow", "next_week"] };
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
    case "inbox.snooze": {
      // Snooze: out of every view and count until then; never changes a due date. null wakes it now.
      const key = typeof o.key === "string" ? parseKey(o.key) : null;
      const u = o.until;
      const choice = u === null || u === "later" || u === "tomorrow" || u === "next_week" || (typeof u === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u) && Temporal.PlainDate.from(u, { overflow: "reject" }) !== null) ? (u as SnoozeChoice | IsoDate | null) : undefined;
      if (!key || choice === undefined || Object.keys(o).length !== 2) return bad("inbox.snooze takes { key, until: \"later\" | \"tomorrow\" | \"next_week\" | a date | null }");
      const g = await gather(ctx, cfg);
      const item = g.items.find((i) => i.facts.key === o.key);
      if (!item) return bad("That isn't in your Inbox", 404);
      if (item.facts.done) return bad("It's done already", 409);
      let until: string | null = null;
      if (choice !== null) {
        if (choice !== "later" && choice !== "tomorrow" && choice !== "next_week" && (choice <= g.today || choice > Temporal.PlainDate.from(g.today).add({ years: 1 }).toString())) return bad("Pick a day after today, within a year");
        const day = await ctx.snoozeDay();
        if (!day) return bad("Set your working hours first", 409);
        until = snoozeUntil(choice, g.now, day);
        if (!until) return bad("There's less than an hour left of your day. Snooze it until tomorrow", 409);
      }
      // A former follow-up's own date snooze goes too, so the Inbox's mark is the one snooze it has.
      if (key.source === "followUp") {
        const fu = (await ctx.plan.openFollowUps()).find((f) => f.id === key.id);
        if (fu?.snoozedUntil) await ctx.plan.snoozeFollowUp(key.id, null);
      }
      await ctx.plan.markInbox([o.key as string], { snoozedUntil: until });
      return { ok: true, data: { snoozedUntil: until } };
    }
  }
}
