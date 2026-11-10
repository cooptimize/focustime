// The calendar editing rule (step 13): FocusTime only edits what it created or what only I can see. Pure: an event's
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
  /** FocusTime's marker value, when the event carries one. */
  marker: string | null;
  /** D470: marked, but this person's store has no record of it (an earlier FocusTime made it): an ordinary event. */
  earlier?: boolean;
  webLink: string | null;
  /** Step 16 (D283): my response (Graph's value), the organizer's name for a meeting I'm invited to, and whether new times may be proposed. */
  response?: string | null;
  organizer?: string | null;
  proposals?: boolean;
};

export type Tier = "focustime" | "invite" | "earlier" | "mine" | "meeting" | "readonly" | "unknown";
export type EditAction = "move" | "resize" | "retitle" | "show_as" | "delete" | "cancel" | "open" | "rsvp";
export type ActionState = { id: EditAction; allowed: boolean; reason?: string };
export type EventEdit = { tier: Tier; actions: ActionState[]; webLink: string | null; why: string };

export const TIMEBOX_MARKER = /^tb-[0-9a-f-]{36}$/;
// The inv- prefix is kept from before the rename (R1): help invites already sent carry it.
export const INVITE_MARKER = /^inv-[0-9a-f-]{36}$/;

const ALL: EditAction[] = ["move", "resize", "retitle", "show_as", "delete", "cancel", "open", "rsvp"];
const REASON = {
  meeting: "Others are on this meeting, so FocusTime won't change it: open it in Outlook",
  mineTitle: "FocusTime never changes the title or body of your own events",
  mineDelete: "FocusTime only deletes events it created",
  recurring: "A repeating event: change it in Outlook",
  allDay: "An all-day event: change it in Outlook",
  google: "Google events are read-only in FocusTime",
  link: "Events from a calendar link are read-only in FocusTime",
  noWrite: "Allow calendar changes in Settings > Connections to edit Outlook events here",
  notYet: "FocusTime hasn't read this event's details yet: refresh",
  invite: "A help invite with attendees: only cancelling is done from FocusTime (Undo in Settings > Data)",
  cancelOnly: "Only invites FocusTime sent can be cancelled here",
  focustimeOnly: "Only events FocusTime created",
  rsvpOnly: "Only meetings someone else invited you to can be answered",
  rsvpOrganizer: "You organize this meeting, so there is nothing to answer",
  earlier: "Made by an earlier FocusTime: it leaves this event alone, so change it in Outlook",
};

/** The tier of an Outlook event from its scan facts (null: not scanned, or no write access). */
export function tierOf(e: Pick<CalEvent, "source">, f: EditFacts | null): Tier {
  if (e.source !== "outlook") return "readonly";
  if (!f) return "unknown";
  if (f.marker && f.earlier && (TIMEBOX_MARKER.test(f.marker) || INVITE_MARKER.test(f.marker))) return "earlier";
  if (f.marker && TIMEBOX_MARKER.test(f.marker)) return "focustime";
  if (f.marker && INVITE_MARKER.test(f.marker)) return "invite";
  if (f.isOrganizer && f.others === 0) return "mine";
  return "meeting";
}

/**
 * Every action with whether this tier allows it. FocusTime events: everything but cancel. Invites: cancel and open.
 * Mine: move, resize and show as (not repeating or all-day ones); never title or delete. Meetings: open only.
 */
export function eventEdit(e: Pick<CalEvent, "source" | "allDay">, f: EditFacts | null, canWrite: boolean): EventEdit {
  const tier = tierOf(e, f);
  const webLink = f?.webLink ?? null;
  const st = (id: EditAction, allowed: boolean, reason?: string): ActionState => (allowed ? { id, allowed } : { id, allowed, reason: reason ?? "" });
  const open = st("open", e.source === "outlook", REASON.google);
  if (tier === "readonly") {
    const why = e.source === "google" ? REASON.google : e.source === "ics" ? REASON.link : null;
    return { tier, why: why ?? "Blocked in FocusTime: change it from the day's menu", webLink: null, actions: ALL.map((a) => st(a, false, why ?? "Change unavailable time from the day's menu")) };
  }
  if (!canWrite || tier === "unknown") {
    const reason = canWrite ? REASON.notYet : REASON.noWrite;
    return { tier, why: reason, webLink, actions: ALL.map((a) => (a === "open" ? open : st(a, false, reason))) };
  }
  switch (tier) {
    case "focustime":
      return { tier, why: "Created by FocusTime: edit it here, the event and its timebox are one thing", webLink, actions: ALL.map((a) => (a === "cancel" ? st(a, false, REASON.cancelOnly) : a === "rsvp" ? st(a, false, REASON.rsvpOnly) : a === "open" ? open : st(a, true))) };
    case "earlier":
      return { tier, why: REASON.earlier, webLink, actions: ALL.map((a) => (a === "open" ? open : st(a, false, REASON.earlier))) };
    case "invite":
      return { tier, why: REASON.invite, webLink, actions: ALL.map((a) => (a === "cancel" || a === "open" ? st(a, true) : st(a, false, REASON.invite))) };
    case "mine": {
      const lock = f!.recurring ? REASON.recurring : e.allDay || f!.allDay ? REASON.allDay : null;
      return {
        tier,
        why: lock ?? "Your own event with nobody else on it: FocusTime can move it, resize it or change its show as, after a preview",
        webLink,
        actions: ALL.map((a) => {
          if (a === "open") return open;
          if (a === "retitle") return st(a, false, REASON.mineTitle);
          if (a === "delete") return st(a, false, REASON.mineDelete);
          if (a === "cancel") return st(a, false, REASON.cancelOnly);
          if (a === "rsvp") return st(a, false, REASON.rsvpOnly);
          if (lock) return st(a, false, lock);
          if (a === "show_as") return st(a, true);
          return st(a, true);
        }),
      };
    }
    default: {
      // Step 16 (D283): a meeting someone else organizes can be answered (my response only; the meeting isn't edited).
      const invited = !f!.isOrganizer && f!.others > 0;
      return {
        tier,
        why: invited ? "A meeting you're invited to: answer it here, change anything else in Outlook" : REASON.meeting,
        webLink,
        actions: ALL.map((a) => (a === "open" ? open : a === "rsvp" ? st(a, invited, REASON.rsvpOrganizer) : st(a, false, REASON.meeting))),
      };
    }
  }
}

/** Is one action allowed? */
export const allows = (x: EventEdit, a: EditAction) => x.actions.some((s) => s.id === a && s.allowed);

/** Outlook links FocusTime will open: Outlook on the web only. */
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
