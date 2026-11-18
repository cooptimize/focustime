// DP-3: a deployment several people share. Pure: the window as one moment for everyone (two instants) and as each
// person sees it in their own zone (a date and local "HH:MM"), who else is on it, and the words for who a change is
// for. No store, no network.
import type { IsoDate } from "../week/types.ts";
import type { TodoWindow } from "./types.ts";
import { firstName } from "./loop.ts";

/** Someone on a deployment: their id (users.id, lowercased), the name shown, who added them and when. */
export type DeployPerson = { id: string; name: string; addedBy: string; addedAt: string };

/** A person's own Outlook state for a deployment (never anyone else's). */
export type HoldState =
  /** Not on their Outlook. */
  | "off"
  /** On their Outlook, in step. */
  | "on"
  /** On their Outlook with the old title or time: their FocusTime updates it under their own sign-in. */
  | "behind"
  /** FocusTime is putting it on, or the write didn't confirm yet. */
  | "pending"
  /** Deleted in their Outlook: Put it back or Take me off. */
  | "deleted_in_outlook"
  /** Moved in their Outlook while others are on it: Move it for everyone or Put my hold back. */
  | "moved_in_outlook";

/** What a person's to-do for a shared deployment carries beside the to-do itself (read models only). */
export type SharedView = {
  id: number;
  version: number;
  people: DeployPerson[];
  /** Me: who added me (null when I made it). */
  addedBy: string | null;
  createdBy: string;
  /** The window's instants, the same for everyone. */
  startAt: string;
  endAt: string;
  /** The window crosses midnight in my zone: it shows on its start's date, cut at 24:00. */
  clipped: boolean;
  hold: { state: HoldState; uid: string | null; timeboxId: number | null };
};

const zdt = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
const hhmm = (z: Temporal.ZonedDateTime) => `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;

/** A window on a local date in a zone, as two UTC instants ("24:00" is the next midnight). */
export function instantsOf(date: IsoDate, w: TodoWindow, zone: string): { startAt: string; endAt: string } {
  const day = Temporal.PlainDate.from(date);
  const at = (hm: string) => {
    const [h, m] = hm.split(":").map(Number) as [number, number];
    const base = h === 24 ? day.add({ days: 1 }).toZonedDateTime({ timeZone: zone }) : day.toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from({ hour: h, minute: m }) });
    return base.toInstant().toString();
  };
  return { startAt: at(w.start), endAt: at(w.end) };
}

/**
 * The window as a person sees it in their zone: the start's local date and both times. An end on a later day in this
 * zone (a window that crosses midnight here, though not where it was planned) is cut at "24:00" and marked clipped.
 */
export function localOf(startAt: string, endAt: string, zone: string): { date: IsoDate; window: TodoWindow; clipped: boolean } {
  const s = zdt(startAt, zone);
  const e = zdt(endAt, zone);
  const date = s.toPlainDate().toString();
  const sameDay = e.toPlainDate().toString() === date;
  const midnight = !sameDay && e.hour === 0 && e.minute === 0 && Temporal.PlainDate.compare(e.toPlainDate(), s.toPlainDate().add({ days: 1 })) === 0;
  const end = sameDay ? hhmm(e) : "24:00";
  return { date, window: { start: hhmm(s), end }, clipped: !sameDay && !midnight };
}

/** The window moved to another local date, keeping its local times (a move or a carry). */
export function movedTo(startAt: string, endAt: string, zone: string, to: IsoDate): { startAt: string; endAt: string } {
  const l = localOf(startAt, endAt, zone);
  if (!l.clipped) return instantsOf(to, l.window, zone);
  // Cut at midnight here: keep its length, from the same local start on the new day.
  const len = Temporal.Instant.from(endAt).epochMilliseconds - Temporal.Instant.from(startAt).epochMilliseconds;
  const s = instantsOf(to, { start: l.window.start, end: "24:00" }, zone).startAt;
  return { startAt: s, endAt: Temporal.Instant.fromEpochMilliseconds(Temporal.Instant.from(s).epochMilliseconds + len).toString() };
}

/** "Jordan Lee", "Jordan Lee and Priya Shah", "Jordan Lee, Priya Shah and Sam Ortiz". */
export function namesText(names: readonly string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

/** The others on it (everyone but me), in the order they were added. */
export const othersOn = (people: readonly DeployPerson[], me: string) => people.filter((p) => p.id !== me.toLowerCase());

/**
 * The one line on a form that says who a change is for, before it is saved: "This changes it for Jordan Lee too",
 * "This changes it for Jordan Lee and Priya Shah too". Null when only I am on it (nothing to say).
 */
export function changeForLine(people: readonly DeployPerson[], me: string): string | null {
  const others = othersOn(people, me);
  if (!others.length) return null;
  return `This changes it for ${namesText(others.map((p) => p.name))} too`;
}

/** The undo line's count after a change made any other way (a drag, a carry, Close out, From last week). */
export function forPeopleText(count: number): string | null {
  return count > 1 ? `for all ${count} on it` : null;
}

/** Delete's question: names who else is on it. */
export function deleteQuestion(people: readonly DeployPerson[], me: string): string {
  const others = othersOn(people, me);
  return others.length ? `Delete it for everyone? ${namesText(others.map((p) => p.name))} ${others.length === 1 ? "is" : "are"} on it too, and it comes off their plans.` : "Delete this deployment?";
}

/** "Added by Jordan" on the panel of the person added; null for the person who made it. */
export function addedByText(view: Pick<SharedView, "addedBy" | "people">): string | null {
  if (!view.addedBy) return null;
  const by = view.people.find((p) => p.id === view.addedBy);
  return `Added by ${by ? firstName(by.name) : "a teammate"}`;
}

/** The words for my own Outlook state on a deployment, and its offer. Only ever my own. */
export const HOLD_WORDS: Record<HoldState, { line: string; offer: string | null }> = {
  off: { line: "Not on your Outlook", offer: "Put on my Outlook" },
  on: { line: "On your Outlook", offer: "Take off my Outlook" },
  behind: { line: "Your Outlook still shows the old time", offer: "Update my Outlook" },
  pending: { line: "Going on your Outlook", offer: null },
  deleted_in_outlook: { line: "Your hold was deleted in Outlook", offer: "Put it back" },
  moved_in_outlook: { line: "You moved your hold in Outlook", offer: null },
};

/** A hold left on my Outlook after Take me off, a removal or a delete. */
export const LEFT_HOLD = "A hold for a deployment you're no longer on is still on your Outlook";

/** How a deployment's change counts: changes that tell people (the day or the time), and the rest (quiet). */
export const timeChanged = (a: { startAt: string; endAt: string }, b: { startAt: string; endAt: string }) => a.startAt !== b.startAt || a.endAt !== b.endAt;

/** The refusal when two people save at once. */
export const STALE_SAVE = "Someone else on this deployment changed it while you had it open. Nothing of yours was saved. Look at what changed and save again";

/** The window in a person's own words: "Sat, Nov 21, 9:00 to 11:00 AM", "Sat, Nov 21, 11:30 AM to 1:00 PM". */
export function windowWords(startAt: string, endAt: string, zone: string): string {
  const s = zdt(startAt, zone);
  const e = zdt(endAt, zone);
  const day = s.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const t = (z: Temporal.ZonedDateTime, ampm: boolean) => `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}${ampm ? (z.hour < 12 ? " AM" : " PM") : ""}`;
  const same = s.hour < 12 === e.hour < 12 && s.toPlainDate().equals(e.toPlainDate());
  return `${day}, ${t(s, !same)} to ${t(e, true)}`;
}
