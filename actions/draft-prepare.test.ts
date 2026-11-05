// CP-1: a captured draft's AI version, in the background. The real ai/ service on a stub provider, the real plan store,
// a fake DevOps read side. Ready with a parent, Needs a parent, AI off (switch, client, cap) as a plain draft with no
// error, no write PAT sends nothing, a lost "writing" ends, one client only in the request, my own text untouched.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { PrepareAnswer } from "../plan/capture-prepare.ts";
import { buildProcessModel } from "../plan/process.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aClientProcess, anAiApp, anExemplarCandidate, withTeam } from "../test/builders/index.ts";
import { draftAiAction, type DraftAiView, type PrepareContext } from "./draft-prepare.ts";
import type { CaptureFeatures } from "./types.ts";
import { isInternalKey } from "./client-accounts.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";

const NOW = "2026-11-05T15:00:00Z";
const CLIENT = "contoso";
const OTHER = "fabrikam";

function setup(o: { client?: string; allowed?: string[]; on?: boolean; write?: string[]; answer?: (c: ProviderCall) => PrepareAnswer | string; spent?: number; noAi?: boolean } = {}) {
  let now = NOW;
  // GD-1: the draft's client (Contoso by default; Cooptimize Internal for the Internal tests).
  const K = o.client ?? CLIENT;
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York") });
  const toml = `${STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')}\n[clients.contoso]\nname = "Contoso"\n[clients.fabrikam]\nname = "Fabrikam"\n`;
  const cfg = (() => {
    const p = withTeam(parseConfig(toml), { ai: { on: o.on ?? true, allowed: o.allowed ?? [K] } });
    if (!p.ok) throw new Error("config");
    return p.config;
  })();
  const calls: ProviderCall[] = [];
  const answer = o.answer ?? (() => ({ title: "Export the invoice list as CSV", description: "Finance needs the invoice list in a spreadsheet each month.", acceptance_criteria: "- A CSV button on the invoice list\n- The file has every visible column", type: "User Story", parent_id: 437, parent_reason: "It belongs to the monthly export feature" }));
  const features: Record<string, CaptureFeatures> = {
    [CLIENT]: { clientKey: CLIENT, status: "ok", features: [{ id: 437, title: "Monthly export for finance", state: "Active", type: "Feature" }, { id: 438, title: "Single sign-on", state: "Active", type: "Feature" }] as never, epics: [{ id: 400, title: "Reporting", state: "Active", type: "Epic" }] as never },
    [INTERNAL_CLIENT]: { clientKey: INTERNAL_CLIENT, status: "ok", features: [{ id: 437, title: "Monthly export for finance", state: "Active", type: "Feature" }] as never, epics: [] },
    [OTHER]: { clientKey: OTHER, status: "ok", features: [{ id: 901, title: "Fabrikam secret roadmap", state: "Active", type: "Feature" }] as never, epics: [] },
  };
  const reads: string[] = [];
  const ctx: PrepareContext = {
    plan,
    config: async () => cfg,
    ai: async () =>
      o.noAi
        ? null
        : createAi({
            provider: async () => stubProvider({ respond: (x) => (calls.push(x), (() => { const a = answer(x); return typeof a === "string" ? a : JSON.stringify(a); })()) }),
            app: anAiApp(),
            rules: async () => cfg.aiRules,
            // GD-1: Internal as dispatch decides it (clientAccounts()'s why "internal").
            guard: async (client) => ({ directory: [{ key: CLIENT, names: ["Contoso"], projects: ["Contoso ERP"], itemIds: [437, 438, 400] }, { key: OTHER, names: ["Fabrikam"], projects: ["Fabrikam Web"], itemIds: [901] }], homeDomains: ["example.com"], forbidden: [], internal: await isInternalKey(null, client) }),
            log: { add: async () => {}, spentMicros: async () => o.spent ?? 0, recent: async () => [] },
            appSpend: { get: async () => 0, add: async () => {} },
            now: () => now,
          }),
    writeClients: async () => o.write ?? [K],
    features: async (_c, k) => (reads.push(`features:${k}`), features[k]!),
    model: async (_c, k) => (reads.push(`model:${k}`), buildProcessModel(aClientProcess())),
    pool: async (_c, k) => (reads.push(`pool:${k}`), k === K ? [anExemplarCandidate({ id: 301 }), anExemplarCandidate({ id: 302 }), anExemplarCandidate({ id: 303 })] : [anExemplarCandidate({ id: 902, title: "Fabrikam secret plan" })]),
    now: () => now,
  };
  const run = async (action: "draft.prepare" | "draft.get", input: unknown) => {
    const r = await draftAiAction(ctx, action, input);
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as DraftAiView;
  };
  const capture = async (text: string, as: "draft" | "draft_feature" = "draft", parentItemId: number | null = null) => {
    const c = await plan.addCapture({ text, clientKey: K });
    const routed = await plan.routeCapture(c.id, as === "draft" ? { as, clientKey: K, parentItemId, title: text, size: "M" } : { as, clientKey: K, parentItemId, title: text });
    return routed.routedId!;
  };
  return { plan, run, capture, calls, reads, setNow: (t: string) => void (now = t) };
}

describe("draft.prepare (CP-1)", () => {
  it("prepares a ready draft with a parent, and keeps my own title", async () => {
    const t = setup();
    const id = await t.capture("csv export of invoices for finance");
    const v = await t.run("draft.prepare", { id });
    expect(v.draft.ai).toMatchObject({ state: "ready", title: "Export the invoice list as CSV", type: "User Story", parentId: 437, parentReason: "It belongs to the monthly export feature", ranAt: NOW });
    expect(v.draft.ai?.acceptance).toContain("CSV button");
    // My own text stays the draft's; the AI version is beside it.
    expect(v.draft.title).toBe("csv export of invoices for finance");
    expect(v.draft.parentItemId).toBeNull();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.schemaName).toBe("capture_prepare");
    // Once per draft: asking again without `again` sends nothing.
    await t.run("draft.prepare", { id });
    expect(t.calls).toHaveLength(1);
  });

  // GD-1: Internal work names clients; a client's draft still may not.
  it("Internal: a capture draft naming two clients is sent, and an answer naming them is accepted", async () => {
    const t = setup({ client: INTERNAL_CLIENT, answer: () => ({ title: "Compare the Contoso and Fabrikam exports", description: "Contoso ERP and Fabrikam Web do it differently.", acceptance_criteria: "- Both compared", type: "User Story", parent_id: 437, parent_reason: "Export work" }) });
    const id = await t.capture("compare how Contoso and Fabrikam export invoices");
    const v = await t.run("draft.prepare", { id });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.input).toContain("Contoso and Fabrikam");
    expect(v.draft.ai).toMatchObject({ state: "ready", title: "Compare the Contoso and Fabrikam exports" });
  });

  it("a client: a capture draft naming another client is not sent; an answer naming one is not kept", async () => {
    const t = setup();
    const id = await t.capture("same as the Fabrikam export");
    const v = await t.run("draft.prepare", { id });
    expect(t.calls).toHaveLength(0);
    expect(v.draft.ai?.state).not.toBe("ready");
    const u = setup({ answer: () => ({ title: "Reuse the Fabrikam export", description: "x", acceptance_criteria: "- y", type: "User Story", parent_id: 437, parent_reason: "z" }) });
    const v2 = await u.run("draft.prepare", { id: await u.capture("csv export of invoices") });
    expect(u.calls).toHaveLength(1);
    expect(v2.draft.ai?.state).not.toBe("ready");
    expect(v2.draft.ai?.title ?? null).toBeNull();
  });

  it("sends only this client's types, parents and examples, and my text", async () => {
    const t = setup();
    const id = await t.capture("csv export of invoices for finance");
    await t.run("draft.prepare", { id });
    const input = JSON.parse(t.calls[0]!.input) as Record<string, unknown>;
    expect(input).toMatchObject({ kind: "story", client: "Contoso", note: "csv export of invoices for finance", offered_types: ["User Story"] });
    expect((input.offered_parents as { id: number }[]).map((p) => p.id)).toEqual([437, 438]);
    expect(t.calls[0]!.input).not.toMatch(/Fabrikam|901|902/);
    expect(t.reads.every((r) => r.endsWith(`:${CLIENT}`))).toBe(true);
    // The schema allows only what was offered.
    expect(JSON.stringify(t.calls[0]!.schema)).toContain("[437,438]");
  });

  it("a feature gets the epic tier's parents and the feature types, and no acceptance criteria", async () => {
    const t = setup({ answer: () => ({ title: "Reporting exports", description: "Exports for finance.", acceptance_criteria: "- not for a feature", type: "Feature", parent_id: 400, parent_reason: "Reporting" }) });
    const id = await t.capture("feature: reporting exports", "draft_feature");
    const v = await t.run("draft.prepare", { id });
    expect(v.draft.ai).toMatchObject({ state: "ready", type: "Feature", parentId: 400, acceptance: null });
    const input = JSON.parse(t.calls[0]!.input) as { offered_types: string[]; offered_parents: { id: number }[] };
    expect(input.offered_types).toEqual(["Feature"]);
    expect(input.offered_parents.map((p) => p.id)).toEqual([400]);
  });

  it("no parent that clearly fits: Needs a parent; a parent I chose already: ready", async () => {
    const t = setup({ answer: () => ({ title: "Tidy the login page", description: "", acceptance_criteria: "", type: "User Story", parent_id: null, parent_reason: "None of the features is about login" }) });
    const loose = await t.capture("tidy login page");
    expect((await t.run("draft.prepare", { id: loose })).draft.ai).toMatchObject({ state: "needs_parent", parentId: null });
    const placed = await t.capture("tidy login page again", "draft", 438);
    expect((await t.run("draft.prepare", { id: placed })).draft.ai).toMatchObject({ state: "ready", parentId: null });
  });

  it("AI off for FocusTime, off for the client, or not set up: a plain draft, nothing read or sent", async () => {
    for (const o of [{ on: false }, { allowed: [OTHER] }, { noAi: true }]) {
      const t = setup(o);
      const id = await t.capture("csv export");
      const v = await t.run("draft.prepare", { id });
      expect(v.draft.ai?.state).toBe("off");
      expect(v.draft.ai?.title).toBeNull();
      expect(t.calls).toEqual([]);
      expect(t.reads).toEqual([]);
    }
  });

  it("cap reached: a plain draft with the reason, no error", async () => {
    const t = setup({ spent: 50_000_000 });
    const id = await t.capture("csv export");
    const v = await t.run("draft.prepare", { id });
    expect(v.draft.ai).toMatchObject({ state: "off", note: "AI budget reached for this month" });
    expect(t.calls).toEqual([]);
  });

  it("no write PAT for the client: nothing is sent, and the view says so", async () => {
    const t = setup({ write: [] });
    const id = await t.capture("csv export");
    const v = await t.run("draft.prepare", { id });
    expect(v.canWrite).toBe(false);
    expect(v.draft.ai ?? null).toBeNull();
    expect(t.calls).toEqual([]);
    expect(t.reads).toEqual([]);
  });

  it("an answer that isn't usable is a plain draft, never retried", async () => {
    const t = setup({ answer: () => "{not json" });
    const id = await t.capture("csv export");
    const v = await t.run("draft.prepare", { id });
    expect(v.draft.ai?.state).toBe("failed");
    expect(t.calls).toHaveLength(1);
  });

  it("while writing a second prepare waits; a writing left by a lost request ends after two minutes", async () => {
    const t = setup();
    const id = await t.capture("csv export");
    await t.plan.setDraftAi(id, { state: "writing", title: null, description: null, acceptance: null, type: null, parentId: null, parentReason: null, note: null, ranAt: NOW });
    expect((await t.run("draft.prepare", { id })).draft.ai?.state).toBe("writing");
    expect(t.calls).toEqual([]);
    t.setNow("2026-11-05T15:03:00Z");
    expect((await t.run("draft.prepare", { id })).draft.ai?.state).toBe("ready");
    expect(t.calls).toHaveLength(1);
  });

  it("draft.get reads without sending anything", async () => {
    const t = setup();
    const id = await t.capture("csv export");
    const v = await t.run("draft.get", { id });
    expect(v).toMatchObject({ canWrite: true, now: NOW, draft: { id, title: "csv export" } });
    expect(t.calls).toEqual([]);
  });
});
