// A4: telemetry to Application Insights carries only the closed log fields and fixed route names.
import { describe, expect, it } from "vitest";
import { appInsights, envelopeOf, parseConnectionString, span } from "./appinsights.ts";

const CS = "InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://centralus-0.in.applicationinsights.azure.com/;LiveEndpoint=https://x/";

describe("Application Insights (A4)", () => {
  it("reads the connection string, and refuses one that isn't", () => {
    expect(parseConnectionString(CS)).toEqual({ iKey: "00000000-0000-4000-8000-000000000001", url: "https://centralus-0.in.applicationinsights.azure.com/v2.1/track" });
    expect(parseConnectionString("nonsense")).toBeNull();
    expect(span(1234)).toBe("0.00:00:01.234");
    expect(span(90_061_001)).toBe("1.01:01:01.001");
  });

  it("a source call with a status is a dependency, the rest a trace; only the closed fields", () => {
    const d = envelopeOf({ source: "outlook", op: "events", status: 200, durationMs: 12, count: 3 }, "k", new Date(0), "focustime") as { data: { baseType: string; baseData: Record<string, unknown> } };
    expect(d.data.baseType).toBe("RemoteDependencyData");
    expect(d.data.baseData.properties).toEqual({ source: "outlook", op: "events", status: "200", count: "3" });
    const t = envelopeOf({ source: "plan", op: "scheduler", kind: "idle" }, "k", new Date(0), "focustime") as { data: { baseType: string } };
    expect(t.data.baseType).toBe("MessageData");
  });

  it("sends in batches, nothing when idle, and drops a failed batch without retrying", async () => {
    const sent: unknown[][] = [];
    let ok = true;
    const fetch = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as unknown[]);
      return new Response("", { status: ok ? 200 : 500 });
    }) as unknown as typeof globalThis.fetch;
    const lines: unknown[] = [];
    const t = appInsights({ connectionString: CS, next: (r) => lines.push(r), fetch, everyMs: 60_000 })!;
    await t.flush();
    expect(sent).toHaveLength(0);
    t.request({ method: "POST", route: "/api/action", status: 200, durationMs: 5 });
    t.log({ source: "plan", op: "scheduler", kind: "idle" });
    await t.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain("POST /api/action");
    ok = false;
    t.log({ source: "plan", op: "x" });
    await t.flush();
    await t.flush();
    expect(sent).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ op: "telemetry", kind: "dropped" });
    t.stop();
  });
});
