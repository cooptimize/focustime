// LP-1: Close the loop's sends through Microsoft Graph, delegated, as the signed-in person (never the Teams bot, never
// app-only). Only these requests exist; nothing else here can post, send, edit or delete:
// - Teams, a 1:1 chat: POST /chats (oneOnOne, me and them; Graph returns the chat that already exists, never a second
//   one), on the send token (Chat.Create).
// - Teams, a message: POST /chats/{id}/messages (ChatMessage.Send), into the delivery chat the ask came from or that
//   1:1 chat; read back with GET /chats/{id}/messages/{id} (Chat.Read, the person's own consent from AP-1).
// - Email, a draft: POST /me/messages with Prefer: IdType="ImmutableId" (Mail.ReadWrite), so the id stays the same
//   once it is sent and moves to Sent Items; read back with GET /me/messages/{id}.
// - Email, send now: that draft, then POST /me/messages/{id}/send (Mail.Send), then the same read back (isDraft false).
// Logs carry the op, the status and the duration: never a chat id, an address, a subject, a message or an id.
// Docs (checked Nov 7, 2026): learn.microsoft.com/graph/api/chat-post, chat-post-messages, chatmessage-get,
// user-post-messages, message-send, outlook-immutable-id; permissions-reference.
import type { Logger } from "../../log/logger.ts";
import { CHAT_ID } from "../../plan/chats.ts";
import { AuthFailure } from "../oauth/oauth.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const IMMUTABLE = 'IdType="ImmutableId"';
const ID = /^[A-Za-z0-9_=+/-]{1,400}$/;
const USER = /^[A-Za-z0-9._@-]{1,200}$/;

/**
 * Why a send didn't happen, in plain words the page can show. consent: the person hasn't allowed this yet (or the
 * tenant asks an admin to); forbidden: Graph refused it (a policy, a chat I'm not in); network: no answer; error: anything else.
 */
export type SendFailureKind = "consent" | "forbidden" | "not_found" | "network" | "throttled" | "error";
export class SendFailure extends Error {
  readonly kind: SendFailureKind;
  constructor(kind: SendFailureKind, message: string) {
    super(message);
    this.name = "SendFailure";
    this.kind = kind;
  }
}

export type SendDeps = {
  fetch: typeof fetch;
  /** ChatMessage.Send and Chat.Create (the incremental consent teams_send). */
  chatToken: () => Promise<string>;
  /** Chat.Read (AP-1's consent), for the read back only. */
  chatReadToken: () => Promise<string>;
  /** Mail.ReadWrite (mail_draft): the draft and the read back. */
  mailToken: () => Promise<string>;
  /** Mail.Send (mail_send). */
  mailSendToken: () => Promise<string>;
  invalidate: () => void;
  log: Logger;
  timeoutMs?: number;
};

export type SendClient = {
  /** The 1:1 chat between me and them (theirs: an Entra object id or UPN), made if there isn't one. */
  oneOnOne: (me: string, them: string) => Promise<string>;
  /** Posts into a chat as me; Graph's message id. */
  post: (chatId: string, html: string) => Promise<string>;
  /** The message as Teams has it now, or null when Teams doesn't show it (yet). `unchecked`: I haven't allowed Chat.Read. */
  readMessage: (chatId: string, messageId: string) => Promise<{ found: boolean; unchecked?: boolean }>;
  /** A draft in my Drafts folder: its immutable id and Outlook's link to it. */
  draft: (m: { to: { address: string; name: string }; subject: string; html: string }) => Promise<{ id: string; webLink: string | null }>;
  /** Sends a draft (it moves to Sent Items). */
  send: (id: string) => Promise<void>;
  /** The message now: still a draft, sent (with when), or not found. */
  readMail: (id: string) => Promise<{ state: "draft" | "sent" | "missing"; webLink: string | null; sentAt: string | null }>;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);

export function createSendClient(d: SendDeps): SendClient {
  async function token(get: () => Promise<string>): Promise<string> {
    try {
      return await get();
    } catch (e) {
      if (e instanceof AuthFailure && e.kind === "consent") throw new SendFailure("consent", "FocusTime isn't allowed to send this for you yet");
      if (e instanceof AuthFailure && (e.kind === "not_connected" || e.kind === "expired")) throw new SendFailure("consent", "Sign in to Microsoft again to send from FocusTime");
      if (e instanceof AuthFailure && e.kind === "network") throw new SendFailure("network", "Microsoft didn't answer. Nothing was sent");
      throw new SendFailure("error", "FocusTime couldn't get access to send this");
    }
  }

  async function req(op: string, get: () => Promise<string>, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}, retried = false): Promise<{ status: number; json: Obj | null }> {
    const t = await token(get);
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: `Bearer ${t}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(d.timeoutMs ?? 20_000),
      });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new SendFailure("network", "Microsoft didn't answer");
    }
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return req(op, get, method, url, body, extra, true);
    }
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
    if (res.status === 202 || res.status === 204) {
      await res.body?.cancel();
      return { status: res.status, json: null };
    }
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 401) throw new SendFailure("consent", "Microsoft refused FocusTime's access. Sign in again");
      if (res.status === 403) throw new SendFailure("forbidden", "Microsoft refused it. Your organization may not allow sending from apps, or you're not in that chat");
      if (res.status === 404) throw new SendFailure("not_found", "Microsoft couldn't find it");
      if (res.status === 429 || res.status === 503) throw new SendFailure("throttled", "Microsoft is busy. Try again in a minute");
      throw new SendFailure("error", `Microsoft answered ${res.status}`);
    }
    return { status: res.status, json: obj(await res.json().catch(() => null)) };
  }

  const userBind = (id: string) => `${GRAPH}/users('${encodeURIComponent(id)}')`;
  const member = (id: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": userBind(id) });

  return {
    async oneOnOne(me, them) {
      if (!USER.test(me) || !USER.test(them)) throw new SendFailure("error", "That person can't be reached in Teams from here");
      const r = await req("loop_chat", d.chatToken, "POST", `${GRAPH}/chats`, { chatType: "oneOnOne", members: [member(me), member(them)] });
      const id = typeof r.json?.id === "string" ? r.json.id : null;
      if (!id || !CHAT_ID.test(id)) throw new SendFailure("error", "Teams didn't return the chat");
      return id;
    },
    async post(chatId, html) {
      if (!CHAT_ID.test(chatId)) throw new SendFailure("error", "Not a Teams chat");
      const r = await req("loop_post", d.chatToken, "POST", `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages`, { body: { contentType: "html", content: html } });
      const id = typeof r.json?.id === "string" && /^\d{1,20}$/.test(r.json.id) ? r.json.id : null;
      if (!id) throw new SendFailure("error", "Teams didn't say the message was posted");
      return id;
    },
    async readMessage(chatId, messageId) {
      if (!CHAT_ID.test(chatId) || !/^\d{1,20}$/.test(messageId)) return { found: false };
      try {
        const r = await req("loop_post_read", d.chatReadToken, "GET", `${GRAPH}/chats/${encodeURIComponent(chatId)}/messages/${messageId}`);
        return { found: r.json?.id === messageId && !r.json?.deletedDateTime };
      } catch (e) {
        if (e instanceof SendFailure && e.kind === "consent") return { found: false, unchecked: true };
        if (e instanceof SendFailure && e.kind === "not_found") return { found: false };
        throw e;
      }
    },
    async draft(m) {
      const r = await req("loop_draft", d.mailToken, "POST", `${GRAPH}/me/messages`, {
        subject: m.subject,
        body: { contentType: "HTML", content: m.html },
        toRecipients: [{ emailAddress: { address: m.to.address, name: m.to.name } }],
      }, { prefer: IMMUTABLE });
      const id = typeof r.json?.id === "string" && ID.test(r.json.id) ? r.json.id : null;
      if (!id) throw new SendFailure("error", "Outlook didn't return the draft");
      const link = typeof r.json?.webLink === "string" && /^https:\/\//.test(r.json.webLink) ? r.json.webLink : null;
      return { id, webLink: link };
    },
    async send(id) {
      if (!ID.test(id)) throw new SendFailure("error", "Not an Outlook message");
      await req("loop_send", d.mailSendToken, "POST", `${GRAPH}/me/messages/${encodeURIComponent(id)}/send`, undefined, { prefer: IMMUTABLE });
    },
    async readMail(id) {
      if (!ID.test(id)) return { state: "missing", webLink: null, sentAt: null };
      try {
        const r = await req("loop_mail_read", d.mailToken, "GET", `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=id,isDraft,sentDateTime,webLink`, undefined, { prefer: IMMUTABLE });
        const link = typeof r.json?.webLink === "string" && /^https:\/\//.test(r.json.webLink) ? r.json.webLink : null;
        const sentAt = typeof r.json?.sentDateTime === "string" ? r.json.sentDateTime : null;
        return { state: r.json?.isDraft === false ? "sent" : "draft", webLink: link, sentAt };
      } catch (e) {
        if (e instanceof SendFailure && e.kind === "not_found") return { state: "missing", webLink: null, sentAt: null };
        throw e;
      }
    },
  };
}
