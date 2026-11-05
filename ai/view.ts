// AI-0: Settings › AI's view of the AI state: amounts in words and the log's outcomes in plain words. Pure, and safe
// for the page to import (no server modules).
import { fmtUsd } from "./cost.ts";
import type { AiStatus } from "./types.ts";

export type AiView = AiStatus & { /** ADM-1: a cap an admin set to $0 ("AI budget is set to $0", never "reached"). */ zeroBudget: boolean; capText: string; spentText: string; recentText: { at: string; task: string; client: string | null; cost: string; outcome: string; detail: string | null }[] };

/** Outcome words for the log. */
export const OUTCOME_WORDS: Record<string, string> = { ok: "OK", refused: "Not sent", invalid: "Unusable answer", provider_error: "Failed", over_budget: "Over budget" };

export function aiView(s: AiStatus): AiView {
  return {
    ...s,
    zeroBudget: s.capMicros === 0 || s.appCapMicros === 0,
    capText: fmtUsd(s.capMicros),
    spentText: fmtUsd(s.spentMicros),
    recentText: s.recent.map((r) => ({ at: r.at, task: r.task, client: r.clientKey, cost: fmtUsd(r.costMicros), outcome: r.detail === "zero_budget" ? "Budget set to $0" : (OUTCOME_WORDS[r.outcome] ?? r.outcome), detail: r.detail })),
  };
}
