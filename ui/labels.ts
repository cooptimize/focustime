import { clients, fallbackClientColor } from "../config/defaults";
import { formatRange, toZoned } from "../week/format";
import type { CalEvent, Half, Risk, RiskRule, Slot } from "../week/types";

export function clientColor(key: string | undefined): string {
  return (key && clients[key]?.color) || fallbackClientColor;
}

export const ruleLabel: Record<RiskRule, string> = {
  meeting_load: "Meetings",
  personal_conflict: "Personal",
  no_focus_window: "No focus window",
  double_booked_block: "Double-booked",
};

export const severityLabel = (r: Risk) => (r.severity === "at_risk" ? "At risk" : "Watch");

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

export const halfName = (h: Half) => (h === "AM" ? "Morning" : "Afternoon");

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

export function sourceName(e: CalEvent): string {
  return e.source === "outlook" ? "Outlook" : "Google";
}

export function showAsLabel(e: CalEvent): string {
  return e.showAs === "tentative" ? "tentative" : e.showAs === "free" ? "free" : e.showAs === "oof" ? "out of office" : "busy";
}
