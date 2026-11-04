// T-2: delivery chats, the pure rules. A delivery chat is a Teams group chat a person registers for a client (Settings >
// Clients); the first is the primary. A member is external when their Entra tenant isn't Cooptimize's, by tenantId only:
// never by name, email domain or a list of people. A member with no tenantId can't be shown to be Cooptimize's, so it
// counts as external too. Nothing here reads or keeps message content.

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

export type ChatMember = { userId: string | null; displayName: string | null; email: string | null; tenantId: string | null };
export type FlaggedMember = ChatMember & { external: boolean };

/** A registered delivery chat, as stored per person and client. */
export type DeliveryChat = {
  clientKey: string;
  chatId: string;
  displayName: string;
  webUrl: string | null;
  primary: boolean;
  /** The cached members (null until first read) and when they were read. */
  members: ChatMember[] | null;
  membersFetchedAt: string | null;
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Teams chat id: 19:<thread>@thread.v2 (or the older @thread.skype, and @unq.gbl.spaces for one-on-one). */
export const CHAT_ID = /^19:[A-Za-z0-9_\-.]{1,200}@(thread\.v2|thread\.skype|unq\.gbl\.spaces)$/;

/** External: not in my organization's tenant (or no tenant to tell). */
export function isExternal(m: Pick<ChatMember, "tenantId">, homeTenant: string): boolean {
  if (!GUID.test(homeTenant)) throw new Error("homeTenant must be a tenant id");
  return !m.tenantId || m.tenantId.toLowerCase() !== homeTenant.toLowerCase();
}

/** Members with the external flag, Cooptimize people first, then by name. */
export function flagMembers(members: readonly ChatMember[], homeTenant: string): FlaggedMember[] {
  return members
    .map((m) => ({ ...m, external: isExternal(m, homeTenant) }))
    .sort((a, b) => Number(a.external) - Number(b.external) || nameOf(a).localeCompare(nameOf(b)));
}

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
 * recently active first. Chats already registered for another client are left out: one chat, one client.
 */
export function filterChats(chats: readonly ChatSummary[], query: string, takenByOthers: ReadonlySet<string> = new Set()): ChatSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return chats
    .filter((c) => !takenByOthers.has(c.id))
    .filter((c) => {
      if (!words.length) return true;
      const hay = [chatName(c), ...c.members.map(nameOf)].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (activityOf(b) ?? "").localeCompare(activityOf(a) ?? "") || chatName(a).localeCompare(chatName(b)));
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
  primary: boolean;
  link: string;
  members: FlaggedMember[] | null;
  memberCount: number | null;
  externalCount: number | null;
  fetchedAt: string | null;
  /** The last read failed (the cached members, if any, are still shown). */
  error: string | null;
};
export type ChatsData = { available: boolean; reason: ChatAccess | null; homeTenant: string | null; chats: DeliveryChatView[] };
export type ChatPickerData = { available: boolean; reason: ChatAccess | null; homeTenant: string | null; chats: ChatSummary[]; taken: Record<string, string> };

