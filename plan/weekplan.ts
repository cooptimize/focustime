// Plan the week (step 8): the week plan commits features, the day plan commits stories. Pure: fit per client
// (committed blocks against that client's available focus blocks), the readiness ladder, the Coop brief and the week
// nudges. No I/O; the server and UI hand in the week, DevOps results and the plan.
import { freeMinutes } from "../week/free.ts";
import type { ClientPortfolio, IsoDate, PortfolioItem, Slot, Week, WorkItem } from "../week/types.ts";

/** The week plan's features as these rules need them (the store's WeekFeature fits). */
export type FeatureLike = { clientKey: string; itemId: number; title: string; blocks: number; slots: readonly { date: IsoDate; half: "AM" | "PM" }[] };

export type Block = { date: IsoDate; half: "AM" | "PM"; freeMinutes: number; totalMinutes: number; pto: boolean; /** An Open half-day a feature of this client is placed on. */ open: boolean };

const windowMinutes = (s: Slot) => s.windows.reduce((m, w) => m + Temporal.Instant.from(w.start).until(Temporal.Instant.from(w.end)).total("minutes"), 0);

function blockOf(s: Slot, open: boolean): Block {
  return { date: s.date, half: s.half as "AM" | "PM", freeMinutes: s.pto ? 0 : freeMinutes(s), totalMinutes: windowMinutes(s), pto: s.pto, open };
}

/** A client's focus blocks in the week (Dataverse or standing; the block the card shows), with free time after meetings. */
export function clientBlocks(week: Week, clientKey: string): Block[] {
  return week.days.flatMap((d) => [d.am, d.pm].filter((s) => s.focus[0]?.clientKey === clientKey).map((s) => blockOf(s, false)));
}

export type Verdict = "none" | "fits" | "tight" | "over";

export type ClientFit = {
  clientKey: string;
  clientName: string;
  blocks: Block[];
  /** Blocks' free share (free over working minutes), less unpaid borrowed time, to one decimal. */
  availableBlocks: number;
  committedBlocks: number;
  borrowedMinutes: number;
  verdict: Verdict;
};

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

/** Less than half a block to spare is tight. */
export const TIGHT_BLOCKS = 0.5;
/** A block's length when a client has none to average (unpaid borrowed time is still owed). */
const NOMINAL_BLOCK_MINUTES = 240;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Fit per client: committed blocks (the sum of its features' blocks) against its available focus blocks next week,
 * after PTO, meetings and unavailable time (all already in each slot's free time) and the client's unpaid borrowed
 * time. Open half-days a feature is placed on count as that client's blocks. No sizing or forecasting.
 */
export function weekFit(week: Week, features: readonly FeatureLike[], o: { borrowedMinutes: Readonly<Record<string, number>> }): ClientFit[] {
  const names = new Map<string, string>();
  for (const d of week.days) for (const s of [d.am, d.pm]) if (s.focus[0] && !names.has(s.focus[0].clientKey)) names.set(s.focus[0].clientKey, s.focus[0].clientName);
  for (const f of features) if (!names.has(f.clientKey)) names.set(f.clientKey, f.clientKey);
  const slotAt = (date: IsoDate, half: "AM" | "PM") => {
    const d = week.days.find((x) => x.date === date);
    return d ? (half === "AM" ? d.am : d.pm) : null;
  };
  return [...names].map(([clientKey, clientName]) => {
    const mine = features.filter((f) => f.clientKey === clientKey);
    const placedOpen = new Map<string, Block>();
    for (const f of mine)
      for (const p of f.slots) {
        const s = slotAt(p.date, p.half);
        if (s?.open && !placedOpen.has(`${p.date}${p.half}`)) placedOpen.set(`${p.date}${p.half}`, blockOf(s, true));
      }
    const blocks = [...clientBlocks(week, clientKey), ...placedOpen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.half.localeCompare(b.half));
    const share = blocks.reduce((n, b) => n + (b.totalMinutes > 0 ? Math.min(1, b.freeMinutes / b.totalMinutes) : 0), 0);
    const working = blocks.filter((b) => b.totalMinutes > 0);
    const avg = working.length ? working.reduce((n, b) => n + b.totalMinutes, 0) / working.length : NOMINAL_BLOCK_MINUTES;
    const borrowed = o.borrowedMinutes[clientKey] ?? 0;
    const availableBlocks = Math.max(0, round1(share - borrowed / avg));
    const committedBlocks = mine.reduce((n, f) => n + f.blocks, 0);
    const verdict: Verdict = committedBlocks === 0 ? "none" : committedBlocks > availableBlocks + 1e-9 ? "over" : committedBlocks > availableBlocks - TIGHT_BLOCKS ? "tight" : "fits";
    return { clientKey, clientName, blocks, availableBlocks, committedBlocks, borrowedMinutes: borrowed, verdict };
  });
}

export type ReadinessKind = "block_needs_work" | "needs_breakdown" | "needs_features" | "captures_to_sort" | "no_target_date";

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
  /** Block needs work: the open "ask about priorities" loop for that client and week, or null. */
  loopId?: number | null;
};

export type WorkLike = { clientKey: string; status: string; fromCache: boolean; items: readonly WorkItem[] };
export type LoopRef = { id: number; kind: string; clientKey: string | null; ruleKey: string | null; closedAt: string | null };

export type ReadinessInput = {
  week: Week;
  portfolios: readonly ClientPortfolio[];
  features: readonly FeatureLike[];
  /** My open work per client (week.load's DevOps); null when DevOps wasn't loaded. */
  work: readonly WorkLike[] | null;
  marks: readonly { clientKey: string; itemId: number; markedAt: string }[];
  loops: readonly LoopRef[];
  /** Local draft stories (step 9), to count those under each feature. */
  drafts?: readonly { clientKey: string; parentItemId: number | null }[];
  /** Captures not sorted yet (step 9). */
  captures?: number;
};

const ORDER: readonly ReadinessKind[] = ["block_needs_work", "needs_breakdown", "needs_features", "captures_to_sort", "no_target_date"];

/** The "ask about priorities" loop key for a client and week. */
export const prioritiesKey = (weekStart: IsoDate, clientKey: string) => `priorities:${weekStart}:${clientKey}`;

/**
 * The readiness ladder, as one short list with one action each:
 * a client block next week with no open work assigned to me ("Block needs work"); a committed feature with no open
 * stories, anyone's ("Needs breakdown"); an epic with no open features ("Needs features"); a committed feature with
 * no target date ("No target date", soft). Anything DevOps can't say right now (not loaded, failed, cached) isn't flagged.
 */
export function readiness(i: ReadinessInput): ReadinessFlag[] {
  const out: ReadinessFlag[] = [];
  const find = (clientKey: string, id: number): PortfolioItem | undefined => i.portfolios.find((p) => p.clientKey === clientKey)?.items.find((x) => x.id === id);

  const clients = new Set(i.week.days.flatMap((d) => [d.am, d.pm]).map((s) => s.focus[0]?.clientKey).filter((k): k is string => !!k));
  for (const clientKey of clients) {
    const w = i.work?.find((x) => x.clientKey === clientKey);
    if (!w || w.status !== "ok" || w.fromCache || w.items.length > 0) continue;
    const blocks = clientBlocks(i.week, clientKey).filter((b) => !b.pto).length;
    if (!blocks) continue;
    const loop = i.loops.find((l) => !l.closedAt && l.kind === "priorities" && l.ruleKey === prioritiesKey(i.week.weekStart, clientKey));
    out.push({ kind: "block_needs_work", clientKey, itemId: null, title: `No open work assigned to me for ${clientKey}`, url: null, soft: false, blocks, loopId: loop?.id ?? null });
  }
  for (const f of i.features) {
    const item = find(f.clientKey, f.itemId);
    if (!item) continue;
    if (!item.children.some((c) => c.open && c.level === "story"))
      out.push({
        kind: "needs_breakdown", clientKey: f.clientKey, itemId: f.itemId, title: item.title, url: item.url, soft: false,
        markedAt: i.marks.find((m) => m.clientKey === f.clientKey && m.itemId === f.itemId)?.markedAt ?? null,
        drafts: (i.drafts ?? []).filter((d) => d.clientKey === f.clientKey && d.parentItemId === f.itemId).length,
      });
  }
  for (const p of i.portfolios)
    for (const e of p.items.filter((x) => x.tier === "epic"))
      if (!e.children.some((c) => c.open && c.level === "portfolio")) out.push({ kind: "needs_features", clientKey: p.clientKey, itemId: e.id, title: e.title, url: e.url, soft: false });
  for (const f of i.features) {
    const item = find(f.clientKey, f.itemId);
    if (item && !item.targetDate) out.push({ kind: "no_target_date", clientKey: f.clientKey, itemId: f.itemId, title: item.title, url: item.url, soft: true });
  }
  if (i.captures) out.push({ kind: "captures_to_sort", clientKey: "", itemId: null, title: `${i.captures} unprocessed capture${i.captures === 1 ? "" : "s"}`, url: null, soft: false, count: i.captures });
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

const longDate = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/**
 * The Coop brief: copyable markdown for one feature, for Coop on the client VM to propose user stories. Only DevOps
 * fields (and the client's name): nothing from Coopilot's plan, notes or loops, and no assignees.
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
    "- Size: S (about 1 hour), M (about 2 hours) or L (about a half-day block)",
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
 * and only while that week isn't committed (the caller fires each once, markOnce). Q50: given today's working start
 * (null: no working time today), one not sent on its day (a PTO day) is due again from that start, until its week
 * starts (Thursday's and Friday's) or ends (Monday's). The top-bar badge shows the week of the latest nudge time
 * passed (looking back a week) until that week is committed.
 */
export function weekNudges(
  now: Temporal.ZonedDateTime,
  times: NudgeTimes,
  committed: (weekStart: IsoDate) => boolean,
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
  const due = passed.filter((m) => (m.day === today.toString() || late(m)) && !committed(m.weekStart)).map((m) => ({ key: m.key, weekStart: m.weekStart }));
  const last = passed.sort((a, b) => Temporal.ZonedDateTime.compare(a.at, b.at)).at(-1);
  return { due, badge: last && !committed(last.weekStart) ? last.weekStart : null };
}

export const WEEK_NUDGE_MESSAGE = (weekStart: IsoDate, thisWeek: boolean) =>
  `${thisWeek ? "This week" : `Next week (${Temporal.PlainDate.from(weekStart).toLocaleString("en-US", { month: "short", day: "numeric" })})`} isn't planned yet: commit features per client. Open Coopilot and press W.`;
