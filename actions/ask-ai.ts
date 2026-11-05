// AP-2: AI sorts requests, and Promises: the requests. Shared polling (D516): the message and its earlier messages come
// from the shared store; a Request's sort is saved once on its shared row with whose settings sorted it (the token
// owner's in the poll job, the person's own on Sort again); a promise runs under its author's settings. One ai/ request per new ask candidate ("asks.classify") and per
// new promise candidate ("promises.extract"), each about that client only: the message, up to 5 earlier messages of
// that chat (authors as "client", "Cooptimize" or "me", no email addresses), the client's process names and up to 50
// of its open items. ai/ applies the switches (Use AI, Allow AI for the client), the guards, the budget and the log;
// nothing here logs text. A failed or refused request is never retried in a loop: the card says "Not sorted" and
// offers Sort again.
import type { AiService } from "../ai/service.ts";
import { AiError } from "../ai/types.ts";
import type { AppConfig } from "../config/schema.ts";
import { CONTEXT_MESSAGES, type Ask, type StoredMessage } from "../plan/asks.ts";
import { buildContext, CLASSIFY_INSTRUCTIONS, CLASSIFY_SCHEMA, CLASSIFY_TASK, contextText, promiseFrom, PROMISE_INSTRUCTIONS, PROMISE_SCHEMA, PROMISE_TASK, promiseWithoutAi, sortFrom, type AiMessage, type AskSort, type ClassifyAnswer, type NotSorted, type PromiseAnswer, type PromiseDraft } from "../plan/asks-ai.ts";
import { isExternal, type ChatMember } from "../plan/chats.ts";
import { storedOf } from "../plan/requests.ts";
import type { SortStore } from "../store/teams-store.ts";
import type { WorkItem } from "../week/types.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";

export type AskAiDeps = {
  teams: SortStore;
  /** Whose settings run the request (saved as the sort's author). */
  by: string | null;
  /** The AI service for this person, or null where there is none (demo, no store). */
  ai: () => Promise<AiService | null>;
  homeTenant: string | null;
  me: string | null;
  /** The client's open items (as Link offers them), or null when DevOps couldn't be read. */
  openItems: (cfg: AppConfig, clientKey: string) => Promise<WorkItem[] | null>;
};

/** Who wrote a message, as the AI is told: "me", "Cooptimize" or "client" (never a name or an address). */
export function authorOf(m: Pick<StoredMessage, "authorId" | "authorTenant">, chat: { members: readonly ChatMember[] | null } | null | undefined, home: string | null, me: string | null): AiMessage["from"] {
  if (me && m.authorId?.toLowerCase() === me.toLowerCase()) return "me";
  const member = chat?.members?.find((x) => x.userId && m.authorId && x.userId.toLowerCase() === m.authorId.toLowerCase());
  if (!home) return "client";
  return isExternal({ tenantId: m.authorTenant ?? member?.tenantId ?? null, ...(member?.guest ? { guest: true } : {}) }, home) ? "client" : "Cooptimize";
}

const asAi = (m: StoredMessage, from: AiMessage["from"]): AiMessage => ({ id: m.messageId, from, text: m.text, attachment: m.hasImage ? "image" : m.hasFile ? "file" : null });

/** The context for one message of a chat: that chat's earlier messages and that client's items only. */
async function contextFor(d: AskAiDeps, cfg: AppConfig, m: StoredMessage) {
  const chat = await d.teams.chat(m.chatId);
  const before = (await d.teams.messagesBefore(m.chatId, m.createdAt, CONTEXT_MESSAGES)).map(storedOf);
  const items = (await d.openItems(cfg, m.clientKey).catch(() => null)) ?? [];
  const earlier = before.map((x) => asAi(x, authorOf(x, chat, d.homeTenant, d.me)));
  const c = buildContext({ clientName: cfg.clientSettings[m.clientKey]?.name ?? m.clientKey, items, earlier, message: asAi(m, authorOf(m, chat, d.homeTenant, d.me)) });
  return { c, chat, before };
}

/** Sorts one ask: the stored sort, or why it wasn't sorted. Returns what was stored. */
export async function classifyAsk(d: AskAiDeps, cfg: AppConfig, ask: Pick<Ask, "chatId" | "messageId" | "clientKey">): Promise<{ status: "sorted"; sort: AskSort } | { status: NotSorted } | null> {
  const ai = await d.ai();
  if (!ai) return null;
  const stored = await d.teams.message(ask.chatId, ask.messageId);
  if (!stored) return null;
  const m = storedOf(stored);
  const { c } = await contextFor(d, cfg, m);
  const r = await ai.run<ClassifyAnswer>({ name: CLASSIFY_TASK, client: ask.clientKey, instructions: CLASSIFY_INSTRUCTIONS }, contextText(c), CLASSIFY_SCHEMA);
  if (!r.ok) {
    const kind = r.error instanceof AiError ? r.error.kind : "provider";
    await d.teams.setSort(ask.chatId, ask.messageId, kind, null, d.by);
    return { status: kind };
  }
  const sort = sortFrom(r.value, c.items.map((i) => i.id));
  if (!sort) {
    await d.teams.setSort(ask.chatId, ask.messageId, "unknown_item", null, d.by);
    return { status: "unknown_item" };
  }
  await d.teams.setSort(ask.chatId, ask.messageId, "sorted", sort, d.by);
  return { status: "sorted", sort };
}

/**
 * A promise from one of my messages the rules matched: with AI (when it's on and allowed for the client) the draft
 * from "promises.extract", which may say it isn't a promise (null: no card); without AI the message's first line.
 */
export async function extractPromise(d: AskAiDeps, cfg: AppConfig, m: StoredMessage): Promise<{ draft: PromiseDraft; aiStatus: "sorted" | NotSorted | null } | null> {
  const ai = await d.ai();
  if (!ai) return { draft: promiseWithoutAi(m.text), aiStatus: null };
  const { c, chat, before } = await contextFor(d, cfg, m);
  const zone = userZone(cfg);
  const today = localToday(m.createdAt, zone);
  const weekday = Temporal.PlainDate.from(today).toLocaleString("en-US", { weekday: "long" });
  const names = (chat?.members ?? []).map((x) => x.displayName).filter((n): n is string => !!n);
  const r = await ai.run<PromiseAnswer>(
    { name: PROMISE_TASK, client: m.clientKey, instructions: PROMISE_INSTRUCTIONS },
    contextText(c, { today: `${today} (${weekday})`, people_in_chat: names }),
    PROMISE_SCHEMA,
  );
  if (!r.ok) return { draft: promiseWithoutAi(m.text), aiStatus: r.error instanceof AiError ? r.error.kind : "provider" };
  const draft = promiseFrom(r.value, { messageDay: today, offeredIds: before.map((x) => x.messageId), names });
  return draft ? { draft, aiStatus: "sorted" } : null;
}
