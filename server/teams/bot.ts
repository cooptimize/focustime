// TB-1: the bot's core, after the Teams SDK verified the token (server/teams/sdk.ts). Teams gives a bot 10 to 15
// seconds, and dev may be waking from zero, so a message is answered at once (200, nothing in the body) and its turn
// runs after: a typing indicator, then the reply, with "On it…" first when the assistant takes longer than a moment.
// Teams may deliver an activity again; the same activity id is handled once.
//
// A message goes to the gate (server/teams/gate.ts), then a quick command (server/teams/quick.ts) or the assistant
// (AS-1's handle); the reply is its text, its result cards and one proposal card per write. A tap on Confirm or Cancel
// is an adaptiveCard/action invoke: the card row is claimed once (store/teams-bot-store.ts), the assistant's confirm
// or cancel runs once, and the card becomes its outcome. When confirm runs long the tap gets "Working on it…" and the
// card is updated when it finishes. The bot sends only replies and card updates, only in the 1:1 chat it was messaged
// in. Nothing here logs text, ids of people or conversations: only kinds and counts.
import type { LogRecord } from "../../log/logger.ts";
import type { TeamsBotStore } from "../../store/teams-bot-store.ts";
import { SETTLED } from "../../store/teams-bot-store.ts";
import { PROPOSAL_MINUTES, type AssistantService, type HandleResult, type Proposal, type TeamsContext } from "./assistant.ts";
import { attach, cancelledCard, CARD_TYPE, doneCard, expiredCard, failedCard, helpCard, ownLinks, proposalCard, resultCard, tapOf, workingCard, type Card } from "./cards.ts";
import { gate, refusalText, type GateDeps } from "./gate.ts";
import { nextCard, quickOf, todayCard, type TodayFacts } from "./quick.ts";

/** The parts of an incoming activity the bot reads. */
export type InActivity = {
  id?: string;
  type: string;
  name?: string;
  action?: string;
  text?: string;
  value?: unknown;
  replyToId?: string;
  channelId?: string;
  serviceUrl?: string;
  locale?: string;
  localTimezone?: string;
  conversation?: { id?: string; conversationType?: string; tenantId?: string } | null;
  channelData?: { tenant?: { id?: string } | null } | null;
  from?: { aadObjectId?: string } | null;
  recipient?: { id?: string } | null;
};

export type Address = { conversationId: string; serviceUrl: string };
export type OutActivity = { type: "message"; text?: string; textFormat?: "plain"; attachments?: unknown[] } | { type: "typing" };
/** Sending into the chat a message came from (the SDK's connector client with the bot's token in sdk.ts). */
export type Sender = {
  send(to: Address, a: OutActivity): Promise<{ id: string | null }>;
  update(to: Address, activityId: string, a: OutActivity): Promise<void>;
};
/** An adaptiveCard/action invoke's response body (the SDK sends it with HTTP 200). */
export type InvokeBody = { statusCode: number; type: string; value: unknown };

export type BotDeps = {
  publicUrl: string;
  gate: GateDeps;
  /** AS-1's assistant service; null until it is wired (quick commands still work). */
  assistant: AssistantService | null;
  /** Today for a person, from their own week (week.load); throws when the sources can't be read. */
  today: (userId: string) => Promise<TodayFacts>;
  store: (userId: string) => TeamsBotStore;
  sender: Sender;
  log: (r: Pick<LogRecord, "op" | "kind" | "count" | "status" | "durationMs">) => void;
  now: () => Temporal.Instant;
  /** "On it…" after this long without a reply (ms). */
  ackAfterMs?: number;
  /** A tap waits this long for confirm before answering "Working on it…" (ms). */
  confirmWaitMs?: number;
  /** Turns that run after the 200 go here (tests wait for them). */
  background?: (p: Promise<void>) => void;
  /** The connector hosts the bot sends to (its token goes there); Teams' own by default. */
  serviceHost?: RegExp;
  /** HK-3: a Cooptimizer messaged or tapped (real use, like a page in front of someone). */
  onUse?: () => void;
};

export const ON_IT = "On it…";
export const NOT_READY = "I can answer what's next, today, help and open FocusTime for now. The rest comes with FocusTime's assistant.";
export const WENT_WRONG = "Something went wrong on my side. Try again in a minute.";
export const SOURCES_DOWN = "I couldn't read your week just now. Open FocusTime to see what's wrong.";
/** Teams' connector hosts (the serviceUrl a Teams activity carries). */
export const TEAMS_SERVICE = /^(smba\.trafficmanager\.net|[a-z0-9-]+\.botframework\.com|[a-z0-9-]+\.teams\.microsoft\.com)$/;

const SEEN_MS = 10 * 60_000;
const SEEN_MAX = 5000;

export function createBotCore(d: BotDeps) {
  const ackAfter = d.ackAfterMs ?? 2500;
  const confirmWait = d.confirmWaitMs ?? 8000;
  const background = d.background ?? ((p) => void p.catch(() => undefined));
  const serviceHost = d.serviceHost ?? TEAMS_SERVICE;
  const seen = new Map<string, number>();
  /**
   * Each person's turns run one at a time, in the order Teams sent them, so replies come back in order. In memory: the
   * order holds within one replica (the app runs one; with more, two messages sent close together could be answered
   * by two replicas at once). Duplicates are caught across replicas by the store (firstSeen).
   */
  const queues = new Map<string, Promise<void>>();
  const inOrder = (userId: string, job: () => Promise<void>): Promise<void> => {
    const next = (queues.get(userId) ?? Promise.resolve()).then(job, job);
    queues.set(userId, next);
    void next.finally(() => queues.get(userId) === next && queues.delete(userId)).catch(() => undefined);
    return next;
  };

  /** True the first time an activity id is seen in the last 10 minutes. */
  const firstTime = (id: string | undefined) => {
    if (!id) return true;
    const t = d.now().epochMilliseconds;
    for (const [k, at] of seen) if (t - at > SEEN_MS || seen.size > SEEN_MAX) seen.delete(k);
    if (seen.has(id)) return false;
    seen.set(id, t);
    return true;
  };
  const addressOf = (a: InActivity): Address | null => {
    const conversationId = a.conversation?.id;
    const serviceUrl = a.serviceUrl;
    if (!conversationId || !serviceUrl) return null;
    try {
      const u = new URL(serviceUrl);
      if (u.protocol !== "https:" || !serviceHost.test(u.hostname)) return null;
    } catch {
      return null;
    }
    return { conversationId, serviceUrl };
  };
  const say = (to: Address, text: string) => d.sender.send(to, { type: "message", text, textFormat: "plain" });
  const cards = (to: Address, list: Card[], text?: string) => d.sender.send(to, { type: "message", ...(text ? { text, textFormat: "plain" as const } : {}), attachments: list.map(attach) });
  const context = (a: InActivity): TeamsContext => ({ surface: "teams", conversation: "personal", locale: typeof a.locale === "string" ? a.locale.slice(0, 20) : null, timeZone: typeof a.localTimezone === "string" ? a.localTimezone.slice(0, 64) : null });
  const expiresOf = (p: Proposal) => {
    try {
      return Temporal.Instant.from(p.expiresAt).toString();
    } catch {
      return d.now().add({ minutes: PROPOSAL_MINUTES }).toString();
    }
  };

  /** One message's turn, after the 200. */
  async function turn(a: InActivity, to: Address, userId: string): Promise<void> {
    const started = d.now().epochMilliseconds;
    await d.sender.send(to, { type: "typing" }).catch(() => undefined);
    const text = (a.text ?? "").slice(0, 4000);
    const q = quickOf(text);
    if (q === "help") return void (await cards(to, [helpCard(d.publicUrl)]), d.log({ op: "turn", kind: "help" }));
    if (q === "open") return void (await cards(to, [resultCard({ title: "FocusTime", lines: ["Your week, your focus blocks and everything you planned."], links: [{ label: "Open FocusTime", url: d.publicUrl }] }, d.publicUrl)]), d.log({ op: "turn", kind: "open" }));
    if (q === "next" || q === "today") {
      let facts: TodayFacts;
      try {
        facts = await d.today(userId);
      } catch {
        d.log({ op: "turn", kind: `${q}_unavailable` });
        return void (await say(to, SOURCES_DOWN));
      }
      await cards(to, [resultCard(q === "next" ? nextCard(facts, d.publicUrl) : todayCard(facts, d.publicUrl), d.publicUrl)]);
      return d.log({ op: "turn", kind: q, durationMs: d.now().epochMilliseconds - started });
    }
    if (!d.assistant) return void (await say(to, NOT_READY), d.log({ op: "turn", kind: "not_ready" }));

    let acked = false;
    const timer = setTimeout(() => {
      acked = true;
      void say(to, ON_IT).catch(() => undefined);
    }, ackAfter);
    let r: HandleResult;
    try {
      r = await d.assistant.handle({ person: { userId }, channel: "teams", text, context: context(a) });
    } catch {
      clearTimeout(timer);
      d.log({ op: "turn", kind: "assistant_error" });
      return void (await say(to, WENT_WRONG));
    }
    clearTimeout(timer);
    await reply(to, userId, r);
    d.log({ op: "turn", kind: `assistant_${String(r.status).replace(/[^a-z_]/g, "").slice(0, 20) || "other"}`, count: r.proposals.length, durationMs: d.now().epochMilliseconds - started, ...(acked ? { status: "acked" } : {}) });
  }

  async function reply(to: Address, userId: string, r: HandleResult): Promise<void> {
    const results = r.cards.slice(0, 5).map((c) => resultCard(c, d.publicUrl));
    const links = ownLinks(r.links, d.publicUrl);
    if (links.length && !results.length) results.push(resultCard({ title: "In FocusTime", links }, d.publicUrl));
    if (results.length) await cards(to, results, r.reply || undefined);
    else if (r.reply) await say(to, r.reply);
    const store = d.store(userId);
    for (const p of r.proposals.slice(0, 5)) {
      const expires = expiresOf(p);
      // The row exists before the card does, so a tap can never arrive for a card FocusTime doesn't know.
      await store.cardSent(p.id, null, expires, p.title);
      const sent = await cards(to, [proposalCard(p)]);
      await store.cardSent(p.id, sent.id, expires, p.title);
    }
  }

  /** A tap on Confirm or Cancel: the card's new content. */
  async function tap(a: InActivity, userId: string, to: Address | null): Promise<InvokeBody> {
    const answer = (c: Card): InvokeBody => ({ statusCode: 200, type: CARD_TYPE, value: c });
    const t = tapOf(a.value);
    if (!t) return { statusCode: 400, type: "application/vnd.microsoft.error", value: { code: "BadRequest", message: "Not a FocusTime card" } };
    const store = d.store(userId);
    const row = await store.card(t.proposalId);
    if (!row) return answer(failedCard("this card", "FocusTime doesn't know this card any more. Ask again for a fresh preview."));
    const title = row.title;
    if (SETTLED.has(row.state) && row.card) return d.log({ op: "tap", kind: "repeat" }), answer(row.card as Card);
    if (row.state === "running") return d.log({ op: "tap", kind: "in_progress" }), answer(workingCard(title));
    if (d.now().epochMilliseconds > Temporal.Instant.from(row.expiresAt).epochMilliseconds) {
      if (!(await store.claim(t.proposalId))) return answer(workingCard(title));
      const c = expiredCard(title);
      await store.settle(t.proposalId, "expired", c);
      return d.log({ op: "tap", kind: "expired" }), answer(c);
    }
    if (!(await store.claim(t.proposalId))) {
      const now = await store.card(t.proposalId);
      return d.log({ op: "tap", kind: "repeat" }), answer(now?.card ? (now.card as Card) : workingCard(title));
    }
    const assistant = d.assistant;
    if (!assistant) {
      await store.release(t.proposalId);
      return answer(failedCard(title, NOT_READY));
    }
    if (t.ft === "cancel") {
      await assistant.cancel({ person: { userId }, proposalId: t.proposalId }).catch(() => undefined);
      const c = cancelledCard(title);
      await store.settle(t.proposalId, "cancelled", c);
      return d.log({ op: "tap", kind: "cancelled" }), answer(c);
    }

    const run = (async (): Promise<Card> => {
      try {
        const r = await assistant.confirm({ person: { userId }, proposalId: t.proposalId });
        if (r.status === "ok") {
          const c = doneCard({ title, message: r.message, undo: r.undo ?? null, links: r.links ?? [] }, d.publicUrl);
          await store.settle(t.proposalId, "done", c);
          d.log({ op: "tap", kind: "done" });
          return c;
        }
        if (r.status === "changed") {
          // The card becomes the new preview, to confirm again; the new proposal is tapped from the same message.
          const c = proposalCard(r.proposal, { again: r.message });
          await store.settle(t.proposalId, "replaced", c);
          await store.cardSent(r.proposal.id, row.activityId ?? a.replyToId ?? null, expiresOf(r.proposal), r.proposal.title);
          d.log({ op: "tap", kind: "changed" });
          return c;
        }
        const c = r.status === "expired" ? expiredCard(title) : failedCard(title, r.message);
        await store.settle(t.proposalId, r.status === "expired" ? "expired" : "failed", c);
        d.log({ op: "tap", kind: r.status });
        return c;
      } catch {
        const c = failedCard(title, "Something went wrong. Check FocusTime before trying again.");
        await store.settle(t.proposalId, "failed", c).catch(() => undefined);
        d.log({ op: "tap", kind: "confirm_error" });
        return c;
      }
    })();
    let late = false;
    const quick = await Promise.race([run, new Promise<null>((ok) => setTimeout(() => ok(null), confirmWait))]);
    if (quick) return answer(quick);
    late = true;
    const id = row.activityId ?? a.replyToId ?? null;
    if (to && id && late)
      background(
        run.then(async (c) => {
          await d.sender.update(to, id, { type: "message", attachments: [attach(c)] });
        }),
      );
    d.log({ op: "tap", kind: "slow" });
    return answer(workingCard(title));
  }

  return {
    /** A verified activity. An invoke gets its response body; anything else gets null (a plain 200). */
    async activity(a: InActivity): Promise<InvokeBody | null> {
      const isTap = a.type === "invoke" && a.name === "adaptiveCard/action";
      if (a.type !== "message" && !isTap && a.type !== "installationUpdate") return null;
      if (!isTap && !firstTime(a.id)) return d.log({ op: "activity", kind: "duplicate" }), null;
      const to = addressOf(a);
      const g = await gate(a, d.gate);
      if (!g.ok) {
        d.log({ op: "refused", kind: g.why });
        const line = refusalText(g.why, d.publicUrl);
        if (isTap) return { statusCode: 200, type: "application/vnd.microsoft.activity.message", value: line ?? "Not available" };
        if (line && to && a.type === "message") background(say(to, line).then(() => undefined));
        return null;
      }
      d.onUse?.();
      if (isTap) return tap(a, g.userId, to);
      if (!to) return d.log({ op: "activity", kind: "no_address" }), null;
      const store = d.store(g.userId);
      if (a.type === "installationUpdate") {
        if (a.action === "remove") await store.chatRemoved();
        else await store.saveChat({ conversationId: to.conversationId, serviceUrl: to.serviceUrl, tenantId: (a.conversation?.tenantId ?? a.channelData?.tenant?.id ?? "").toLowerCase(), botId: a.recipient?.id || "bot" }).catch(() => undefined);
        return d.log({ op: "install", kind: a.action === "remove" ? "removed" : "added" }), null;
      }
      // TB-1b: the same delivery on another replica (or after this one restarted) is answered once too.
      if (a.id && !(await store.firstSeen(a.id).catch(() => (d.log({ op: "seen_save", kind: "failed" }), true)))) return d.log({ op: "activity", kind: "duplicate" }), null;
      background(
        inOrder(g.userId, async () => {
          await store.saveChat({ conversationId: to.conversationId, serviceUrl: to.serviceUrl, tenantId: (a.conversation?.tenantId ?? a.channelData?.tenant?.id ?? "").toLowerCase(), botId: a.recipient?.id || "bot" }).catch(() => d.log({ op: "chat_save", kind: "failed" }));
          await turn(a, to, g.userId).catch(async () => {
            d.log({ op: "turn", kind: "error" });
            await say(to, WENT_WRONG).catch(() => undefined);
          });
        }),
      );
      return null;
    },
  };
}
export type BotCore = ReturnType<typeof createBotCore>;
