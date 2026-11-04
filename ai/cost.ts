// AI-0: estimated cost from the token counts the provider reports, at the app's prices (app settings, not code), in
// millionths of a dollar so sums stay exact. Months are calendar months in UTC, for the person and the app alike.
import type { Usage } from "./types.ts";

/** USD per million tokens. Cached input is part of input; reasoning tokens are part of output (OpenAI's usage). */
export type Prices = { inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number };

export function costMicros(u: Usage, p: Prices): number {
  const cached = Math.min(u.cachedTokens, u.inputTokens);
  return Math.round((u.inputTokens - cached) * p.inputPerMillion + cached * p.cachedInputPerMillion + u.outputTokens * p.outputPerMillion);
}

/** "2026-11" for an instant (UTC). */
export const monthOf = (instantIso: string): string => Temporal.Instant.from(instantIso).toZonedDateTimeISO("UTC").toPlainDate().toPlainYearMonth().toString();

/** The month's first instant and the next month's (UTC), for "between" reads. */
export function monthBounds(month: string): { from: string; to: string } {
  const ym = Temporal.PlainYearMonth.from(month);
  const at = (m: Temporal.PlainYearMonth) => m.toPlainDate({ day: 1 }).toZonedDateTime("UTC").toInstant().toString();
  return { from: at(ym), to: at(ym.add({ months: 1 })) };
}

export const usd = (micros: number): number => micros / 1_000_000;
export const micros = (dollars: number): number => Math.round(dollars * 1_000_000);

/** "$0.42", "$0.0031" for small amounts (two significant digits under a cent), "$10" for whole dollars. */
export function fmtUsd(micro: number): string {
  const d = micro / 1_000_000;
  if (d === 0) return "$0";
  if (Number.isInteger(d)) return `$${d}`;
  if (d < 0.0001) return "under $0.0001";
  if (d < 0.01) return `$${Number(d.toPrecision(2))}`;
  return `$${d.toFixed(2)}`;
}
