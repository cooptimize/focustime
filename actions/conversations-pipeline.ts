// CV-1: the conversations pipeline, inside the shared poll job (actions/request-poll.ts), once per chat and cycle with
// that chat's new messages as one batch. Nobody has to open FocusTime.
//   1. Rules, no AI: GIFs, stickers, emoji only and empty messages are chatter; a short acknowledgement ("thanks",
//      "ok") is never shown, and inside a recent conversation it's a wind-down signal ("Looks wrapped up. Resolve?").
//   2. One "conversations.update" request for the rest, that client only: the batch, the chat's open (and lately
//      closed) conversations with a few recent messages each, and the client's open items; people as p1, p2 with
//      display names, messages as m1, m2 (never their ids or anyone's address). The rules' hints (a reply, a quote or a
//      mention joins; 45 minutes among the same people leans) go with each message, and a doubtful "new topic" loses
//      to a reply or a mention. Refs or item ids that weren't offered reject the whole answer.
//   3. The answer applied: new conversations, each message's place, titles and summaries, owners, commitments (one
//      per person and message group; a status statement only sets a time), a meaningful change for a linked item, a
//      likely existing item. A new work message reopens a closed conversation. Status is decided from facts.
// Throttles: one request per chat per cycle; a daily cap per chat; the app's monthly cap (the pipeline never counts
// against a person's). Without AI (off for the client, over budget, refused by a guard, failing, the chat's cap):
// rules only. A reply or mention of an open conversation joins it; anything else waits as "unsorted" with the reason
// until Sort unsorted. A FocusTime user's own message with a promise phrase still becomes their promise.
// Nothing here logs text: counts and kinds only.
import type { AiService } from "../ai/service.ts";
import type { AiImage } from "./chat-images.ts";
import { hostedImageIds } from "../plan/sanitize.ts";
import type { AppConfig } from "../config/schema.ts";
import { NO_CLIENT_RULES } from "../config/org.ts";
import { AiError } from "../ai/types.ts";
import { askTitle, DEFAULT_ASK_SETTINGS, matchAsk, type AskSettings, type IncomingMessage } from "../plan/asks.ts";
import { isExternal } from "../plan/chats.ts";
import {
  BadAnswer, buildUpdate, CLIENT_REFUSED, LEGACY_CLIENT_REFUSED, checkDue, checkImageDescriptions, IMAGE_INSTRUCTIONS, UPDATE_SCHEMA_WITH_IMAGES, checkUpdate, dueFromText, dueOf, hintFor, mergeByGroup, messageGroups, NEAR_MINUTES, oneLine, promisePhrase, promiseWhatWithoutAi, ruleVerdict, statusOf, UPDATE_INSTRUCTIONS, UPDATE_SCHEMA, UPDATE_TASK,
  type BatchMessage, type Commitment, type Conversation, type Hint, type OpenConversation, type Participant, type UpdateAnswer,
} from "../plan/conversations.ts";
import type { ClientChat, FocusUser, TeamsMessage } from "../plan/requests.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import type { TeamsStore } from "../store/teams-store.ts";
import type { WorkItem } from "../week/types.ts";
import { localToday } from "../week/dates.ts";

/** A chat's AI calls a day, at most (a setting for ADM-1 to host: conversations.chat_daily_ai_calls). */
/** The built-in per-chat daily AI cap; the team's Rule (Admin › Conversations, ADM-1) replaces it. */
export const CHAT_DAILY_AI_CALLS = 200;
/** Closed conversations stay in the AI's list this long, so a new work message can reopen them. */
const REOPEN_DAYS = 7;

export type AuthorSettings = { zone: string; promisePhrases: string[] };

export type PipelineDeps = {
  teams: TeamsStore;
  convs: ConversationStore;
  users: readonly FocusUser[];
  homeTenant: string | null;
  now: string;
  clientName: string;
  /** The AI for the shared pipeline: the token owner's switches, the app's cap. Null: AI isn't available here. */
  ai: AiService | null;
  /** The zone the AI reads times in (the token owner's), and the acknowledgement phrases. */
  zone: string;
  ackPhrases: readonly string[];
  /** The client's open items (null: DevOps couldn't be read). */
  items: readonly WorkItem[] | null;
  /** A FocusTime author's own zone and promise phrases (their settings), or null. */
  author: (userId: string) => Promise<AuthorSettings | null>;
  chatCap?: number;
  /** CV-3: the client's Rule "Group messages without AI": while AI is off (or not set up), group by rules only. */
  groupWithoutAi?: boolean;
  /** The team's request phrases (AP-1's rules), for a rules-only conversation's first message. */
  requestPhrases?: readonly string[];
  /**
   * CV-4: the client's "Send attachments to AI" is on: the batch's images, read now with the poll's token (stripped,
   * within the limits). Absent: no image is sent, only counted.
   */
  images?: (messageIds: readonly string[]) => Promise<{ images: AiImage[]; skipped: number }>;
};

export type PipelineResult = { work: number; chatter: number; acks: number; unsorted: number; conversations: number; commitments: number; aiCalls: number; aiOutcome: string | null; /** CV-4 */ imagesSent: number; imagesNotSent: number; described: number };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A stored message as the pipeline reads it, with who wrote it and from which side. */
export function batchOf(m: TeamsMessage, chat: Pick<ClientChat, "members">, home: string | null): BatchMessage {
  const member = chat.members?.find((x) => same(x.userId, m.senderId));
  const external = home ? isExternal({ tenantId: m.senderTenant ?? member?.tenantId ?? null, ...(member?.guest ? { guest: true } : {}) }, home) : false;
  return {
    messageId: m.messageId, senderId: m.senderId, senderName: m.senderName ?? member?.displayName ?? null, external, createdAt: m.createdAt, text: m.text, html: m.html,
    hasImage: m.hasImage, hasFile: m.hasFile, replyToId: m.replyToId, mentions: m.mentions.map((x) => ({ id: x.id, name: x.name })),
  };
}

export const participantOf = (m: BatchMessage): Participant | null => (m.senderId ? { id: m.senderId, name: m.senderName ?? (m.external ? "Someone outside Cooptimize" : "Someone at Cooptimize"), external: m.external } : null);
export const withParticipants = (ps: readonly Participant[], more: readonly (Participant | null)[]) => {
  const out = [...ps];
  for (const p of more) if (p && !out.some((x) => same(x.id, p.id))) out.push(p);
  return out;
};
const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

/**
 * GD-1: a chat's messages refused before GD-1 for naming another client (every Cooptimize Internal chat's were), to be
 * tried once more as their own batch. A retry that is refused again stores the new reason, so it is never tried again.
 */
export async function legacyRefused(convs: Pick<ConversationStore, "placesByRole">, teams: Pick<TeamsStore, "message">, chatId: string): Promise<TeamsMessage[]> {
  const places = (await convs.placesByRole([chatId], "unsorted")).filter((p) => p.reason === LEGACY_CLIENT_REFUSED);
  const out: TeamsMessage[] = [];
  for (const p of places) {
    const m = await teams.message(p.chatId, p.messageId);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Runs one chat's batch through the rules and (when it may) one AI request, and stores the result. Sort unsorted
 * passes the messages waiting as unsorted, which are placed again. Never throws for a message.
 */
export async function runPipeline(d: PipelineDeps, chat: ClientChat, batchIn: readonly TeamsMessage[]): Promise<PipelineResult> {
  const out: PipelineResult = { work: 0, chatter: 0, acks: 0, unsorted: 0, conversations: 0, commitments: 0, aiCalls: 0, aiOutcome: null, imagesSent: 0, imagesNotSent: 0, described: 0 };
  if (!batchIn.length) return out;
  const batch = [...batchIn].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((m) => batchOf(m, chat, d.homeTenant));
  const byId = new Map(batch.map((m) => [m.messageId, m]));
  const since = Temporal.Instant.from(d.now).subtract({ hours: REOPEN_DAYS * 24 }).toString();
  const all = await d.convs.conversations([chat.chatId]);
  const candidatesConv = all.filter((c) => !c.closedAt || Date.parse(c.lastAt) >= Date.parse(since));
  const places = await d.convs.placesIn(candidatesConv.map((c) => c.id));
  const open: OpenConversation[] = candidatesConv.map((c) => ({ id: c.id, title: c.title, summary: c.summary, status: c.status, participants: c.participants, lastAt: c.lastAt, messageIds: places.filter((p) => p.conversationId === c.id).map((p) => p.messageId) }));
  const placed = new Map<string, number>(places.filter((p) => p.conversationId !== null).map((p) => [p.messageId, p.conversationId!]));
  const touched = new Set<number>();
  /** The latest acknowledgement per conversation in this batch (after its last work, it's a wind-down). */
  const acked = new Map<number, string>();
  /** Acks with no conversation before them yet: placed once this batch's work is (thanks right after a commitment). */
  const lateAcks: BatchMessage[] = [];

  // 1. Rules.
  const work: BatchMessage[] = [];
  // "Thanks Evan" is still only thanks: the chat's people's names don't count as words.
  const names = (chat.members ?? []).flatMap((x) => (x.displayName ? [x.displayName.toLowerCase(), firstName(x.displayName).toLowerCase()] : []));
  for (const m of batch) {
    const v = ruleVerdict(m, [...d.ackPhrases, ...names]);
    if (v?.role === "chatter") {
      await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: null, role: "chatter", reason: v.why, placedBy: "rule", at: m.createdAt }]);
      out.chatter++;
      continue;
    }
    if (v?.role === "ack") {
      // Inside a conversation that just had work (the replied one, else the latest within 45 minutes): wind-down.
      const target = (m.replyToId ? placed.get(m.replyToId) : undefined) ?? [...open].filter((c) => !all.find((x) => x.id === c.id)?.closedAt).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).find((c) => (Date.parse(m.createdAt) - Date.parse(c.lastAt)) / 60_000 <= NEAR_MINUTES)?.id;
      if (target === undefined && work.length) {
        lateAcks.push(m);
        continue;
      }
      await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: target ?? null, role: target ? "ack" : "chatter", reason: "ack", placedBy: "rule", at: m.createdAt }]);
      if (target !== undefined) {
        acked.set(target, m.createdAt);
        const c = all.find((x) => x.id === target);
        if (c && !c.closedAt && !c.windDown) await d.convs.updateConversation(target, { windDown: true, lastAt: m.createdAt });
        out.acks++;
      } else out.chatter++;
      continue;
    }
    work.push(m);
  }
  if (!work.length) return out;
  const settleLateAcks = async () => {
    for (const m of lateAcks) {
      const prior = work.filter((w) => placed.has(w.messageId) && w.createdAt <= m.createdAt && (Date.parse(m.createdAt) - Date.parse(w.createdAt)) / 60_000 <= NEAR_MINUTES).at(-1);
      const target = prior ? placed.get(prior.messageId) : undefined;
      await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: target ?? null, role: target !== undefined ? "ack" : "chatter", reason: "ack", placedBy: "rule", at: m.createdAt }]);
      if (target !== undefined) {
        if (!acked.has(target) || acked.get(target)! < m.createdAt) acked.set(target, m.createdAt);
        out.acks++;
      } else out.chatter++;
    }
  };

  // Hints and groups (my promises: one per group), over the batch and the hour before it.
  const before = (await d.teams.messagesBefore(chat.chatId, work[0]!.createdAt, 20)).map((m) => batchOf(m, chat, d.homeTenant)).filter((m) => (Date.parse(work[0]!.createdAt) - Date.parse(m.createdAt)) / 60_000 <= 60);
  const groups = messageGroups([...before, ...work]);
  const hints = new Map<string, Hint>();
  for (const m of work) {
    const h = hintFor(m, open, placed);
    if (h) hints.set(m.messageId, h);
  }

  // The rules-only ending: promises, late thanks, wind-down and status.
  const finishByRules = async () => {
    out.commitments += await promisesByRule(d, chat, work, groups, placed, [...before, ...work]);
    await settleLateAcks();
    for (const [id, at] of acked) {
      const c = await d.convs.conversation(id);
      if (c && !c.closedAt && !c.windDown && Date.parse(at) > Date.parse(c.lastWorkAt)) await d.convs.updateConversation(id, { windDown: true, lastAt: Date.parse(at) > Date.parse(c.lastAt) ? at : c.lastAt });
    }
    for (const id of touched) await refreshStatus(d, id);
    return out;
  };

  // 2a. CV-3: AI off for this client (AI for FocusTime, Allow AI, or no provider key) with the Rule on: conversations
  // by rules only, decided before any AI call (none is counted). Caps and provider errors aren't "off": they wait.
  if (d.groupWithoutAi) {
    const why = d.ai ? await d.ai.availability(chat.clientKey) : "not_set_up";
    if (why !== "ok") {
      await groupByRules(d, chat, work, { all, placed, touched, out, reason: why });
      return finishByRules();
    }
  }

  // 2. AI, when it may.
  let answer: ReturnType<typeof checkUpdate> | null = null;
  let reason: string | null = null;
  const day = localToday(d.now, d.zone);
  // CV-4: images in this batch not sent to an AI (switch off or no AI): counted, never read.
  const batchImages = work.reduce((n, m) => n + hostedImageIds(m.html ?? null).length, 0);
  if (!d.images || !d.ai) out.imagesNotSent = batchImages;
  if (!d.ai) reason = "not_set_up";
  else if ((await d.convs.aiCalls(chat.chatId, day)) >= (d.chatCap ?? CHAT_DAILY_AI_CALLS)) {
    reason = "chat_cap";
    out.imagesNotSent = batchImages;
  }
  else {
    const people = withParticipants(open.flatMap((c) => c.participants), [...before, ...work].map(participantOf));
    const recent = new Map<number, BatchMessage[]>();
    for (const c of open) {
      const ids = c.messageIds.slice(-4);
      const ms: BatchMessage[] = [];
      for (const id of ids) {
        const m = await d.teams.message(chat.chatId, id);
        if (m) ms.push(batchOf(m, chat, d.homeTenant));
      }
      recent.set(c.id, ms);
    }
    const built = buildUpdate({ clientName: d.clientName, chatKind: chat.kind, zone: d.zone, now: d.now, people, open, recent, items: [...(d.items ?? [])].sort((a, b) => (b.changedAt ?? "").localeCompare(a.changedAt ?? "")), batch: work, hints, groups });
    // CV-4: with the client's switch on, the batch's images go in the same request, each labelled with its message.
    const withImages = work.filter((m) => hostedImageIds(m.html ?? null).length).map((m) => m.messageId);
    const pics = withImages.length && d.images ? await d.images(withImages).catch(() => ({ images: [] as AiImage[], skipped: withImages.length })) : { images: [] as AiImage[], skipped: 0 };
    const refOf = new Map([...built.refs.messages].map(([r, id]) => [id, r]));
    const sent = pics.images.filter((i) => refOf.has(i.messageId));
    out.imagesSent = sent.length;
    if (d.images) out.imagesNotSent = pics.skipped + (pics.images.length - sent.length);
    await d.convs.countAiCall(chat.chatId, day);
    out.aiCalls++;
    const r = sent.length
      ? await d.ai.run<UpdateAnswer & { images: { ref: string; description: string }[] }>(
          { name: UPDATE_TASK, client: chat.clientKey, instructions: `${UPDATE_INSTRUCTIONS}\n${IMAGE_INSTRUCTIONS}` },
          built.text,
          UPDATE_SCHEMA_WITH_IMAGES,
          { images: sent.map((i) => ({ label: `Image ${i.ref}, in message ${refOf.get(i.messageId)}:`, dataUrl: i.dataUrl })) },
        )
      : await d.ai.run<UpdateAnswer>({ name: UPDATE_TASK, client: chat.clientKey, instructions: UPDATE_INSTRUCTIONS }, built.text, UPDATE_SCHEMA);
    if (!r.ok) {
      reason = r.error instanceof AiError ? r.error.kind : "provider";
      if (reason === LEGACY_CLIENT_REFUSED) reason = CLIENT_REFUSED;
    }
    else {
      try {
        answer = checkUpdate(r.value, built.refs, { batch: work.map((m) => m.messageId), itemIds: (d.items ?? []).map((i) => i.id), hints });
      } catch (e) {
        if (!(e instanceof BadAnswer)) throw e;
        reason = "unknown_ref";
      }
      // The descriptions, only for images that were sent (an unknown ref is ignored, never stored).
      if (answer && sent.length) {
        for (const x of checkImageDescriptions((r.value as { images?: { ref: string; description: string }[] }).images ?? [], sent)) {
          await d.teams.setImageDescription(x.id, x.description);
          out.described++;
        }
      }
    }
    out.aiOutcome = answer ? "ok" : reason;
  }

  // 3a. Without AI: rules only.
  if (!answer) {
    for (const m of work) {
      const h = hints.get(m.messageId);
      if (h && (h.why === "reply" || h.why === "mention")) {
        await joinByRule(d, chat, m, h.conversationId, all);
        placed.set(m.messageId, h.conversationId);
        touched.add(h.conversationId);
        out.work++;
      } else {
        await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: null, role: "unsorted", reason, placedBy: "rule", at: m.createdAt }]);
        out.unsorted++;
      }
    }
    return finishByRules();
  }

  // 3b. The AI's answer.
  const created = new Map<string, Conversation>();
  const updateFor = (t: { id: number } | { newRef: string }) => answer!.updates.find((u) => ("id" in t && "id" in u.target && u.target.id === t.id) || ("newRef" in t && "newRef" in u.target && u.target.newRef === t.newRef));
  for (const p of answer.placements) {
    const m = byId.get(p.messageId)!;
    if (!p.target) {
      await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: null, role: "chatter", reason: "ai", placedBy: "ai", at: m.createdAt }]);
      out.chatter++;
      continue;
    }
    let id: number;
    if ("id" in p.target) id = p.target.id;
    else {
      let c = created.get(p.target.newRef);
      if (!c) {
        const u = updateFor(p.target);
        c = await d.convs.addConversation({ chatId: chat.chatId, clientKey: chat.clientKey, title: u?.title || askTitle(m.text), summary: u?.summary ?? "", participants: [], firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt, changeNote: "New conversation" });
        created.set(p.target.newRef, c);
        out.conversations++;
      }
      id = c.id;
    }
    await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: id, role: "work", reason: null, placedBy: "ai", at: m.createdAt }]);
    placed.set(m.messageId, id);
    touched.add(id);
    out.work++;
  }
  await settleLateAcks();
  // Per conversation: what the AI says about it, and the facts from its new messages.
  const texts = new Map([...before, ...work].map((m) => [m.messageId, m.text]));
  for (const id of touched) {
    const c = (await d.convs.conversation(id))!;
    const mine = work.filter((m) => placed.get(m.messageId) === id);
    const u = updateFor([...created.entries()].find(([, x]) => x.id === id) ? { newRef: [...created.entries()].find(([, x]) => x.id === id)![0] } : { id });
    const reopened = !!c.closedAt;
    const participants = withParticipants(c.participants, mine.map(participantOf));
    const owner = u?.ownerId && participants.some((p) => same(p.id, u.ownerId) && !p.external) ? u.ownerId : c.ownerId;
    const last = mine.at(-1)?.createdAt ?? c.lastAt;
    const itemChange = c.itemId && u?.itemChange ? { ...u.itemChange, at: last, scope: u.scopeChanged } : c.itemChange;
    await d.convs.updateConversation(
      id,
      {
        ...(u ? { title: u.title || c.title, summary: u.summary || c.summary, changeNote: reopened ? "Opened again by a new message" : u.change || null, likelyItem: u.likelyItem ?? c.likelyItem } : { changeNote: reopened ? "Opened again by a new message" : "New messages" }),
        participants, ownerId: owner, lastAt: Date.parse(last) > Date.parse(c.lastAt) ? last : c.lastAt, lastWorkAt: last, windDown: !!u?.wrappedUp || (acked.has(id) && Date.parse(acked.get(id)!) > Date.parse(last)), itemChange,
        ...(reopened ? { closed: null, status: "new" as const } : {}),
      },
      { bump: true },
    );
    // Commitments: one per person and message group; a status statement only sets the time.
    if (u?.commitments.length) {
      const zoneOf = async (who: string) => (await d.author(who))?.zone ?? d.zone;
      const raw = [];
      for (const x of u.commitments) {
        const at = x.messageIds.map((mid) => [...before, ...work].find((m) => m.messageId === mid)?.createdAt).find(Boolean) ?? last;
        const z = await zoneOf(x.whoId);
        const stated = checkDue(x.due, at, z) ?? dueFromText(x.messageIds.map((mid) => texts.get(mid) ?? "").join("\n"), at, z);
        raw.push({ ...x, due: stated, zone: z, at });
      }
      for (const x of mergeByGroup(raw, groups, texts)) {
        if (await sameCommitment(d, chat.chatId, x.whoId, x.messageIds)) continue;
        const who = participants.find((p) => same(p.id, x.whoId)) ?? null;
        const answered = x.toId && !same(x.toId, x.whoId) ? { id: x.toId, name: null } : await whomAnswered(d, chat, x.messageIds, [...before, ...work], x.whoId);
        const to = answered?.id ?? null;
        const named = to ? (participants.find((p) => same(p.id, to))?.name ?? answered?.name ?? nameIn(chat, [...before, ...work], to)) : null;
        // CV-3b: never the committer, even under another id with their name (a guest copy of the same person).
        const self = !!named && !!who?.name && same(named.trim(), who.name.trim());
        const toName = self ? null : named;
        const due = dueOf(x.due, x.zone);
        // When it was said (escalation counts from then, not from when it was read).
        const said = x.messageIds.map((mid) => [...before, ...work].find((m) => m.messageId === mid)?.createdAt).filter((t): t is string => !!t).sort()[0];
        await d.convs.addCommitment({ conversationId: id, chatId: chat.chatId, clientKey: chat.clientKey, whoId: x.whoId, whoName: who?.name ?? "Someone", toId: self ? null : to, toName, what: x.what, ...due, impliesItem: x.impliesItem || impliesItemByRule([x.what, ...x.messageIds.map((mid) => texts.get(mid) ?? "")].join("\n")), messageIds: x.messageIds, reason: null, ...(said ? { createdAt: said } : {}) });
        // A commitment's messages are kept with it (never expire as chatter).
        for (const mid of x.messageIds) if (!placed.has(mid) && byId.has(mid)) await d.convs.place([{ chatId: chat.chatId, messageId: mid, conversationId: id, role: "work", reason: null, placedBy: "ai", at: byId.get(mid)!.createdAt }]);
        out.commitments++;
      }
    }
    await refreshStatus(d, id);
  }
  return out;
}

/** CV-3: the client's grouping Rule (on by default) and the team's request phrases, for the shared pipeline. */
export function groupingRules(cfg: AppConfig, clientKey: string): Pick<PipelineDeps, "groupWithoutAi" | "requestPhrases"> {
  return { groupWithoutAi: cfg.org?.clients[clientKey]?.groupWithoutAi ?? NO_CLIENT_RULES.groupWithoutAi, requestPhrases: cfg.org?.phrases.team.request ?? cfg.asks.requestPhrases };
}

/** A rules-only conversation's working view: who is in it, who was @mentioned, each author's last message. */
type RuleConv = { id: number; lastAt: string; participants: Set<string>; mentioned: Set<string>; lastBy: Map<string, string> };
const key = (id: string | null | undefined) => (id ?? "").toLowerCase();

/**
 * CV-3: rules-only grouping (AI off for the client, the Rule on), one chat, in time order. A message joins an open
 * conversation of this chat when it (1) replies to a message in it, (2) @mentions someone in it (the latest such),
 * (2b) comes from someone @mentioned in it within 45 minutes of its last message, or (3) comes from an author within
 * 45 minutes of their own last message in it. Otherwise (4) a message AP-1's Request rules pick out starts one, with
 * its author's still-unsorted messages from the 45 minutes before; its title is its first message, shortened, with no
 * summary. Anything else (5) waits as unsorted with the reason, as before. Never across chats, so never across clients.
 */
async function groupByRules(d: PipelineDeps, chat: ClientChat, work: readonly BatchMessage[], x: { all: readonly Conversation[]; placed: Map<string, number>; touched: Set<number>; out: PipelineResult; reason: string }) {
  const convs: RuleConv[] = [];
  for (const c of x.all.filter((c) => !c.closedAt && c.chatId === chat.chatId)) {
    const rc: RuleConv = { id: c.id, lastAt: c.lastAt, participants: new Set(c.participants.map((p) => key(p.id))), mentioned: new Set(), lastBy: new Map() };
    const places = (await d.convs.placesIn([c.id])).filter((p) => p.role === "work").slice(-20);
    for (const p of places) {
      const m = await d.teams.message(p.chatId, p.messageId);
      if (!m) continue;
      for (const who of m.mentions) rc.mentioned.add(key(who.id));
      if (m.senderId && (rc.lastBy.get(key(m.senderId)) ?? "") < m.createdAt) rc.lastBy.set(key(m.senderId), m.createdAt);
    }
    convs.push(rc);
  }
  const note = (rc: RuleConv, m: BatchMessage) => {
    if (m.createdAt > rc.lastAt) rc.lastAt = m.createdAt;
    if (m.senderId) {
      rc.participants.add(key(m.senderId));
      if ((rc.lastBy.get(key(m.senderId)) ?? "") < m.createdAt) rc.lastBy.set(key(m.senderId), m.createdAt);
    }
    for (const who of m.mentions) rc.mentioned.add(key(who.id));
  };
  const latest = (cs: readonly RuleConv[]) => [...cs].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))[0];
  const within = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000 <= NEAR_MINUTES && Date.parse(to) >= Date.parse(from);
  const targetOf = (m: BatchMessage): RuleConv | undefined => {
    const replied = m.replyToId ? x.placed.get(m.replyToId) : undefined;
    const byReply = replied !== undefined ? convs.find((c) => c.id === replied) : undefined;
    if (byReply) return byReply;
    const byMention = latest(convs.filter((c) => m.mentions.some((who) => c.participants.has(key(who.id)))));
    if (byMention) return byMention;
    const s = key(m.senderId);
    if (!s) return undefined;
    const mentionedPoster = latest(convs.filter((c) => c.mentioned.has(s) && within(c.lastAt, m.createdAt)));
    if (mentionedPoster) return mentionedPoster;
    return latest(convs.filter((c) => c.lastBy.has(s) && within(c.lastBy.get(s)!, m.createdAt)));
  };
  const settings: AskSettings = { ...DEFAULT_ASK_SETTINGS, requestPhrases: [...(d.requestPhrases ?? DEFAULT_ASK_SETTINGS.requestPhrases)], ackPhrases: [...d.ackPhrases] };
  const isRequest = (m: BatchMessage) =>
    m.external && !!d.homeTenant && !!matchAsk({ chatId: chat.chatId, messageId: m.messageId, clientKey: chat.clientKey, authorId: m.senderId, authorTenant: null, createdAt: m.createdAt, text: m.text, hasImage: m.hasImage, hasFile: m.hasFile, mentionedUserIds: m.mentions.map((w) => w.id) } as IncomingMessage, { homeTenant: d.homeTenant, me: null, members: chat.members ?? [], settings });
  /** This batch's messages left unsorted so far, for a new conversation to take its author's earlier ones. */
  const unsorted: BatchMessage[] = [];

  for (const m of work) {
    const t = targetOf(m);
    if (t) {
      await joinByRule(d, chat, m, t.id, x.all);
      note(t, m);
      x.placed.set(m.messageId, t.id);
      x.touched.add(t.id);
      x.out.work++;
      continue;
    }
    if (isRequest(m)) {
      // The author's still-unsorted messages from the 45 minutes before (this batch's, then stored ones) come along.
      const earlier: BatchMessage[] = unsorted.filter((u) => same(u.senderId, m.senderId) && within(u.createdAt, m.createdAt));
      for (const s of await d.teams.messagesBefore(chat.chatId, earlier[0]?.createdAt ?? m.createdAt, 12)) {
        if (!same(s.senderId, m.senderId) || !within(s.createdAt, m.createdAt) || earlier.some((e) => e.messageId === s.messageId)) continue;
        if ((await d.convs.placeOf(chat.chatId, s.messageId))?.role === "unsorted") earlier.push(batchOf(s, chat, d.homeTenant));
      }
      const ms = [...earlier, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const titled = ms.find((y) => y.text.trim());
      const c = await d.convs.addConversation({
        chatId: chat.chatId, clientKey: chat.clientKey, title: titled ? oneLine(titled.text, 80) : `${m.hasImage ? "An image" : "A file"} from ${firstName(m.senderName ?? "someone")}`, summary: "",
        participants: withParticipants([], ms.map(participantOf)), firstAt: ms[0]!.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt,
      });
      await d.convs.place(ms.map((y) => ({ chatId: chat.chatId, messageId: y.messageId, conversationId: c.id, role: "work" as const, reason: null, placedBy: "rule" as const, at: y.createdAt })));
      const rc: RuleConv = { id: c.id, lastAt: m.createdAt, participants: new Set(), mentioned: new Set(), lastBy: new Map() };
      for (const y of ms) note(rc, y), x.placed.set(y.messageId, c.id);
      convs.push(rc);
      x.touched.add(c.id);
      const fromBatch = earlier.filter((e) => unsorted.includes(e));
      for (const e of fromBatch) unsorted.splice(unsorted.indexOf(e), 1);
      x.out.unsorted -= fromBatch.length;
      x.out.work += 1 + fromBatch.length;
      x.out.conversations++;
      continue;
    }
    await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: null, role: "unsorted", reason: x.reason, placedBy: "rule", at: m.createdAt }]);
    unsorted.push(m);
    x.out.unsorted++;
  }
}

/** Joins a message to a conversation by rule (a reply or a mention while AI is unavailable): a new message, reopening it. */
async function joinByRule(d: PipelineDeps, chat: ClientChat, m: BatchMessage, id: number, all: readonly Conversation[]) {
  const c = all.find((x) => x.id === id) ?? (await d.convs.conversation(id));
  if (!c) return;
  await d.convs.place([{ chatId: chat.chatId, messageId: m.messageId, conversationId: id, role: "work", reason: null, placedBy: "rule", at: m.createdAt }]);
  await d.convs.updateConversation(id, { participants: withParticipants(c.participants, [participantOf(m)]), lastAt: m.createdAt, lastWorkAt: m.createdAt, windDown: c.windDown && Date.parse(c.lastAt) > Date.parse(m.createdAt), changeNote: c.closedAt ? "Opened again by a new message" : `New message from ${firstName(m.senderName ?? "someone")}`, ...(c.closedAt ? { closed: null, status: "new" as const } : {}) }, { bump: true });
}

/** Rules-only promises: a FocusTime user's own message with a promise phrase, one per message group. */
async function promisesByRule(d: PipelineDeps, chat: ClientChat, work: readonly BatchMessage[], groups: ReadonlyMap<string, string>, placed: ReadonlyMap<string, number>, context: readonly BatchMessage[]): Promise<number> {
  let n = 0;
  const done = new Set<string>();
  for (const m of work) {
    const user = m.senderId ? d.users.find((u) => !u.deleted && same(u.id, m.senderId)) : undefined;
    if (!user) continue;
    const g = groups.get(m.messageId) ?? m.messageId;
    if (done.has(`${user.id}|${g}`)) continue;
    const settings = await d.author(user.id);
    if (!settings) continue;
    const phrase = promisePhrase(m.text, settings.promisePhrases);
    if (!phrase) continue;
    done.add(`${user.id}|${g}`);
    const groupMs = context.filter((x) => groups.get(x.messageId) === g && same(x.senderId, user.id));
    if (await sameCommitment(d, chat.chatId, user.id, groupMs.map((x) => x.messageId))) continue;
    const due = dueOf(dueFromText(groupMs.map((x) => x.text).join("\n"), m.createdAt, settings.zone), settings.zone);
    const found = await whomAnswered(d, chat, groupMs.map((x) => x.messageId), context, user.id);
    // CV-3b: never the committer by name either.
    const to = found && !same((found.name ?? nameIn(chat, context, found.id))?.trim(), (m.senderName ?? user.name).trim()) ? found : null;
    await d.convs.addCommitment({
      conversationId: placed.get(m.messageId) ?? null, chatId: chat.chatId, clientKey: chat.clientKey, whoId: user.id, whoName: m.senderName ?? user.name, toId: to?.id ?? null,
      toName: to ? (to.name ?? nameIn(chat, context, to.id)) : null, what: promiseWhatWithoutAi(m.text, phrase), ...due, impliesItem: impliesItemByRule(groupMs.map((x) => x.text).join("\n")),
      messageIds: groupMs.map((x) => x.messageId), reason: `Says "${phrase}"`, createdAt: groupMs[0]?.createdAt ?? m.createdAt,
    });
    for (const x of groupMs) if (!placed.has(x.messageId) && work.some((w) => w.messageId === x.messageId)) await d.convs.place([{ chatId: chat.chatId, messageId: x.messageId, conversationId: null, role: "work", reason: null, placedBy: "rule", at: x.createdAt }]);
    n++;
  }
  return n;
}

/** A person's name from the chat's cached member list, else as they signed a message in view. */
function nameIn(chat: ClientChat, context: readonly BatchMessage[], id: string): string | null {
  return chat.members?.find((m) => same(m.userId, id))?.displayName ?? context.find((x) => same(x.senderId, id))?.senderName ?? null;
}

/**
 * CV-2: whom a commitment answers, with their name when known: the author of the message replied to (looked up in
 * the store whatever its age when it isn't in view), else someone mentioned (named from the mention or the chat's
 * cached members), else the last other author in the hour before.
 */
export async function whomAnswered(d: Pick<PipelineDeps, "teams">, chat: ClientChat, messageIds: readonly string[], context: readonly BatchMessage[], whoId: string): Promise<{ id: string; name: string | null } | null> {
  const ms = context.filter((m) => messageIds.includes(m.messageId));
  for (const m of ms) {
    if (!m.replyToId) continue;
    const inView = context.find((x) => x.messageId === m.replyToId);
    const replied = inView ?? (await d.teams.message(chat.chatId, m.replyToId).catch(() => null));
    if (replied?.senderId && !same(replied.senderId, whoId)) return { id: replied.senderId, name: replied.senderName ?? nameIn(chat, context, replied.senderId) };
  }
  for (const m of ms) {
    const other = m.mentions.find((x) => !same(x.id, whoId));
    if (other) return { id: other.id, name: other.name ?? nameIn(chat, context, other.id) };
  }
  const id = answeredBy(messageIds, context, whoId);
  return id ? { id, name: nameIn(chat, context, id) } : null;
}

/**
 * CV-2: my own words that put work in DevOps, for a promise found by the rules ("put it in the queue", "log a
 * ticket", "add a story", "track it", "I'll take it on" with a backlog reference); the AI says so itself otherwise.
 */
export function impliesItemByRule(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(dev queue|backlog|ticket|bug|story|work item|devops)\b/.test(t)) return true;
  if (/\b(put|add|get|drop) (it|this|that|them) (in|into|on|onto) the (queue|board|sprint|list)\b/.test(t)) return true;
  if (/\b(log|open|file|raise|create) (a|an|the) (ticket|bug|item|story|card|issue)\b/.test(t)) return true;
  if (/\badd (a|an|the) (story|item|task|card)\b/.test(t)) return true;
  if (/\btrack (it|this|that|them)\b/.test(t)) return true;
  if (/\b(take|pick) (it|this|that) (on|up)\b/.test(t) && /#\d{2,}|\b(backlog|board|sprint|queue|feature)\b/.test(t)) return true;
  return false;
}

/** Whom a commitment answers: the author of the message replied to, someone mentioned, or the last other author in the hour before. */
export function answeredBy(messageIds: readonly string[], context: readonly BatchMessage[], whoId: string): string | null {
  const ms = context.filter((m) => messageIds.includes(m.messageId));
  for (const m of ms) {
    const replied = m.replyToId ? context.find((x) => x.messageId === m.replyToId) : undefined;
    if (replied?.senderId && !same(replied.senderId, whoId)) return replied.senderId;
  }
  for (const m of ms) {
    const other = m.mentions.find((x) => !same(x.id, whoId));
    if (other) return other.id;
  }
  const first = ms.map((m) => m.createdAt).sort()[0];
  if (!first) return null;
  const prior = context.filter((x) => Date.parse(x.createdAt) < Date.parse(first) && (Date.parse(first) - Date.parse(x.createdAt)) / 60_000 <= 60 && x.senderId && !same(x.senderId, whoId)).at(-1);
  return prior?.senderId ?? null;
}

/** A commitment already recorded for these messages by this person (a batch read twice never doubles one). */
async function sameCommitment(d: PipelineDeps, chatId: string, whoId: string, messageIds: readonly string[]): Promise<boolean> {
  const list: Commitment[] = await d.convs.commitmentsInChat(chatId);
  return list.some((c) => same(c.whoId, whoId) && c.messageIds.some((id) => messageIds.includes(id)));
}

/** Recomputes a conversation's status from its facts (never Resolved or Closed: only a person does that). */
export async function refreshStatus(d: Pick<PipelineDeps, "convs" | "teams" | "homeTenant">, id: number): Promise<Conversation | null> {
  const c = await d.convs.conversation(id);
  if (!c) return null;
  const commitments = await d.convs.commitmentsIn([id]);
  const places = (await d.convs.placesIn([id])).filter((p) => p.role === "work");
  const first = places[0];
  let firstAuthor: string | null = null;
  let cooptimizerSpoke = false;
  const chat = await d.teams.chat(c.chatId);
  for (const p of places) {
    const m = await d.teams.message(p.chatId, p.messageId);
    if (!m) continue;
    const b = batchOf(m, chat ?? { members: null }, d.homeTenant);
    if (p === first) firstAuthor = b.senderId;
    else if (!b.external && !same(b.senderId, firstAuthor)) cooptimizerSpoke = true;
  }
  const status = statusOf(c, { openCommitment: commitments.some((x) => x.state === "open"), cooptimizerSpoke });
  if (status !== c.status) return d.convs.updateConversation(id, { status });
  return c;
}
