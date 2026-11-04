// T-2 and AP-1: client chats (Settings > Clients) and the Microsoft permissions list (Settings > Connections). Read only
// against Teams: chat names and members through the person's own sign-in (Chat.ReadBasic), never messages. A client
// can have several chats; a chat is registered for one client of one person, labelled Delivery team or Customer
// collaboration (suggested from its members, changeable). Members are cached in the plan store and read again once a
// day when the Clients section opens, or on Refresh; never on a timer. Nothing here logs a chat or a person.
import { CHAT_ID, CHAT_KINDS, chatName, flagMembers, isExternal, kindOf, kindWarning, membersStale, suggestKind, teamsLink, type ChatAccess, type ChatKind, type ChatPickerData, type ChatsData, type ChatSummary, type DeliveryChat, type DeliveryChatView } from "../plan/chats.ts";
export type { ChatAccess, ChatPickerData, ChatsData, DeliveryChatView } from "../plan/chats.ts";
import { permissionRows, type PermissionRow } from "../plan/permissions.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { PlanError } from "../store/plan-store.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import { mapSeq } from "./seq.ts";
import type { ActionResponse } from "./types.ts";

export type ChatAction = "chats.registered" | "chats.list" | "chats.add" | "chats.remove" | "chats.kind" | "chats.refresh" | "permissions.status";

export type ChatContext = {
  plan?: PlanStore | undefined;
  account: MicrosoftAccount | null;
  /** Cooptimize's tenant (the app's Entra tenant): members in any other are external. */
  homeTenant: () => Promise<string | null>;
  /** The person's clients (as Settings > Clients lists them); null when Dataverse couldn't be read. */
  clientKeys: () => Promise<ReadonlySet<string> | null>;
  now: () => string;
};

export type PermissionsData = { signedIn: boolean; rows: PermissionRow[] };

/** The most registered chats read again at once (Clients open or Refresh). */
const MAX_REFRESH = 40;

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });

export function accessOf(e: unknown): ChatAccess {
  if (e instanceof AuthFailure) return e.kind === "consent" ? "consent" : e.kind === "not_connected" || e.kind === "expired" ? "signed_out" : "unavailable";
  if (e instanceof HttpError) return e.status === 401 || e.status === 403 ? "consent" : "unavailable";
  if (e instanceof NetworkError) return "unavailable";
  return "unavailable";
}
const ACCESS_TEXT: Record<ChatAccess, string> = {
  signed_out: "Sign in with Microsoft to read your Teams chats",
  consent: "FocusTime isn't allowed to read your Teams chat names and members yet (Chat.ReadBasic)",
  unavailable: "Teams couldn't be reached. Try again in a moment",
};

function view(c: DeliveryChat, kind: ChatKind, home: string | null, error: string | null): DeliveryChatView {
  const members = c.members && home ? flagMembers(c.members, home) : null;
  return {
    clientKey: c.clientKey,
    chatId: c.chatId,
    displayName: c.displayName,
    kind,
    warning: home ? kindWarning(kind, c.members, home) : null,
    link: teamsLink(c),
    members,
    memberCount: c.members ? c.members.length : null,
    externalCount: c.members && home ? c.members.filter((m) => isExternal(m, home)).length : null,
    fetchedAt: c.membersFetchedAt,
    error,
    asks: { on: !!c.asks?.on, polledAt: c.asks?.polledAt ?? null, status: c.asks?.status ?? null },
  };
}

/** Reads the members of these chats again and stores them; returns each chat's error, if any. */
async function refreshMembers(ctx: ChatContext, plan: PlanStore, chats: readonly DeliveryChat[]): Promise<{ errors: Map<string, string>; reason: ChatAccess | null }> {
  const errors = new Map<string, string>();
  const client = ctx.account?.chats;
  if (!client) return { errors, reason: "signed_out" };
  let reason: ChatAccess | null = null;
  await mapSeq(chats.slice(0, MAX_REFRESH), async (c) => {
    if (reason === "consent" || reason === "signed_out") {
      errors.set(c.chatId, ACCESS_TEXT[reason]);
      return;
    }
    try {
      const members = await client.members(c.chatId);
      await plan.setDeliveryChatMembers(c.chatId, members, ctx.now());
    } catch (e) {
      const a = e instanceof HttpError && e.status === 404 ? null : accessOf(e);
      if (a === "consent" || a === "signed_out") reason = a;
      errors.set(c.chatId, a ? ACCESS_TEXT[a] : "You aren't in this chat any more, or it was deleted");
    }
  });
  return { errors, reason };
}

/**
 * The registered chats as views. `refresh`: false reads nothing; "stale" reads the members of chats not read in the
 * last day (the Clients section opening); "all" or a client key reads them all, or that client's (Refresh).
 */
async function registered(ctx: ChatContext, plan: PlanStore, refresh: false | "stale" | "all" | { clientKey: string }): Promise<ChatsData> {
  const home = await ctx.homeTenant();
  let chats = await plan.deliveryChats();
  let errors = new Map<string, string>();
  let reason: ChatAccess | null = ctx.account?.chats ? null : "signed_out";
  const due = !refresh ? [] : refresh === "all" ? chats : refresh === "stale" ? chats.filter((c) => membersStale(c, ctx.now())) : chats.filter((c) => c.clientKey === refresh.clientKey);
  if (due.length) {
    const r = await refreshMembers(ctx, plan, due);
    errors = r.errors;
    reason = r.reason;
    chats = await plan.deliveryChats();
  }
  return { available: reason === null, reason, homeTenant: home, chats: chats.map((c) => view(c, kindOf(c, home), home, errors.get(c.chatId) ?? null)) };
}

const only = (input: unknown, keys: readonly string[]): Record<string, unknown> | null => {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !keys.includes(k))) return null;
  return input as Record<string, unknown>;
};

export async function chatAction(ctx: ChatContext, action: ChatAction, input: unknown): Promise<ActionResponse> {
  if (action === "permissions.status") {
    if (!only(input, [])) return bad("permissions.status takes {}");
    const me = await storedIdentity(ctx.plan);
    const probe = ctx.account?.probe;
    if (!me || !probe) return { ok: true, data: { signedIn: false, rows: permissionRows([], false) } satisfies PermissionsData };
    const probes = await mapSeq(["read", "presence", "photo", "chats", "messages", "arm"] as const, (k) => probe(k));
    return { ok: true, data: { signedIn: true, rows: permissionRows(probes, true) } satisfies PermissionsData };
  }
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available", 503);
  try {
    switch (action) {
      case "chats.registered": {
        const o = only(input, ["refresh"]);
        if (!o || (o.refresh !== undefined && typeof o.refresh !== "boolean")) return bad("chats.registered takes { refresh? }");
        return { ok: true, data: await registered(ctx, plan, o.refresh ? "stale" : false) };
      }
      case "chats.refresh": {
        const o = only(input, ["clientKey"]);
        if (!o || (o.clientKey !== undefined && typeof o.clientKey !== "string")) return bad("chats.refresh takes { clientKey? }");
        return { ok: true, data: await registered(ctx, plan, typeof o.clientKey === "string" ? { clientKey: o.clientKey } : "all") };
      }
      case "chats.list": {
        if (!only(input, [])) return bad("chats.list takes {}");
        const home = await ctx.homeTenant();
        const taken = Object.fromEntries((await plan.deliveryChats()).map((c) => [c.chatId, c.clientKey]));
        const client = ctx.account?.chats;
        if (!client) return { ok: true, data: { available: false, reason: "signed_out", homeTenant: home, chats: [], taken } satisfies ChatPickerData };
        try {
          return { ok: true, data: { available: true, reason: null, homeTenant: home, chats: await client.groupChats(), taken } satisfies ChatPickerData };
        } catch (e) {
          return { ok: true, data: { available: false, reason: accessOf(e), homeTenant: home, chats: [], taken } satisfies ChatPickerData };
        }
      }
      case "chats.add": {
        const o = only(input, ["clientKey", "kind", "chatId"]);
        if (!o || typeof o.clientKey !== "string" || (o.kind !== undefined && !CHAT_KINDS.includes(o.kind as ChatKind)) || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId)) return bad("chats.add takes { clientKey, kind?, chatId }");
        const keys = await ctx.clientKeys();
        if (!keys) return bad("Dataverse couldn't be read, so FocusTime can't check the client. Try again in a moment", 503);
        if (!keys.has(o.clientKey)) return bad("That isn't one of your clients", 404);
        const client = ctx.account?.chats;
        if (!client) return bad(ACCESS_TEXT.signed_out, 409);
        // The name and link come from Teams, not from the request: the chat must be one of mine, and a group chat.
        let chat: ChatSummary | undefined;
        try {
          chat = (await client.groupChats()).find((c) => c.id === o.chatId);
        } catch (e) {
          return bad(ACCESS_TEXT[accessOf(e)], 409);
        }
        if (!chat) return bad("That isn't one of your Teams group chats", 404);
        // The kind given, or the one its members suggest (anyone from outside Cooptimize: Customer collaboration).
        const home = await ctx.homeTenant();
        const kind = (o.kind as ChatKind | undefined) ?? (home ? suggestKind(chat.members, home) : "delivery");
        const saved = await plan.addDeliveryChat(o.clientKey, kind, { chatId: chat.id, displayName: chatName(chat), webUrl: chat.webUrl });
        await refreshMembers(ctx, plan, [saved]);
        return { ok: true, data: await registered(ctx, plan, false) };
      }
      case "chats.kind": {
        const o = only(input, ["chatId", "kind"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || !CHAT_KINDS.includes(o.kind as ChatKind)) return bad("chats.kind takes { chatId, kind }");
        await plan.setDeliveryChatKind(o.chatId, o.kind as ChatKind);
        return { ok: true, data: await registered(ctx, plan, false) };
      }
      case "chats.remove": {
        const o = only(input, ["chatId"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId)) return bad("chats.remove takes { chatId }");
        await plan.removeDeliveryChat(o.chatId);
        return { ok: true, data: await registered(ctx, plan, false) };
      }
    }
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
