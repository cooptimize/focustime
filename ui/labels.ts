import { formatRange, toZoned } from "../week/format.ts";
import type { CalEvent, Half, RiskRule, Slot } from "../week/types.ts";

// Calm fallbacks for clients without a configured color, picked stably from the key. Domain tokens
// (ui/styles.css), so a theme can change them; a configured color is used as is.
const FALLBACK = Array.from({ length: 8 }, (_, i) => `var(--client-fallback-${i + 1})`);

export function clientColor(key: string | undefined, colors: Record<string, string>): string {
  if (!key) return "var(--client-none)";
  const set = colors[key];
  if (set) return set;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

export const ruleLabel: Record<RiskRule, string> = {
  meeting_load: "Meetings",
  personal_conflict: "Personal",
  out_of_office: "Out of office",
  all_day_busy: "All-day event",
  no_focus_window: "No focus window",
  double_booked_block: "Double-booked",
};

export function eventRange(e: CalEvent, tz: string): string {
  if (e.allDay) return "All day";
  return formatRange(toZoned(e.start, tz), toZoned(e.end, tz));
}

export function startClock(isoStr: string, tz: string): string {
  const z = toZoned(isoStr, tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}`;
}

export function slotRange(slot: Slot, tz: string): string {
  return formatRange(toZoned(slot.start, tz), toZoned(slot.end, tz));
}

/** "9:00–12:30": a block's range without AM and PM (U3 Week cards, U4 Plan the day blocks). */
export function shortRange(slot: Pick<Slot, "start" | "end">, tz: string): string {
  return `${startClock(slot.start, tz)}–${startClock(slot.end, tz)}`;
}

export const halfName = (h: Half) => (h === "AM" ? "Morning" : h === "PM" ? "Afternoon" : "Evening");
/** The short tag on a card: AM, PM or EVE shown as "Eve". */
export const halfTag = (h: Half) => (h === "EVE" ? "Eve" : h);

const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const mdy = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const full = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const utc = (d: string) => new Date(`${d}T12:00:00Z`);

export const shortDate = (d: string) => md.format(utc(d));
export const longDate = (d: string) => full.format(utc(d));

export function weekLabel(monday: string, friday: string): string {
  const a = Temporal.PlainDate.from(monday);
  const b = Temporal.PlainDate.from(friday);
  if (a.month === b.month) return `${md.format(utc(monday))}–${b.day}, ${b.year}`;
  return `${md.format(utc(monday))} – ${mdy.format(utc(friday))}`;
}

import { createContext } from "react";

/** Sources currently served from the bundled sample, so their events can be labeled as sample. */
export const SampleSources = createContext<ReadonlySet<string>>(new Set());

export function sourceName(e: CalEvent, samples: ReadonlySet<string>): string {
  if (e.source === "focustime") return "FocusTime (unavailable)";
  const name = e.source === "outlook" ? "Outlook" : "Google";
  return samples.has(e.source) ? `${name} sample` : name;
}

export function showAsLabel(e: CalEvent): string {
  switch (e.showAs) {
    case "tentative": return "tentative";
    case "free": return "free";
    case "oof": return "out of office";
    case "workingElsewhere": return "working elsewhere";
    default: return "busy";
  }
}

/**
 * A stored time as "Nov 1, 2:05 PM" in the given zone (step 15, D271). The plan store stamps zoned times
 * ("…-05:00[Region/City]"), which `new Date` can't read; Temporal reads both kinds. "Unknown time" otherwise.
 */
export function whenText(stamp: string, tz: string): string {
  try {
    const z = stamp.includes("[") ? Temporal.ZonedDateTime.from(stamp).withTimeZone(tz) : Temporal.Instant.from(stamp).toZonedDateTimeISO(tz);
    return `${z.toPlainDate().toLocaleString("en-US", { month: "short", day: "numeric" })}, ${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
  } catch {
    return "Unknown time";
  }
}
