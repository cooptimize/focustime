// CW-1: co-working calls. Cooptimizers start a Teams call in a client's delivery chat and stay on it while they work;
// FocusTime makes that visible ("Call live in <chat> · started 9:12 · Join") and one click away ("Start a call in
// <chat>"). Pure: the call events read off the chat messages the shared poll already fetches (D514), the live rule,
// the links and the card a live call shows on. Nothing here sends, records or transcribes anything.
//
// Graph (v1.0, delegated Chat.Read, the same GET /chats/{id}/messages the poll makes): a system event message
// (messageType systemEventMessage, or unknownFutureValue without the Prefer header) whose eventDetail is
//   #microsoft.graph.callStartedEventMessageDetail { callId, callEventType, initiator }
//   #microsoft.graph.callEndedEventMessageDetail   { callId, callEventType, callDuration, callParticipants, initiator }
// Only the call id, the event's time, the initiator's user id and tenant, and the duration are kept. Never the
// participants, a display name from the event, or anything else. A call event is never a message: it never reaches
// the conversations pipeline, the Inbox, promises, chatter or the AI.
import { CHAT_ID, teamsLink } from "./chats.ts";

/** A call with no end event this long after it started is treated as ended (CW-1). */
export const STALE_CALL_HOURS = 10;

const STARTED = "#microsoft.graph.callstartedeventmessagedetail";
const ENDED = "#microsoft.graph.callendedeventmessagedetail";
/** Group calls in a chat ("call"), and a Meet now in it ("meeting"); a screen share alone isn't a call. */
const CALL_KINDS = new Set(["call", "meeting"]);
const CALL_ID = /^[0-9A-Za-z_\-.:]{1,128}$/;
const USER_ID = /^[0-9A-Za-z_\-.:]{1,64}$/;

export type CallEvent = {
  chatId: string;
  callId: string;
  kind: "started" | "ended";
  /** The event message's createdDateTime. */
  at: string;
  /** For an end event, when the call started (its time minus callDuration), when Graph gave a duration. */
  startedAt: string | null;
  initiatorId: string | null;
  initiatorTenant: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** An ISO 8601 duration as Graph writes callDuration ("PT59S", "PT1H2M3.5S", "P1DT2H"), in milliseconds; null if not one. */
export function durationMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(v);
  if (!m || v === "P" || v.endsWith("T")) return null;
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map((x) => (x ? Number(x) : 0));
  return Math.round((((d! * 24 + h!) * 60 + mi!) * 60 + s!) * 1000);
}

/**
 * A chat message from Graph as a call event, or null for anything else (a person's message, another system event, a
 * screen share, a malformed one). Recognised by its eventDetail type, whatever messageType says.
 */
export function callEventOf(v: unknown, chatId: string): CallEvent | null {
  const m = obj(v);
  const d = obj(m?.eventDetail);
  if (!m || !d || m.deletedDateTime) return null;
  const type = typeof d["@odata.type"] === "string" ? (d["@odata.type"] as string).toLowerCase() : "";
  const kind = type === STARTED ? "started" : type === ENDED ? "ended" : null;
  if (!kind) return null;
  const callType = typeof d.callEventType === "string" ? d.callEventType : "call";
  if (!CALL_KINDS.has(callType)) return null;
  const callId = str(d.callId, 128);
  const created = str(m.createdDateTime, 40);
  if (!callId || !CALL_ID.test(callId) || !created || Number.isNaN(Date.parse(created)) || !CHAT_ID.test(chatId)) return null;
  const user = obj(obj(d.initiator)?.user);
  const uid = str(user?.id, 64);
  const at = new Date(created).toISOString();
  const dur = kind === "ended" ? durationMs(d.callDuration) : null;
  return {
    chatId,
    callId,
    kind,
    at,
    startedAt: kind === "started" ? at : dur !== null ? new Date(Date.parse(at) - dur).toISOString() : null,
    initiatorId: uid && USER_ID.test(uid) ? uid : null,
    initiatorTenant: str(user?.tenantId, 64),
  };
}

/** One call as stored (chat_calls): started, and ended once its end event came. */
export type StoredCall = { chatId: string; callId: string; startedAt: string | null; endedAt: string | null; startedBy: string | null; startedByTenant: string | null };

/** Whether a stored call is live now: started, not ended, and started less than STALE_CALL_HOURS ago. */
export function isLive(c: Pick<StoredCall, "startedAt" | "endedAt">, now: string, staleHours = STALE_CALL_HOURS): boolean {
  if (c.endedAt || !c.startedAt) return false;
  const age = Date.parse(now) - Date.parse(c.startedAt);
  return age >= -5 * 60_000 && age < staleHours * 3_600_000;
}

/** The live call of a chat, the most recently started one when Teams reports more than one. */
export function liveCall<T extends StoredCall>(calls: readonly T[], now: string, staleHours = STALE_CALL_HOURS): T | null {
  return calls.filter((c) => isLive(c, now, staleHours)).sort((a, b) => b.startedAt!.localeCompare(a.startedAt!))[0] ?? null;
}

/**
 * Join and Start a call: the chat itself in Teams, where its header shows Join while a call is live, or the call
 * buttons to start one. FocusTime never starts the call or posts anything. The same link as Open in Teams: the chat's
 * own webUrl from Graph when it is a Teams link, else https://teams.microsoft.com/l/chat/<chat id>/conversations.
 */
export const chatCallLink = (c: { chatId: string; webUrl: string | null }): string => teamsLink(c);

// ---- the views the action returns and the UI shows (here so the UI never imports server code) ----

/** A live call as people see it: when it started and who started it (a Cooptimizer by name, anyone else unnamed). */
export type LiveCallView = { startedAt: string; by: string | null; byOutside: boolean };
/** One registered chat I may see (I'm in it and follow its client), with its live call. */
export type CoworkChatView = { clientKey: string; chatId: string; name: string; link: string; live: LiveCallView | null };
export type CoworkData = { available: boolean; chats: CoworkChatView[] };

/** "Call live in Northwind delivery · started 9:12" (the time in my zone, no AM or PM), and the starter when known. */
export function liveLine(chatName: string, live: LiveCallView, zone: string): { line: string; by: string | null } {
  const z = Temporal.Instant.from(live.startedAt).toZonedDateTimeISO(zone);
  const at = `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}`;
  return { line: `Call live in ${chatName} · started ${at}`, by: live.by ? `Started by ${live.by}` : live.byOutside ? "Started by someone outside Cooptimize" : null };
}

/**
 * The card a client's live call shows on, from today's cards: the first for that client that hasn't ended (the one
 * under way, else the next one). None when the client has no block left today.
 */
export function liveCallCard<K extends { key: string; clientKey: string | null; start: string; end: string }>(cards: readonly K[], clientKey: string, now: string): string | null {
  const t = Date.parse(now);
  return cards.filter((c) => c.clientKey === clientKey && Date.parse(c.end) > t).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]?.key ?? null;
}
