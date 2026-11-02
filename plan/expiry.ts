// Secrets and PATs that expire soon (step 14.5, D256, Q82): one line each for Today, from expiry dates I entered
// (DevOps write PATs per client, app secrets in [secrets]). Never the secrets themselves. Pure.
import type { IsoDate } from "../week/types.ts";

export const EXPIRY_WARN_DAYS = 14;
export type Expiring = { key: string; label: string; expires: IsoDate; section: string };
export type ExpiryLine = { key: string; text: string; days: number; section: string };

/** "in 9 days", "tomorrow", "today", "1 day ago". */
export function whenWords(days: number): string {
  if (days > 1) return `expires in ${days} days`;
  if (days === 1) return "expires tomorrow";
  if (days === 0) return "expires today";
  return `expired ${-days} day${days === -1 ? "" : "s"} ago`;
}

/** Each one expiring within `within` days (or already expired), soonest first. */
export function expiringSoon(list: readonly Expiring[], today: IsoDate, within = EXPIRY_WARN_DAYS): ExpiryLine[] {
  const t = Temporal.PlainDate.from(today);
  return list
    .map((x) => ({ x, days: t.until(Temporal.PlainDate.from(x.expires), { largestUnit: "days" }).days }))
    .filter(({ days }) => days <= within)
    .sort((a, b) => a.days - b.days || a.x.label.localeCompare(b.x.label))
    .map(({ x, days }) => ({ key: x.key, text: `${x.label} ${whenWords(days)}. Update in Settings`, days, section: x.section }));
}
