// DS-1: Draft stories through the real dispatcher, the real ai/ service (a stub provider), the plan store and the
// write framework on a fake dev.azure.com. Prepare shows the signals, the client's own examples and the cost; no write
// PAT sends nothing; AI off for the client says so; the guard refuses another client's name before anything is sent;
// a malformed answer, or one with a dependency on an unknown card, is a plain error and no cards; Publish creates the
// kept cards under the feature and records card → item; a lost answer is retried without a second item; a partial
// failure says what was created and Retry finishes the rest.
import { beforeEach, describe, expect, it } from "vitest";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { ExemplarCandidate, FeatureSignals } from "../plan/stories.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { COMPANY_PAT, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aCoopProposal, aFeatureSignals, anAiApp, anExemplarCandidate, aProposalsAnswer, withTeam } from "../test/builders/index.ts";
import { clearDevopsPreviews, type DevOpsPreview } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { DraftView } from "./story-actions.ts";

const NOW = "2026-11-04T15:00:00Z";
const COOP = "Cooptimize";
const FEATURE = 437;

function setup(o: { client?: string; allowed?: string[]; teamStyle?: string; signals?: Partial<FeatureSignals>; answer?: (c: ProviderCall) => string; parentType?: string } = {}) {
  clearDevopsPreviews();
  // GD-1: Cooptimize Internal by default; `client` runs the same Break down for a client.
  const K = o.client ?? COOP;
  const dv = fakeDevOpsWrite({ now: () => NOW, recurring: true });
  dv.add(FEATURE, { "System.WorkItemType": o.parentType ?? "Feature", "System.Title": "Monthly export for the finance team", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
  dv.add(441, { "System.WorkItemType": "User Story", "System.Title": "Pick the columns for the export", "System.State": "Closed" }, FEATURE);
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const toml = `${STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"')}\n[clients.Northwind]\nname = "Northwind"\n${K === COOP ? "" : `[clients.${K}]\nname = "${K}"\n`}`;
  const keyring = new Map<string, string>();
  const calls: ProviderCall[] = [];
  const signals = aFeatureSignals({ feature: { id: FEATURE, ...(o.parentType ? { type: o.parentType } : {}) }, children: [{ id: 441, title: "Pick the columns for the export", type: "User Story", state: "Closed" }], ...o.signals });
  // Each client's own pool; Northwind's must never show up for Cooptimize.
  const pools: Record<string, ExemplarCandidate[]> = {
    [K]: [anExemplarCandidate({ id: 301 }), anExemplarCandidate({ id: 302, title: "Monthly export for HR" }), anExemplarCandidate({ id: 303, areaPath: "Other" })],
    Northwind: [anExemplarCandidate({ id: 901, title: "Northwind secret plan" })],
  };
  const answer = o.answer ?? (() => JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [{ title: "Pick the columns", why: "already_covered", existing_item_id: 441, reason: "Done in #441" }] })));
  const target = (clientKey: string, withPat: boolean): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org: "cooptimize", project: `${clientKey} Project`, projectName: `${clientKey} Project`, email: "avery@cooptimize.example", pat: withPat ? new Pat(COMPANY_PAT) : null });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: withTeam(parseConfig(toml), { ai: { allowed: o.allowed ?? [K] }, rows: o.teamStyle ? [{ scope: `client:${K}`, key: "house_style", value: o.teamStyle }] : [] }) }),
    makeDataverse: () => ({ devopsTargets: async (keys: string[], x: { withPat?: boolean } = {}) => ({ ok: true, targets: keys.map((k) => target(k, x.withPat !== false)) }), myClients: async () => [] }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({
      forget: () => {},
      last: () => null,
      featureSignals: async (k: string, id: number) => (k === K && id === FEATURE ? { ok: true, value: signals } : { ok: false, message: "not here" }),
      exemplarPool: async (k: string) => ({ ok: true, value: pools[k] ?? [] }),
    }) as never,
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async () => {},
    plan,
    devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
    writePats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
    ai: { app: anAiApp(), provider: async () => stubProvider({ respond: (x) => (calls.push(x), answer(x)) }), appSpend: { get: async () => 0, add: async () => {} } },
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const fail = async (action: string, input: unknown) => {
    const r = await dispatch(c, { action, input });
    if (r.ok) throw new Error("expected failure");
    return r;
  };
  const enable = () => run("devops.set_write_pat", { clientKey: K, pat: WRITE_PAT });
  const draft = () => run<DraftView>("stories.run", { clientKey: K, featureId: FEATURE, note: "split by report" });
  const created = () => [...dv.items.values()].filter((i) => i.fields["System.Parent"] === FEATURE && i.id !== 441);
  return { dv, plan, run, fail, enable, draft, calls, created, client: K };
}

const cardsInput = (d: DraftView, f: (c: DraftView["cards"][number]) => Partial<DraftView["cards"][number]> = () => ({})) => d.cards.map((c) => { const x = { ...c, ...f(c) }; return { id: x.id, keep: x.keep, title: x.title, description: x.description, acceptance: x.acceptance, size: x.size }; });

describe("Draft stories", () => {
  beforeEach(() => clearDevopsPreviews());

  it("prepares: the item, its description, parent and children, and what's sent in plain words (BD-1)", async () => {
    const s = setup();
    type P = { item: { state: string; priority: number | null; description: string }; parent: { id: number; type: string; url: string } | null; children: { id: number }[]; sent: string[]; ai: string; write: boolean; writeMessage: string } & Record<string, unknown>;
    const p = await s.run<P>("stories.prepare", { clientKey: COOP, featureId: FEATURE });
    expect(p.item).toEqual({ state: "Active", priority: 2, description: "Finance needs the monthly totals as a CSV file." });
    expect(p.parent).toEqual({ id: 230, title: "Finance reporting", type: "Epic", url: "https://dev.azure.com/contoso/Contoso/_workitems/edit/230" });
    expect(p.children.map((c) => c.id)).toEqual([441]);
    expect(p.sent).toContain("3 examples from Cooptimize's own items, with their children");
    expect(p.sent).toContain("House style: learned from Cooptimize's own items");
    expect(p.sent).toContain("2 of 2 comments, newest first");
    // Removed from the panel: the field table, examples, house style text, cost and model.
    for (const k of ["signals", "exemplars", "style", "estimate", "model", "poolRead"]) expect(p, k).not.toHaveProperty(k);
    expect(p.ai).toBe("on");
    expect(p.write).toBe(false);
    expect(p.writeMessage).toBe("Add DevOps write access for Cooptimize in Settings");
    expect(s.calls).toHaveLength(0);
  });

  it("sends nothing without a write PAT", async () => {
    const s = setup();
    const r = await s.fail("stories.run", { clientKey: COOP, featureId: FEATURE });
    expect(r).toMatchObject({ status: 409, code: "no_write_pat", error: "Add DevOps write access for Cooptimize in Settings" });
    expect(s.calls).toHaveLength(0);
  });

  it("says AI is off for the client, and doesn't send", async () => {
    const s = setup({ allowed: [] });
    await s.enable();
    const p = await s.run<{ ai: string; aiMessage: string }>("stories.prepare", { clientKey: COOP, featureId: FEATURE });
    expect(p.ai).toBe("client_off");
    expect(p.aiMessage).toContain("AI is off for Cooptimize");
    expect((await s.fail("stories.run", { clientKey: COOP, featureId: FEATURE })).code).toBe("ai_off");
    expect(s.calls).toHaveLength(0);
  });

  // GD-1: Internal work names clients; in a client's Break down, another client's name never goes or comes back.
  it("Internal: a Break down naming two clients is sent, and an answer naming them is accepted and published", async () => {
    const answer = () => JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [], proposals: [aCoopProposal({ title: "Compare with the Northwind and Fabrikam exports" })] }));
    const s = setup({ answer, signals: { comments: [{ at: "2026-11-03T10:00:00Z", text: "Same as we did for Northwind and Fabrikam last spring" }] } });
    await s.enable();
    const d = await s.draft();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.input).toContain("Northwind and Fabrikam");
    expect(d.cards.map((c) => c.title)).toEqual(["Compare with the Northwind and Fabrikam exports"]);
    const pv = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    expect((await s.run<{ created: number }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) })).created).toBe(1);
  });

  it("Internal: a secret in the payload is still refused before anything is sent", async () => {
    const s = setup({ signals: { comments: [{ at: "2026-11-03T10:00:00Z", text: `the key is sk-${"Ab3".repeat(10)}` }] } });
    await s.enable();
    expect((await s.fail("stories.run", { clientKey: COOP, featureId: FEATURE })).error).toBe("Not sent: it contains something that looks like a key, token or secret");
    expect(s.calls).toHaveLength(0);
  });

  // GD-2: words travel (the feature's own comments may name a client); the answer's names are replaced and marked.
  it("GD-2: a client: the feature's own words may name another client; the answer's names are replaced and the draft says so", async () => {
    const answer = () => JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [], proposals: [aCoopProposal({ title: "Reuse the Northwind export", description: "Like Northwind did" })] }));
    const s = setup({ client: "Fabrikam", answer, signals: { comments: [{ at: "2026-11-03T10:00:00Z", text: "Same as we did for Northwind last spring" }] } });
    await s.enable();
    const d = await s.draft();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.input).toContain("Northwind last spring");
    // Never another client's records: Northwind's own items aren't offered as examples.
    expect(s.calls[0]!.input).not.toMatch(/Northwind secret plan|901/);
    expect(s.calls[0]!.instructions).toContain("Never name any other client");
    expect(d.namesRemoved).toBe(true);
    expect(d.cards.map((c) => [c.title, c.description])).toEqual([["Reuse the another client export", "Like another client did"]]);
  });

  it("GD-2: a client: a card I edited to name another client is flagged in the preview; Replace writes \"another client\"; Save anyway keeps my words", async () => {
    const s = setup({ client: "Fabrikam" });
    await s.enable();
    const d = await s.draft();
    await s.run("stories.save", { draftId: d.id, cards: cardsInput(d, (c) => (c.id === "P2" ? { description: "Like the Northwind Traders one" } : {})) });
    const pv = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    expect(pv.previews.find((p) => p.mentions)?.mentions).toEqual(["Northwind"]);
    // Confirm without seeing it through: refused, nothing written.
    const no = await s.run<{ created: number; failed: string[] }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) });
    expect(no.failed.join(" ")).toMatch(/mentions Northwind/);
    // Only the flagged card waits; the other one was written.
    expect(s.created()).toHaveLength(1);
    expect(JSON.stringify(s.created())).not.toMatch(/Northwind/);
    // One click: replaced, flag gone.
    const fixed = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id, replace: true });
    expect(fixed.previews.some((p) => p.mentions)).toBe(false);
    expect(JSON.stringify(fixed.previews)).not.toMatch(/Northwind/);
    // My own words can still go after the flag.
    const again = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    const r = await s.run<{ created: number }>("stories.publish", { draftId: d.id, previewIds: again.previews.map((p) => p.previewId), mentionsOk: true });
    expect(r.created).toBe(2);
    expect(JSON.stringify(s.created())).toContain("Northwind Traders");
  });

  it("shows no cards for a malformed answer or a dependency on an unknown card", async () => {
    for (const bad of [() => "{\"kind\":\"story_proposals\"}", () => JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [], proposals: [aCoopProposal({ depends_on: ["P7"] })] }))]) {
      const s = setup({ answer: bad });
      await s.enable();
      const r = await s.fail("stories.run", { clientKey: COOP, featureId: FEATURE });
      expect(r).toMatchObject({ status: 422, error: "The AI's answer wasn't usable, so nothing is shown. Try again" });
      expect(await s.plan.latestStoryDraft(COOP, FEATURE)).toBeNull();
    }
  });

  it("drafts with the note and examples as data, then publishes the kept, edited cards under the feature", async () => {
    const s = setup();
    await s.enable();
    const d = await s.draft();
    expect(d.cards.map((c) => [c.id, c.after])).toEqual([["P1", []], ["P2", ["Add the date filter to the export"]]]);
    const input = JSON.parse(s.calls[0]!.input) as { note_from_the_person: string; examples: { title: string }[]; existing_children: { id: number }[] };
    expect(input.note_from_the_person).toBe("split by report");
    expect(input.existing_children.map((x) => x.id)).toEqual([441]);
    expect(input.examples.some((e) => /Northwind/.test(e.title))).toBe(false);
    // BD-1: no picker any more: the top ranked examples go (at most 5), as Prepare counted them.
    expect(input.examples).toHaveLength(3);
    expect(s.calls[0]!.schemaName).toBe("stories_draft");

    // Edit the first, add a third card's worth of drop: keep P1 (edited, L), drop nothing, reorder P2 first.
    const edited = await s.run<DraftView>("stories.save", { draftId: d.id, cards: cardsInput(d, (c) => (c.id === "P1" ? { title: "Add a month filter to the export", size: "L" } : {})).reverse() });
    expect(edited.cards.map((c) => c.id)).toEqual(["P2", "P1"]);
    const pv = await s.run<{ previews: DevOpsPreview[]; order: string[] }>("stories.publish_preview", { draftId: d.id });
    // Dependencies first: P1 before P2 though P2 is listed first.
    expect(pv.order).toEqual(["P1", "P2"]);
    expect(pv.previews.map((p) => p.item)).toEqual(["New User Story: Add a month filter to the export", "New User Story: Email the export to finance"]);
    expect(pv.previews[0]!.links).toEqual([`Adds a parent link to #${FEATURE}, which shows the new item as its child`]);
    expect(pv.previews[0]!.fields.find((f) => f.label === "Size in FocusTime")?.after).toBe("L · 4h (not written to DevOps)");
    expect(s.created()).toHaveLength(0); // nothing before confirm
    const r = await s.run<{ draft: DraftView; created: number; failed: string[] }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) });
    expect(r.created).toBe(2);
    expect(r.failed).toEqual([]);
    expect(s.created().map((i) => i.fields["System.Title"])).toEqual(["Add a month filter to the export", "Email the export to finance"]);
    const email = s.created()[1]!;
    expect(String(email.fields["System.Description"])).toContain("After: Add a month filter to the export");
    expect(String(email.fields["Microsoft.VSTS.Common.AcceptanceCriteria"])).toContain("Finance gets the file by email");
    expect(r.draft.cards.every((c) => c.status.state === "created")).toBe(true);
    // Done: nothing more to preview, and a confirm of the same previews doesn't make more.
    expect((await s.run<{ previews: unknown[] }>("stories.publish_preview", { draftId: d.id })).previews).toEqual([]);
    expect(s.created()).toHaveLength(2);
    // A dropped card is never sent; a sent one can't be edited any more.
    expect((await s.fail("stories.save", { draftId: d.id, cards: cardsInput(r.draft, () => ({ title: "Changed" })) })).status).toBe(409);
  });

  it("breaks down a Recurring item (parent level beside Feature) into its child type, through the same create", async () => {
    const s = setup({ parentType: "Recurring" });
    await s.enable();
    const p = await s.run<{ featureType: string; childTypes: string[] }>("stories.prepare", { clientKey: COOP, featureId: FEATURE });
    expect(p.featureType).toBe("Recurring");
    const d = await s.draft();
    const pv = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    expect(pv.previews.map((x) => x.fields.find((f) => f.label === "Type")?.after)).toEqual(["User Story", "User Story"]);
    const r = await s.run<{ created: number }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((x) => x.previewId) });
    expect(r.created).toBe(2);
    expect(s.created().every((i) => i.fields["System.Parent"] === FEATURE && i.fields["System.WorkItemType"] === "User Story")).toBe(true);
  });

  it("refuses to create under a type that isn't broken down (a story), and sends nothing", async () => {
    const s = setup({ parentType: "User Story" });
    await s.enable();
    const d = await s.draft();
    const pv = await s.fail("stories.publish_preview", { draftId: d.id });
    expect(pv.error).toContain("isn't broken down");
    expect(s.created()).toHaveLength(0);
  });

  it("never makes a second item when an answer is lost: Retry checks first", async () => {
    const s = setup();
    await s.enable();
    const d = await s.draft();
    s.dv.fail("POST", /\/_apis\/wit\/workitems\/\$/, "lost");
    const pv = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    const r = await s.run<{ draft: DraftView; created: number; failed: string[] }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) });
    expect(r.created).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(s.created()).toHaveLength(2); // the lost one landed in DevOps
    // A new preview of the draft offers nothing for that card; a confirm of an old preview is refused.
    expect((await s.run<{ previews: unknown[] }>("stories.publish_preview", { draftId: d.id })).previews).toEqual([]);
    const after = await s.run<{ draft: DraftView; messages: string[]; toPreview: string[] }>("stories.retry", { draftId: d.id });
    expect(after.messages).toEqual([]);
    expect(after.draft.cards.every((c) => c.status.state === "created")).toBe(true);
    expect(s.created()).toHaveLength(2);
  });

  it("partial failure: lists what was created and what wasn't, and Retry finishes the rest", async () => {
    const s = setup();
    await s.enable();
    const d = await s.draft();
    s.dv.fail("POST", /\/_apis\/wit\/workitems\/\$/, "network");
    const pv = await s.run<{ previews: DevOpsPreview[] }>("stories.publish_preview", { draftId: d.id });
    const r = await s.run<{ draft: DraftView; created: number; failed: string[] }>("stories.publish", { draftId: d.id, previewIds: pv.previews.map((p) => p.previewId) });
    expect(r.created).toBe(1);
    expect(r.draft.cards.map((c) => c.status.state)).toEqual(["unconfirmed", "created"]);
    expect(s.created()).toHaveLength(1);
    const after = await s.run<{ draft: DraftView }>("stories.retry", { draftId: d.id });
    expect(after.draft.cards.map((c) => c.status.state)).toEqual(["created", "created"]);
    expect(s.created().map((i) => i.fields["System.Title"]).sort()).toEqual(["Add the date filter to the export", "Email the export to finance"]);
  });

  it("regenerates one card in place, keeping its id; the set only before anything is published", async () => {
    const s = setup({ answer: (c) => (/regenerate_only/.test(c.input) ? JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [], proposals: [aCoopProposal({ id: "P2", title: "Send the export to finance each month", depends_on: ["P1"] })] })) : JSON.stringify(aProposalsAnswer({ feature_id: FEATURE, set_aside: [] }))) });
    await s.enable();
    const d = await s.draft();
    const one = await s.run<DraftView>("stories.regenerate", { draftId: d.id, proposalId: "P2" });
    expect(one.cards.map((c) => [c.id, c.title])).toEqual([["P1", "Add the date filter to the export"], ["P2", "Send the export to finance each month"]]);
    expect(one.cost).not.toBe(d.cost);
  });

  it("ADM-1: the team's house style (an admin's Rule) wins; a person can't change it", async () => {
    const s = setup({ teamStyle: "Titles as As a <role>. Always acceptance criteria." });
    await s.run("stories.prepare", { clientKey: COOP, featureId: FEATURE });
    const style = await s.run<{ text: string; team: string | null; edited: null }>("stories.house_style", { clientKey: COOP });
    expect(style.text).toBe("Titles as As a <role>. Always acceptance criteria.");
    expect(style.team).toBe("Titles as As a <role>. Always acceptance criteria.");
    expect(await s.fail("stories.house_style_save", { clientKey: COOP, text: "Mine" })).toMatchObject({ status: 403, code: "admin_setting" });
  });
  it("without a team style, the learned one", async () => {
    const s = setup();
    await s.run("stories.prepare", { clientKey: COOP, featureId: FEATURE });
    const style = await s.run<{ text: string; learned: boolean; team: string | null }>("stories.house_style", { clientKey: COOP });
    expect([style.learned, style.team]).toEqual([true, null]);
  });
});
