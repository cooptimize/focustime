// T-2 and shared polling (D515): client chats (Settings > Clients) and the Microsoft permissions list (Settings >
// Connections). Read only against Teams: chat names and members through the person's own sign-in (Chat.ReadBasic). A
// chat is registered once for a client, for everyone (client_chats), by any Cooptimizer who follows the client and is
// a member of the chat, who allows Chat.Read when they do (the job may read it with their sign-in); every add, label
// and removal is logged with who did it (client_chat_changes). A registered chat is shown only to members of it who
// follow its client. Labelled Delivery team or Customer collaboration (suggested from its members, changeable).
// Members are read again once a day by the poll job, when the Clients section opens, or on Refresh. Nothing here logs a
// chat or a person.
import { CHAT_ID, CHAT_KINDS, chatName, flagMembers, isExternal, kindWarning, membersStale, suggestKind, teamsLink, type ChatAccess, type ChatKind, type ChatPickerData, type ChatsData, type ChatSummary, type DeliveryChatView } from "../plan/chats.ts";
import type { ClientChat } from "../plan/requests.ts";
import type { TeamsStore } from "../store/teams-store.ts";
import { chatStatus } from "./request-actions.ts";
export type { ChatAccess, ChatPickerData, ChatsData, DeliveryChatView } from "../plan/chats.ts";
import { permissionRows, type PermissionRow } from "../plan/permissions.ts";
import { HttpError, NetworkError } from "../sources/calendar/http.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { PlanError } from "../store/plan-store.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import { mapSeq } from "./seq.ts";
import type { ActionResponse } from "./types.ts";

export type ChatAction = "chats.registered" | "chats.list" | "chats.add" | "chats.remove" | "chats.kind" | "chats.reading" | "chats.social" | "chats.refresh" | "permissions.status";

export type ChatContext = {
  plan?: PlanStore | undefined;
  /** The shared registration (absent: client chats aren't available here). */
  teams?: TeamsStore | undefined;
  /** The person's Entra object id (from their sign-in), or null. */
  me: () => Promise<string | null>;
  /** D522: whether they may add, relabel and remove chats (actions/admin.ts). Absent: nobody may. */
  isAdmin?: () => Promise<boolean>;
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

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });

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

function view(c: ClientChat, clientName: string, home: string | null, error: string | null): DeliveryChatView {
  const members = c.members && home ? flagMembers(c.members, home) : null;
  const kind = c.kind;
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
    registeredBy: c.members?.find((m) => m.userId?.toLowerCase() === c.registeredBy.toLowerCase())?.displayName ?? null,
    readOn: c.readOn,
    social: !!c.social,
    poll: chatStatus(c, clientName),
  };
}

/** Reads the members of these chats again and stores them; returns each chat's error, if any. */
async function refreshMembers(ctx: ChatContext, teams: TeamsStore, chats: readonly ClientChat[]): Promise<{ errors: Map<string, string>; reason: ChatAccess | null }> {
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
      await teams.setMembers(c.chatId, members, ctx.now());
    } catch (e) {
      const a = e instanceof HttpError && e.status === 404 ? null : accessOf(e);
      if (a === "consent" || a === "signed_out") reason = a;
      errors.set(c.chatId, a ? ACCESS_TEXT[a] : "You aren't in this chat any more, or it was deleted");
    }
  });
  return { errors, reason };
}

/** The registered chats this person sees: the store's view (chats they're in now, D521) of clients they follow (D515). */
async function mine(ctx: ChatContext, teams: TeamsStore): Promise<ClientChat[]> {
  const me = await ctx.me();
  if (!me) return [];
  const followed = await ctx.clientKeys().catch(() => null);
  return (await teams.viewer(me).chats()).filter((c) => !followed || followed.has(c.clientKey));
}

/**
 * The registered chats as views. `refresh`: false reads nothing; "stale" reads the members of chats not read in the
 * last day (the Clients section opening); "all" or a client key reads them all, or that client's (Refresh).
 */
async function registered(ctx: ChatContext, teams: TeamsStore, refresh: false | "stale" | "all" | { clientKey: string }, names: (k: string) => string = (k) => k): Promise<ChatsData> {
  const home = await ctx.homeTenant();
  let chats = await mine(ctx, teams);
  let errors = new Map<string, string>();
  let reason: ChatAccess | null = ctx.account?.chats ? null : "signed_out";
  const due = !refresh ? [] : refresh === "all" ? chats : refresh === "stale" ? chats.filter((c) => membersStale(c, ctx.now())) : chats.filter((c) => c.clientKey === refresh.clientKey);
  if (due.length) {
    const r = await refreshMembers(ctx, teams, due);
    errors = r.errors;
    reason = r.reason;
    chats = await mine(ctx, teams);
  }
  return { available: reason === null, reason, homeTenant: home, chats: chats.map((c) => view(c, names(c.clientKey), home, errors.get(c.chatId) ?? null)), admin: (await ctx.isAdmin?.()) ?? false };
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
  const teams = ctx.teams;
  if (!teams) return bad("Client chats aren't available here", 503);
  // D522: registering is an admin's (one check, moving to the admin console next); reading is decided per chat.
  const ADMIN_ONLY: readonly string[] = ["chats.list", "chats.add", "chats.kind", "chats.reading", "chats.social", "chats.remove"];
  if (ADMIN_ONLY.includes(action) && !((await ctx.isAdmin?.()) ?? false)) return bad("Only a FocusTime admin adds or changes client chats", 403, "admin");
  try {
    switch (action) {
      case "chats.registered": {
        const o = only(input, ["refresh"]);
        if (!o || (o.refresh !== undefined && typeof o.refresh !== "boolean")) return bad("chats.registered takes { refresh? }");
        return { ok: true, data: await registered(ctx, teams, o.refresh ? "stale" : false) };
      }
      case "chats.refresh": {
        const o = only(input, ["clientKey"]);
        if (!o || (o.clientKey !== undefined && typeof o.clientKey !== "string")) return bad("chats.refresh takes { clientKey? }");
        return { ok: true, data: await registered(ctx, teams, typeof o.clientKey === "string" ? { clientKey: o.clientKey } : "all") };
      }
      case "chats.list": {
        if (!only(input, [])) return bad("chats.list takes {}");
        const home = await ctx.homeTenant();
        const client = ctx.account?.chats;
        if (!client) return { ok: true, data: { available: false, reason: "signed_out", homeTenant: home, chats: [], taken: {} } satisfies ChatPickerData };
        try {
          const chats = await client.groupChats();
          // Which of my own chats are registered already, by anyone and for which client (a chat belongs to one client).
          // Only chats Teams lists for me: nothing about chats I'm not in.
          const ids = new Set(chats.map((c) => c.id));
          const taken = Object.fromEntries((await teams.chats()).filter((c) => ids.has(c.chatId)).map((c) => [c.chatId, c.clientKey]));
          return { ok: true, data: { available: true, reason: null, homeTenant: home, chats, taken } satisfies ChatPickerData };
        } catch (e) {
          return { ok: true, data: { available: false, reason: accessOf(e), homeTenant: home, chats: [], taken: {} } satisfies ChatPickerData };
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
        const me = await ctx.me();
        if (!me) return bad(ACCESS_TEXT.signed_out, 409);
        // The registering person allows Chat.Read (D515): the job reads the chat with their sign-in first.
        const probe = ctx.account?.probe ? await ctx.account.probe("messages").catch(() => null) : null;
        if (!probe || probe.state === "signed_out") return bad(ACCESS_TEXT.signed_out, 409, "signed_out");
        if (probe.state !== "granted") return bad("Allow FocusTime to read the messages in chats you register (Chat.Read). Microsoft asks you once", 409, "consent");
        // The kind given, or the one its members suggest (anyone from outside Cooptimize: Customer collaboration).
        const home = await ctx.homeTenant();
        const kind = (o.kind as ChatKind | undefined) ?? (home ? suggestKind(chat.members, home) : "delivery");
        // The whole member list (the expanded one stops at 25); the picker's when it can't be read.
        const members = await client.members(chat.id).catch(() => (chat.moreMembers ? null : chat.members));
        await teams.viewer(me).addChat({ chatId: chat.id, clientKey: o.clientKey, kind, displayName: chatName(chat), webUrl: chat.webUrl, members });
        return { ok: true, data: await registered(ctx, teams, false) };
      }
      case "chats.kind": {
        const o = only(input, ["chatId", "kind"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || !CHAT_KINDS.includes(o.kind as ChatKind)) return bad("chats.kind takes { chatId, kind }");
        const c = (await mine(ctx, teams)).find((x) => x.chatId === o.chatId);
        if (!c) return bad("That chat isn't registered for one of your clients", 404);
        await teams.viewer((await ctx.me())!).setKind(o.chatId, o.kind as ChatKind);
        return { ok: true, data: await registered(ctx, teams, false) };
      }
      case "chats.reading": {
        // D523: whether the job reads this chat, decided centrally (an admin), never per person.
        const o = only(input, ["chatId", "on"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || typeof o.on !== "boolean") return bad("chats.reading takes { chatId, on }");
        const c = (await mine(ctx, teams)).find((x) => x.chatId === o.chatId);
        if (!c) return bad("That chat isn't registered for one of your clients", 404);
        await teams.viewer((await ctx.me())!).setReading(o.chatId, o.on);
        return { ok: true, data: await registered(ctx, teams, false) };
      }
      case "chats.social": {
        // IB-1: a Social chat skips the AI pass entirely; decided centrally by an admin, for everyone on the chat.
        const o = only(input, ["chatId", "on"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId) || typeof o.on !== "boolean") return bad("chats.social takes { chatId, on }");
        const c = (await mine(ctx, teams)).find((x) => x.chatId === o.chatId);
        if (!c) return bad("That chat isn't registered for one of your clients", 404);
        await teams.viewer((await ctx.me())!).setSocial(o.chatId, o.on);
        return { ok: true, data: await registered(ctx, teams, false) };
      }
      case "chats.remove": {
        const o = only(input, ["chatId"]);
        if (!o || typeof o.chatId !== "string" || !CHAT_ID.test(o.chatId)) return bad("chats.remove takes { chatId }");
        const c = (await mine(ctx, teams)).find((x) => x.chatId === o.chatId);
        if (!c) return bad("That chat isn't registered for one of your clients", 404);
        await teams.viewer((await ctx.me())!).removeChat(o.chatId);
        return { ok: true, data: await registered(ctx, teams, false) };
      }
    }
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}
