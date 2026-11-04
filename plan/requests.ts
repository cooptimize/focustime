// Shared polling (D514 to D518), the pure rules. A client's Teams chats are registered once and polled by one job for
// everyone: every 5 minutes inside the union of its followers' working hours (each in their own zone and week, so a
// weekend counts only when someone works it), never outside (the first poll of the day catches up: Graph is asked for
// everything changed since the newest message seen). A follower is a FocusTime user who is a member of the chat. The
// registering person's token is tried first, then the other followers' by name. A chat's messages and Requests are
// shown only to a member of the chat who follows its client. Nothing here does I/O or logs.
import { inWorkingHours } from "./notify.ts";
import type { Ask, StoredMessage } from "./asks.ts";
import type { ChatKind, ChatMember } from "./chats.ts";
import { hoursOn, type TimeModel } from "../week/hours.ts";

/** The interval inside working hours. */
export const POLL_MINUTES = 5;
/** Members are read again after a day (they decide who sees a chat and whose token can be used). */
export const MEMBERS_STALE_MS = 24 * 3600_000;

export type Mention = { id: string; name: string | null };

/** One Teams message as stored once for everyone (teams_messages). `html` is the raw body, `text` the plain text. */
export type TeamsMessage = {
  chatId: string;
  messageId: string;
  clientKey: string;
  senderId: string | null;
  senderName: string | null;
  senderTenant: string | null;
  createdAt: string;
  /** Graph's lastModifiedDateTime: a newer one replaces the stored body and text. */
  modifiedAt: string;
  html: string | null;
  text: string;
  hasImage: boolean;
  hasFile: boolean;
  replyToId: string | null;
  mentions: Mention[];
  fetchedAt: string;
};

/** ok: read with the registering person's token; via: with another follower's; reconnect: nobody's works; retry: throttled or unreachable. */
export type PollState = "ok" | "via" | "reconnect" | "retry";

/** A client's registered Teams chat and its poll state (client_chats). Times are instants. */
export type ClientChat = {
  chatId: string;
  clientKey: string;
  kind: ChatKind;
  displayName: string;
  webUrl: string | null;
  position: number;
  members: ChatMember[] | null;
  membersFetchedAt: string | null;
  registeredBy: string;
  registeredAt: string;
  /** Nothing created before this is read (no backfill). */
  readSince: string;
  /** The newest lastModifiedDateTime stored: the next read asks for messages changed after it. */
  seenAt: string | null;
  polledAt: string | null;
  /** The last successful fetch. */
  fetchedAt: string | null;
  retryAt: string | null;
  failures: number;
  pollState: PollState | null;
  /** A plain line for a throttle or an unreachable Teams (null otherwise). */
  pollNote: string | null;
  /** Whose token the last successful read used (a user id). */
  tokenUser: string | null;
};

/** A Request: the shared row (requests) for a message the rules picked out. */
export type Request = Ask & {
  resolvedBy: string | null;
  assignee: string | null;
  /** Whose AI settings sorted it (the token owner's, or whoever pressed Sort again). */
  sortedBy: string | null;
  sortedAt: string | null;
};

export type FocusUser = { id: string; name: string; deleted: boolean };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Whether anyone is inside their working hours at `now`, each in their own zone. */
export function inUnion(now: Temporal.Instant, hours: readonly TimeModel[]): boolean {
  return hours.some((h) => inWorkingHours(h, now.toZonedDateTimeISO(h.timeZone)));
}

/** The interval now: every POLL_MINUTES inside the union of working hours, null (no polling) outside it (D514). */
export function pollEvery(now: Temporal.Instant, hours: readonly TimeModel[]): number | null {
  return inUnion(now, hours) ? POLL_MINUTES : null;
}

/** Whether a chat is read now: inside hours, the interval passed and no retry pending; Refresh any time but a retry. */
export function chatDue(c: Pick<ClientChat, "polledAt" | "retryAt">, now: string, inHours: boolean, force: boolean): boolean {
  const t = Date.parse(now);
  if (c.retryAt && Date.parse(c.retryAt) > t) return false;
  if (force) return true;
  if (!inHours) return false;
  return !c.polledAt || t - Date.parse(c.polledAt) >= POLL_MINUTES * 60_000;
}

/** The start of the next working span in the union after `now` (within 8 days), or null when nobody has hours. */
export function nextUnionStart(now: Temporal.Instant, hours: readonly TimeModel[]): Temporal.Instant | null {
  let best: Temporal.Instant | null = null;
  for (const h of hours) {
    const today = now.toZonedDateTimeISO(h.timeZone).toPlainDate();
    for (let d = 0; d <= 8; d++) {
      const date = today.add({ days: d });
      for (const s of hoursOn(h, date.toString()).segments) {
        const start = date.toZonedDateTime({ timeZone: h.timeZone, plainTime: Temporal.PlainTime.from(s.start) }).toInstant();
        if (Temporal.Instant.compare(start, now) <= 0) continue;
        if (!best || Temporal.Instant.compare(start, best) < 0) best = start;
        break;
      }
      if (best && Temporal.Instant.compare(best, date.toZonedDateTime({ timeZone: h.timeZone }).toInstant()) < 0) break;
    }
  }
  return best;
}

/**
 * The idle rule: when the next chat is due. Inside a chat's union of hours, its interval after the last poll (or the end
 * of a retry wait); outside, the start of the union's next span. Null with no chats or no followers.
 */
export function nextPollDue(chats: readonly { chat: Pick<ClientChat, "polledAt" | "retryAt">; hours: readonly TimeModel[] }[], now: Temporal.Instant): Temporal.Instant | null {
  let best: Temporal.Instant | null = null;
  for (const { chat, hours } of chats) {
    if (!hours.length) continue;
    let due: Temporal.Instant | null;
    if (inUnion(now, hours)) {
      const after = chat.polledAt ? Temporal.Instant.from(chat.polledAt).add({ minutes: POLL_MINUTES }) : now;
      const retry = chat.retryAt ? Temporal.Instant.from(chat.retryAt) : now;
      due = [after, retry, now].reduce((a, b) => (Temporal.Instant.compare(a, b) >= 0 ? a : b));
    } else due = nextUnionStart(now, hours);
    if (due && (!best || Temporal.Instant.compare(due, best) < 0)) best = due;
  }
  return best;
}

/** The FocusTime users (not deleted) who are members of the chat, in the users' order. */
export function followersOf(c: Pick<ClientChat, "members">, users: readonly FocusUser[]): string[] {
  const ids = (c.members ?? []).map((m) => m.userId).filter((x): x is string => !!x);
  return users.filter((u) => !u.deleted && ids.some((id) => same(id, u.id))).map((u) => u.id);
}

/** Whose tokens are tried, in order: the registering person's (while a follower), then the other followers' by name. */
export function tokenOrder(c: Pick<ClientChat, "members" | "registeredBy">, users: readonly FocusUser[]): string[] {
  const followers = new Set(followersOf(c, users));
  const rest = users.filter((u) => followers.has(u.id) && !same(u.id, c.registeredBy)).sort((a, b) => a.name.localeCompare(b.name)).map((u) => u.id);
  const first = users.find((u) => same(u.id, c.registeredBy) && followers.has(u.id));
  return first ? [first.id, ...rest] : rest;
}

/**
 * Who sees a chat's messages and Requests (D515): a member of the chat (by their Entra object id) who follows its
 * client. When the followed clients can't be read (Dataverse down), membership alone: everyone it lets in can already
 * read the chat in Teams. Members not read yet: nobody.
 */
export function canSee(c: Pick<ClientChat, "members" | "clientKey">, me: string, followed: ReadonlySet<string> | null): boolean {
  if (!c.members?.some((m) => same(m.userId, me))) return false;
  return !followed || followed.has(c.clientKey);
}

/** Whether the members should be read again. */
export const membersStale = (c: Pick<ClientChat, "membersFetchedAt">, now: string) => !c.membersFetchedAt || Date.parse(now) - Date.parse(c.membersFetchedAt) >= MEMBERS_STALE_MS;

/** A shared message in the shape the rules and the AI context read. */
export const storedOf = (m: TeamsMessage): StoredMessage => ({
  chatId: m.chatId, messageId: m.messageId, clientKey: m.clientKey, authorId: m.senderId, authorTenant: m.senderTenant,
  createdAt: m.createdAt, text: m.text, hasImage: m.hasImage, hasFile: m.hasFile, replyToId: m.replyToId,
});
