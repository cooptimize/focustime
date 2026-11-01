// The calendar editing rule (step 13): Coopilot only edits what it created or what only I can see. Pure: an event's
// edit facts in, its tier and the actions that tier allows out, each disabled one with a one-line reason.
import type { CalEvent } from "../week/types.ts";

/** What a write-token scan of the week knows about one Outlook event. Never attendee addresses: only a count. */
export type EditFacts = {
  isOrganizer: boolean;
  /** Attendees other than me. */
  others: number;
  /** Part of a series (occurrence or exception). */
  recurring: boolean;
  allDay: boolean;
  /** Coopilot's marker value, when the event carries one. */
  marker: string | null;
  webLink: string | null;
};

export type Tier = "coopilot" | "invite" | "mine" | "meeting" | "readonly" | "unknown";
export type EditAction = "move" | "resize" | "retitle" | "show_as" | "delete" | "cancel" | "open";
export type ActionState = { id: EditAction; allowed: boolean; reason?: string };
export type EventEdit = { tier: Tier; actions: ActionState[]; webLink: string | null; why: string };

export const TIMEBOX_MARKER = /^tb-[0-9a-f-]{36}$/;
export const INVITE_MARKER = /^inv-[0-9a-f-]{36}$/;

const ALL: EditAction[] = ["move", "resize", "retitle", "show_as", "delete", "cancel", "open"];
const REASON = {
  meeting: "Others are on this meeting, so Coopilot won't change it: open it in Outlook",
  mineTitle: "Coopilot never changes the title or body of your own events",
  mineDelete: "Coopilot only deletes events it created",
  recurring: "A repeating event: change it in Outlook",
  allDay: "An all-day event: change it in Outlook",
  google: "Google events are read-only in Coopilot",
  noWrite: "Allow calendar changes in Settings > Connections to edit Outlook events here",
  notYet: "Coopilot hasn't read this event's details yet: refresh",
  invite: "A help invite with attendees: only cancelling is done from Coopilot (Undo in Settings > Data)",
  cancelOnly: "Only invites Coopilot sent can be cancelled here",
  coopilotOnly: "Only events Coopilot created",
};

/** The tier of an Outlook event from its scan facts (null: not scanned, or no write access). */
export function tierOf(e: Pick<CalEvent, "source">, f: EditFacts | null): Tier {
  if (e.source !== "outlook") return "readonly";
  if (!f) return "unknown";
  if (f.marker && TIMEBOX_MARKER.test(f.marker)) return "coopilot";
  if (f.marker && INVITE_MARKER.test(f.marker)) return "invite";
  if (f.isOrganizer && f.others === 0) return "mine";
  return "meeting";
}

/**
 * Every action with whether this tier allows it. Coopilot events: everything but cancel. Invites: cancel and open.
 * Mine: move, resize and show as (not repeating or all-day ones); never title or delete. Meetings: open only.
 */
export function eventEdit(e: Pick<CalEvent, "source" | "allDay">, f: EditFacts | null, canWrite: boolean): EventEdit {
  const tier = tierOf(e, f);
  const webLink = f?.webLink ?? null;
  const st = (id: EditAction, allowed: boolean, reason?: string): ActionState => (allowed ? { id, allowed } : { id, allowed, reason: reason ?? "" });
  const open = st("open", e.source === "outlook", REASON.google);
  if (tier === "readonly") return { tier, why: e.source === "google" ? REASON.google : "Blocked in Coopilot: change it from the day's menu", webLink: null, actions: ALL.map((a) => st(a, false, e.source === "google" ? REASON.google : "Change unavailable time from the day's menu")) };
  if (!canWrite || tier === "unknown") {
    const reason = canWrite ? REASON.notYet : REASON.noWrite;
    return { tier, why: reason, webLink, actions: ALL.map((a) => (a === "open" ? open : st(a, false, reason))) };
  }
  switch (tier) {
    case "coopilot":
      return { tier, why: "Created by Coopilot: edit it here, the event and its timebox are one thing", webLink, actions: ALL.map((a) => (a === "cancel" ? st(a, false, REASON.cancelOnly) : a === "open" ? open : st(a, true))) };
    case "invite":
      return { tier, why: REASON.invite, webLink, actions: ALL.map((a) => (a === "cancel" || a === "open" ? st(a, true) : st(a, false, REASON.invite))) };
    case "mine": {
      const lock = f!.recurring ? REASON.recurring : e.allDay || f!.allDay ? REASON.allDay : null;
      return {
        tier,
        why: lock ?? "Your own event with nobody else on it: Coopilot can move it, resize it or change its show as, after a preview",
        webLink,
        actions: ALL.map((a) => {
          if (a === "open") return open;
          if (a === "retitle") return st(a, false, REASON.mineTitle);
          if (a === "delete") return st(a, false, REASON.mineDelete);
          if (a === "cancel") return st(a, false, REASON.cancelOnly);
          if (lock) return st(a, false, lock);
          if (a === "show_as") return st(a, true);
          return st(a, true);
        }),
      };
    }
    default:
      return { tier, why: REASON.meeting, webLink, actions: ALL.map((a) => (a === "open" ? open : st(a, false, REASON.meeting))) };
  }
}

/** Is one action allowed? */
export const allows = (x: EventEdit, a: EditAction) => x.actions.some((s) => s.id === a && s.allowed);

/** Outlook links Coopilot will open: Outlook on the web only. */
export function outlookLink(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2000) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (!["outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft"].includes(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
