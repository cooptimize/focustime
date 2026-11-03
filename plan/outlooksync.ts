// Two-way sync for FocusTime's own Outlook events (step 13, Q70) and rebuilding a lost record from the marker (Q69).
// Pure: what FocusTime last wrote, what Outlook shows now, and what the timebox wants now, in; one decision out.
// "Since the last sync" means against `last`: the fields last confirmed on Outlook or last taken from it.
import type { Fields, OutlookShowAs, Timebox } from "./timebox.ts";
import { timeboxProblem } from "./timebox.ts";

/** A marked event as Outlook shows it now (UTC instants). */
export type SeenEvent = { id: string; subject: string; start: string; end: string; showAs: string; marker: string };

export type SyncDecision =
  | { kind: "none" }
  /** Outlook changed, FocusTime didn't: the timebox follows Outlook. */
  | { kind: "adopt"; fields: Fields; changed: string[] }
  /** Deleted in Outlook while the timebox still wants it (step 13.5): keep the timebox, turn Put on Outlook off, ask. */
  | { kind: "removed_in_outlook" }
  /** Both changed since the last sync: nothing is overwritten; the person chooses. */
  | { kind: "conflict"; outlook: Fields | null; changed: string[] };

/** The note on a timebox whose event was deleted in Outlook (step 13.5). */
export const REMOVED_IN_OUTLOOK = "Removed in Outlook";

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
const SHOW: readonly OutlookShowAs[] = ["free", "tentative", "busy", "oof", "workingElsewhere"];
export const showAsOf = (s: string): OutlookShowAs => (SHOW as readonly string[]).includes(s) ? (s as OutlookShowAs) : SHOW.find((x) => x.toLowerCase() === s.toLowerCase()) ?? "busy";

/** Which of the synced fields differ (the body isn't read back, so it never counts). */
export function differences(a: Pick<Fields, "subject" | "start" | "end" | "showAs">, b: Pick<Fields, "subject" | "start" | "end" | "showAs">): string[] {
  const out: string[] = [];
  if (ms(a.start) !== ms(b.start) || ms(a.end) !== ms(b.end)) out.push("time");
  if (a.subject !== b.subject) out.push("title");
  if (a.showAs.toLowerCase() !== b.showAs.toLowerCase()) out.push("show as");
  return out;
}

/** Outlook's version as FocusTime fields (keeps FocusTime's body, which isn't read). */
export const seenFields = (seen: SeenEvent, last: Fields): Fields => ({ ...last, subject: seen.subject, start: Temporal.Instant.from(seen.start).toString(), end: Temporal.Instant.from(seen.end).toString(), showAs: showAsOf(seen.showAs) });

/**
 * One marked event. `seen` null means Outlook no longer has it (confirmed by a read by id). `want` null means the
 * timebox no longer wants an event (removed, or Put on Outlook off). Outlook changed only → adopt; both → conflict;
 * gone from Outlook → removed_in_outlook.
 */
export function syncDecision(last: Fields, seen: SeenEvent | null, want: Fields | null): SyncDecision {
  const localChanged = !want || differences(last, want).length > 0;
  // Step 13.5: never re-created and never removed for me; the timebox stays and asks Keep or Remove.
  if (!seen) return want ? { kind: "removed_in_outlook" } : { kind: "none" };
  const changed = differences(last, seen as unknown as Fields);
  if (!changed.length) return { kind: "none" };
  const fields = seenFields(seen, last);
  if (localChanged) return { kind: "conflict", outlook: fields, changed };
  return { kind: "adopt", fields, changed };
}

/** A subject "<client>: <title>" split back into the title, when it starts with the client's name. */
export function titleFromSubject(subject: string, clientName: string): string {
  const p = `${clientName}: `;
  return subject.startsWith(p) && subject.length > p.length ? subject.slice(p.length) : subject;
}

/** The timebox fields that follow Outlook's version, in the configured zone. Null when Outlook's times can't be a timebox. */
export function timeboxFrom(fields: Fields, clientName: string, tz: string): { date: string; start: string; end: string; title: string; showAs: OutlookShowAs } | null {
  const s = Temporal.Instant.from(fields.start).toZonedDateTimeISO(tz);
  const e = Temporal.Instant.from(fields.end).toZonedDateTimeISO(tz);
  const opts = { timeZoneName: "never", smallestUnit: "second" } as const;
  const date = s.toPlainDate().toString();
  const start = s.toString(opts), end = e.toString(opts);
  if (timeboxProblem(date, start, end)) return null;
  return { date, start, end, title: titleFromSubject(fields.subject, clientName).slice(0, 200), showAs: showAsOf(fields.showAs) };
}

/**
 * Q69: a FocusTime-marked event with no local record. The client is the subject's "<client>: " prefix when it names a
 * known client; else the prefix itself; else Internal. Null when its times can't be a timebox (it then stays hidden
 * as FocusTime's and is listed for removal).
 */
export function rebuildFrom(seen: SeenEvent, clients: readonly { key: string; name: string }[], tz: string, internal: string): Omit<Timebox, "id" | "createdAt" | "updatedAt" | "removedAt" | "pickId" | "itemId" | "url" | "outlookNote" | "conflict"> | null {
  const known = clients.find((c) => seen.subject.startsWith(`${c.name}: `)) ?? clients.find((c) => seen.subject.startsWith(`${c.key}: `));
  const prefix = /^([^:]{1,40}): ./.exec(seen.subject)?.[1];
  const clientKey = known?.key ?? prefix ?? internal;
  const name = known ? (seen.subject.startsWith(`${known.name}: `) ? known.name : known.key) : prefix ?? "";
  const f: Fields = { subject: seen.subject, body: "", start: Temporal.Instant.from(seen.start).toString(), end: Temporal.Instant.from(seen.end).toString(), showAs: showAsOf(seen.showAs), reminder: false };
  const t = timeboxFrom(f, name, tz);
  if (!t) return null;
  return { uid: seen.marker, date: t.date, clientKey, title: name ? t.title : seen.subject.slice(0, 200), start: t.start, end: t.end, outlook: true, showAs: t.showAs };
}
