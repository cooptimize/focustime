// TB-1: the quick commands that work without AI: "what's next", "today", "help" and "open FocusTime". They read the
// same week the app loads (week.load through the person's own action context) and the same Now strip rule
// (plan/now.ts), so the bot and Today agree. Pure: the reader in server/main.ts hands in the loaded week.
import type { WeekLoadData } from "../../actions/types.ts";
import { nowStrip, type NowStrip } from "../../plan/now.ts";
import type { Pick } from "../../plan/types.ts";
import { planTarget } from "../../plan/target.ts";
import { dayEndOf, hoursOn } from "../../week/hours.ts";
import type { Slot } from "../../week/types.ts";
import { userZone } from "../../week/zone.ts";
import type { AssistantCard } from "./assistant.ts";

export type Quick = "next" | "today" | "help" | "open";

/** The command a message is, or null. Mentions, case, punctuation and extra spaces don't matter. */
export function quickOf(text: string): Quick | null {
  const t = text.replace(/<at>[^<]*<\/at>/gi, " ").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (["whats next", "what is next", "next", "whats up next"].includes(t)) return "next";
  if (["today", "my day", "todays plan", "what about today"].includes(t)) return "today";
  if (["help", "commands", "what can you do"].includes(t) || text.trim() === "?") return "help";
  if (["open focustime", "open focus time", "open", "open the app", "link"].includes(t)) return "open";
  return null;
}

export type TodayBlock = { half: "AM" | "PM" | "EVE"; client: string | null; start: string; end: string; picks: { title: string; done: boolean }[] };
export type TodayFacts = { date: string; strip: NowStrip; blocks: TodayBlock[]; committed: boolean };

const HALF: Record<TodayBlock["half"], string> = { AM: "Morning", PM: "Afternoon", EVE: "Evening" };
const hm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });

/** Today from the loaded week, as the app's Today shows it. */
export function todayFacts(data: WeekLoadData, now: Temporal.Instant): TodayFacts {
  const tz = userZone(data);
  const zoned = now.toZonedDateTimeISO(tz);
  const date = zoned.toPlainDate().toString();
  const day = data.week.days.find((d) => d.date === date) ?? null;
  const plan = data.plan?.[date];
  const picks: readonly Pick[] = plan?.picks ?? [];
  const names = new Map(data.planClients.map((c) => [c.clientKey, c.clientName]));
  // The day Plan the day would open (Today's rule, ui/App.tsx): today, or the next workday that isn't PTO.
  const hasHours = (x: string) => hoursOn(data.hours, x).segments.length > 0 || data.week.days.some((w) => w.date === x && w.flexMinutes > 0);
  const pto = new Set([...data.ptoAhead, ...data.week.days.filter((w) => w.pto).map((w) => w.date)]);
  const target = planTarget(zoned, dayEndOf(data.hours, date) ?? "24:00", pto, hasHours);
  const strip = nowStrip({
    now: zoned,
    day,
    picks,
    committed: !!plan?.committedAt,
    pto: data.ptoAhead.includes(date),
    nextWorkday: target.date !== date ? target.date : null,
    clientName: (k) => names.get(k) ?? k,
    noHoursToday: !hasHours(date),
    sizes: data.planning.sizes,
    timeboxes: data.timeboxes,
  });
  const slots: [TodayBlock["half"], Slot | null][] = day ? [["AM", day.am], ["PM", day.pm], ["EVE", day.eve]] : [];
  const blocks: TodayBlock[] = [];
  for (const [half, s] of slots) {
    if (!s || s.off || !s.windows.length) continue;
    const mine = picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done")).sort((a, b) => a.position - b.position);
    const client = s.focus[0]?.clientName ?? null;
    if (!client && !mine.length) continue;
    blocks.push({ half, client, start: hm(s.windows[0]!.start, tz), end: hm(s.windows[s.windows.length - 1]!.end, tz), picks: mine.map((p) => ({ title: p.title, done: p.status === "done" })) });
  }
  return { date, strip, blocks, committed: !!plan?.committedAt };
}

const link = (publicUrl: string, route: string, label: string) => ({ label, url: `${publicUrl.replace(/\/+$/, "")}/${route}` });

export function nextCard(f: TodayFacts, publicUrl: string): AssistantCard {
  const s = f.strip;
  const lines: string[] = [];
  if (s.kind === "pto") lines.push(s.next ? `PTO today. Back on ${s.next}.` : "PTO today.");
  else if (s.kind === "off") lines.push(s.next ? `No work today. Next workday: ${s.next}.` : "No work today.");
  else {
    if (s.nextPick) lines.push(`Next to-do: ${s.nextPick}${s.draft ? " (not committed yet)" : ""}`);
    else lines.push(f.committed ? "Nothing left planned today." : "Today isn't planned yet.");
    if (s.event) lines.push(s.event.now ? `In ${s.event.title} until ${s.event.at}` : `Next meeting: ${s.event.title} at ${s.event.at}`);
    if (s.picks) lines.push(`${s.picks.done} of ${s.picks.total} to-dos done`);
    if (s.overBy) lines.push(`About ${Math.round(s.overBy / 60)}h more planned than fits in this block`);
  }
  return { title: s.title || "What's next", lines, links: [link(publicUrl, "#/today", "Open Today")] };
}

export function todayCard(f: TodayFacts, publicUrl: string): AssistantCard {
  if (f.strip.kind === "pto" || f.strip.kind === "off") return { ...nextCard(f, publicUrl), title: "Today" };
  const lines: string[] = [];
  if (!f.blocks.length) lines.push("No focus blocks today.");
  for (const b of f.blocks) {
    lines.push(`${HALF[b.half]} ${b.start}–${b.end}: ${b.client ?? "Open"}`);
    if (!b.picks.length) lines.push("  Nothing planned");
    for (const p of b.picks.slice(0, 8)) lines.push(`  ${p.done ? "✓" : "•"} ${p.title}`);
  }
  if (!f.committed) lines.push("Today isn't committed yet.");
  return { title: "Today", lines, links: [link(publicUrl, "#/today", "Open Today"), ...(f.committed ? [] : [link(publicUrl, `#/week/day/${f.date}`, "Plan today")])] };
}
