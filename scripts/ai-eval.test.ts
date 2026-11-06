// HK-4: the model comparison's harness keeps working: every case's schema is one strict mode takes, the dry run
// passes each case through the real service, and every model it compares has prices.
import { describe, expect, it } from "vitest";
import { strictProblems } from "../ai/schema.ts";
import { CASES, MODEL_PRICES, runEval } from "./ai-eval.ts";

describe("ai-eval (HK-4)", () => {
  it("every case's schema is strict-mode ready", () => {
    for (const c of CASES) expect(strictProblems(c.schema), `${c.task}/${c.id}`).toEqual([]);
  });
  it("a dry run over the stub runs every case through the service on each model", async () => {
    const rows = await runEval({ models: ["gpt-6-luna", "gpt-6-luna@flex"], live: false, runs: 1 });
    expect(rows.reduce((n, r) => n + r.runs, 0)).toBe(CASES.length * 2);
    expect(rows.every((r) => r.passed === r.runs && r.invalid === 0)).toBe(true);
    // Flex is half the standard price for the same tokens.
    const cost = (m: string) => rows.filter((r) => r.model === m).reduce((n, r) => n + r.costMicros, 0);
    expect(cost("gpt-6-luna@flex")).toBeCloseTo(cost("gpt-6-luna") / 2, -1);
  });
  it("prices match the app's default for the default model", async () => {
    const { DEFAULT_AI } = await import("../server/appconfig.ts");
    expect(MODEL_PRICES[DEFAULT_AI.model]).toEqual(DEFAULT_AI.prices);
  });
});
