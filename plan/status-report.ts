// SR-1: Status, the preview of Monday's status report and the comments that feed it. Kat (Cooptimize's automation)
// emails each client a report every Monday at 7:00 AM ET: a heading per feature, linked to DevOps, in backlog order,
// and under it every feature-level DevOps comment entered or edited since Kat last sent that client's report (the
// account's coop_statuslastsenton, by the comment's modified date), each followed by its author. FocusTime never sends
// or replaces it: Status shows what it will say and lets me add and edit my own lines. Pure: no I/O, no clock.
import type { IsoDate } from "../week/types.ts";
import { isClosed } from "./process.ts";

/** Kat's zone and time. The report goes out Mondays at 7:00 AM in New York, whatever my own zone is. */
export const KAT_ZONE = "America/New_York";
export const KAT_HOUR = 7;

/** Coop's structured comments: `[Coop brief v1]` and `[Coop update v1]` (plan/stories.ts reads them the same way). */
const COOP_BLOCK = /^\s*(?:<[^>]+>\s*)*\[(Coop (?:brief|update) v1)\]/i;
export const isCoopComment = (text: string) => COOP_BLOCK.test(text);

/** The Monday 7:00 AM ET at or before an instant. */
export function lastKatRun(now: Temporal.Instant): Temporal.Instant {
  const z = now.toZonedDateTimeISO(KAT_ZONE);
  let d = z.toPlainDate().subtract({ days: z.dayOfWeek - 1 });
  let at = d.toZonedDateTime({ timeZone: KAT_ZONE, plainTime: Temporal.PlainTime.from({ hour: KAT_HOUR }) });
  if (Temporal.ZonedDateTime.compare(at, z) > 0) {
    d = d.subtract({ days: 7 });
    at = d.toZonedDateTime({ timeZone: KAT_ZONE, plainTime: Temporal.PlainTime.from({ hour: KAT_HOUR }) });
  }
  return at.toInstant();
}

/** The next Monday 7:00 AM ET after an instant: the report Status previews. */
export function nextKatRun(now: Temporal.Instant): Temporal.Instant {
  return lastKatRun(now).toZonedDateTimeISO(KAT_ZONE).add({ days: 7 }).toInstant();
}

export type ReportWindow = {
  /** Comments modified at or after this instant are in Monday's report. */
  since: string;
  /** "kat": Kat's own last send for this client; "fallback": the most recent Monday 7:00 AM ET (unknown or unreadable). */
  source: "kat" | "fallback";
  /** Kat's last send for this client as Dataverse has it, or null. */
  katSentAt: string | null;
  /** Last week's comments (folded): the week before `since`. */
  prevSince: string;
};

/**
 * A client's window. Kat's watermark when Dataverse has one that isn't in the future and isn't older than five weeks
 * (a stale or broken value would show a month of comments that Monday's report won't); otherwise Monday 7:00 AM ET.
 */
export function reportWindow(katSentAt: string | null, now: Temporal.Instant): ReportWindow {
  let kat: Temporal.Instant | null = null;
  if (katSentAt) {
    try {
      kat = Temporal.Instant.from(katSentAt);
    } catch {
      kat = null;
    }
  }
  const fallback = lastKatRun(now);
  const usable = kat && Temporal.Instant.compare(kat, now) <= 0 && Temporal.Instant.compare(kat, fallback.subtract({ hours: 24 * 35 })) >= 0;
  const since = usable ? kat! : fallback;
  return { since: since.toString(), source: usable ? "kat" : "fallback", katSentAt: kat ? kat.toString() : null, prevSince: since.subtract({ hours: 24 * 7 }).toString() };
}

// ---- Comments ----

/** A feature comment as DevOps shows it (read with the company read PAT; never stored). */
export type RawReportComment = { id: number; text: string; authorName: string; authorUnique: string | null; createdAt: string; modifiedAt: string | null };
export type CommentWho = "mine" | "teammate" | "coop";
export type ReportComment = RawReportComment & { who: CommentWho; /** Mine, not Coop's, inside the window, and I can write to this client. */ editable: boolean };

/** When Kat counts a comment: its modified date (an edit brings it into the window), else its created date. */
export const countedAt = (c: Pick<RawReportComment, "createdAt" | "modifiedAt">) => c.modifiedAt || c.createdAt;

const at = (s: string) => {
  try {
    return Temporal.Instant.from(s);
  } catch {
    return null;
  }
};

/** This window's comments and last week's, oldest first (as the report lists them), each with who wrote it. */
export function sortComments(list: readonly RawReportComment[], w: Pick<ReportWindow, "since" | "prevSince">, mine: (unique: string | null) => boolean, canWrite: boolean): { thisWeek: ReportComment[]; lastWeek: ReportComment[] } {
  const since = Temporal.Instant.from(w.since);
  const prev = Temporal.Instant.from(w.prevSince);
  const thisWeek: ReportComment[] = [];
  const lastWeek: ReportComment[] = [];
  for (const c of list) {
    const t = at(countedAt(c));
    if (!t || !c.text.trim()) continue;
    const who: CommentWho = isCoopComment(c.text) ? "coop" : mine(c.authorUnique) ? "mine" : "teammate";
    if (Temporal.Instant.compare(t, since) >= 0) thisWeek.push({ ...c, who, editable: who === "mine" && canWrite });
    else if (Temporal.Instant.compare(t, prev) >= 0) lastWeek.push({ ...c, who, editable: false });
  }
  const byTime = (a: ReportComment, b: ReportComment) => Temporal.Instant.compare(at(countedAt(a))!, at(countedAt(b))!) || a.id - b.id;
  return { thisWeek: thisWeek.sort(byTime), lastWeek: lastWeek.sort(byTime) };
}

// ---- Which features ----

/** An item of the client's store as Ahead reads it (only what selection needs). */
export type ReportItem = { id: number; title: string; type: string; state: string; stateCategory: string; level: "top" | "parent" | "child" | "task" | null; parentId: number | null; assigneeEmail: string | null; url: string; order: number | null };
export type FeatureWhy = "planned" | "touched" | "assigned";

export type SelectInput = {
  items: readonly ReportItem[];
  /** This week's plan rows for the client: a feature, or a story (its parent counts). */
  planned: readonly { itemId: number; level: "feature" | "story"; parentId: number | null }[];
  /** Items I had a pick on in the window (not dropped). */
  picked: readonly number[];
  /** Items I changed (state or a comment) in the window, from DV-1's change log. */
  changed: readonly number[];
  /** My emails for this client (the write identity, Dataverse's DevOps email, confirmed client logins), lowercase. */
  myEmails: ReadonlySet<string>;
};
export type SelectedFeature = { item: ReportItem; why: FeatureWhy };

const closed = (cat: string) => isClosed(cat);

/**
 * Features shown: those on this week's plan (or with a planned story), and those with a story (or themselves) I
 * picked or changed in the window. Assigned to me, open and none of those: "Also assigned to you". In backlog order.
 */
export function selectFeatures(i: SelectInput): { shown: SelectedFeature[]; also: SelectedFeature[] } {
  const byId = new Map(i.items.map((x) => [x.id, x] as const));
  const featureOf = (id: number | null, depth = 0): ReportItem | null => {
    if (id === null || depth > 6) return null;
    const x = byId.get(id);
    if (!x) return null;
    if (x.level === "parent") return x;
    if (x.level === "top") return null;
    return featureOf(x.parentId, depth + 1);
  };
  const why = new Map<number, FeatureWhy>();
  for (const p of i.planned) {
    const f = featureOf(p.itemId) ?? (p.level === "story" ? featureOf(p.parentId) : null);
    if (f) why.set(f.id, "planned");
  }
  for (const id of [...i.picked, ...i.changed]) {
    const f = featureOf(id);
    if (f && !why.has(f.id)) why.set(f.id, "touched");
  }
  const also: SelectedFeature[] = [];
  for (const x of i.items) if (x.level === "parent" && !why.has(x.id) && !closed(x.stateCategory) && x.assigneeEmail && i.myEmails.has(x.assigneeEmail.toLowerCase())) also.push({ item: x, why: "assigned" });
  const shown = [...why].map(([id, w]) => ({ item: byId.get(id)!, why: w }));
  return { shown: shown.sort(backlog), also: also.sort(backlog) };
}

/** Backlog (stack rank) order: the order field ascending, unset last, then id. */
export function backlog(a: { item: Pick<ReportItem, "order" | "id"> }, b: { item: Pick<ReportItem, "order" | "id"> }): number {
  const x = a.item.order ?? Number.POSITIVE_INFINITY;
  const y = b.item.order ?? Number.POSITIVE_INFINITY;
  return x === y ? a.item.id - b.item.id : x < y ? -1 : 1;
}

// ---- Facts for the draft ----

export type StoryFact =
  | { kind: "state"; itemId: number; title: string; from: string | null; to: string | null }
  | { kind: "comments"; itemId: number; title: string; count: number }
  | { kind: "done_pick"; itemId: number; title: string }
  | { kind: "note"; date: IsoDate; text: string }
  | { kind: "capture"; text: string };

/** The facts as plain hint lines (AI off, or beside the draft), newest kinds first and at most 12. */
export function hintLines(facts: readonly StoryFact[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of facts) {
    const line =
      f.kind === "state" ? `#${f.itemId} ${f.title}: ${f.from ? `${f.from} → ` : ""}${f.to ?? "changed"}`
      : f.kind === "comments" ? `#${f.itemId} ${f.title}: ${f.count === 1 ? "1 new comment" : `${f.count} new comments`}`
      : f.kind === "done_pick" ? `Done in FocusTime: #${f.itemId} ${f.title}`
      : f.kind === "note" ? `Where you left off (${f.date}): ${f.text}`
      : `Captured: ${f.text}`;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line.length > 200 ? `${line.slice(0, 199)}…` : line);
  }
  return out.slice(0, 12);
}

// ---- The count and the nudge ----

export type FeatureState = { thisWeek: number; pending?: number };
/** "5 features · 2 with an update · 3 without": the shown features only (Also assigned isn't counted). */
export function reportCounts(features: readonly FeatureState[]): { features: number; withUpdate: number; without: number } {
  const withUpdate = features.filter((f) => f.thisWeek > 0).length;
  return { features: features.length, withUpdate, without: features.length - withUpdate };
}
export function countLine(c: { features: number; withUpdate: number; without: number }): string {
  return `${c.features === 1 ? "1 feature" : `${c.features} features`} · ${c.withUpdate} with an update · ${c.without} without`;
}

export type StatusNudgeSettings = { friday: boolean; fridayAt: string; sunday: boolean; sundayAt: string };
export const DEFAULT_STATUS_NUDGE: StatusNudgeSettings = { friday: false, fridayAt: "15:00", sunday: false, sundayAt: "19:00" };
/** Settings › Notifications: the times and the Sunday option, shared by the in-app kind and the Teams one (whose own switches are Friday). */
export type StatusTimes = Omit<StatusNudgeSettings, "friday">;
export const DEFAULT_STATUS_TIMES: StatusTimes = { fridayAt: DEFAULT_STATUS_NUDGE.fridayAt, sunday: false, sundayAt: DEFAULT_STATUS_NUDGE.sundayAt };

/**
 * Is a Status nudge due now? Friday from its time (clamped to before my day ends, never after it), Sunday evening from
 * its time until midnight; only with its switch on, not on a PTO day, and only when some feature has no update yet.
 * `dayEnd` is the end of my working day on Friday (HH:MM) or null without hours that day.
 */
export function statusNudgeDue(f: { localDate: IsoDate; localTime: string; s: StatusNudgeSettings; dayEnd: string | null; pto: boolean; without: number }): { occasion: string } | null {
  if (f.pto || f.without <= 0) return null;
  const dow = Temporal.PlainDate.from(f.localDate).dayOfWeek;
  if (dow === 5 && f.s.friday) {
    if (!f.dayEnd) return null;
    // Before my day ends: the set time, or an hour before the end when the end comes first.
    const end = toMin(f.dayEnd);
    const from = Math.min(toMin(f.s.fridayAt), Math.max(0, end - 60));
    const t = toMin(f.localTime);
    return t >= from && t < end ? { occasion: `status_report:${f.localDate}` } : null;
  }
  if (dow === 7 && f.s.sunday) return toMin(f.localTime) >= toMin(f.s.sundayAt) ? { occasion: `status_report:${f.localDate}` } : null;
  return null;
}
const toMin = (hm: string) => (hm === "24:00" ? 1440 : Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)));

export const nudgeLine = (without: number) => `${without === 1 ? "1 feature has" : `${without} features have`} no update yet for Monday's report`;

/**
 * A3's idle rule for the status nudge: the next moment one could be due in the coming 8 days (its Friday or Sunday
 * time, or in 30 minutes while inside a window whose occasion isn't sent yet). `dayEndOn` is my day's end (HH:MM) on a
 * date, or null. Null when nothing is switched on. Early is harmless: a pass that finds nothing due does nothing.
 */
export function nextStatusNudge(now: Temporal.ZonedDateTime, s: StatusNudgeSettings, dayEndOn: (date: IsoDate) => string | null, sent: (occasion: string) => boolean): Temporal.Instant | null {
  if (!s.friday && !s.sunday) return null;
  const nowI = now.toInstant();
  const today = now.toPlainDate();
  for (let d = 0; d < 8; d++) {
    const date = today.add({ days: d });
    const iso = date.toString();
    if (sent(`status_report:${iso}`)) continue;
    let from: number | null = null;
    let until = 1440;
    if (date.dayOfWeek === 5 && s.friday) {
      const end = dayEndOn(iso);
      if (!end) continue;
      until = toMin(end);
      from = Math.min(toMin(s.fridayAt), Math.max(0, until - 60));
    } else if (date.dayOfWeek === 7 && s.sunday) from = toMin(s.sundayAt);
    if (from === null) continue;
    const at = (m: number) => date.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: { hour: Math.floor(Math.min(m, 1439) / 60), minute: Math.min(m, 1439) % 60 } }).toInstant();
    if (Temporal.Instant.compare(at(until), nowI) <= 0) continue;
    return Temporal.Instant.compare(at(from), nowI) > 0 ? at(from) : nowI.add({ minutes: 30 });
  }
  return null;
}
