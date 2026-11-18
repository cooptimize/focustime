// MC-2c: the calls started in a client's registered delivery chats, as Calls sees them for one person. Only chats this
// person is in now (the chat's cached members, through the Teams store's viewer, D521) and whose client they follow;
// following that can't be read now fails closed (nothing is listed), unlike CW-1's live call line. Only calls whose
// transcript-is-ready event came, with a known start, not live, started in Calls' window. Nothing here asks Microsoft
// anything: it reads only what the poll kept (the call's id, its times, the event's time and the transcript's id).
import { chatCallListed, TRANSCRIPT_CALL_DAYS, type TranscriptCall } from "../plan/cowork.ts";
import { followersOf, type ClientChat, type FocusUser } from "../plan/requests.ts";
import type { TeamsStore } from "../store/teams-store.ts";

/** One chat call for Calls: what the poll kept, with the chat's name and client (its registration's). */
export type ChatCallEntry = TranscriptCall & { chatName: string };

export type ChatCallsPort = {
  /** My listed chat calls that started from `fromIso` (Calls' window). */
  listed: (fromIso: string) => Promise<ChatCallEntry[]>;
  /** One of my listed chat calls by its call id (in the last TRANSCRIPT_CALL_DAYS days), or null. */
  one: (callId: string) => Promise<ChatCallEntry | null>;
  /** Whether I'm in this registered chat now and follow its client. */
  sees: (chatId: string) => Promise<boolean>;
  /** The FocusTime users in this chat who are Cooptimizers (never a guest, an outsider or an automation account). */
  cooptimizersIn: (chatId: string) => Promise<string[]>;
};

export type ChatCallsDeps = {
  teams: TeamsStore;
  me: () => Promise<string | null>;
  /** The clients I follow; null when that can't be read now (then nothing is listed). */
  clientKeys: () => Promise<ReadonlySet<string> | null>;
  users: () => Promise<FocusUser[]>;
  cooptimizer: (userId: string) => Promise<boolean>;
  now: () => string;
};

export function chatCallsPort(d: ChatCallsDeps): ChatCallsPort {
  const visible = async (): Promise<ClientChat[]> => {
    const me = await d.me();
    if (!me) return [];
    const followed = await d.clientKeys().catch(() => null);
    if (!followed) return [];
    const low = new Set([...followed].map((k) => k.toLowerCase()));
    return (await d.teams.viewer(me).chats()).filter((c) => low.has(c.clientKey.toLowerCase()));
  };
  const listed = async (fromIso: string): Promise<ChatCallEntry[]> => {
    const chats = await visible();
    if (!chats.length) return [];
    const now = d.now();
    const rows = await d.teams.transcriptCalls(chats.map((c) => c.chatId), fromIso);
    return rows.flatMap((r) => {
      const chat = chats.find((c) => c.chatId === r.chatId);
      return chat && chatCallListed(r, now, fromIso) ? [{ ...r, clientKey: chat.clientKey, chatName: chat.displayName }] : [];
    });
  };
  return {
    listed,
    async one(callId) {
      const from = Temporal.Instant.from(d.now()).subtract({ hours: 24 * TRANSCRIPT_CALL_DAYS }).toString();
      return (await listed(from)).find((c) => c.callId === callId) ?? null;
    },
    async sees(chatId) {
      return (await visible()).some((c) => c.chatId === chatId);
    },
    async cooptimizersIn(chatId) {
      const chat = (await visible()).find((c) => c.chatId === chatId);
      if (!chat || !chat.members) return [];
      const ids = followersOf(chat, await d.users());
      const out: string[] = [];
      for (const id of ids) if (await d.cooptimizer(id).catch(() => false)) out.push(id);
      return out;
    },
  };
}
