// The person's time zone (A1): an IANA name from their settings (`[hours] time_zone` today, the user's row from A2),
// defaulting to the host clock's zone when they haven't set one. Every read of it, on the server and in the UI, goes
// through userZone, so the hosted app can serve people in different zones without a process-wide zone anywhere.
// week/zone.test.ts rejects other reads and hard-coded zone names.

/** The zone when nothing better is known: no settings yet, and a host with no zone of its own. */
export const NEUTRAL_ZONE = "UTC";

/** Anything that carries the person's zone: their settings, a payload with their working hours, or a week view. */
export type ZoneSource = { week: { hours: { timeZone: string } } } | { hours: { timeZone: string } } | { timeZone: string };

/** The person's time zone. Null or undefined (no settings could be read): the neutral zone. */
export function userZone(from: ZoneSource | null | undefined): string {
  if (!from) return NEUTRAL_ZONE;
  const z = "week" in from && from.week && "hours" in from.week ? from.week.hours.timeZone : "hours" in from && from.hours ? from.hours.timeZone : "timeZone" in from ? from.timeZone : null;
  return typeof z === "string" && z ? z : NEUTRAL_ZONE;
}

/** Whether a name is a time zone this runtime knows (an IANA Region/City name). */
export function knownZone(name: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(name);
    return true;
  } catch {
    return false;
  }
}
