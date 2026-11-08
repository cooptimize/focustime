// IN-2: what the invite sheet gets from the send actions (actions/invite-send.ts). Types only, so the UI can import them.
import type { ChannelAccess } from "./loop-types.ts";

export type InviteChannel = "teams" | "email";
export type InviteMode = "draft" | "send";
/** Several people by email: one message each (the default), or one with everyone on To. */
export type EmailSplit = "each" | "one";

export type InviteAccessView = { teams: ChannelAccess; draft: ChannelAccess; send: ChannelAccess; note: string; canAsk: boolean };

export type InvitePreviewView = {
  previewId: string;
  channel: InviteChannel;
  mode: InviteMode | null;
  split: EmailSplit | null;
  /** "Teams: a 1:1 chat with each person, as you" */
  how: string;
  recipients: { id: string; name: string }[];
  subject: string | null;
  messages: { to: string[]; text: string }[];
  note: string;
  expiresAt: string;
};

export type ItemState = "sent" | "draft" | "unconfirmed" | "failed" | "draft_kept";
export type InviteItemView = { names: string[]; ok: boolean; state: ItemState; line: string; link: string | null };
export type InviteResultView = { batchId: string; channel: InviteChannel; mode: InviteMode | null; items: InviteItemView[]; message: string; ok: boolean; retry: boolean; invited: number };

