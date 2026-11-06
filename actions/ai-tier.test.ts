// AI-F1: aiFor's `waiting` (Sort again, Sort unsorted: buttons a person waits on) keeps a background task on standard;
// without it the same task runs on Flex.
import { expect, it } from "vitest";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import { anAiApp, anAiRules } from "../test/builders/index.ts";
import { aiFor, type ActionContext } from "./dispatch.ts";

it("a person waiting: standard; the poll's own run: Flex", async () => {
  const calls: ProviderCall[] = [];
  const ctx = {
    loadConfig: async () => ({ path: "/x", parsed: { ok: false, errors: [] } }),
    now: () => "2026-11-06T15:00:00Z",
    plan: { addAiRequest: async () => {}, aiSpentMicros: async () => 0, aiRequests: async () => [] },
    ai: { app: anAiApp(), provider: async () => stubProvider({ respond: (c) => (calls.push(c), '{"ok":true}') }), appSpend: { get: async () => 0, add: async () => {} } },
  } as unknown as ActionContext;
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } as const;
  const task = { name: "asks.classify", client: "fabrikam", instructions: "Answer." };
  const rules = anAiRules();
  await (await aiFor(ctx, { rules, waiting: true }))!.run(task, "go", schema as never);
  await (await aiFor(ctx, { rules }))!.run(task, "go", schema as never);
  expect(calls.map((c) => c.serviceTier)).toEqual([undefined, "flex"]);
});
