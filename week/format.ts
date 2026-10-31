// Plain-language formatting used in risk reasons and the UI. Deterministic, not locale dependent.

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function parts(zdt: Temporal.ZonedDateTime) {
  const h12 = zdt.hour % 12 || 12;
  const mm = String(zdt.minute).padStart(2, "0");
  return { clock: `${h12}:${mm}`, meridiem: zdt.hour < 12 ? "AM" : "PM" };
}

export function formatTime(zdt: Temporal.ZonedDateTime): string {
  const p = parts(zdt);
  return `${p.clock} ${p.meridiem}`;
}

/** "3:30–4:00 PM", or "11:30 AM–12:15 PM" across noon. */
export function formatRange(start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime): string {
  const a = parts(start);
  const b = parts(end);
  return a.meridiem === b.meridiem ? `${a.clock}–${b.clock} ${b.meridiem}` : `${a.clock} ${a.meridiem}–${b.clock} ${b.meridiem}`;
}

export function toZoned(isoDateTime: string, timeZone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(isoDateTime).toZonedDateTimeISO(timeZone);
}
