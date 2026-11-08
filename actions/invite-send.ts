// IN-2: send an invite from FocusTime, through Close the loop's send path (LP-1). Admin › People's invite sheet only,
// behind the one admin check (admin-actions.ts runs it before any of these).
//
// - admin.invite_access: whether this admin can send now, per way (a token probe each, LP-1's `sendAccess`; nothing
//   is sent). Missing: the consent to ask for and LP-1's note that an admin may need to approve it.
// - admin.invite_preview: the recipients (Cooptimizers in Who's set up who haven't signed in, with an address inside
//   the Cooptimize domains; never a guest or an automation account), the way, and the final text of every message.
//   Teams is one 1:1 chat per person. Email is one per person by default, or one to everyone. Held five minutes, for
//   this admin only.
// - admin.invite_send: the one Send. Each message goes as the admin (delegated), is read back, gets its own audit entry
//   and, once it landed, "Invited by <admin> via Teams/Email, <day>" on each of its people. Partial failure names who.
// - admin.invite_retry: only what didn't land. A message Graph took but didn't show yet is read back, never sent twice;
//   one that never got there is sent again; a draft that wasn't sent is sent from Outlook's copy.
//
// The same Graph requests as LP-1 (sources/graph/send.ts) on the same per-person consents: nothing new is asked for.
// Nothing is automatic. The message, addresses and Graph ids stay on the server and out of logs and the audit.
import { firstName, INVITE_ADMIN_NOTE, personalize, validEmail, type SetupRow } from "../plan/invite.ts";
import { insideDomain, messageLink, textHtml } from "../plan/loop.ts";
import { SendFailure, type SendClient } from "../sources/graph/send.ts";
import type { Actor, AdminStore } from "../store/admin-store.ts";
import type { EmailSplit, InviteAccessView, InviteChannel, InviteItemView, InviteMode, InvitePreviewView, InviteResultView, ItemState } from "./invite-types.ts";
export type { EmailSplit, InviteAccessView, InviteChannel, InviteItemView, InviteMode, InvitePreviewView, InviteResultView };
import { sendAccess } from "./loop-actions.ts";
import type { ActionResponse } from "./types.ts";

export const INVITE_SEND_ACTIONS = ["admin.invite_access", "admin.invite_preview", "admin.invite_send", "admin.invite_retry"] as const;
export type InviteSendAction = (typeof INVITE_SEND_ACTIONS)[number];
export const EMAIL_SPLIT_DEFAULT: EmailSplit = "each";

/** The admin's own Graph sends and consent probes, as Close the loop has them. */
export type InviteSendPort = {
  sender: () => Promise<SendClient | null>;
  access: (kind: "send" | "mail" | "mail_send") => Promise<"granted" | "consent" | "unavailable">;
  /** Whether "Allow sending from FocusTime" can be offered here (not in the demo, which has no Microsoft sign-in). */
  canAsk?: boolean;
};

type Person = { id: string; name: string; email: string };
type Held = { id: string; owner: string; expiresAt: number; channel: InviteChannel; mode: InviteMode | null; split: EmailSplit | null; subject: string | null; messages: { people: Person[]; text: string }[] };
type Item = { people: Person[]; text: string; state: ItemState; ref: string | null; link: string | null; error: string | null };
type Batch = { id: string; owner: string; expiresAt: number; channel: InviteChannel; mode: InviteMode | null; subject: string | null; items: Item[] };

export const INVITE_PREVIEW_MS = 5 * 60_000;
const BATCH_MS = 30 * 60_000;
const held = new Map<string, Held>();
const batches = new Map<string, Batch>();
const NO_UNDO = "Sent Teams messages and emails can't be undone.";
const MAX_PEOPLE = 50;

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const newId = () => crypto.randomUUID();
const sweep = (m: Map<string, { expiresAt: number }>, now: number) => {
  for (const [k, v] of m) if (v.expiresAt <= now) m.delete(k);
};
const errorOf = (e: unknown) => (e instanceof SendFailure ? e.message : "Something went wrong. Nothing was sent");
const list = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const viaOf = (b: { channel: InviteChannel; mode: InviteMode | null }) => (b.channel === "teams" ? "teams_sent" : b.mode === "send" ? "email_sent" : "email_draft") as "teams_sent" | "email_sent" | "email_draft";

export async function inviteAccess(port: InviteSendPort): Promise<InviteAccessView> {
  const [teams, draft, send] = await Promise.all([sendAccess(port.access, "send", "teams_send", "teams"), sendAccess(port.access, "mail", "mail_draft", "email"), sendAccess(port.access, "mail_send", "mail_send", "email")]);
  return { teams, draft, send, note: INVITE_ADMIN_NOTE, canAsk: port.canAsk !== false };
}

type Deps = { port: InviteSendPort; store: AdminStore; actor: Actor; rows: () => Promise<SetupRow[]>; domains: () => Promise<readonly string[]>; now?: () => number };

export async function inviteSendAction(d: Deps, action: InviteSendAction, i: Record<string, unknown>): Promise<ActionResponse> {
  const now = (d.now ?? Date.now)();
  sweep(held, now);
  sweep(batches, now);
  const owner = (d.actor.id ?? "").toLowerCase();
  if (!owner) return bad("Sign in first", 401);
  const allowed = (keys: string[]) => Object.keys(i).find((k) => !keys.includes(k));
  switch (action) {
    case "admin.invite_access": {
      if (Object.keys(i).length) return bad("admin.invite_access takes {}");
      return { ok: true, data: await inviteAccess(d.port) };
    }
    case "admin.invite_preview": {
      const extra = allowed(["personIds", "channel", "mode", "split", "subject", "message"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (!Array.isArray(i.personIds) || !i.personIds.length || i.personIds.length > MAX_PEOPLE || !i.personIds.every((x) => typeof x === "string"))
        return bad(`personIds is a list of 1 to ${MAX_PEOPLE} people`);
      if (i.channel !== "teams" && i.channel !== "email") return bad("channel is teams or email");
      const channel = i.channel as InviteChannel;
      if (channel === "teams" && (i.mode !== undefined || i.split !== undefined || i.subject !== undefined)) return bad("Teams takes no mode, split or subject");
      const mode: InviteMode | null = channel === "email" ? (i.mode === undefined ? "draft" : i.mode === "draft" || i.mode === "send" ? i.mode : null) : null;
      if (channel === "email" && !mode) return bad("mode is draft or send");
      const split: EmailSplit | null = channel === "email" ? (i.split === undefined ? EMAIL_SPLIT_DEFAULT : i.split === "each" || i.split === "one" ? i.split : null) : null;
      if (channel === "email" && !split) return bad("split is each or one");
      if (typeof i.message !== "string" || !i.message.trim()) return bad("Write the message first");
      if (i.message.length > 1500) return bad("The message is at most 1,500 characters");
      const subject = channel === "email" ? (typeof i.subject === "string" ? i.subject.trim() : "") : null;
      if (channel === "email" && (!subject || subject.length > 120)) return bad("The subject is 1 to 120 characters");

      // Recipients: Cooptimizers in Who's set up only (guests, other domains and automation accounts are never rows).
      const rows = await d.rows();
      const ids = [...new Set((i.personIds as string[]).map((x) => x.toLowerCase()))];
      const found = ids.map((id) => rows.find((r) => r.id === id));
      if (found.some((p) => !p)) return bad("Only Cooptimizers in Who's set up can be invited", 404, "not_cooptimizer");
      const people = found as SetupRow[];
      if (people.some((p) => p.signedIn)) return bad("They have signed in already", 409, "signed_in");
      if (people.some((p) => !validEmail(p.email))) return bad("FocusTime has no email address for them. Copy the message instead.", 422, "no_email");
      const domains = await d.domains();
      if (!domains.length) return bad("Set Cooptimize email domains in Admin › Organization before sending from FocusTime", 422, "no_domains");
      if (people.some((p) => !insideDomain(p.email!, domains))) return bad("FocusTime only sends invites to addresses at Cooptimize", 422, "outside");

      // Only with the permission present; otherwise the sheet keeps IN-1's links (the probe, again, on the server).
      const access = channel === "teams" ? await sendAccess(d.port.access, "send", "teams_send", "teams") : await sendAccess(d.port.access, "mail", "mail_draft", "email");
      const sendOk = mode === "send" ? await sendAccess(d.port.access, "mail_send", "mail_send", "email") : ({ state: "ready" } as const);
      for (const a of [access, sendOk]) if (a.state !== "ready") return bad(a.state === "consent" ? a.note : a.reason, 409, "consent");

      const ps: Person[] = people.map((p) => ({ id: p.id, name: p.name, email: p.email!.trim() }));
      const message = i.message as string;
      const messages =
        channel === "email" && split === "one" && ps.length > 1 ? [{ people: ps, text: personalize(message, null) }] : ps.map((p) => ({ people: [p], text: personalize(message, p.name) }));
      const h: Held = { id: newId(), owner, expiresAt: now + INVITE_PREVIEW_MS, channel, mode, split, subject, messages };
      held.set(h.id, h);
      const how =
        channel === "teams"
          ? ps.length > 1 ? `Teams: a 1:1 chat with each of the ${ps.length}, as you` : `Teams: a 1:1 chat with ${firstName(ps[0]!.name)}, as you`
          : `${mode === "send" ? "Email, sent now" : "Email, an Outlook draft in your mailbox"}${ps.length > 1 ? (split === "one" ? `: one email to all ${ps.length}` : `: one email each to ${ps.length} people`) : ""}, as you`;
      const view: InvitePreviewView = {
        previewId: h.id,
        channel,
        mode,
        split: ps.length > 1 ? split : null,
        how,
        recipients: ps.map((p) => ({ id: p.id, name: p.name })),
        subject,
        messages: messages.map((m) => ({ to: m.people.map((p) => p.name), text: m.text })),
        note: mode === "draft" ? "The draft waits in your Outlook Drafts for you to send." : NO_UNDO,
        expiresAt: new Date(h.expiresAt).toISOString(),
      };
      return { ok: true, data: view };
    }
    case "admin.invite_send": {
      const extra = allowed(["previewId"]);
      if (extra) return bad(`unknown input field ${extra}`);
      const h = typeof i.previewId === "string" ? held.get(i.previewId) : undefined;
      if (!h || h.owner !== owner) return bad("That preview has expired. Preview it again.", 410, "expired");
      held.delete(h.id);
      const sender = await d.port.sender();
      if (!sender) return bad("Sign in to Microsoft to send from FocusTime", 409, "consent");
      const b: Batch = { id: newId(), owner, expiresAt: now + BATCH_MS, channel: h.channel, mode: h.mode, subject: h.subject, items: h.messages.map((m) => ({ ...m, state: "failed", ref: null, link: null, error: null })) };
      for (const it of b.items) await deliver(d, sender, b, it, false);
      batches.set(b.id, b);
      return { ok: true, data: resultOf(b) };
    }
    case "admin.invite_retry": {
      const extra = allowed(["batchId"]);
      if (extra) return bad(`unknown input field ${extra}`);
      const b = typeof i.batchId === "string" ? batches.get(i.batchId) : undefined;
      if (!b || b.owner !== owner) return bad("FocusTime no longer has that send. Check Who's set up and invite again.", 410, "expired");
      const sender = await d.port.sender();
      if (!sender) return bad("Sign in to Microsoft to send from FocusTime", 409, "consent");
      for (const it of b.items) if (!okState(it.state)) await deliver(d, sender, b, it, true);
      return { ok: true, data: resultOf(b) };
    }
  }
}

const okState = (s: ItemState) => s === "sent" || s === "draft";

/** Sends one message (or, on Retry, finishes it) and records the outcome: an audit entry, and the invite once it landed. */
async function deliver(d: Deps, sender: SendClient, b: Batch, it: Item, retry: boolean): Promise<void> {
  const before = it.state;
  try {
    if (b.channel === "teams") await teams(sender, d.actor.id ?? "", it, retry);
    else await email(sender, b, it, retry);
  } catch (e) {
    // Nothing landed (or a draft was made and not sent: draft_kept keeps its ref so Retry sends that draft).
    it.error = errorOf(e);
    if (it.state !== "draft_kept") it.state = "failed";
  }
  if (retry && it.state === before && !okState(it.state) && before === "unconfirmed") return; // still not showing: no new entry
  const ok = okState(it.state);
  const note = ok ? (retry ? "read back on retry" : "read back") : it.state === "unconfirmed" ? "taken, not read back yet" : `not sent: ${it.error ?? "unknown"}`;
  await d.store.recordInviteSend(it.people, viaOf(b), d.actor, { ok, note });
}

async function teams(sender: SendClient, me: string, it: Item, retry: boolean) {
  const p = it.people[0]!;
  if (retry && it.state === "unconfirmed" && it.ref) {
    const [chatId, messageId] = it.ref.split("|");
    if ((await sender.readMessage(chatId!, messageId!).catch(() => ({ found: false }))).found) settle(it, "sent");
    return;
  }
  // A 1:1 chat with someone at Cooptimize (Graph binds a user by their work address and returns the chat that exists).
  const chatId = await sender.oneOnOne(me, p.email);
  const messageId = await sender.post(chatId, textHtml(it.text));
  it.ref = `${chatId}|${messageId}`;
  it.link = messageLink(chatId, messageId);
  it.state = "unconfirmed";
  const back = await sender.readMessage(chatId, messageId).catch(() => ({ found: false }));
  // Without Chat.Read the post's own answer (Graph returned the message's id) is the confirmation, as in LP-1.
  if (back.found || ("unchecked" in back && back.unchecked)) settle(it, "sent");
}

async function email(sender: SendClient, b: Batch, it: Item, retry: boolean) {
  if (retry && it.ref && (it.state === "unconfirmed" || it.state === "draft_kept")) {
    const m = await sender.readMail(it.ref).catch(() => ({ state: "missing" as const, webLink: null, sentAt: null }));
    it.link = m.webLink ?? it.link;
    if (m.state === "sent" || (b.mode === "draft" && m.state === "draft")) return settle(it, m.state === "sent" && b.mode === "send" ? "sent" : "draft");
    if (m.state === "missing") {
      if (it.state === "unconfirmed") return;
      // The unsent draft is gone from Drafts: send a new one.
      it.ref = null;
    } else if (b.mode === "send" && it.state === "draft_kept") {
      // The send itself failed and it's still a draft: send Outlook's copy, never a second email.
      return sendDraft(sender, it, it.ref);
    } else return; // Outlook took the send but still shows a draft: only read back, never send it again.
  }
  if (retry && it.state === "unconfirmed") return;
  const draft = await sender.draft({ to: it.people.map((p) => ({ address: p.email, name: p.name })), subject: b.subject ?? "", html: textHtml(it.text) });
  it.ref = draft.id;
  it.link = draft.webLink;
  if (b.mode === "send") return sendDraft(sender, it, draft.id);
  it.state = "unconfirmed";
  const m = await sender.readMail(draft.id).catch(() => ({ state: "missing" as const, webLink: null, sentAt: null }));
  it.link = m.webLink ?? it.link;
  if (m.state !== "missing") settle(it, "draft");
}

async function sendDraft(sender: SendClient, it: Item, id: string) {
  try {
    await sender.send(id);
  } catch (e) {
    it.state = "draft_kept";
    throw e;
  }
  it.state = "unconfirmed";
  const m = await sender.readMail(id).catch(() => ({ state: "missing" as const, webLink: null, sentAt: null }));
  it.link = m.webLink ?? it.link;
  if (m.state === "sent") settle(it, "sent");
}

function settle(it: Item, state: "sent" | "draft") {
  it.state = state;
  it.error = null;
}

function lineOf(b: Batch, it: Item): string {
  switch (it.state) {
    case "sent":
      return b.channel === "teams" ? "Sent in Teams" : "Emailed";
    case "draft":
      return "Draft in your Outlook";
    case "unconfirmed":
      return b.channel === "teams" ? "Teams took it but doesn't show it yet. Retry checks first and won't send it twice." : "Outlook took it but doesn't show it yet. Retry checks first and won't send it twice.";
    case "draft_kept":
      return `${it.error ?? "Not sent"}. The draft is in your Outlook; Retry sends it.`;
    case "failed":
      return it.error ?? "Not sent";
  }
}

function resultOf(b: Batch): InviteResultView {
  const items = b.items.map((it) => ({ names: it.people.map((p) => p.name), ok: okState(it.state), state: it.state, line: lineOf(b, it), link: it.link }));
  const people = (ok: boolean) => b.items.filter((it) => okState(it.state) === ok).flatMap((it) => it.people.map((p) => p.name));
  const done = people(true);
  const left = people(false);
  const verb = b.channel === "teams" ? "Sent in Teams to" : b.mode === "send" ? "Emailed" : "Outlook draft for";
  const total = done.length + left.length;
  const message = !left.length
    ? `${verb} ${total === 1 ? done[0] : `all ${total}`}.${b.mode === "draft" ? " Send it from Outlook." : ""}`
    : !done.length
      ? `Not sent to ${list(left)}. Nothing was marked invited.`
      : `${verb} ${done.length} of ${total}. Not sent to ${list(left)}.`;
  return { batchId: b.id, channel: b.channel, mode: b.mode, items, message, ok: !left.length, retry: left.length > 0, invited: done.length };
}

/** Test seam: forget held previews and sends. */
export const forgetInviteSends = () => (held.clear(), batches.clear());
