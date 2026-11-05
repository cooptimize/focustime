// HK-1: telemetry's own health for Admin › Status, and the Teams poll's counts for its job operation.
import type { CycleResult } from "../actions/request-poll.ts";
import type { StatusSource } from "../actions/status-rows.ts";
import type { Telemetry } from "../log/appinsights.ts";
import type { Job } from "../log/operation.ts";

/** One row: how many items went to Application Insights since the start, and what didn't arrive, once it happens. */
export function telemetryStatusSource(t: Pick<Telemetry, "status">): StatusSource {
  return {
    id: "telemetry",
    title: "Telemetry",
    note: "What FocusTime sends to Application Insights: operation names, counts, durations and outcomes, never content.",
    async rows() {
      const s = t.status();
      const lost = s.dropped + s.refused;
      const parts = [`${s.sent} ${s.sent === 1 ? "item" : "items"} sent since the app started`];
      if (s.dropped) parts.push(`${s.dropped} dropped`);
      if (s.refused) parts.push(`${s.refused} refused`);
      if (s.lastProblem) parts.push(`last problem ${s.lastProblem.status === null ? "no answer" : `HTTP ${s.lastProblem.status}`}`);
      return [{ id: "appinsights", label: "Application Insights", state: lost ? "warn" : s.sent ? "ok" : "idle", detail: parts.join(" · "), lastCheck: s.lastProblem?.at ?? null }];
    },
  };
}

/** A Teams poll's result as its job's counts (the AI pipeline's among them); partial when a chat couldn't be read. */
export function cycleCounts(job: Job, r: CycleResult): CycleResult {
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === "number") counts[k] = v;
  job.set({ counts, outcome: r.failures ? "partial" : "ok" });
  return r;
}
