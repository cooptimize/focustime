// LP-1: what Close the loop's actions return to the page (types only; the UI imports these, never actions/loop-actions.ts).
import type { Audience, ItemFact, LoopChannel, LoopSendView } from "../plan/loop.ts";
import type { DevOpsPreview } from "./types.ts";


export type ChannelAccess = { state: "ready" } | { state: "consent"; consent: "teams_send" | "mail_draft" | "mail_send"; note: string } | { state: "unavailable"; reason: string };
export type TeamsTarget = { kind: "chat" | "direct"; label: string; line: string };
export type LoopChannelOption = {
  channel: LoopChannel;
  label: string;
  /** Where it goes, in words: "Northwind delivery chat", "Dana Reyes only", "#4417", "A reminder only". */
  where: string;
  available: boolean;
  /** Why not (no address, no item, no write access). */
  reason: string | null;
  access: ChannelAccess;
  /** Teams: the delivery chat and, when the recipient is a Cooptimizer, the 1:1 chat. */
  targets?: TeamsTarget[];
  /** Email: whether Send now can run for me (Mail.Send), apart from the draft. */
  sendNow?: ChannelAccess;
};
export type LoopDraftView = {
  key: string;
  clientKey: string | null;
  clientName: string | null;
  what: string;
  recipient: { name: string; outside: boolean } | null;
  /** Why there's no recipient ("Who isn't set", "Who can't be you"). */
  noRecipient: string | null;
  text: string;
  subject: string;
  draftedFrom: string;
  ai: "ok" | "off" | "failed";
  aiNote: string | null;
  /** GD-2 point 5: the AI's draft had another client's name replaced ("Another client's name was removed"). */
  namesRemoved?: string;
  /** The linked item: its state now, whether I can write to it, and the other states its type has (from the process). */
  item: (ItemFact & { canComment: boolean; states: string[] }) | null;
  channels: LoopChannelOption[];
  /** The channel to start on: the promise's own, else Teams where the ask came from, else Email. */
  initial: LoopChannel;
  /** The latest sends of this promise (a draft waiting in Outlook shows here). */
  sends: LoopSendView[];
};
export type LoopPreviewView = {
  previewId: string;
  expiresAt: string;
  channel: LoopChannel;
  mode: "post" | "draft" | "send" | "comment" | "note";
  /** "Contoso project chat, 7 people, 4 outside Cooptimize" */
  line: string;
  destination: string;
  audience: Audience | null;
  /** For a DevOps comment: who can see it, in words (DevOps can't count them). */
  audienceNote: string | null;
  text: string;
  subject: string | null;
  /** GD-1 refused it: the plain reason, and Send is off. Since GD-2 always null (another client is flagged in `mentions`). */
  blocked: string | null;
  /**
   * GD-2 point 6: the other clients the text names, with the text (and subject) as they'd be with each replaced by
   * "another client" (one click), and the line to show. Send needs mentionsOk while the text still names one.
   */
  mentions?: { names: string[]; text: string; subject?: string; line: string };
  /** "Sent Teams messages and emails can't be undone." */
  final: string | null;
  kept: boolean;
  /** The DevOps parts, each with its own write-framework preview. */
  devops: { kind: "comment" | "state"; preview: DevOpsPreview }[];
  /** A DevOps part that couldn't be previewed: why (the send still can go). */
  devopsNotes: string[];
  /** The prefilled links when FocusTime can't send this way for me (the fallback). */
  fallback: { open: string; label: string; note: string; consent: string | null } | null;
  /** Call: the Teams call link. */
  call: string | null;
};
export type LoopResultView = {
  send: LoopSendView;
  /** "Posted in Northwind delivery chat", or the error in plain words. */
  message: string;
  ok: boolean;
  /** What else ran after the send: the promise kept, the comment, the state change. */
  parts: { kind: "kept" | "comment" | "state"; ok: boolean; message: string; writeId?: number | null }[];
  /** Whether the loop is closed now (kept ticked and done). */
  closed: boolean;
  retry: boolean;
};

