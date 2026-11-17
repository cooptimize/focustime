// MC-1d: Last 20 requests shows a failed request's HTTP status (the provider's, a number) in its result; nothing else
// of the request. Fictional data only.
import { describe, expect, it } from "vitest";
import type { AiLogEntry, AiStatus } from "./types.ts";
import { aiView, statusOf } from "./view.ts";

const row = (o: Partial<AiLogEntry>): AiLogEntry => ({ at: "2026-11-10T17:00:00Z", task: "meeting.capture", clientKey: "contoso", model: "test-model", inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: 900, outcome: "ok", detail: null, cap: "person", tier: "standard", ...o });
const status = (recent: AiLogEntry[]): AiStatus => ({ setUp: true, provider: "openai", model: "test-model", on: true, allowedClients: [], capMicros: 10_000_000, appCapMicros: 100_000_000, spentMicros: 0, appReached: false, recent });

describe("MC-1d: Last 20 requests", () => {
  it("a failed request the provider answered says its HTTP status; one it didn't, and ok ones, read as before", () => {
    const v = aiView(status([row({ outcome: "provider_error", detail: "provider:400" }), row({ outcome: "provider_error", detail: "timeout" }), row({ outcome: "provider_error", detail: "rate_limited:429", tier: "flex" }), row({})]));
    expect(v.recentText.map((r) => r.outcome)).toEqual(["Failed · HTTP 400", "Failed", "Failed · HTTP 429", "OK"]);
    expect(statusOf("provider:503")).toBe(503);
    expect(statusOf("zero_budget")).toBeNull();
    expect(statusOf(null)).toBeNull();
  });
});
