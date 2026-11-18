// SA-3: Settings › Your data › What FocusTime keeps about you. Every line and number comes from docs/technical/ (Data,
// "Retention" and "Who sees what") and the code's own constants, never typed a second time (ui/settings/keeps.test.ts).
import { HISTORY_DAYS } from "../../assistant/types.ts";
import { UNMATCHED_DAYS } from "../../plan/asks.ts";
import { TRANSCRIPT_DAYS } from "../../plan/meetings.ts";
import { HARD_DELETE_AFTER_DAYS } from "../../plan/retention-days.ts";

/** Where a line is controlled: a Settings place, or another address in the app. */
export type KeepLink = { label: string; section?: string; setting?: string; href?: string };
export type KeepLine = { id: string; what: string; kept: string; link: KeepLink };

export const KEEP_NUMBERS = { HARD_DELETE_AFTER_DAYS, UNMATCHED_DAYS, TRANSCRIPT_DAYS, HISTORY_DAYS } as const;

export const KEEP_LINES: readonly KeepLine[] = [
  {
    id: "plan",
    what: "Your plan and settings: to-dos, promises, captures, focus sessions, the logs below, and your settings.",
    kept: `Until you remove them or delete your data. Delete my data removes everything for good after ${HARD_DELETE_AFTER_DAYS} days.`,
    link: { label: "Delete my data", section: "data", setting: "delete" },
  },
  {
    id: "chats",
    what: "Messages from your clients' registered chats, shown only to people in that chat who follow its client.",
    kept: `A message that didn't become a request is deleted after ${UNMATCHED_DAYS} days. Images are never stored.`,
    link: { label: "Chats FocusTime reads", section: "clients", setting: "chats-read" },
  },
  {
    id: "transcripts",
    what: "Call transcripts from your clients' registered calls, shown only to the call's reviewers and attendees.",
    kept: `Transcript lines and their quotes for ${TRANSCRIPT_DAYS} days. Proposals and what Confirm made stay.`,
    link: { label: "Client calls", href: "#/meetings" },
  },
  {
    id: "assistant",
    what: "Your assistant history: what you asked and what it proposed. Only yours, and in Export.",
    kept: `${HISTORY_DAYS} days. Clear deletes it at once.`,
    link: { label: "Assistant history", section: "ai", setting: "assistant-history" },
  },
  {
    id: "ai",
    what: "What is sent to AI: only with AI for FocusTime on and that client's Allow AI. Push-to-talk audio is never stored.",
    kept: "Prompts and answers are never kept. The request log keeps counts, cost and outcome only.",
    link: { label: "What is sent to AI", section: "ai", setting: "ai-sent" },
  },
  {
    id: "admins",
    what: "What admins see: team values, health and counts.",
    kept: "Never anyone's plan, to-dos, promises, captures, focus sessions, PATs, AI request text, assistant history or chats they aren't in.",
    link: { label: "Who sees what", href: "#/docs/data/who-sees-what" },
  },
];
