// T-2: Teams group chats through Microsoft Graph, delegated, on the chats token (Chat.ReadBasic: names and members of
// my chats, no messages). Read only. AP-1: a registered chat's new messages, on its own token (Chat.Read), only for
// chats with Read for asks on.
// - My group chats: GET /me/chats?$expand=members (50 a page, at most MAX_PAGES pages), group chats kept, the rest
//   dropped. lastMessagePreview is never asked for: it carries message text.
// - One chat's members: GET /chats/{id}/members (the whole list; the expanded one stops at 25).
// From answers only ids, topic, webUrl, the two times and each member's userId, displayName, email, tenantId and guest
// role are kept.
// - AP-1, a chat's messages changed after a time: GET /chats/{id}/messages?$orderby=lastModifiedDateTime desc&$filter=
//   lastModifiedDateTime gt <time>&$top=50 (Graph needs the order and the filter on the same property), at most
//   MESSAGE_PAGES pages. CW-1: the call started and ended system events among them come back apart (plan/cowork.ts).
//   From each message only the fields the shared store keeps (D514): ids, sender id, name and tenant, times, the raw
//   body and its plain text, attachment flags, the reply id and the mentions (ids and names).
// - CV-2, one pasted image: GET /chats/{id}/messages/{id}/hostedContents/{id}/$value (raw bytes, Chat.Read), read up
//   to 10 MB; the bytes go only to the stripper and the shared store, never to a log.
// Logs carry the op, status, count and duration: never a chat id, a topic, a person or message text.
import type { Logger } from "../../log/logger.ts";
import { plainText, type IncomingMessage } from "../../plan/asks.ts";
import { MAX_IMAGE_BYTES } from "../../plan/image-strip.ts";
import { bodyKind } from "../../plan/sanitize.ts";
import { CHAT_ID, type ChatMember, type ChatSummary } from "../../plan/chats.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";
import { callEventOf, type CallEvent } from "../../plan/cowork.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Pages of 50 chats read at most (500 chats, the most recently changed first as Graph lists them). */
export const MAX_PAGES = 10;
/** Graph's cap on members in an expanded chat list. */
const EXPANDED_MEMBERS = 25;

/** Pages of 50 messages read at most per chat and read (250 messages changed since the last read). */
export const MESSAGE_PAGES = 5;

export type ChatsDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };
export type ChatsClient = {
  groupChats: () => Promise<ChatSummary[]>;
  members: (chatId: string) => Promise<ChatMember[]>;
};
/** AP-1: the newest messages of one chat (Chat.Read), oldest first, and the newest lastModifiedDateTime among them. */
export type ChatMessagesClient = {
  /** CW-1: `calls` are the call started and ended events among the same pages (never messages; no request of their own). */
  messagesSince: (chatId: string, clientKey: string, sinceIso: string) => Promise<{ messages: GraphMessage[]; newest: string | null; calls?: CallEvent[] }>;
  /** CV-2: one image pasted into a message, its raw bytes (at most MAX_IMAGE_BYTES; "too big" past that). */
  hostedContent?: (chatId: string, messageId: string, hostedId: string) => Promise<{ bytes: Uint8Array } | { tooBig: true }>;
};
/** CV-2: a message id and a hosted content id as Graph writes them (digits; base64 with its URL-safe letters). */
const MESSAGE_ID = /^\d{1,20}$/;
const HOSTED_ID = /^[A-Za-z0-9+/=_-]{1,1500}$/;
/**
 * A message as read: the fields the rules use, plus what the shared store keeps (the raw body, the sender's name, the
 * mentions with names, Graph's lastModifiedDateTime). The last three are optional for the older per-person path.
 */
export type GraphMessage = IncomingMessage & { modifiedAt: string; html?: string | null; authorName?: string | null; mentions?: { id: string; name: string | null; at?: number }[]; reactions?: { emoji: string; count: number }[] };

/** CV-2: Graph's older named reactions as the emoji Teams shows. */
const NAMED_REACTION: Record<string, string> = { like: "👍", heart: "❤️", laugh: "😆", surprised: "😮", sad: "😢", angry: "😡" };
/**
 * CV-2: a message's reactions as counts per emoji, never who reacted (the user is never read). A unicode reactionType
 * is kept as it is; the named ones become their emoji; custom ones (a hosted picture) are left out.
 */
export function reactionsOf(v: unknown): { emoji: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const x of Array.isArray(v) ? v : []) {
    const t = str(obj(x)?.reactionType, 32);
    if (!t) continue;
    const named = NAMED_REACTION[t.toLowerCase()];
    const emoji = named ?? (t.toLowerCase() === "custom" || /^[\p{L}\p{N}_ -]+$/u.test(t) ? null : t);
    if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }
  return [...counts].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count).slice(0, 12);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown, max = 400) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** A member from Graph (aadUserConversationMember): the four fields T-2 uses, and whether its roles include guest. */
export function memberOf(v: unknown): ChatMember | null {
  const m = obj(v);
  if (!m) return null;
  const guest = Array.isArray(m.roles) && m.roles.some((r) => typeof r === "string" && r.toLowerCase() === "guest");
  return { userId: str(m.userId, 64), displayName: str(m.displayName, 200), email: str(m.email, 320), tenantId: str(m.tenantId, 64), ...(guest ? { guest: true } : {}) };
}

/** A chat from Graph, or null when it isn't a group chat we can use. */
export function chatOf(v: unknown): ChatSummary | null {
  const c = obj(v);
  if (!c || c.chatType !== "group") return null;
  const id = str(c.id, 256);
  if (!id || !CHAT_ID.test(id)) return null;
  const members = Array.isArray(c.members) ? c.members.map(memberOf).filter((m): m is ChatMember => !!m) : [];
  return {
    id,
    topic: str(c.topic),
    webUrl: str(c.webUrl, 2000),
    lastUpdated: str(c.lastUpdatedDateTime, 40),
    lastRead: str(obj(c.viewpoint)?.lastMessageReadDateTime, 40),
    members,
    moreMembers: members.length >= EXPANDED_MEMBERS,
  };
}

/**
 * AP-1: a message from Graph (chatMessage), or null for what isn't a person's message (system events, deleted ones).
 * Only the fields Asks stores, plus the user ids it mentions.
 */
export function messageOf(v: unknown, chatId: string, clientKey: string): GraphMessage | null {
  const m = obj(v);
  if (!m || m.messageType !== "message" || m.deletedDateTime) return null;
  const id = str(m.id, 64);
  const created = str(m.createdDateTime, 40);
  if (!id || !/^[0-9A-Za-z_\-.:]{1,64}$/.test(id) || !created || Number.isNaN(Date.parse(created))) return null;
  const user = obj(obj(m.from)?.user);
  const body = obj(m.body);
  const html = typeof body?.content === "string" ? body.content : "";
  const attachments = Array.isArray(m.attachments) ? m.attachments.map(obj).filter((a): a is Obj => !!a) : [];
  const type = (a: Obj) => (typeof a.contentType === "string" ? a.contentType.toLowerCase() : "");
  // An emoji, a GIF or a sticker isn't an image someone attached (CV-1's chatter rules look at those).
  const kind = bodyKind(html);
  const hasImage = kind.hostedImages + kind.otherImages > 0 || attachments.some((a) => type(a).startsWith("image/"));
  // Shared files are "reference"; cards (application/vnd.microsoft.card.*) and quoted replies ("messageReference") aren't files.
  const hasFile = attachments.some((a) => type(a) === "reference" || type(a) === "file" || (type(a).startsWith("application/") && !type(a).startsWith("application/vnd.microsoft.card.")));
  const mentions = (Array.isArray(m.mentions) ? m.mentions : []).flatMap((x, i) => {
    const u = obj(obj(obj(x)?.mentioned)?.user);
    const id = str(u?.id, 64);
    const at = typeof obj(x)?.id === "number" ? (obj(x)!.id as number) : i;
    return id ? [{ id, name: str(u?.displayName, 200) ?? str(obj(x)?.mentionText, 200), at }] : [];
  });
  // CV-1: a reply or quote in a group chat. Graph's replyToId is for channels only; in a chat the quoted message comes as
  // an attachment of type messageReference whose id (and content's messageId) is the quoted message's id. Not in the
  // chatMessageAttachment docs (they list forwardedMessageReference); read defensively, and a forward isn't a reply.
  const quoted = attachments.flatMap((a) => {
    if (type(a) !== "messagereference") return [];
    let ref: string | null = null;
    try {
      ref = str(obj(JSON.parse(typeof a.content === "string" ? a.content : "null"))?.messageId, 64);
    } catch {
      ref = null;
    }
    return [ref ?? str(a.id, 64)].filter((x): x is string => !!x && /^[0-9A-Za-z_\-.:]{1,64}$/.test(x));
  });
  const isHtml = typeof body?.contentType !== "string" || body.contentType.toLowerCase() === "html";
  const escText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").split(/\r?\n/).join("<br>");
  return {
    chatId,
    messageId: id,
    clientKey,
    authorId: str(user?.id, 64),
    authorTenant: str(user?.tenantId, 64),
    createdAt: new Date(created).toISOString(),
    modifiedAt: new Date(str(m.lastModifiedDateTime, 40) ?? created).toISOString(),
    text: plainText(html, typeof body?.contentType === "string" ? body.contentType : null).slice(0, 28_000),
    hasImage,
    hasFile,
    replyToId: str(m.replyToId, 64) ?? quoted[0] ?? null,
    mentionedUserIds: mentions.map((x) => x.id),
    html: (isHtml ? html : escText(html)).slice(0, 64_000) || null,
    authorName: str(user?.displayName, 200),
    mentions,
    reactions: reactionsOf(m.reactions),
  };
}

/** Seconds from a Retry-After header (a number of seconds, or an HTTP date), or null. */
export function retryAfterOf(h: string | null, nowMs = Date.now()): number | null {
  if (!h) return null;
  if (/^\d+$/.test(h.trim())) return Number(h.trim());
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((t - nowMs) / 1000));
}

export function createChatsClient(d: ChatsDeps): ChatsClient & ChatMessagesClient {
  async function get(op: string, url: string, retried = false): Promise<Obj> {
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(d.timeoutMs ?? 15_000) });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return get(op, url, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
      throw new HttpError(res.status, res.status === 429 || res.status === 503 ? retryAfterOf(res.headers.get("retry-after")) : null);
    }
    const json = obj(await res.json().catch(() => null)) ?? {};
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started, count: Array.isArray(json.value) ? json.value.length : 0 });
    return json;
  }

  /** CV-2: raw bytes, read only up to the cap; the body is never logged, only the op, status and size. */
  async function bytes(op: string, url: string, retried = false): Promise<{ bytes: Uint8Array } | { tooBig: true }> {
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: "image/*", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(d.timeoutMs ?? 30_000) });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return bytes(op, url, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
      throw new HttpError(res.status, res.status === 429 || res.status === 503 ? retryAfterOf(res.headers.get("retry-after")) : null);
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      await res.body?.cancel();
      d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started, count: 0 });
      return { tooBig: true };
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    for (;;) {
      const chunk = reader ? await reader.read() : { done: true as const, value: undefined };
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_IMAGE_BYTES) {
        await reader!.cancel();
        d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started, count: 0 });
        return { tooBig: true };
      }
      parts.push(chunk.value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) (out.set(p, at), (at += p.length));
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started, count: 1 });
    return { bytes: out };
  }

  return {
    async hostedContent(chatId: string, messageId: string, hostedId: string) {
      if (!CHAT_ID.test(chatId) || !MESSAGE_ID.test(messageId) || !HOSTED_ID.test(hostedId)) throw new HttpError(400);
      return bytes("chat_image", `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages/${messageId}/hostedContents/${encodeURIComponent(hostedId)}/$value`);
    },
    async messagesSince(chatId: string, clientKey: string, sinceIso: string) {
      if (!CHAT_ID.test(chatId)) throw new HttpError(400);
      const since = new Date(sinceIso).toISOString();
      const out: GraphMessage[] = [];
      const calls: CallEvent[] = [];
      let newest: string | null = null;
      let url: string | null = `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages?$top=50&$orderby=lastModifiedDateTime desc&$filter=lastModifiedDateTime gt ${since}`;
      for (let page = 0; url && page < MESSAGE_PAGES; page++) {
        const json: Obj = await get("chat_messages", url);
        for (const v of Array.isArray(json.value) ? json.value : []) {
          const lm = str(obj(v)?.lastModifiedDateTime, 40);
          if (lm && !Number.isNaN(Date.parse(lm)) && (!newest || Date.parse(lm) > Date.parse(newest))) newest = new Date(lm).toISOString();
          const msg = messageOf(v, chatId, clientKey);
          if (msg) out.push(msg);
          // CW-1: a call started or ended event (a system message messageOf drops) is kept apart, never as a message.
          const call = msg ? null : callEventOf(v, chatId);
          if (call) calls.push(call);
        }
        const next = str(json["@odata.nextLink"], 4000);
        url = next && next.startsWith(`${GRAPH}/`) ? next : null;
      }
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      calls.sort((a, b) => a.at.localeCompare(b.at));
      return { messages: out, newest, calls };
    },
    async groupChats() {
      const out: ChatSummary[] = [];
      let url: string | null = `${GRAPH}/me/chats?$expand=members&$top=50`;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const json: Obj = await get("chats_list", url);
        for (const v of Array.isArray(json.value) ? json.value : []) {
          const c = chatOf(v);
          if (c) out.push(c);
        }
        const next = str(json["@odata.nextLink"], 4000);
        url = next && next.startsWith(`${GRAPH}/`) ? next : null;
      }
      return out;
    },
    async members(chatId) {
      if (!CHAT_ID.test(chatId)) throw new HttpError(400);
      const json = await get("chat_members", `${GRAPH}/chats/${encodeURIComponent(chatId)}/members`);
      return (Array.isArray(json.value) ? json.value : []).map(memberOf).filter((m): m is ChatMember => !!m);
    },
  };
}
