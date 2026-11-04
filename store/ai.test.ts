// AI-0: the AI request log (a person's table) and the app's monthly spend (an app table), on SQLite and SQL Server.
// The log keeps only the listed fields, sums a month's cost per person, and each person sees only their own rows; the
// app's total adds every person's cost per month. Run through the service, no column of either table ever holds the
// instructions, the input or the answer.
import { expect, it } from "vitest";
import { addUsers, forEachDriver } from "../test/db.ts";
import { aClientEntry, anAiApp, anAiPerson } from "../test/builders/index.ts";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { AiLogEntry } from "../ai/types.ts";
import { appSpendStore } from "./ai-spend.ts";
import { planStoreOn } from "./plan-store.ts";

const NOW = "2026-11-04T15:00:00Z";
const now = () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York");
const entry = (o: Partial<AiLogEntry> = {}): AiLogEntry => ({ at: NOW, task: "test_ai", clientKey: null, model: "test-model", inputTokens: 100, outputTokens: 20, costMicros: 140, latencyMs: 900, outcome: "ok", detail: null, ...o });

await forEachDriver("AI log and spend (AI-0)", ({ open }) => {
  async function setup() {
    const db = (await open()).conn;
    await addUsers(db, "ana", "ben");
    return { db, ana: planStoreOn(db, { userId: "ana", now }), ben: planStoreOn(db, { userId: "ben", now }), spend: appSpendStore(db, () => Temporal.Instant.from(NOW)) };
  }

  it("the log: only the listed fields, newest first, a month's sum, one person's rows only", async () => {
    const { db, ana, ben } = await setup();
    await ana.addAiRequest(entry({ at: "2026-10-31T23:59:59Z", costMicros: 1000 }));
    await ana.addAiRequest(entry({ at: "2026-11-01T00:00:00Z" }));
    await ana.addAiRequest(entry({ at: "2026-11-04T14:00:00Z", task: "draft_title", clientKey: "fabrikam", outcome: "refused", detail: "refused_client", inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: 0 }));
    await ben.addAiRequest(entry({ costMicros: 5000 }));
    expect(await ana.aiSpentMicros("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toBe(140);
    expect(await ben.aiSpentMicros("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")).toBe(5000);
    const recent = await ana.aiRequests(2);
    expect(recent).toEqual([entry({ at: "2026-11-04T14:00:00Z", task: "draft_title", clientKey: "fabrikam", outcome: "refused", detail: "refused_client", inputTokens: 0, outputTokens: 0, costMicros: 0, latencyMs: 0 }), entry({ at: "2026-11-01T00:00:00Z" })]);
    const cols = Object.keys((await db.get("SELECT * FROM ai_requests")) as object).sort();
    expect(cols).toEqual(["at", "client_key", "cost_micros", "detail", "id", "input_tokens", "latency_ms", "model", "outcome", "output_tokens", "task", "user_id"]);
  });

  it("AP-2, the guard's item map: ids per client, only new ones added, one person's only, kept after a restart", async () => {
    const { db, ana, ben } = await setup();
    expect(await ana.rememberItemClient("fabrikam", [4101, 4102, 4101])).toBe(2);
    expect(await ana.rememberItemClient("fabrikam", [4102, 4103])).toBe(1);
    expect(await ana.rememberItemClient("northwind", [4101, -3, 1.5])).toBe(1);
    expect(await ana.rememberItemClient("", [1])).toBe(0);
    const restarted = planStoreOn(db, { userId: "ana", now });
    const map = await restarted.itemClients();
    expect(Object.fromEntries([...map].map(([k, v]) => [k, v.sort((a, b) => a - b)]))).toEqual({ fabrikam: [4101, 4102, 4103], northwind: [4101] });
    expect((await ben.itemClients()).size).toBe(0);
  });

  it("the app's spend: one total per month across people", async () => {
    const { spend } = await setup();
    expect(await spend.get("2026-11")).toBe(0);
    await spend.add("2026-11", 140);
    await spend.add("2026-11", 60);
    await spend.add("2026-12", 5);
    await spend.add("2026-12", 0);
    expect([await spend.get("2026-11"), await spend.get("2026-12")]).toEqual([200, 5]);
    await expect(spend.get("Nov")).rejects.toThrow();
  });

  it("through the service: no prompt, input or answer text in any stored row", async () => {
    const { db, ana, spend } = await setup();
    const WORDS = "ZEBRA-QUOKKA-1234";
    const replies = [JSON.stringify({ reply: "ok" }), JSON.stringify({ title: `${WORDS} answer` }), "not json"];
    const ai = createAi({
      provider: async () => stubProvider({ respond: () => replies.shift() ?? "{}" }),
      app: anAiApp(),
      person: async () => anAiPerson({ allowedClients: ["fabrikam"] }),
      guard: async () => ({ directory: [aClientEntry({ key: "fabrikam" }), aClientEntry({ key: "northwind", names: ["Northwind Traders"], projects: [], itemIds: [] })], homeDomains: ["cooptimize.example"], forbidden: [] }),
      log: { add: (e) => ana.addAiRequest(e), spentMicros: (a, b) => ana.aiSpentMicros(a, b), recent: (n) => ana.aiRequests(n) },
      appSpend: spend,
      now: () => NOW,
    });
    const schema = { type: "object" as const, properties: { title: { type: "string" as const } }, required: ["title"], additionalProperties: false as const };
    expect((await ai.test()).ok).toBe(true);
    expect((await ai.run({ name: "draft_title", client: "fabrikam", instructions: `Title it. ${WORDS}` }, `Request ${WORDS}`, schema)).ok).toBe(true);
    expect((await ai.run({ name: "draft_title", client: "fabrikam", instructions: "Title it." }, `Request ${WORDS}`, schema)).ok).toBe(false);
    expect((await ai.run({ name: "draft_title", client: "fabrikam", instructions: "Title it." }, `Northwind Traders ${WORDS}`, schema)).ok).toBe(false);
    const rows = JSON.stringify([await db.all("SELECT * FROM ai_requests"), await db.all("SELECT * FROM ai_app_spend")]);
    expect((await ana.aiRequests(10)).map((e) => e.outcome)).toEqual(["refused", "invalid", "ok", "ok"]);
    for (const w of [WORDS, "Title it", "Request", "Reply with ok", "answer", "not json"]) expect(rows).not.toContain(w);
    expect(await spend.get("2026-11")).toBe(await ana.aiSpentMicros("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"));
  });
});
