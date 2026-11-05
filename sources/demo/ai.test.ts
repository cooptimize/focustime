// DM-1: the demo's AI: a real answer when one is allowed and fits, else the stored sample (slow, error, wrong shape,
// the session's cap, AI off, seeding). A guard refusal happens before the provider, so it never gets a sample.
import { describe, expect, it } from "vitest";
import type { AiProvider, ProviderCall, ProviderReply } from "../../ai/types.ts";
import { dispatch } from "../../actions/dispatch.ts";
import { createDemoContext, demoSessionOf, seedDemo } from "../../server/demo.ts";
import { demoAi, type RealAi } from "./ai.ts";

const SCHEMA = { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" } } } as const;
const call = (o: Partial<ProviderCall> = {}): ProviderCall => ({ model: "m", instructions: "", input: "{}", schemaName: "test_task", schema: SCHEMA as never, maxOutputTokens: 100, timeoutMs: 1000, reasoningEffort: null, ...o });
const usage = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 };
const PRICES = { inputPerMillion: 0.5, cachedInputPerMillion: 0, outputPerMillion: 0 }; // 0.5 USD per call

function real(reply: () => Promise<ProviderReply>, allowed = true): RealAi & { calls: number } {
  const r = { calls: 0 } as RealAi & { calls: number };
  const provider: AiProvider = { name: "openai", call: async () => (r.calls++, reply()) };
  return Object.assign(r, { provider: async () => provider, allowed: async () => allowed, prices: PRICES });
}
const fits = () => Promise.resolve<ProviderReply>({ ok: true, text: JSON.stringify({ title: "Real" }), model: "m", usage });

describe("the demo's AI (DM-1)", () => {
  it("answers for real when allowed and the answer fits", async () => {
    const ai = demoAi({ real: real(fits) });
    const r = await ai.provider.call(call());
    expect(r.ok && JSON.parse(r.text)).toEqual({ title: "Real" });
    expect(ai.log).toMatchObject({ real: 1, samples: 0 });
  });
  it.each([
    ["slow", () => new Promise<ProviderReply>((ok) => setTimeout(() => void fits().then(ok), 200))],
    ["provider error", () => Promise.resolve<ProviderReply>({ ok: false, kind: "provider", status: 500 } as ProviderReply)],
    ["answer didn't fit", () => Promise.resolve<ProviderReply>({ ok: true, text: JSON.stringify({ nope: 1 }), model: "m", usage })],
  ])("falls back to the sample: %s", async (why, reply) => {
    const ai = demoAi({ real: real(reply), timeoutMs: 50 });
    const r = await ai.provider.call(call());
    expect(r.ok && r.model).toBe("demo samples");
    expect(ai.log).toMatchObject({ samples: 1, lastReason: why });
  });
  it("stops real calls at the session's cap, when AI is off, and while seeding", async () => {
    const r = real(fits);
    const ai = demoAi({ real: r, sessionCapUsd: 0.9 });
    await ai.provider.call(call());
    await ai.provider.call(call()); // 1.0 USD spent now
    await ai.provider.call(call());
    expect(r.calls).toBe(2);
    expect(ai.log.lastReason).toBe("the demo session's cap");
    const off = demoAi({ real: real(fits, false) });
    await off.provider.call(call());
    expect(off.log.lastReason).toBe("AI is off or the app's cap is reached");
    const seeding = real(fits);
    const s = demoAi({ real: seeding });
    s.hold(true);
    await s.provider.call(call());
    expect(seeding.calls).toBe(0);
  });
  it("a guard refusal in the demo is refused, and no sample answers it", async () => {
    const ctx = createDemoContext({ now: () => "2026-11-02T14:30:00Z", demo: { on: true, set: async () => {} } });
    await seedDemo(ctx);
    const before = { ...demoSessionOf(ctx)!.ai.log };
    const r = await dispatch(ctx, { action: "capture.add", input: { text: `Draft: rotate the key sk-${"Ab3".repeat(10)} for Northwind`, clientKey: "Northwind" } });
    expect(r.ok).toBe(true); // the capture is saved; its AI step is refused
    const sb = await dispatch(ctx, { action: "stories.run", input: { clientKey: "Northwind", featureId: 1120, note: `the key is sk-${"Ab3".repeat(10)}` } });
    expect(sb).toMatchObject({ ok: false });
    expect(String((sb as { error?: string }).error)).toMatch(/key, token or secret/);
    expect(demoSessionOf(ctx)!.ai.log.samples).toBe(before.samples);
  });
});
