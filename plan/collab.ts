// The collaboration finder (step 13): who could help with an item, when everyone is free, and the invite's fields.
// Pure. Candidates are Cooptimize staff only, ranked in tiers: 1 on this client that day (Focus Time), 2 on this
// client (Account Worker, or Focus Time on other days), 3 anyone else. PTO is a date only ("away"), never a title.
// Free/busy comes from Graph getSchedule: only the availability string and working hours are read from it; the
// schedule items (subjects, locations) are never looked at, kept or logged.
import type { DayPart, IsoDate, WorkWeekday } from "../week/types.ts";
import type { Attendee, Fields } from "./timebox.ts";
import { zoneOf, type GraphZone } from "./timezones.ts";

export type Teammate = { id: string; name: string; email: string };
/** A Focus Time pattern of a teammate on this client (normalized, client already filtered). */
export type TeamPattern = { userId: string; startDate: IsoDate; endDate: IsoDate | null; days: Partial<Record<WorkWeekday, DayPart>> };
export type CandidateTier = 1 | 2 | 3;
export type Candidate = Teammate & {
  /** Best tier over the range's days they aren't away. */
  tier: CandidateTier;
  tierByDate: Record<IsoDate, CandidateTier>;
  /** Range days on this client by Focus Time (tier 1). */
  onClient: IsoDate[];
  /** Range days on PTO: shown only as "away". */
  away: IsoDate[];
};

const WD: (WorkWeekday | null)[] = [null, "Mon", "Tue", "Wed", "Thu", null, null, null];
const lower = (s: string) => s.trim().toLowerCase();

/** An email in one of the allowed domains (exact domain, one @, no display-name tricks). */
export function domainAllowed(email: string, domains: readonly string[]): boolean {
  const m = /^[^\s@<>"',;]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  return !!m && domains.map(lower).includes(m[1]!.toLowerCase());
}

/** Does a pattern put this person on the client on that date? */
export function patternCovers(p: Pick<TeamPattern, "startDate" | "endDate" | "days">, date: IsoDate): boolean {
  const d = Temporal.PlainDate.from(date);
  const wd = WD[d.dayOfWeek];
  if (!wd || !p.days[wd]) return false;
  return date >= p.startDate && (p.endDate === null || date <= p.endDate);
}

/**
 * Candidates for help on a client over some dates, best first: tier 1 days on the client, else tier 2, else 3; then
 * more tier 1 days; then name. Me, people without an allowed email, and duplicates are left out.
 */
/** People to exclude (step 13.5): a listed name or address matches, any case. Excluded people are never suggested. */
export function isExcluded(p: { name: string; email: string }, list: readonly string[]): boolean {
  const name = p.name.trim().toLowerCase(), email = p.email.trim().toLowerCase();
  return list.some((x) => {
    const v = x.trim().toLowerCase();
    return !!v && (v === name || v === email);
  });
}

export function rankCandidates(o: { team: readonly Teammate[]; meId: string; meEmail: string; patterns: readonly TeamPattern[]; workers: ReadonlySet<string>; away: readonly { userId: string; date: IsoDate }[]; dates: readonly IsoDate[]; domains: readonly string[]; exclude?: readonly string[] }): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const t of o.team) {
    const email = lower(t.email);
    if (lower(t.id) === lower(o.meId) || email === lower(o.meEmail) || !domainAllowed(email, o.domains) || seen.has(email) || isExcluded(t, o.exclude ?? [])) continue;
    seen.add(email);
    const mine = o.patterns.filter((p) => lower(p.userId) === lower(t.id));
    const away = o.dates.filter((d) => o.away.some((a) => lower(a.userId) === lower(t.id) && a.date === d));
    const onClientEver = o.workers.has(lower(t.id)) || mine.some((p) => o.dates.some((d) => d >= p.startDate && (p.endDate === null || p.endDate >= d)));
    const tierByDate: Record<IsoDate, CandidateTier> = {};
    for (const d of o.dates) tierByDate[d] = mine.some((p) => patternCovers(p, d)) ? 1 : onClientEver ? 2 : 3;
    const free = o.dates.filter((d) => !away.includes(d));
    const tier = (free.length ? Math.min(...free.map((d) => tierByDate[d]!)) : onClientEver ? 2 : 3) as CandidateTier;
    out.push({ ...t, email, tier, tierByDate, onClient: o.dates.filter((d) => tierByDate[d] === 1), away });
  }
  return out.sort((a, b) => a.tier - b.tier || b.onClient.length - a.onClient.length || a.name.localeCompare(b.name));
}

// ---------- free/busy ----------

export type WorkingHours = { days: string[]; start: string; end: string; zone: string };
export type Availability = {
  email: string;
  /** Busy (or tentative, or away) stretches as epoch milliseconds. Only from the availability string. */
  busy: [number, number][];
  /** The range the availability string covers. */
  covers: [number, number];
  workingHours: WorkingHours | null;
  /** Step 13.5: no working hours were shared, so 9:00 to 5:00 in my zone is assumed. */
  hoursUnknown: boolean;
  /** Why this person can't be checked ("no free/busy", "time zone not recognized"). */
  problem: string | null;
};

/** Digits of availabilityView: 0 free, 1 tentative, 2 busy, 3 away, 4 working elsewhere. Tentative counts as busy. */
const FREE_DIGITS = new Set(["0", "4"]);
const TIME = /^(\d\d):(\d\d)(?::(\d\d))?/;

/**
 * getSchedule's answer as availability per person. Reads only scheduleId, availabilityView, workingHours and error;
 * everything else (scheduleItems with subjects and locations) is ignored and not copied anywhere.
 */
export function parseSchedule(raw: unknown, rangeStart: string, rangeEnd: string, intervalMin: number, myZone = "UTC"): Availability[] {
  const list = Array.isArray((raw as { value?: unknown })?.value) ? ((raw as { value: unknown[] }).value) : [];
  const t0 = Temporal.Instant.from(rangeStart).epochMilliseconds;
  const t1 = Temporal.Instant.from(rangeEnd).epochMilliseconds;
  const step = intervalMin * 60_000;
  const out: Availability[] = [];
  for (const r of list) {
    const o = r as { scheduleId?: unknown; availabilityView?: unknown; workingHours?: { daysOfWeek?: unknown; startTime?: unknown; endTime?: unknown; timeZone?: GraphZone }; error?: unknown };
    if (typeof o.scheduleId !== "string") continue;
    const email = o.scheduleId.trim().toLowerCase();
    const view = typeof o.availabilityView === "string" && /^[0-9]*$/.test(o.availabilityView) ? o.availabilityView : null;
    if (o.error || view === null || !view.length) {
      out.push({ email, busy: [], covers: [t0, t0], workingHours: null, hoursUnknown: false, problem: "no free/busy shared" });
      continue;
    }
    const busy: [number, number][] = [];
    for (let i = 0; i < view.length; i++) {
      if (FREE_DIGITS.has(view[i]!)) continue;
      const a = t0 + i * step, b = Math.min(t1, a + step);
      const last = busy[busy.length - 1];
      if (last && last[1] === a) last[1] = b;
      else busy.push([a, b]);
    }
    const covers: [number, number] = [t0, Math.min(t1, t0 + view.length * step)];
    const w = o.workingHours;
    let wh: WorkingHours | null = null;
    let problem: string | null = null;
    let hoursUnknown = false;
    if (w && Array.isArray(w.daysOfWeek) && typeof w.startTime === "string" && typeof w.endTime === "string" && TIME.test(w.startTime) && TIME.test(w.endTime)) {
      const zone = zoneOf(w.timeZone);
      if (zone) wh = { days: w.daysOfWeek.filter((d): d is string => typeof d === "string").map(lower), start: TIME.exec(w.startTime)![0]!.slice(0, 5), end: TIME.exec(w.endTime)![0]!.slice(0, 5), zone };
      else problem = "time zone not recognized";
    } else {
      // Step 13.5: assume 9:00 to 5:00, Monday to Friday, in my zone, and say so.
      wh = { days: ["monday", "tuesday", "wednesday", "thursday", "friday"], start: "09:00", end: "17:00", zone: myZone };
      hoursUnknown = true;
    }
    out.push({ email, busy, covers, workingHours: wh, hoursUnknown, problem });
  }
  return out;
}

const DAY_NAMES = ["", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const minOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is [a, b) inside this person's working hours, read in their own zone (one working day, not across midnight)? */
export function withinWorkingHours(a: number, b: number, wh: WorkingHours): boolean {
  const s = Temporal.Instant.fromEpochMilliseconds(a).toZonedDateTimeISO(wh.zone);
  const e = Temporal.Instant.fromEpochMilliseconds(b).toZonedDateTimeISO(wh.zone);
  if (!wh.days.includes(DAY_NAMES[s.dayOfWeek]!)) return false;
  const endDay = Temporal.PlainDate.compare(s.toPlainDate(), e.toPlainDate());
  const sm = s.hour * 60 + s.minute;
  const em = endDay === 0 ? e.hour * 60 + e.minute : 24 * 60;
  if (endDay !== 0 && !(e.hour === 0 && e.minute === 0 && s.toPlainDate().add({ days: 1 }).equals(e.toPlainDate()))) return false;
  const ws = minOf(wh.start), we = minOf(wh.end) || 24 * 60;
  return sm >= ws && em <= we;
}

const overlaps = (a: number, b: number, list: readonly [number, number][]) => list.some(([x, y]) => x < b && y > a);
const overlapMinutes = (a: number, b: number, list: readonly [number, number][]) => list.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0) / 60_000;

/** Is this person free for [a, b): inside the checked range, no busy stretch, inside their working hours? */
export function freeFor(av: Availability | undefined, a: number, b: number): boolean {
  if (!av || av.problem || !av.workingHours) return false;
  if (a < av.covers[0] || b > av.covers[1]) return false;
  return !overlaps(a, b, av.busy) && withinWorkingHours(a, b, av.workingHours);
}

export type Slot = {
  start: string;
  end: string;
  date: IsoDate;
  people: { email: string; name: string; tier: CandidateTier; hoursUnknown?: boolean }[];
  /** Others of the best tier also free then (auto mode). */
  alsoFree: string[];
  tier: CandidateTier;
  /** Minutes over my own timeboxes (avoided where possible). */
  overTimebox: number;
  /** Step 13.5: inside one of my focus blocks for this client (ranked first). */
  inFocus: boolean;
};

export type SuggestInput = {
  minutes: number;
  /** My working time, by date (my PTO days left out), as epoch ms. */
  myWindows: readonly { date: IsoDate; start: number; end: number }[];
  /** My meetings, personal events and unavailable time. */
  myBusy: readonly [number, number][];
  /** My timeboxes: soft. */
  myBoxes: readonly [number, number][];
  /** Step 13.5: my focus blocks for this client; slots inside them rank first. */
  focus?: readonly [number, number][];
  candidates: readonly Candidate[];
  availability: readonly Availability[];
  /** Chosen people (emails), or null for "let Coopilot choose the top tier". */
  chosen: readonly string[] | null;
  now: number;
  tz: string;
  max?: number;
  perDay?: number;
  step?: number;
};

/**
 * Up to 5 slots, ranked by: the tier of the people in it (chosen people: the lowest tier among them that day),
 * minutes over my timeboxes, then time. Hard rules: inside my working hours and free on my calendar, everyone in it
 * free inside their own working hours and not away. No two suggestions overlap, and at most two fall on one day
 * unless there aren't five otherwise.
 */
export function suggestSlots(o: SuggestInput): Slot[] {
  const step = (o.step ?? 15) * 60_000;
  const len = o.minutes * 60_000;
  const max = o.max ?? 5;
  const perDay = o.perDay ?? 2;
  const byEmail = new Map(o.availability.map((a) => [a.email, a]));
  const chosen = o.chosen ? o.candidates.filter((c) => o.chosen!.map(lower).includes(c.email)) : null;
  const all: Slot[] = [];
  for (const w of o.myWindows) {
    const first = Math.ceil(Math.max(w.start, o.now) / step) * step;
    for (let a = first; a + len <= w.end; a += step) {
      const b = a + len;
      if (overlaps(a, b, o.myBusy)) continue;
      const ok = (c: Candidate) => !c.away.includes(w.date) && freeFor(byEmail.get(c.email), a, b);
      let people: Candidate[];
      let alsoFree: string[] = [];
      if (chosen) {
        if (!chosen.length || !chosen.every(ok)) continue;
        people = chosen;
      } else {
        const free = o.candidates.filter(ok).sort((x, y) => x.tierByDate[w.date]! - y.tierByDate[w.date]! || o.candidates.indexOf(x) - o.candidates.indexOf(y));
        if (!free.length) continue;
        people = [free[0]!];
        alsoFree = free.slice(1).filter((c) => c.tierByDate[w.date] === free[0]!.tierByDate[w.date]).slice(0, 3).map((c) => c.name);
      }
      const tier = Math.max(...people.map((c) => c.tierByDate[w.date] ?? 3)) as CandidateTier;
      const iso = (t: number) => Temporal.Instant.fromEpochMilliseconds(t).toZonedDateTimeISO(o.tz).toString({ timeZoneName: "never", smallestUnit: "second" });
      const inFocus = (o.focus ?? []).some(([s, e]) => a >= s && b <= e);
      all.push({ start: iso(a), end: iso(b), date: w.date, people: people.map((c) => ({ email: c.email, name: c.name, tier: c.tierByDate[w.date] ?? 3, ...(byEmail.get(c.email)?.hoursUnknown ? { hoursUnknown: true } : {}) })), alsoFree, tier, overTimebox: Math.round(overlapMinutes(a, b, o.myBoxes)), inFocus });
    }
  }
  const t = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
  all.sort((x, y) => Number(y.inFocus) - Number(x.inFocus) || x.tier - y.tier || x.overTimebox - y.overTimebox || t(x.start) - t(y.start));
  const picked: Slot[] = [];
  const take = (limit: number) => {
    for (const s of all) {
      if (picked.length >= max) return;
      if (picked.includes(s)) continue;
      if (picked.some((p) => t(p.start) < t(s.end) && t(p.end) > t(s.start))) continue;
      if (picked.filter((p) => p.date === s.date).length >= limit) continue;
      picked.push(s);
    }
  };
  take(perDay);
  if (picked.length < max) take(Infinity);
  return picked.sort((x, y) => Number(y.inFocus) - Number(x.inFocus) || x.tier - y.tier || x.overTimebox - y.overTimebox || t(x.start) - t(y.start));
}

// ---------- the invite ----------

/** "Fabrikam: help on #4512 Import mapping", the DevOps link and an optional note, the chosen people, Teams or not. */
export function inviteFields(o: { clientName: string; itemTitle: string; url: string | null; note: string | null; start: string; end: string; people: readonly Attendee[]; teams: boolean }): Fields {
  return {
    subject: `${o.clientName}: help on ${o.itemTitle}`.slice(0, 255),
    body: [o.url ?? "", o.note?.trim() ?? "", "Help session planned in Coopilot."].filter(Boolean).join("\n\n"),
    start: Temporal.Instant.from(o.start).toString(),
    end: Temporal.Instant.from(o.end).toString(),
    showAs: "busy",
    reminder: false,
    attendees: o.people.map((p) => ({ name: p.name, email: p.email.toLowerCase() })),
    teams: o.teams,
  };
}

/** The default range: the item's pinned day when it's today or later, else the next N workdays from today. */
export function defaultRange(today: IsoDate, pinned: IsoDate | null, isWorkday: (d: IsoDate) => boolean, daysAhead: number): { from: IsoDate; to: IsoDate } {
  if (pinned && pinned >= today) return { from: pinned, to: pinned };
  const days: IsoDate[] = [];
  for (let d = Temporal.PlainDate.from(today); days.length < daysAhead && days.length < 31; d = d.add({ days: 1 })) {
    if (isWorkday(d.toString())) days.push(d.toString());
    if (Temporal.PlainDate.from(today).until(d).days > 60) break;
  }
  return { from: days[0] ?? today, to: days[days.length - 1] ?? today };
}

/** "Help session with Ana and Ben on #4512 Import mapping". */
export function helpFollowUpText(names: readonly string[], itemTitle: string): string {
  const who = names.length <= 1 ? names[0] ?? "a teammate" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Help session with ${who} on ${itemTitle}`;
}
