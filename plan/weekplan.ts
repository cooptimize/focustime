// Plan the week (step 8): the week plan commits features, the day plan commits stories. Pure: fit per client
// (E2: the musts' hours against that client's real free time in its blocks), the readiness ladder, the Coop brief and the week
// nudges. No I/O; the server and UI hand in the week, DevOps results and the plan.
import type { SizeScale } from "./estimate.ts";
import { freeMinutes } from "../week/free.ts";
import { budgetWords, estimate, plannedMinutesOf, type StorySize } from "./estimate.ts";
import { keepOpenOf, resolvedOf, type PlanBits } from "./carry.ts";
import { countsFor } from "./process.ts";
import type { ClientPortfolio, IsoDate, PortfolioItem, Slot, Week, WorkItem } from "../week/types.ts";

/** The week plan's items as these rules need them (the store's WeekFeature fits). */
export type FeatureLike = {
  clientKey: string;
  itemId: number;
  title: string;
  /** E2: a feature's estimate in minutes, or null for 4h; ignored when a sized story of it is on the list. Stories: unused. */
  estimate: number | null;
  slots: readonly { date: IsoDate; half: "AM" | "PM" }[];
  /** Step 11: feature or story (missing: feature). CF-1: every one counts the same (no musts). */
  level?: "feature" | "story";
  /** Step 16.4: a story's size and parent feature. */
  size?: StorySize | null;
  parentId?: number | null;
  done?: unknown;
  /** WT-1: the DevOps type, so a background type (no hours) can be left out of the budget. */
  itemType?: string | null;
};
const isFeature = (f: FeatureLike) => (f.level ?? "feature") === "feature";

export type Block = { date: IsoDate; half: "AM" | "PM"; start: string; end: string; freeMinutes: number; totalMinutes: number; pto: boolean; /** An Open half-day an item of this client is pinned to. */ open: boolean };

const windowMinutes = (s: Slot) => s.windows.reduce((m, w) => m + Temporal.Instant.from(w.start).until(Temporal.Instant.from(w.end)).total("minutes"), 0);

function blockOf(s: Slot, open: boolean): Block {
  return { date: s.date, half: s.half as "AM" | "PM", start: s.start, end: s.end, freeMinutes: s.pto ? 0 : freeMinutes(s), totalMinutes: windowMinutes(s), pto: s.pto, open };
}

/** A client's focus blocks in the week (Dataverse or standing; the block the card shows), with free time after meetings. */
export function clientBlocks(week: Week, clientKey: string): Block[] {
  return week.days.flatMap((d) => [d.am, d.pm].filter((s) => s.focus[0]?.clientKey === clientKey).map((s) => blockOf(s, false)));
}

/** S1 (D453): a feature pinned to a PTO half stays pinned, flagged; never moved or unpinned for the person. */
export const PINNED_TO_PTO = "Pinned to PTO, move it";
/** The PTO halves an item is pinned to (Week's PTO: a whole day or one half). */
export function pinnedToPto(week: Pick<Week, "days">, slots: readonly { date: IsoDate; half: "AM" | "PM" }[]): { date: IsoDate; half: "AM" | "PM" }[] {
  return slots.filter((p) => {
    const d = week.days.find((x) => x.date === p.date);
    return !!d && (p.half === "AM" ? d.am : d.pm).pto;
  });
}

/** S1 (D453): a client whose blocks that week are all on PTO. */
export const NO_TIME = "No time this week";

export type ClientBudget = {
  clientKey: string;
  clientName: string;
  /** Its blocks that week (the calendar unit: where the work happens), each with its real free minutes. PTO left out. */
  blocks: Block[];
  /** S1: its blocks that fall on PTO (left out of `blocks` and the fit), so a client with only PTO still has a line. */
  ptoBlocks: { date: IsoDate; half: "AM" | "PM" }[];
  /** E2: minutes of real free focus time in its blocks (after meetings, personal events even when hidden, unavailable
   * time and days off), less unpaid borrowed time: what Plan the day's fit uses per block, summed over the week. */
  freeMinutes: number;
  /** Unpaid borrowed minutes taken off it. */
  borrowedMinutes: number;
  /** CF-1: minutes of everything on its week (one total). */
  plannedMinutes: number;
  status: "none" | "all" | "free" | "over";
  /** "7h free · 9h planned". */
  text: string;
  /** "7h free". */
  free: string;
  /** "9h planned", or null with nothing planned. */
  planned: string | null;
  /** The amber "about 2h over", or null. */
  over: string | null;
  /** PL-1: the share of its block hours kept open for walk-ins (0: none), and its Watching check-ins' minutes. */
  keepOpen?: number;
  checkinMinutes?: number;
  /** PL-1: the minutes it plans up to: free × plan share × (1 − keep open); the over line and fit use this. */
  planUpTo?: number;
};

/**
 * PL-1: the one budget Commit, the Board and Today's This week line show: weekBudget with the same inputs everywhere
 * (WT-1's background types, the plan share, Keep open, what DevOps resolved, the Watching check-ins).
 */
export function planBudget(week: Week, items: readonly FeatureLike[], o: { borrowed: Parameters<typeof borrowedForWeek>[0]; weekStart: IsoDate; work: Parameters<typeof countsFor>[0]; bits: PlanBits | null | undefined; planShare?: number | undefined; sizes: SizeScale }): ClientBudget[] {
  const bits = o.bits;
  return weekBudget(week, items, {
    sizes: o.sizes,
    borrowedMinutes: borrowedForWeek(o.borrowed, o.weekStart),
    counts: countsFor(o.work),
    planShare: bits?.planShare ?? o.planShare ?? 100,
    ...(bits ? { keepOpen: keepOpenOf(bits), resolved: resolvedOf(bits), checkins: bits.checkins } : {}),
  });
}

/**
 * Q48: the unpaid borrowed minutes per client that count against a week's fit: those whose payback date falls in
 * that week (Monday to Sunday), or that have no payback date.
 */
export function borrowedForWeek(list: readonly { clientKey: string; minutes: number; paidAt: string | null; paybackDate: IsoDate | null }[], weekStart: IsoDate): Record<string, number> {
  const end = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const out: Record<string, number> = {};
  for (const b of list)
    if (!b.paidAt && (!b.paybackDate || (b.paybackDate >= weekStart && b.paybackDate <= end))) out[b.clientKey] = (out[b.clientKey] ?? 0) + b.minutes;
  return out;
}

/**
 * Q51: committed features show their current DevOps title; the title stored at commit is only the fallback when
 * DevOps can't give one right now (unreachable, cached, or the item no longer read).
 */
export function withCurrentTitles<T extends { clientKey: string; itemId: number; title: string }>(features: readonly T[], current: (clientKey: string, itemId: number) => string | null): (T & { titleSource: "devops" | "saved" })[] {
  return features.map((f) => {
    const t = current(f.clientKey, f.itemId);
    return t ? { ...f, title: t, titleSource: "devops" as const } : { ...f, titleSource: "saved" as const };
  });
}

/**
 * The budget per client (E2): the real free focus time in its blocks that week (and Open half-days an item is pinned
 * to), each block's free minutes as Plan the day counts them (week/free.ts: after meetings, personal events whether
 * shown or hidden, unavailable time; none on a day off), less unpaid borrowed time. Planned: minutes of everything on
 * its week (CF-1: one total), features as envelopes (plan/estimate.ts).
 */
export type BudgetOptions = {
  /** SZ-1: S, M, L and what this person counts unsized work as. */
  sizes: SizeScale;
  borrowedMinutes: Readonly<Record<string, number>>;
  /** WT-1: false for a background type (no hours). */
  counts?: (clientKey: string, itemType: string | null | undefined) => boolean;
  /** ADM-1: plan up to this % of free time (100: all of it). */
  planShare?: number;
  /** PL-1: the client's Keep open share (0 to 80). */
  keepOpen?: (clientKey: string) => number;
  /** PL-1: resolved, closed or removed in DevOps: counts zero hours. */
  resolved?: (clientKey: string, itemId: number) => boolean;
  /** PL-1: Watching check-in reservations: minutes per client, counted in its planned time. */
  checkins?: Readonly<Record<string, number>>;
};

export function weekBudget(week: Week, all: readonly FeatureLike[], o: BudgetOptions): ClientBudget[] {
  const items = o.counts ? all.filter((i) => o.counts!(i.clientKey, i.itemType)) : all;
  const names = new Map<string, string>();
  for (const d of week.days) for (const s of [d.am, d.pm]) if (s.focus[0] && !names.has(s.focus[0].clientKey)) names.set(s.focus[0].clientKey, s.focus[0].clientName);
  for (const f of items) if (!names.has(f.clientKey)) names.set(f.clientKey, f.clientKey);
  const slotAt = (date: IsoDate, half: "AM" | "PM") => {
    const d = week.days.find((x) => x.date === date);
    return d ? (half === "AM" ? d.am : d.pm) : null;
  };
  const est = estimate(items.map((i) => ({ ...i, level: i.level ?? "feature", done: !!o.resolved?.(i.clientKey, i.itemId) })), o.sizes);
  for (const k of Object.keys(o.checkins ?? {})) if (!names.has(k)) names.set(k, k);
  return [...names].map(([clientKey, clientName]) => {
    const mine = items.filter((f) => f.clientKey === clientKey);
    const placedOpen = new Map<string, Block>();
    for (const f of mine)
      for (const p of f.slots) {
        const s = slotAt(p.date, p.half);
        if (s?.open && !placedOpen.has(`${p.date}${p.half}`)) placedOpen.set(`${p.date}${p.half}`, blockOf(s, true));
      }
    // S1 (D453): PTO blocks are left out of the summary, the counts and the fit; a client with only PTO has no time.
    const all = [...clientBlocks(week, clientKey), ...placedOpen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.half.localeCompare(b.half));
    const blocks = all.filter((b) => !b.pto);
    const onlyPto = blocks.length === 0 && all.length > 0;
    const inBlocks = blocks.reduce((n, b) => n + b.freeMinutes, 0);
    const borrowed = o.borrowedMinutes[clientKey] ?? 0;
    const freeMinutes = Math.max(0, inBlocks - borrowed);
    const checkinMinutes = o.checkins?.[clientKey] ?? 0;
    const plannedMinutes = plannedMinutesOf(est, clientKey) + checkinMinutes;
    const keepOpen = o.keepOpen?.(clientKey) ?? 0;
    const w0 = budgetWords(freeMinutes, plannedMinutes, o.planShare ?? 100, keepOpen);
    const w = onlyPto ? { ...w0, free: NO_TIME, text: [NO_TIME, w0.planned].filter(Boolean).join(" · ") } : w0;
    return { clientKey, clientName, blocks, ptoBlocks: all.filter((b) => b.pto).map((b) => ({ date: b.date, half: b.half })), freeMinutes, borrowedMinutes: Math.min(borrowed, inBlocks), plannedMinutes, status: w.kind, text: w.text, free: w.free, planned: w.planned, over: w.over, keepOpen, checkinMinutes, planUpTo: onlyPto ? 0 : w0.line };
  });
}

export type ReadinessKind = "block_needs_work" | "needs_breakdown" | "no_target_date" | "intention_not_in_devops" | "needs_features" | "captures_to_sort";

export type ReadinessFlag = {
  kind: ReadinessKind;
  clientKey: string;
  itemId: number | null;
  title: string;
  url: string | null;
  /** "No target date" is a soft flag. */
  soft: boolean;
  /** Block needs work: how many of the client's blocks next week. */
  blocks?: number;
  /** Needs breakdown: when it was marked as being broken down (local), or null. */
  markedAt?: string | null;
  /** Needs breakdown (step 9): local draft stories under it, from captures or Plan the day. */
  drafts?: number;
  /** Captures to sort (step 9): how many are in the inbox. */
  count?: number;
  /** Block needs work: the open "ask about priorities" follow-up for that client and week, or null. */
  followUpId?: number | null;
  /** Intention not in DevOps (step 11): the typed pick, its day and size. */
  pickId?: number;
  date?: IsoDate;
  size?: StorySize;
};

export type WorkLike = { clientKey: string; status: string; fromCache: boolean; items: readonly WorkItem[] };
export type FollowUpRef = { id: number; kind: string; clientKey: string | null; ruleKey: string | null; closedAt: string | null };

export type ReadinessInput = {
  week: Week;
  portfolios: readonly ClientPortfolio[];
  features: readonly FeatureLike[];
  /** My open work per client (week.load's DevOps); null when DevOps wasn't loaded. */
  work: readonly WorkLike[] | null;
  marks: readonly { clientKey: string; itemId: number; markedAt: string }[];
  followUps: readonly FollowUpRef[];
  /** Local draft stories (step 9), to count those under each feature. */
  drafts?: readonly { clientKey: string; parentItemId: number | null; title?: string; level?: "story" | "feature" }[];
  /** Captures not sorted yet (step 9). */
  captures?: number;
  /** Typed intention picks around the week (step 11), to nudge them into DevOps as draft stories. */
  intentions?: readonly { id: number; clientKey: string; title: string; date: IsoDate; size: StorySize; status: string; followUpId?: number | null }[];
};

/** "Break down #id …" picks are about a DevOps feature already; they aren't intentions to move into DevOps. */
export const isBreakDown = (title: string) => /^Break down #\d+/.test(title);

const ORDER: readonly ReadinessKind[] = ["block_needs_work", "needs_breakdown", "no_target_date", "intention_not_in_devops", "needs_features", "captures_to_sort"];

/** The "ask about priorities" follow-up key for a client and week. */
export const prioritiesKey = (weekStart: IsoDate, clientKey: string) => `priorities:${weekStart}:${clientKey}`;

/**
 * The readiness ladder, as one short list with one action each:
 * a client block next week with no open work assigned to me ("Block needs work"); a committed feature with no open
 * stories, anyone's ("Needs breakdown"); an epic with no open features ("Needs features"); a committed feature with
 * no target date ("No target date", soft). Anything DevOps can't say right now (not loaded, failed, cached) isn't flagged.
 */
/**
 * A feature with no open story-level child needs breaking down (D164); shared with Roadmap (step 16). WT-1: only when its
 * type needs breakdown in the project's process (every parent type by default; off for a type an admin turned off).
 */
export const needsBreakdown = (item: Pick<PortfolioItem, "children" | "needsBreakdown">) => item.needsBreakdown !== false && !item.children.some((c) => c.open && c.level === "story");
/** An epic with no open feature needs features (step 13.5); shared with Roadmap (step 16). */
export const needsFeatures = (item: Pick<PortfolioItem, "children">) => !item.children.some((c) => c.open && c.level === "portfolio");

export function readiness(i: ReadinessInput): ReadinessFlag[] {
  const out: ReadinessFlag[] = [];
  const find = (clientKey: string, id: number): PortfolioItem | undefined => i.portfolios.find((p) => p.clientKey === clientKey)?.items.find((x) => x.id === id);

  const clients = new Set(i.week.days.flatMap((d) => [d.am, d.pm]).map((s) => s.focus[0]?.clientKey).filter((k): k is string => !!k));
  for (const clientKey of clients) {
    const w = i.work?.find((x) => x.clientKey === clientKey);
    if (!w || w.status !== "ok" || w.fromCache || w.items.length > 0) continue;
    const blocks = clientBlocks(i.week, clientKey).filter((b) => !b.pto).length;
    if (!blocks) continue;
    const followUp = i.followUps.find((l) => !l.closedAt && l.kind === "priorities" && l.ruleKey === prioritiesKey(i.week.weekStart, clientKey));
    out.push({ kind: "block_needs_work", clientKey, itemId: null, title: `No open work assigned to me for ${clientKey}`, url: null, soft: false, blocks, followUpId: followUp?.id ?? null });
  }
  for (const f of i.features.filter(isFeature)) {
    const item = find(f.clientKey, f.itemId);
    if (!item) continue;
    if (needsBreakdown(item))
      out.push({
        kind: "needs_breakdown", clientKey: f.clientKey, itemId: f.itemId, title: item.title, url: item.url, soft: false,
        markedAt: i.marks.find((m) => m.clientKey === f.clientKey && m.itemId === f.itemId)?.markedAt ?? null,
        drafts: (i.drafts ?? []).filter((d) => d.clientKey === f.clientKey && d.parentItemId === f.itemId && (d.level ?? "story") === "story").length,
      });
  }
  for (const p of i.portfolios)
    for (const e of p.items.filter((x) => x.tier === "epic"))
      if (needsFeatures(e))
        out.push({ kind: "needs_features", clientKey: p.clientKey, itemId: e.id, title: e.title, url: e.url, soft: false, drafts: (i.drafts ?? []).filter((d) => d.clientKey === p.clientKey && d.parentItemId === e.id && d.level === "feature").length });
  // Step 11: features on the week with no target date (CF-1: every feature on the week, no musts).
  for (const f of i.features.filter((x) => isFeature(x))) {
    const item = find(f.clientKey, f.itemId);
    if (item && !item.targetDate) out.push({ kind: "no_target_date", clientKey: f.clientKey, itemId: f.itemId, title: item.title, url: item.url, soft: true });
  }
  // Step 11: typed intentions still planned or done, not yet in DevOps (no draft story with that title for the client).
  const drafted = (k: string, t: string) => (i.drafts ?? []).some((d) => d.clientKey === k && d.title?.trim().toLowerCase() === t.trim().toLowerCase());
  for (const p of i.intentions ?? [])
    if ((p.status === "planned" || p.status === "done") && !p.followUpId && !isBreakDown(p.title) && !drafted(p.clientKey, p.title))
      out.push({ kind: "intention_not_in_devops", clientKey: p.clientKey, itemId: null, title: p.title, url: null, soft: false, pickId: p.id, date: p.date, size: p.size });
  if (i.captures) out.push({ kind: "captures_to_sort", clientKey: "", itemId: null, title: `${i.captures} ${i.captures === 1 ? "capture" : "captures"} to sort`, url: null, soft: false, count: i.captures });
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

const longDate = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/**
 * The Coop brief: copyable markdown for one feature, for Coop on the client VM to propose user stories. Only DevOps
 * fields (and the client's name): nothing from FocusTime's plan, notes or follow-ups, and no assignees.
 */
export function briefMarkdown(o: { clientName: string; item: PortfolioItem; description: string | null }): string {
  const { item } = o;
  const kids = item.children.length ? item.children.map((c) => `- #${c.id} ${c.type}: ${c.title} (${c.state})`) : ["None yet."];
  return [
    `# Coop brief: ${item.type} #${item.id} ${item.title}`,
    "",
    `- Client: ${o.clientName}`,
    `- ${item.type}: #${item.id} ${item.title}`,
    `- State: ${item.state}`,
    `- Target date: ${item.targetDate ? longDate(item.targetDate) : "not set"}`,
    `- Link: ${item.url}`,
    "",
    "## Description",
    "",
    o.description?.trim() || "No description in DevOps.",
    "",
    "## Existing child items",
    "",
    ...kids,
    "",
    "## Request",
    "",
    `Please propose user stories for this ${item.type.toLowerCase()} that cover what the child items above don't. For each story give:`,
    "- Title",
    "- Description",
    "- Acceptance criteria (a short checklist)",
    "- Size: S (1h), M (2h) or L (4h)",
    "",
    "Keep each story small enough for one focus block; split anything bigger than L.",
    "",
  ].join("\n");
}

/** Week nudge times ("HH:MM", or "" for off), Settings > Planning. */
export type NudgeTimes = { thu: string; fri: string; mon: string };
export type NudgeKey = "week_nudge_thu" | "week_nudge_fri" | "week_nudge_mon";

/**
 * Week nudges: Thursday and Friday for next week, Monday for this week, each from its time until the end of that day
 * and only while that week has nothing placed (CF-1; the caller fires each once, markOnce). Q50: given today's working start
 * (null: no working time today), one not sent on its day (a PTO day) is due again from that start, until its week
 * starts (Thursday's and Friday's) or ends (Monday's). The top-bar badge shows the week of the latest nudge time
 * passed (looking back a week) until that week has something placed.
 */
export function weekNudges(
  now: Temporal.ZonedDateTime,
  times: NudgeTimes,
  hasWork: (weekStart: IsoDate) => boolean,
  o: { workStart?: Temporal.PlainTime | null } = {},
): { due: { key: NudgeKey; weekStart: IsoDate }[]; badge: IsoDate | null } {
  type Moment = { key: NudgeKey; at: Temporal.ZonedDateTime; weekStart: IsoDate; day: IsoDate };
  const moments: Moment[] = [];
  const today = now.toPlainDate();
  for (let back = 7; back >= 0; back--) {
    const d = today.subtract({ days: back });
    const mondayOf = d.subtract({ days: d.dayOfWeek - 1 });
    const add = (key: NudgeKey, hm: string, weekStart: Temporal.PlainDate) => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
      if (!m) return;
      moments.push({ key, at: d.toZonedDateTime({ timeZone: now.timeZoneId, plainTime: Temporal.PlainTime.from(hm) }), weekStart: weekStart.toString(), day: d.toString() });
    };
    if (d.dayOfWeek === 4) add("week_nudge_thu", times.thu, mondayOf.add({ days: 7 }));
    if (d.dayOfWeek === 5) add("week_nudge_fri", times.fri, mondayOf.add({ days: 7 }));
    if (d.dayOfWeek === 1) add("week_nudge_mon", times.mon, mondayOf);
  }
  const passed = moments.filter((m) => Temporal.ZonedDateTime.compare(m.at, now) <= 0);
  const until = (m: Moment) => Temporal.PlainDate.from(m.weekStart).add({ days: m.key === "week_nudge_mon" ? 7 : 0 });
  const late = (m: Moment) =>
    m.day < today.toString() && !!o.workStart && Temporal.PlainTime.compare(now.toPlainTime(), o.workStart) >= 0 && Temporal.PlainDate.compare(today, until(m)) < 0;
  const due = passed.filter((m) => (m.day === today.toString() || late(m)) && !hasWork(m.weekStart)).map((m) => ({ key: m.key, weekStart: m.weekStart }));
  const last = passed.sort((a, b) => Temporal.ZonedDateTime.compare(a.at, b.at)).at(-1);
  return { due, badge: last && !hasWork(last.weekStart) ? last.weekStart : null };
}

export const WEEK_NUDGE_MESSAGE = (weekStart: IsoDate, thisWeek: boolean) =>
  `${thisWeek ? "This week" : `Next week (${Temporal.PlainDate.from(weekStart).toLocaleString("en-US", { month: "short", day: "numeric" })})`} has nothing on it yet. Open FocusTime and add work to the week.`;
