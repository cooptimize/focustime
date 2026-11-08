// Shared polling, the job (D514 to D517). One cycle reads each registered client chat once, inside the union of its
// followers' working hours (never outside; the first read of the day asks for everything changed since the newest
// message seen), or on Refresh. A follower is a FocusTime user who is a member of the chat. Tokens are tried in order:
// the registering person's, then the other followers' by name; one refused (signed out, consent missing, 401, 403,
// 404) moves to the next, a throttle (429, 503) or an unreachable Teams waits out the backoff without trying anyone
// else. Nobody's works: "needs reconnecting", with the last successful fetch kept. A chat failing never stops the
// others and nothing escapes a cycle. Messages are stored once (an edit replaces the stored body); the candidate rules
// run here with the token owner's settings, so Requests appear without anyone opening FocusTime; the AI sorts each new
// one under the token owner's switches and caps; a FocusTime user's own message with promise phrasing becomes their
// promise under their own settings. Tokens live only inside each person's account (memory, then gone); this file never
// sees one. Each cycle logs counts and the token owners by name: never a chat id, topic, member or message text.
import { groupingRules } from "./conversations-pipeline.ts";
import type { AiService } from "../ai/service.ts";
import type { AppConfig } from "../config/schema.ts";
import type { LogRecord } from "../log/logger.ts";
import { backoffUntil, matchAsk } from "../plan/asks.ts";
import { matchPromise } from "../plan/asks-ai.ts";
import { chatDue, followersOf, inUnion, membersStale, nextPollDue, POLL_MINUTES, tokenOrder, type ClientChat, type FocusUser, type TeamsMessage } from "../plan/requests.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import type { ChatMessagesClient, ChatsClient, GraphMessage } from "../sources/graph/chats.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { TeamsStore } from "../store/teams-store.ts";
import type { WorkItem } from "../week/types.ts";
import { classifyAsk, extractPromise, type AskAiDeps } from "./ask-ai.ts";
import { mapSeq } from "./seq.ts";
import { imagesForAi } from "./chat-images.ts";
import { CHAT_DAILY_AI_CALLS, legacyRefused, parkedBySwitch, runPipeline } from "./conversations-pipeline.ts";
import type { ClientEntry } from "../ai/guard.ts";
import { chatAudience, type AudienceRules } from "../plan/boundary.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { userZone } from "../week/zone.ts";

/** Unmatched messages are kept this long by default; the live value is the Rule conv.retention_days (D604). */
export const EXPIRE_DAYS = 14;

/** The Rules the job reads at the start of each cycle (ADM-2, D604), so a change applies on the next tick. */
export type PollRules = { pollMinutes: number; retentionDays: number };
const BUILTIN_RULES: PollRules = { pollMinutes: POLL_MINUTES, retentionDays: EXPIRE_DAYS };
const rulesOf = async (deps: Pick<PollDeps, "rules">): Promise<PollRules> => (deps.rules ? await deps.rules().catch(() => BUILTIN_RULES) : BUILTIN_RULES);

/** What the job needs of one FocusTime user, built on demand for a cycle and dropped after it. */
export type PollPerson = {
  name: string;
  config: AppConfig | null;
  /** Their delegated Chat.Read reader (absent: not signed in with Microsoft). */
  chatMessages?: ChatMessagesClient | undefined;
  /** Their Chat.ReadBasic reader, for refreshing a chat's members. */
  chats?: Pick<ChatsClient, "members"> | undefined;
  ai: (() => Promise<AiService | null>) | null;
  /** CV-1: the same person's switches with the app's cap (the shared pipeline never counts against a person). */
  pipelineAi?: (() => Promise<AiService | null>) | null;
  plan: PlanStore | null;
  openItems: (cfg: AppConfig, clientKey: string) => Promise<WorkItem[] | null>;
  /** GD-2: the client boundary as this person knows it (Internal, the other clients' names and aliases). */
  boundary?: (clientKey: string) => Promise<{ internal: boolean; directory: ClientEntry[] }>;
};

export type PollDeps = {
  teams: TeamsStore;
  /** CV-1: the shared conversations (absent: the AP-1 rules, for older callers and tests). */
  conversations?: ConversationStore;
  /** CV-1: escalation, reminders and follow-through, after the chats are read (actions/conversation-upkeep.ts). */
  upkeep?: (now: string) => Promise<void>;
  users: () => Promise<FocusUser[]>;
  person: (userId: string) => Promise<PollPerson | null>;
  homeTenant: () => Promise<string | null>;
  now: () => string;
  log: (r: LogRecord) => void;
  /** The team's Rules (Admin › Conversations); absent: the built-in values. */
  rules?: () => Promise<PollRules>;
  /** GD-2: the Cooptimizer rule a chat's members are read against (absent: tenant and guests only). */
  audienceRules?: (homeTenant: string | null) => Promise<AudienceRules>;
};

export type CycleResult = { polled: number; messages: number; updated: number; candidates: number; promises: number; failures: number; conversations?: number; unsorted?: number; aiCalls?: number; /** CV-4: images sent to the AI, and images in AI batches that weren't (switch off, a limit, unreadable). */ imagesSent?: number; imagesNotSent?: number };

const later = (a: string, b: string) => Date.parse(a) > Date.parse(b);
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A refused token (try the next follower's) as opposed to Teams being slow or away (wait, don't try anyone else). */
const tokenRefused = (e: unknown) => e instanceof AuthFailure || (e instanceof HttpError && (e.status === 401 || e.status === 403 || e.status === 404));

/** The plain line for a wait (no ids, no text, no time: the page shows retryAt in the viewer's zone). */
const waitNote = (e: unknown) =>
  e instanceof HttpError && (e.status === 429 || e.status === 503) ? "Teams asked FocusTime to slow down"
  : e instanceof NetworkError ? "Teams couldn't be reached"
  : "Teams didn't answer as expected";

const toShared = (m: GraphMessage, fetchedAt: string): TeamsMessage => ({
  chatId: m.chatId, messageId: m.messageId, clientKey: m.clientKey, senderId: m.authorId, senderName: m.authorName ?? null, senderTenant: m.authorTenant,
  createdAt: m.createdAt, modifiedAt: m.modifiedAt, html: m.html ?? null, text: m.text, hasImage: m.hasImage, hasFile: m.hasFile, replyToId: m.replyToId,
  mentions: m.mentions ?? m.mentionedUserIds.map((id) => ({ id, name: null })), reactions: m.reactions ?? [], fetchedAt,
});

/** People for one cycle: each built once, then dropped with the cycle (their tokens with them). */
function peopleOnce(deps: PollDeps) {
  const memo = new Map<string, Promise<PollPerson | null>>();
  return (uid: string) => memo.get(uid) ?? memo.set(uid, deps.person(uid).catch(() => null)).get(uid)!;
}

/**
 * One cycle: every due chat (or, on Refresh, the given ones whatever the hour), read once with the first follower's
 * token that works. Never throws for a chat; returns counts.
 */
export async function pollCycle(deps: PollDeps, o: { force?: boolean; chatIds?: readonly string[] } = {}): Promise<CycleResult> {
  const out: CycleResult = { polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 };
  const now = deps.now();
  const instant = Temporal.Instant.from(now);
  const wanted = o.chatIds ? new Set(o.chatIds) : null;
  const live = await rulesOf(deps);
  // D523: a chat with reading off is never read, not even on Refresh.
  const chats = (await deps.teams.chats()).filter((c) => c.readOn && (!wanted || wanted.has(c.chatId)));
  if (!chats.length) return out;
  const users = await deps.users();
  const person = peopleOnce(deps);
  const hoursOf = async (c: ClientChat) => (await Promise.all(followersOf(c, users).map(person))).flatMap((p) => (p?.config ? [p.config.week.hours] : []));
  const due: ClientChat[] = [];
  for (const c of chats) if (chatDue(c, now, inUnion(instant, await hoursOf(c)), !!o.force, live.pollMinutes)) due.push(c);
  if (!due.length) return out;
  const home = await deps.homeTenant();
  const tokenUsers = new Map<string, number>();

  await mapSeq(due, async (chat) => {
    let c = chat;
    try {
      for (const uid of tokenOrder(c, users)) {
        const p = await person(uid);
        if (!p?.chatMessages) continue;
        let read;
        try {
          read = await p.chatMessages.messagesSince(c.chatId, c.clientKey, c.seenAt ?? c.readSince);
        } catch (e) {
          if (tokenRefused(e)) continue;
          const failures = c.failures + 1;
          await deps.teams.recordPoll(c.chatId, { polledAt: now, retryAt: backoffUntil(now, e instanceof HttpError ? e.retryAfter : null, failures), failures, state: "retry", note: waitNote(e), tokenUser: c.tokenUser });
          out.failures++;
          return;
        }
        // Members missing or a day old: read them first with the same sign-in, so the rules (mentions) and who sees the
        // chat follow Teams. A failed read keeps what was cached.
        if (p.chats && membersStale(c, now)) {
          const members = await p.chats.members(c.chatId).catch(() => null);
          if (members?.length) {
            await deps.teams.setMembers(c.chatId, members, now);
            c = { ...c, members, membersFetchedAt: now };
          }
        }
        // No backfill: nothing written before the chat was registered.
        const fresh = read.messages.filter((m) => later(m.createdAt, c.readSince));
        const saved = await deps.teams.saveMessages(fresh.map((m) => toShared(m, now)));
        out.messages += saved.added.length;
        out.updated += saved.updated;
        const added = fresh.filter((m) => saved.added.some((a) => a.messageId === m.messageId));
        if (deps.conversations) await conversationsStep(deps, deps.conversations, c, saved.added, { p, home, users, person, out, now });
        else await rules(deps, c, added, { p, uid, home, users, person, out });
        // CV-4: images are no longer fetched here; they are read when someone views one, or for the AI step above.
        const seenAt = read.newest && (!c.seenAt || later(read.newest, c.seenAt)) ? read.newest : undefined;
        await deps.teams.recordPoll(c.chatId, { polledAt: now, fetchedAt: now, ...(seenAt ? { seenAt } : {}), retryAt: null, failures: 0, state: same(uid, c.registeredBy) ? "ok" : "via", note: null, tokenUser: uid });
        tokenUsers.set(p.name, (tokenUsers.get(p.name) ?? 0) + 1);
        out.polled++;
        return;
      }
      // Nobody's token could read it.
      await deps.teams.recordPoll(c.chatId, { polledAt: now, retryAt: null, failures: c.failures + 1, state: "reconnect", note: null, tokenUser: null });
      out.failures++;
    } catch {
      // The store itself failed for this chat: count it, keep going.
      out.failures++;
    }
  });

  if (out.polled) await deps.teams.expire(instant.subtract({ hours: live.retentionDays * 24 }).toString()).catch(() => 0);
  if (deps.upkeep) await deps.upkeep(now).catch(() => deps.log({ source: "plan", op: "conversations_upkeep", kind: "failed" }));
  deps.log({ source: "plan", op: "requests_poll", kind: o.force ? "refresh" : "cycle", count: out.polled });
  deps.log({ source: "plan", op: "requests_poll_messages", count: out.messages });
  deps.log({ source: "plan", op: "requests_poll_candidates", count: out.candidates });
  for (const [name, count] of tokenUsers) deps.log({ source: "plan", op: "requests_poll_token", kind: name, count });
  if (out.failures) deps.log({ source: "plan", op: "requests_poll_failures", count: out.failures });
  // CV-4: images sent to the AI and described, or not sent (switch off, over a limit, unreadable): counts only.
  if (out.imagesSent || out.imagesNotSent) {
    deps.log({ source: "plan", op: "chat_images_ai", kind: "sent", count: out.imagesSent ?? 0 });
    deps.log({ source: "plan", op: "chat_images_ai", kind: "not_sent", count: out.imagesNotSent ?? 0 });
  }
  if (deps.conversations) {
    deps.log({ source: "plan", op: "conversations_new", count: out.conversations ?? 0 });
    deps.log({ source: "plan", op: "conversations_unsorted", count: out.unsorted ?? 0 });
    deps.log({ source: "plan", op: "conversations_ai_calls", count: out.aiCalls ?? 0 });
  }
  return out;
}

/** CV-1: one chat's new messages through the conversations pipeline, under the token owner's switches and the app's cap. */
async function conversationsStep(
  deps: PollDeps,
  convs: ConversationStore,
  c: ClientChat,
  added: readonly TeamsMessage[],
  x: { p: PollPerson; home: string | null; users: readonly FocusUser[]; person: (uid: string) => Promise<PollPerson | null>; out: CycleResult; now: string },
) {
  const cfg = x.p.config;
  if (!cfg) return;
  // GD-2: the chat's audience from its members now (refreshed above when stale), and the boundary for its client.
  const rulesNow = deps.audienceRules ? await deps.audienceRules(x.home).catch(() => null) : null;
  const audience = chatAudience(c.members, rulesNow ?? { homeTenant: x.home, automation: [], domains: [] });
  const bound = x.p.boundary ? await x.p.boundary(c.clientKey).catch(() => null) : null;
  const boundary = bound ? { audience, directory: bound.directory, internal: bound.internal } : undefined;
  // GD-1, GD-2: messages held under the old rule (a whole batch for one mention or a number) are sorted once more, as
  // their own batch so they never hold back new ones; in an internal chat, GD-2's own holds too.
  const retry = await legacyRefused(convs, deps.teams, c.chatId, { internal: audience === "internal" || !!bound?.internal });
  const ai = x.p.pipelineAi ? await x.p.pipelineAi().catch(() => null) : null;
  // IB-1 slice 3: messages a switch held back are sorted once it passes; nothing to press.
  const available = !!ai && (await ai.availability(c.clientKey).catch(() => "off")) === "ok";
  const parked = await parkedBySwitch(convs, deps.teams, c.chatId, { available, withNew: added.length > 0 });
  if (!added.length && !retry.length && !parked.length) return;
  const items = await x.p.openItems(cfg, c.clientKey).catch(() => null);
  const run = (batch: readonly TeamsMessage[]) => runPipeline(
    {
      teams: deps.teams, convs, users: x.users, homeTenant: x.home, now: x.now, clientName: cfg.clientSettings[c.clientKey]?.name ?? c.clientKey, ai, zone: userZone(cfg), ackPhrases: cfg.asks.ackPhrases, chatCap: cfg.org?.rules.chatAiDailyCap ?? CHAT_DAILY_AI_CALLS, ...groupingRules(cfg, c.clientKey), items,
      // CV-4: only with the client's "Send attachments to AI" on, read with the same token that read the chat.
      ...(cfg.org?.clients[c.clientKey]?.attachmentsAi && x.p.chatMessages ? { images: (ids: readonly string[]) => imagesForAi(deps.teams, x.p.chatMessages!, c.chatId, ids) } : {}),
      author: async (uid) => {
        const a = await x.person(uid);
        return a?.config ? { zone: userZone(a.config), promisePhrases: a.config.asks.promisePhrases } : null;
      },
      ...(boundary ? { boundary } : {}),
    },
    c,
    batch,
  );
  for (const batch of [added, retry, parked]) {
    if (!batch.length) continue;
    const r = await run(batch);
    x.out.imagesSent = (x.out.imagesSent ?? 0) + r.imagesSent;
    x.out.imagesNotSent = (x.out.imagesNotSent ?? 0) + r.imagesNotSent;
    x.out.conversations = (x.out.conversations ?? 0) + r.conversations;
    x.out.unsorted = (x.out.unsorted ?? 0) + r.unsorted;
    x.out.aiCalls = (x.out.aiCalls ?? 0) + r.aiCalls;
    x.out.promises += r.commitments;
  }
}

/** The candidate rules on a chat's new messages: Requests (sorted by the token owner's AI) and their authors' promises. */
async function rules(
  deps: PollDeps,
  c: ClientChat,
  added: readonly GraphMessage[],
  x: { p: PollPerson; uid: string; home: string | null; users: readonly FocusUser[]; person: (uid: string) => Promise<PollPerson | null>; out: CycleResult },
) {
  const cfg = x.p.config;
  if (!cfg || !added.length) return;
  const members = c.members ?? [];
  const ownerAi: AskAiDeps = { teams: deps.teams, by: x.uid, ai: x.p.ai ?? (async () => null), homeTenant: x.home, me: null, openItems: x.p.openItems };
  for (const m of added) {
    const hit = x.home ? matchAsk(m, { homeTenant: x.home, me: null, members, settings: cfg.asks }) : null;
    if (hit && (await deps.teams.addRequest({ chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey, rule: hit.rule, ruleDetail: hit.detail, at: m.createdAt }))) {
      x.out.candidates++;
      await classifyAsk(ownerAi, cfg, m).catch(() => null);
    }
    // A promise belongs to whoever wrote it, under their own settings and in their own plan.
    const author = m.authorId ? x.users.find((u) => !u.deleted && same(u.id, m.authorId)) : undefined;
    if (!author) continue;
    const a = await x.person(author.id);
    if (!a?.plan || !a.config) continue;
    const phrase = matchPromise(m.text, a.config.asks.promisePhrases);
    if (!phrase) continue;
    const ai: AskAiDeps = { teams: deps.teams, by: author.id, ai: a.ai ?? (async () => null), homeTenant: x.home, me: author.id, openItems: a.openItems };
    const drafted = await extractPromise(ai, a.config, m).catch(() => null);
    if (drafted && (await a.plan.addPromise({ chatId: c.chatId, messageId: m.messageId, clientKey: c.clientKey, phrase, at: m.createdAt, draft: drafted.draft, aiStatus: drafted.aiStatus }).catch(() => false))) x.out.promises++;
  }
}

/** When the job next has work (the idle rule): the earliest chat due, or the start of the next union of hours. */
export async function requestsNextDue(deps: Pick<PollDeps, "teams" | "users" | "person" | "now" | "rules">): Promise<string | null> {
  const chats = (await deps.teams.chats()).filter((c) => c.readOn);
  if (!chats.length) return null;
  const users = await deps.users();
  const person = peopleOnce(deps as PollDeps);
  const withHours = await Promise.all(chats.map(async (chat) => ({ chat, hours: (await Promise.all(followersOf(chat, users).map(person))).flatMap((p) => (p?.config ? [p.config.week.hours] : [])) })));
  return nextPollDue(withHours, Temporal.Instant.from(deps.now()), (await rulesOf(deps)).pollMinutes)?.toString() ?? null;
}
