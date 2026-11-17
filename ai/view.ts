// AI-0: Settings › AI's view of the AI state: amounts in words and the log's outcomes in plain words. Pure, and safe
// for the page to import (no server modules).
import { fmtUsd } from "./cost.ts";
import type { AiStatus } from "./types.ts";

export type AiView = AiStatus & { /** ADM-1: a cap an admin set to $0 ("AI budget is set to $0", never "reached"). */ zeroBudget: boolean; capText: string; spentText: string; recentText: { at: string; task: string; client: string | null; cost: string; outcome: string; detail: string | null }[] };

/** Outcome words for the log. */
export const OUTCOME_WORDS: Record<string, string> = { ok: "OK", refused: "Not sent", invalid: "Unusable answer", provider_error: "Failed", over_budget: "Over budget" };

/** MC-1d: a failed request's provider status, from its detail ("provider:400"), or null. */
export const statusOf = (detail: string | null): number | null => {
  const m = /:(\d{3})$/.exec(detail ?? "");
  return m ? Number(m[1]) : null;
};
/** The outcome in words; a failed request the provider answered says its HTTP status ("Failed · HTTP 400"). */
function outcomeText(outcome: string, detail: string | null): string {
  const words = OUTCOME_WORDS[outcome] ?? outcome;
  const status = statusOf(detail);
  return status !== null ? `${words} · HTTP ${status}` : words;
}

export function aiView(s: AiStatus): AiView {
  return {
    ...s,
    zeroBudget: s.capMicros === 0 || s.appCapMicros === 0,
    capText: fmtUsd(s.capMicros),
    spentText: fmtUsd(s.spentMicros),
    recentText: s.recent.map((r) => ({ at: r.at, task: r.task, client: r.clientKey, cost: r.tier === "flex" ? `${fmtUsd(r.costMicros)} · Flex` : fmtUsd(r.costMicros), outcome: r.detail === "zero_budget" ? "Budget set to $0" : outcomeText(r.outcome, r.detail), detail: r.detail })),
  };
}
