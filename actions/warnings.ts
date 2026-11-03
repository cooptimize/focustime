// Fresher timer warnings (step 6d, Q40): while a focus timer runs, the server reloads today's Outlook and Google
// calendars every 5 minutes and recomputes today's warning points, so a meeting added mid-session is warned about.
// Calendars only (no Dataverse or DevOps), loaded through their own 5-minute cache: never a forced refresh.
import { mondayOf, localToday } from "../week/dates.ts";
import { buildWeek } from "../week/build.ts";
import { warnPoints, type WarnPoint } from "../plan/timer.ts";
import { ownEventIds, withoutOwn } from "../plan/timebox.ts";
import type { CalEvent } from "../week/types.ts";
import type { ActionContext } from "./dispatch.ts";
import { userZone } from "../week/zone.ts";

export type WarningsContext = Pick<ActionContext, "loadConfig" | "makeOutlook" | "makeGoogle" | "plan" | "now">;

/** Reloads today's calendars (cache respected) and stores today's warning points. Returns how many points. */
export async function refreshTodayWarnings(ctx: WarningsContext): Promise<number | null> {
  const plan = ctx.plan;
  if (!plan) return null;
  const loaded = await ctx.loadConfig();
  if (!loaded.parsed.ok) return null;
  const cfg = loaded.parsed.config;
  const tz = userZone(cfg);
  const today = localToday(ctx.now(), tz);
  const weekStart = mondayOf(today);
  // Each calendar falls back to its cache inside the source and never throws; anything unexpected drops just that one.
  const [outlook, google] = await Promise.all([
    cfg.outlook ? ctx.makeOutlook(cfg.outlook, tz).load(weekStart).catch(() => null) : null,
    cfg.google ? ctx.makeGoogle(cfg.google, tz).load(weekStart).catch(() => null) : null,
  ]);
  // FocusTime's own timebox events are not meetings (step 12).
  const events: CalEvent[] = withoutOwn([...(outlook?.items ?? []), ...(google?.items ?? [])], ownEventIds(plan.ownEvents()));
  const sunday = Temporal.PlainDate.from(weekStart).add({ days: 6 }).toString();
  const week = buildWeek({ weekStart, patterns: [], events, config: cfg.week, unavailable: plan.unavailableBetween(weekStart, sunday), flex: plan.flexBetween(weekStart, sunday) });
  const day = week.days.find((d) => d.date === today);
  if (!day) return null;
  const points: WarnPoint[] = warnPoints(day, tz);
  plan.setState("warn_points", { date: today, points });
  return points.length;
}
