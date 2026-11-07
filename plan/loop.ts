// LP-1: Close the loop by sending the update: the rules that need no I/O. Who sees a message (inside and outside
// Cooptimize), the plain template when AI isn't on, the "drafted from" line, the deep links for the fallback, the
// Teams message link, and the record of a send as the UI shows it. Pure: no store, no network.
import { CHAT_ID, isExternal, type ChatMember } from "./chats.ts";
import { isOwner, type Owner } from "./follow-who.ts";
import type { PersonRef } from "./person-ref.ts";

export const LOOP_CHANNELS = ["teams", "email", "devops", "call"] as const;
export type LoopChannel = (typeof LOOP_CHANNELS)[number];
/** Email is a draft in Outlook (the default) or sent now; the others have one way each. */
export type EmailMode = "draft" | "send";
export const CHANNEL_LABEL: Record<LoopChannel, string> = { teams: "Teams", email: "Email", devops: "Comment", call: "Call" };

/** How a send went: post (Teams), draft or send (Email), comment (DevOps), note (Call), link (I sent it myself from a prefilled link). */
export type LoopMode = "post" | "draft" | "send" | "link" | "note" | "comment";
export type LoopState = "pending" | "sent" | "draft" | "unconfirmed" | "failed" | "marked";

/** One send as kept (loop_sends): also the audit entry. `graphRef` stays on the server. */
export type LoopSend = {
  id: number;
  promiseKey: string;
  clientKey: string | null;
  channel: LoopChannel;
  mode: LoopMode;
  state: LoopState;
  destination: string;
  recipient: string | null;
  insideCount: number | null;
  outsideCount: number | null;
  body: string;
  link: string | null;
  graphRef: string | null;
  writeId: number | null;
  error: string | null;
  kept: boolean;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
};
/** What the page gets: never Graph's own id. */
export type LoopSendView = Omit<LoopSend, "graphRef">;
export const sendView = ({ graphRef: _g, ...rest }: LoopSend): LoopSendView => rest;

/** Who sees a message: everyone in it but me, counted inside and outside Cooptimize, the outside ones by name only. */
export type Audience = { total: number; inside: number; outside: number; outsideNames: string[]; insideNames: string[] };

/**
 * The people a Teams message reaches, from the chat's cached member list. Outside: another tenant, no tenant, or a
 * guest in the chat (plan/chats.ts isExternal). I'm counted in the total (I see it too) but never named. Names only,
 * never addresses: the preview lists who will see it (LP-1, Tanner's decision 2), the way Teams shows its members.
 */
export function audienceOf(members: readonly ChatMember[], homeTenant: string, me: string | null): Audience {
  const meLow = (me ?? "").toLowerCase();
  const others = members.filter((m) => !(meLow && (m.userId ?? "").toLowerCase() === meLow));
  const outside = others.filter((m) => isExternal(m, homeTenant));
  const inside = others.filter((m) => !isExternal(m, homeTenant));
  const named = (l: readonly ChatMember[]) => l.map((m) => m.displayName?.trim() || "Someone").sort((a, b) => a.localeCompare(b));
  return { total: others.length + (members.length > others.length ? 1 : 0), inside: inside.length, outside: outside.length, outsideNames: named(outside), insideNames: named(inside) };
}

/** "W&C Project chat, 7 people, 4 outside Cooptimize" (the preview's one line). */
export function audienceLine(where: string, a: Audience): string {
  const people = `${a.total} ${a.total === 1 ? "person" : "people"}`;
  const out = a.outside ? `, ${a.outside} outside Cooptimize` : ", all at Cooptimize";
  return `${where}, ${people}${out}`;
}

/** Whether an address is at Cooptimize (the invite domains). */
export const insideDomain = (email: string, domains: readonly string[]) => domains.some((d) => email.trim().toLowerCase().endsWith(`@${d.toLowerCase()}`));

/** The recipient as the flow uses it. `email` is only for the server's send and the prefilled links. */
export type Recipient = { name: string; ref: PersonRef | null; email: string | null; outside: boolean };

/** LP-1: a recipient that is me is never one (by id, or by any of my names, as CV-3b's Who rule). */
export function recipientOk(r: { name: string; ref: PersonRef | null; email?: string | null } | null, owner: Owner & { email?: string | null }): boolean {
  if (!r || !r.name.trim()) return false;
  if (isOwner({ who: r.name, whoRef: r.ref }, owner)) return false;
  if (r.email && owner.email && r.email.trim().toLowerCase() === owner.email.trim().toLowerCase()) return false;
  return true;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** What the template and the AI know about the linked item. */
export type ItemFact = { id: number; title: string; state: string; type: string | null };

/** The plain draft when AI isn't on: who, what, the item's state, and a sign-off. Always editable. */
export function templateText(o: { who: string | null; what: string; item: ItemFact | null; myName: string | null }): string {
  const hi = o.who ? `Hi ${firstName(o.who)},` : "Hi,";
  const what = o.what.trim().replace(/[.!]+$/, "");
  const item = o.item ? ` #${o.item.id} (${o.item.title.trim()}) is ${o.item.state} now.` : "";
  const lines = [hi, "", `Closing the loop on ${lowerFirst(what)}.${item}`, "", "Let me know if anything else is needed."];
  if (o.myName) lines.push("", firstName(o.myName));
  return lines.join("\n");
}
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The subject an email gets: the promise's words, short. */
export function subjectOf(what: string, clientName: string | null): string {
  const w = what.trim().replace(/[.!]+$/, "");
  const s = w.length > 70 ? `${w.slice(0, 69).trimEnd()}…` : w;
  return clientName ? `${clientName}: ${s}` : s;
}

/** "Drafted by AI from your promise, the conversation “Rerun counts” and #4417's state (Resolved)." */
export function draftedFrom(o: { ai: boolean; conversation: string | null; item: ItemFact | null }): string {
  const parts = ["your promise"];
  if (o.conversation) parts.push(`the conversation “${o.conversation}”`);
  if (o.item) parts.push(`#${o.item.id}'s state (${o.item.state})`);
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${o.ai ? "Drafted by AI" : "A plain draft"} from ${list}. Edit it as you like.`;
}

/** A link to one Teams chat message (Graph's webUrl is often null for chat messages). Never logged. */
export function messageLink(chatId: string, messageId: string): string {
  if (!CHAT_ID.test(chatId) || !/^\d{1,20}$/.test(messageId)) throw new Error("Not a Teams message");
  return `https://teams.microsoft.com/l/message/${encodeURIComponent(chatId)}/${messageId}?context=${encodeURIComponent(JSON.stringify({ contextType: "chat" }))}`;
}

/** A Teams call to one person (the Call channel's "Call in Teams"). */
export function callLink(email: string): string {
  return `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(email.trim())}`;
}

/** Plain text as the HTML a Teams message or an email body takes: escaped, one line per <br>. */
export function textHtml(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc.split(/\r?\n/).join("<br>");
}

/** The words a send's row says (the promise's line, the Settings › Data log). */
export function sendLine(s: Pick<LoopSendView, "channel" | "mode" | "state" | "destination">): string {
  const where = s.destination;
  if (s.state === "draft") return `Draft in Outlook for ${where}`;
  if (s.state === "failed") return `Not sent to ${where}`;
  if (s.state === "unconfirmed") return `Sent to ${where}, not read back yet`;
  if (s.state === "pending") return `Sending to ${where}`;
  if (s.mode === "note") return `Called ${where}`;
  if (s.mode === "link" || s.state === "marked") return `Marked sent to ${where}`;
  return s.channel === "devops" ? `Commented on ${where}` : s.channel === "email" ? `Emailed ${where}` : `Posted in ${where}`;
}

/** Why a channel can't send from FocusTime yet, and what to do. */
export type Access = { state: "ready" } | { state: "consent"; consent: "teams_send" | "mail_draft" | "mail_send" } | { state: "admin" } | { state: "unavailable"; reason: string };
export const ADMIN_NOTE = "Sending from FocusTime needs an admin to approve access. Until then, open it prefilled and mark it sent.";
