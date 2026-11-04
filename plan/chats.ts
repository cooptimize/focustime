// T-2 and AP-1: a client's Teams chats, the pure rules. A person registers group chats for a client (Settings > Clients),
// as many as it has (AP-1); a chat belongs to one client. Each is labelled with a kind (T-2.1): a Delivery team chat
// (the internal Cooptimize team) or a Customer collaboration chat (the team with the client's key people), suggested
// from its members and changeable. A member is external when their Entra tenant isn't Cooptimize's, by tenantId (or a
// guest role in the chat): never by name, email domain or a list of people. A member with no tenantId can't be shown to
// be Cooptimize's, so it counts as external too. Nothing here reads or keeps message content.

/** A group chat as the picker lists it. `members` is Graph's expanded list (at most 25); `memberCount` its length. */
export type ChatSummary = {
  id: string;
  topic: string | null;
  webUrl: string | null;
  /** The chat was renamed or its members changed (Graph lastUpdatedDateTime). */
  lastUpdated: string | null;
  /** When I last read it (Graph viewpoint.lastMessageReadDateTime), a content-free sign of activity. */
  lastRead: string | null;
  members: ChatMember[];
  /** True when Graph cut the expanded list at 25. */
  moreMembers: boolean;
};

export type ChatMember = {
  userId: string | null;
  displayName: string | null;
  email: string | null;
  tenantId: string | null;
  /** Graph's roles include "guest" (a B2B guest in the chat). Absent on members cached before AP-1. */
  guest?: boolean;
};
export type FlaggedMember = ChatMember & { external: boolean };

/** The two kinds of client chat (T-2.1). */
export type ChatKind = "delivery" | "customer";
export const CHAT_KINDS: readonly ChatKind[] = ["delivery", "customer"];
export const KIND_NAME: Record<ChatKind, string> = { delivery: "Delivery team", customer: "Customer collaboration" };
export const KIND_HINT: Record<ChatKind, string> = {
  delivery: "The internal Cooptimize team chat",
  customer: "The chat with the Cooptimize team and the client's key people",
};

/** A registered client chat, as stored per person and client. `kind` is null on rows saved before T-2.1. */
export type DeliveryChat = {
  clientKey: string;
  chatId: string;
  displayName: string;
  webUrl: string | null;
  kind: ChatKind | null;
  /** The cached members (null until first read) and when they were read. */
  members: ChatMember[] | null;
  membersFetchedAt: string | null;
  /** AP-1: Read for asks (off unless switched on). */
  asks?: import("./asks.ts").AsksState;
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Teams chat id: 19:<thread>@thread.v2 (or the older @thread.skype, and @unq.gbl.spaces for one-on-one). */
export const CHAT_ID = /^19:[A-Za-z0-9_\-.]{1,200}@(thread\.v2|thread\.skype|unq\.gbl\.spaces)$/;

/** External: not in my organization's tenant (or no tenant to tell), or a guest in the chat whatever its tenant. */
export function isExternal(m: Pick<ChatMember, "tenantId" | "guest">, homeTenant: string): boolean {
  if (!GUID.test(homeTenant)) throw new Error("homeTenant must be a tenant id");
  return !!m.guest || !m.tenantId || m.tenantId.toLowerCase() !== homeTenant.toLowerCase();
}

/** Members with the external flag, Cooptimize people first, then by name. */
export function flagMembers(members: readonly ChatMember[], homeTenant: string): FlaggedMember[] {
  return members
    .map((m) => ({ ...m, external: isExternal(m, homeTenant) }))
    .sort((a, b) => Number(a.external) - Number(b.external) || nameOf(a).localeCompare(nameOf(b)));
}

/** The kind a chat's members suggest: anyone from outside Cooptimize makes it the customer chat. By tenant only. */
export function suggestKind(members: readonly ChatMember[], homeTenant: string): ChatKind {
  return members.some((m) => isExternal(m, homeTenant)) ? "customer" : "delivery";
}

/** A plain line when a chat's members don't fit its kind, or null. */
export function kindWarning(kind: ChatKind, members: readonly ChatMember[] | null, homeTenant: string): string | null {
  if (!members) return null;
  const external = members.filter((m) => isExternal(m, homeTenant)).length;
  if (kind === "delivery" && external > 0) return `${external} ${external === 1 ? "person" : "people"} from outside Cooptimize ${external === 1 ? "is" : "are"} in this internal chat`;
  if (kind === "customer" && external === 0) return "No one from outside Cooptimize is in this chat";
  return null;
}

/** A chat's kind: the one stored, or (a row from before T-2.1) the one its members suggest. */
export function kindOf(c: Pick<DeliveryChat, "kind" | "members">, homeTenant: string | null): ChatKind {
  return c.kind ?? (c.members && homeTenant ? suggestKind(c.members, homeTenant) : "delivery");
}

/** Members are read again once a day (or on Refresh): the cache is stale when never read or older than this. */
export const MEMBERS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const membersStale = (c: Pick<DeliveryChat, "membersFetchedAt">, nowIso: string): boolean =>
  !c.membersFetchedAt || Date.parse(nowIso) - Date.parse(c.membersFetchedAt) >= MEMBERS_MAX_AGE_MS;

export const nameOf = (m: Pick<ChatMember, "displayName" | "email">) => m.displayName?.trim() || m.email || "Unknown person";

/** The chat's name: its topic, or its members' first names ("Ana, Ben, Carla +3") when it has none. */
export function chatName(c: Pick<ChatSummary, "topic" | "members" | "moreMembers">): string {
  if (c.topic?.trim()) return c.topic.trim();
  const names = c.members.map((m) => nameOf(m).split(/\s+/)[0]!).filter(Boolean);
  if (!names.length) return "Group chat";
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length - 3;
  return extra > 0 ? `${shown} +${extra}${c.moreMembers ? "+" : ""}` : c.moreMembers ? `${shown} and more` : shown;
}

/** One line under the name: who's in it, by count, with external people counted. */
export function memberLine(members: readonly ChatMember[], homeTenant: string, more = false): string {
  const external = members.filter((m) => isExternal(m, homeTenant)).length;
  const n = `${members.length}${more ? "+" : ""}`;
  return `${n} ${members.length === 1 && !more ? "member" : "members"}${external ? ` · ${external} external` : ""}`;
}

/** The newer of the chat's change time and my last read, for "last activity" and the picker's order. */
export const activityOf = (c: Pick<ChatSummary, "lastUpdated" | "lastRead">): string | null => [c.lastUpdated, c.lastRead].filter((x): x is string => !!x).sort().at(-1) ?? null;

/**
 * The picker's list: group chats matching the search (every word, in the name or a member's name, any case), most
 * recently active first; with `prefer`, the chats whose members suggest that kind come first. Chats already
 * registered are left out: a chat belongs to one client.
 */
export function filterChats(chats: readonly ChatSummary[], query: string, takenByOthers: ReadonlySet<string> = new Set(), prefer?: { kind: ChatKind; homeTenant: string }): ChatSummary[] {
  const fits = (c: ChatSummary) => (prefer ? Number(suggestKind(c.members, prefer.homeTenant) !== prefer.kind) : 0);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return chats
    .filter((c) => !takenByOthers.has(c.id))
    .filter((c) => {
      if (!words.length) return true;
      const hay = [chatName(c), ...c.members.map(nameOf)].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => fits(a) - fits(b) || (activityOf(b) ?? "").localeCompare(activityOf(a) ?? "") || chatName(a).localeCompare(chatName(b)));
}

/** "Open in Teams": the chat's own webUrl from Graph when it has one (opaque), else the documented chat deep link. */
export function teamsLink(c: { chatId: string; webUrl: string | null }): string {
  if (c.webUrl && /^https:\/\/teams\.microsoft\.com\//.test(c.webUrl)) return c.webUrl;
  if (!CHAT_ID.test(c.chatId)) throw new Error("Not a Teams chat id");
  return `https://teams.microsoft.com/l/chat/${encodeURIComponent(c.chatId)}/conversations`;
}

// The views the actions return and the UI shows (here so the UI never imports server code).
/** Why chats can't be read: not signed in, the permission isn't allowed yet, or Teams couldn't be reached. */
export type ChatAccess = "signed_out" | "consent" | "unavailable";

export type DeliveryChatView = {
  clientKey: string;
  chatId: string;
  displayName: string;
  kind: ChatKind;
  /** The members don't fit the kind (an outsider in the internal chat, no one from the client in the customer chat). */
  warning: string | null;
  link: string;
  members: FlaggedMember[] | null;
  memberCount: number | null;
  externalCount: number | null;
  fetchedAt: string | null;
  /** The last read failed (the cached members, if any, are still shown). */
  error: string | null;
  /** AP-1: Read for asks: on or off, the last read and its problem (a plain line), if any. */
  asks: { on: boolean; polledAt: string | null; status: string | null };
};
export type ChatsData = { available: boolean; reason: ChatAccess | null; homeTenant: string | null; chats: DeliveryChatView[] };
export type ChatPickerData = { available: boolean; reason: ChatAccess | null; homeTenant: string | null; chats: ChatSummary[]; taken: Record<string, string> };

