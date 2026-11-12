// WP-3: trust the DevOps analysis, over a real store and runner, a fake DevOps and the stub AI (fictional data): opening
// the page, changing the list, ignoring a suggestion and both downloads make no AI request; each list change is a
// version with who, when and why, and two people saving at once can't both win; a run never changes the list, and a
// change mid-run applies to the next one; tonight's AI-list labels carry to the list in use without AI; a removed type's
// items are priced and labeled again; a failed second answer gives its place in the sample; a person on one client sees
// every client's counts and only their own client's item rows; WP-1 and WP-2 runs still open.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall, ProviderReply } from "../ai/types.ts";
import { OWN_START } from "../plan/patterns/owned.ts";
import { STARTING_LIST } from "../plan/patterns/labels.ts";
import type { Labels, TypeList } from "../plan/patterns/types.ts";
import { createPatternsStore } from "../store/patterns-store.ts";
import { forEachDriver, sqliteDb } from "../test/db.ts";
import { aClientEntry, anAiApp } from "../test/builders/index.ts";
import { aRawItem, aSmallProject, fakePatternsReader, patternsAnswer } from "../test/builders/patterns.ts";
import { patternsAction, type PatternsContext, type PatternsPort } from "./patterns.ts";
import { createPatternsRunner, type ClassifyDeps } from "./patterns-run.ts";

const NOW = "2026-11-12T17:00:00Z";
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const KIM = "e2e00000-0000-4000-8000-0000000000bb";
const L = (o: Partial<Labels> = {}): Labels => ({ requestType: "new report", otherName: null, otherMeaning: null, layers: ["report"], readiness: "needs discovery first", missing: ["grain"], confidence: "high", ...o });

const projects = () => ({
  adatum: [...aSmallProject(100), aRawItem({ id: 120, type: "Step", title: "Check the totals", created: "2026-05-01T10:00:00Z" })],
  fabrikam: aSmallProject(300),
});

function world(o: { db?: ReturnType<typeof sqliteDb>; respond?: (c: ProviderCall) => string | ProviderReply; aiOff?: boolean } = {}) {
  const db = o.db ?? sqliteDb();
  let clock = Temporal.Instant.from(NOW);
  const reader = fakePatternsReader(projects());
  const store = createPatternsStore(db.conn, () => clock);
  const calls: ProviderCall[] = [];
  const directory = [aClientEntry({ key: "adatum", names: ["Adatum Corp"], projects: [], itemIds: [] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam Inc"], projects: [], itemIds: [] })];
  const respond = o.respond ?? patternsAnswer({ other: (r) => r === "i1", otherName: "housekeeping", otherMeaning: "Tidying folders" });
  const service = createAi({
    provider: async () => stubProvider({ respond: (c) => (calls.push(c), respond(c)) }),
    app: anAiApp(),
    rules: async () => ({ on: true, allowedClients: ["adatum", "fabrikam"], personCapUsd: 100 }),
    guard: async () => ({ directory, homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
  });
  const deps: ClassifyDeps = { ai: service, aiAllowed: async () => true, directory, isInternal: () => false };
  const runner = createPatternsRunner({ store, reader, now: () => clock, sleep: async (ms) => void (clock = clock.add({ milliseconds: ms })), log: () => {}, owner: "proc-1", allowed: async () => true, staleMs: 60_000, prices: () => ({ inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2 }) });
  const port: PatternsPort = { store, runner, clients: async () => ["adatum", "fabrikam"], itemUrl: async (k, id) => `https://dev.azure.com/contoso/${k}/_workitems/edit/${id}` };
  const mine = new Map<string, string[]>([[ME, ["adatum"]], [KIM, ["fabrikam"]]]);
  const ctxFor = (who: string): PatternsContext => ({
    port,
    me: async () => who,
    allowed: async () => true,
    myClients: async () => mine.get(who) ?? [],
    dataPlatform: async () => null,
    ai: async () => (o.aiOff ? { why: "AI is off for FocusTime." } : { deps }),
    directory: async () => [...directory, { key: "contoso", names: ["Northwind Traders"], projects: ["Tailspin Reporting"] }],
    aiAllowed: async () => true,
    now: () => clock.toString(),
    nameOf: async (id) => (id === KIM ? "Kim Example" : null),
  });
  const act = async (who: string, name: Parameters<typeof patternsAction>[1], input: unknown = {}) => {
    const r = await patternsAction(ctxFor(who), name, input);
    return r as { ok: boolean; status?: number; code?: string; error?: string; data?: Record<string, unknown> & { [k: string]: never } };
  };
  const settle = async () => {
    for (let l = runner.activeLoop(); l; l = runner.activeLoop()) await l;
  };
  const classify = async () => {
    const e = await runner.estimate(["adatum", "fabrikam"], async () => true);
    await runner.startClassify(ME, deps, e.totalMicros * 10 + 1000, ["adatum", "fabrikam"]);
    await settle();
    return e;
  };
  return { db, store, runner, calls, act, settle, classify, deps, tick: (ms: number) => void (clock = clock.add({ milliseconds: ms })) };
}

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const data = (r: { data?: unknown }) => r.data as Data;

describe("DevOps patterns: trust the analysis (WP-3)", () => {
  it("opening the page, changing the list, a suggestion and both downloads make no AI request", async () => {
    const w = world();
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    w.calls.length = 0;
    const status = data(await w.act(ME, "patterns.status"));
    expect(status.labelsOn).toEqual({ mode: "in use", version: "own-1" });
    expect(status.inUse.version).toBe("own-1");
    expect(status.suggestions[0]).toMatchObject({ name: "housekeeping", clients: { adatum: expect.any(Number), fabrikam: expect.any(Number) } });
    const add = { kind: "add", name: "housekeeping", meaning: "Tidying folders", example: "Tidy the shared folder", relabel: "other" };
    const preview = data(await w.act(ME, "patterns.list_change", { edit: add, base: "own-1", preview: true }));
    expect(preview.cost.relabelSmall).toBe(preview.cost.relabel);
    expect(preview.cost.relabel).toBeGreaterThan(0);
    expect(data(await w.act(ME, "patterns.list_change", { edit: add, base: "own-1", why: "Suggested often for other" }))).toMatchObject({ saved: true, version: "own-2" });
    await w.act(ME, "patterns.suggestion", { name: "Housekeeping", ignore: true });
    await w.act(ME, "patterns.download", { kind: "summary" });
    await w.act(ME, "patterns.download", { kind: "types" });
    expect(w.calls).toEqual([]);
    const after = data(await w.act(ME, "patterns.status"));
    expect(after.inUse.version).toBe("own-2");
    expect(after.ignored).toEqual(["housekeeping"]);
    // A name now on the list is no longer suggested, ignored or not.
    await w.act(ME, "patterns.suggestion", { name: "housekeeping", ignore: false });
    expect(data(await w.act(ME, "patterns.status")).suggestions.map((x: Data) => x.name)).not.toContain("housekeeping");
    expect(after.versions[0]).toMatchObject({ version: "own-2", by: "you", why: "Suggested often for other", change: { kind: "add", to: ["housekeeping"] } });
    // Kim sees who made it by name.
    expect(data(await w.act(KIM, "patterns.status")).versions[0].by).toBe("someone with the page");
    // The add with "only other and can't tell": those items, and only those, are priced again.
    const est = await w.runner.estimate(["adatum", "fabrikam"], async () => true);
    expect(est.list).toBe("own-2");
    // Every item of a small project is in the agreement sample, so each one labeled again gets its second answer again.
    expect(est.totalItems).toBe(preview.cost.relabel * 2);
  });

  it("refuses an unclear name, a client's name and a change to can't tell or other; a save needs a why", async () => {
    const w = world();
    const go = (edit: unknown, why = "a reason") => w.act(ME, "patterns.list_change", { edit, base: "own-1", why });
    expect(await go({ kind: "add", name: "needs clarification", meaning: "x", example: "", relabel: "other" })).toMatchObject({ ok: false, status: 422 });
    expect(await go({ kind: "add", name: "Fabrikam reports", meaning: "x", example: "", relabel: "other" })).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/client/) });
    expect(await go({ kind: "remove", name: "other" })).toMatchObject({ ok: false, status: 422 });
    expect(await go({ kind: "rename", from: "can't tell", to: "unknown" })).toMatchObject({ ok: false });
    expect(await go({ kind: "rename", from: "small change", to: "minor change" }, "")).toMatchObject({ ok: false, code: "needs_why" });
    expect(await go({ kind: "nope" })).toMatchObject({ ok: false, status: 400 });
    expect((await w.store.lists()).length).toBe(0);
  });

  it("a rename keeps every label at no cost; a removed type's items are priced and labeled again", async () => {
    let type = "new report";
    const w = world({ respond: (c) => patternsAnswer({ requestType: type })(c) });
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    const before = data(await w.act(ME, "patterns.status")).clients.map((c: Data) => c.results?.coverage.labeled);
    const ren = data(await w.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "new report", to: "report build" }, base: "own-1", preview: true }));
    expect(ren.cost.relabel).toBe(0);
    await w.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "new report", to: "report build" }, base: "own-1", why: "Clearer" });
    const s = data(await w.act(ME, "patterns.status"));
    expect(s.clients.map((c: Data) => c.results?.coverage.labeled)).toEqual(before);
    expect(s.clients[0].results.build.requestTypes["report build"]).toBeGreaterThan(0);
    expect(s.clients[0].results.build.requestTypes["new report"]).toBeUndefined();
    expect((await w.runner.estimate(["adatum", "fabrikam"], async () => true)).totalItems).toBe(0);
    // Remove it: its items are priced, shown as removed until labeled again, then labeled on the new version.
    const rm = data(await w.act(ME, "patterns.list_change", { edit: { kind: "remove", name: "report build" }, base: "own-2", preview: true }));
    await w.act(ME, "patterns.list_change", { edit: { kind: "remove", name: "report build" }, base: "own-2", why: "Too broad" });
    expect(data(await w.act(ME, "patterns.status")).clients[0].results.build.requestTypes["report build (removed)"]).toBeGreaterThan(0);
    const est = await w.runner.estimate(["adatum", "fabrikam"], async () => true);
    expect(Object.values(est.clients).reduce((t, c) => t + c.items, 0)).toBeGreaterThanOrEqual(rm.cost.relabel);
    w.calls.length = 0;
    type = "small change";
    await w.classify();
    expect(w.calls.length).toBeGreaterThan(0);
    const done = data(await w.act(ME, "patterns.status"));
    expect(done.clients[0].results.build.requestTypes["report build (removed)"]).toBeUndefined();
    expect(done.clients[0].results.build.rerun).toEqual({});
  });

  it("a list change mid-run: the run keeps the list it started with, and its labels carry to the new one", async () => {
    let w: ReturnType<typeof world> | null = null;
    let changed = false;
    const base = patternsAnswer();
    w = world({
      respond: (c) => {
        if (!changed) {
          changed = true;
          void w!.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "new report", to: "report build" }, base: "own-1", why: "Mid-run" });
        }
        return base(c) as string;
      },
    });
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    const run = (await w.store.latest("classify")).last!;
    expect(run).toMatchObject({ state: "done", progress: { listVersion: "own-1" } });
    expect((await w.store.lists()).map((l) => l.version).sort()).toEqual(["own-1", "own-2"]);
    const s = data(await w.act(ME, "patterns.status"));
    expect(s.labelsOn.version).toBe("own-2");
    expect(s.clients[0].results.build.requestTypes["report build"]).toBeGreaterThan(0);
  });

  it("tonight's AI-list labels carry to the list in use without AI; an old WP-2 classification can't be resumed", async () => {
    const w = world();
    await w.runner.startInventory(ME);
    await w.settle();
    // A WP-2 classification and its AI list, as tonight's run left them.
    const old = await w.store.startRun({ kind: "classify", startedBy: ME, owner: "proc-0", progress: { rules: 2, pass: 2, listVersion: "", clients: {} } });
    const ai: TypeList = { version: `v2-r${old!.id}`, createdAt: "2026-11-12T03:00:00Z", fingerprint: "w2fabc", types: [{ name: "report creation", meaning: "m", example: "e" }, { name: "data migration work", meaning: "Moving data", example: "e" }, { name: "small change", meaning: "m", example: "e" }, ...STARTING_LIST.types.slice(-2)], changes: [{ kind: "rename", from: ["new report"], to: ["report creation"], reason: "r", count: 1 }, { kind: "add", from: [], to: ["data migration work"], reason: "r", count: 1 }] };
    await w.store.saveList(STARTING_LIST, null);
    await w.store.saveList(ai, old!.id);
    const items = (await w.store.currentItems("adatum")).filter((i) => i.inWindow);
    await w.store.putLabels("adatum", ai.version, items.map((i, n) => ({ itemId: i.id, rev: i.rev, labels: L({ requestType: n % 3 === 0 ? "report creation" : n % 3 === 1 ? "data migration work" : "small change" }) })));
    await w.store.finish(old!.id, "proc-0", "stopped", "Stopped: the server restarted or scaled down");
    w.calls.length = 0;
    const s = data(await w.act(ME, "patterns.status"));
    expect(w.calls).toEqual([]);
    expect(s.labelsOn.mode).toBe("in use");
    const b = s.clients[0].results.build;
    expect(b.requestTypes["new report"]).toBeGreaterThan(0);
    expect(b.requestTypes["small change"]).toBeGreaterThan(0);
    expect(b.requestTypes.other).toBeGreaterThan(0);
    expect(b.from[ai.version]).toBe(b.labeled);
    expect(b.rerun["no counterpart"]).toBe(b.requestTypes.other);
    expect(s.suggestions.map((x: Data) => x.name)).toContain("data migration work");
    expect(await w.act(ME, "patterns.resume", { runId: old!.id, total: 0 })).toMatchObject({ ok: false, code: "old_rules" });
    // The estimate prices only the items with no counterpart (and the sample's second answers).
    const est = await w.runner.estimate(["adatum"], async () => true);
    expect(est.clients.adatum!.items).toBe(b.requestTypes.other + est.agreement);
  });

  it("a WP-1 run and its list still open: the labels show on their own list, with a note", async () => {
    const w = world();
    await w.runner.startInventory(ME);
    await w.settle();
    const old = await w.store.startRun({ kind: "classify", startedBy: ME, owner: "proc-0", progress: { pass: 2, listVersion: "", clients: {} } });
    const v1: TypeList = { ...STARTING_LIST, version: "v1", types: [{ name: "needs clarification", meaning: "x", example: "" }, ...STARTING_LIST.types] };
    await w.store.saveList(v1, null);
    const ids = (await w.store.currentItems("adatum")).filter((i) => i.inWindow).map((i) => i.id);
    await w.store.putLabels("adatum", "v1", ids.map((id) => ({ itemId: id, rev: 1, labels: L({ requestType: "needs clarification" }) })));
    await w.store.finish(old!.id, "proc-0", "done", null);
    const s = await w.act(ME, "patterns.status");
    expect(s.ok).toBe(true);
    expect(data(s).labelsOn).toMatchObject({ mode: "earlier", version: "v1", wp1: true });
    expect(data(s).clients[0].results.build.labeled).toBe(ids.length);
    const md = data(await w.act(ME, "patterns.download", { kind: "summary" })).text as string;
    expect(md).toMatch(/Labels are on WP-1's starting list, not the list in use/);
    const types = data(await w.act(ME, "patterns.download", { kind: "types" })).text as string;
    expect(types).toMatch(/^## In use: version 1/m);
    expect(types).toMatch(/^## WP-1's starting list \(v1/m);
  });

  it("a failed second answer gives its place: the next run tops the sample up", async () => {
    let failB = true;
    const base = patternsAnswer();
    const w = world({
      respond: (c) => {
        const out = JSON.parse(base(c) as string) as { items: { ref: string }[] };
        const input = JSON.parse(c.input) as { items: { title: string }[] };
        // The agreement answers come reversed: fail the one for "Check the totals" once.
        if (failB && input.items.length && input.items[0]!.title === "Check the totals" && w.calls.filter((x) => x.input.includes("Check the totals")).length > 1) {
          failB = false;
          return JSON.stringify({ items: out.items.slice(1) });
        }
        return JSON.stringify(out);
      },
    });
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    const s = data(await w.act(ME, "patterns.status"));
    const total = s.clients.reduce((t: number, c: Data) => t + (c.results?.build.agreeFailed ?? 0) + (c.results?.tickets.agreeFailed ?? 0), 0);
    expect(total).toBe(1);
  });

  it("a person on one client sees every client's counts and suggestions, and item rows only for their client", async () => {
    const w = world();
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    const s = data(await w.act(ME, "patterns.status"));
    expect(s.clients.map((c: Data) => [c.key, c.results.coverage.labeled > 0])).toEqual([["adatum", true], ["fabrikam", true]]);
    expect(JSON.stringify(s.clients)).not.toMatch(/Sales reporting|Check the totals/);
    expect(await w.act(ME, "patterns.check", { clientKey: "fabrikam" })).toMatchObject({ ok: false, status: 403 });
    expect((await w.act(ME, "patterns.check", { clientKey: "adatum" })).ok).toBe(true);
  });
});

describe("DevOps patterns: review fixes (WP-3)", () => {
  /** Inventory, then every item in scope given a first answer on own-1 (no second), as an earlier run left them. */
  async function labeledOnOwn1(w: ReturnType<typeof world>) {
    await w.runner.startInventory(ME);
    await w.settle();
    await w.store.saveList(OWN_START, null);
    for (const k of ["adatum", "fabrikam"]) {
      const items = (await w.store.currentItems(k)).filter((i) => i.inWindow);
      await w.store.putLabels(k, "own-1", items.map((i) => ({ itemId: i.id, rev: i.rev, labels: L() })));
    }
  }

  it("a failed second answer for a carried label is recorded, never asked again, and counted; a rename later keeps it so", async () => {
    let fail = true;
    const base = patternsAnswer();
    const w = world({ respond: (c) => (fail && c.schemaName === "patterns_classify" ? JSON.stringify({ items: [] }) : (base(c) as string)) });
    await labeledOnOwn1(w);
    await w.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "small change", to: "minor change" }, base: "own-1", why: "Clearer" });
    const before = await w.runner.estimate(["adatum", "fabrikam"], async () => true);
    expect(before.totalLabels).toBe(0);
    expect(before.totalItems).toBeGreaterThan(0);
    await w.classify();
    // Every second answer failed: recorded on own-2's rows with the carried first answer, so nothing is priced again.
    expect((await w.runner.estimate(["adatum", "fabrikam"], async () => true)).totalItems).toBe(0);
    const s = data(await w.act(ME, "patterns.status"));
    expect(s.clients.reduce((t: number, c: Data) => t + c.results.build.agreeFailed + c.results.tickets.agreeFailed, 0)).toBe(before.totalItems);
    // Another rename: the failures still count, and no first answer is asked for again.
    await w.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "minor change", to: "tiny change" }, base: "own-2", why: "Shorter" });
    w.calls.length = 0;
    expect((await w.runner.estimate(["adatum", "fabrikam"], async () => true)).totalItems).toBe(0);
    fail = false;
  });

  it("a first answer that failed on an earlier list isn't priced again after a rename", async () => {
    const w = world({ respond: () => JSON.stringify({ items: [] }) });
    await w.runner.startInventory(ME);
    await w.settle();
    await w.classify();
    const failedThen = data(await w.act(ME, "patterns.status")).clients.reduce((t: number, c: Data) => t + c.results.coverage.failed, 0);
    expect(failedThen).toBeGreaterThan(0);
    await w.act(ME, "patterns.list_change", { edit: { kind: "rename", from: "new report", to: "report build" }, base: "own-1", why: "Clearer" });
    expect((await w.runner.estimate(["adatum", "fabrikam"], async () => true)).totalItems).toBe(0);
    expect(data(await w.act(ME, "patterns.status")).clients.reduce((t: number, c: Data) => t + c.results.coverage.failed, 0)).toBe(failedThen);
  });

  it("the cost preview and Estimate agree: only items Estimate would send, from clients with Allow AI on", async () => {
    const w = world();
    await labeledOnOwn1(w);
    const preview = data(await w.act(ME, "patterns.list_change", { edit: { kind: "remove", name: "new report" }, base: "own-1", preview: true }));
    await w.act(ME, "patterns.list_change", { edit: { kind: "remove", name: "new report" }, base: "own-1", why: "Too broad" });
    const est = await w.runner.estimate(["adatum", "fabrikam"], async () => true);
    expect(preview.cost.relabel).toBe(est.totalLabels);
    expect(preview.cost.relabel).toBeGreaterThan(0);
    // An add, both ways, priced the same as Estimate would after saving it.
    const add = { kind: "add", name: "spreadsheet", meaning: "Spreadsheet work", example: "Fix the budget sheet", relabel: "all" };
    const p2 = data(await w.act(ME, "patterns.list_change", { edit: add, base: "own-2", preview: true }));
    await w.act(ME, "patterns.list_change", { edit: add, base: "own-2", why: "Seen often" });
    expect(p2.cost.relabel).toBe((await w.runner.estimate(["adatum", "fabrikam"], async () => true)).totalLabels - est.totalLabels);
  });

  it("a stopped classification isn't resumed once the list changed: Run classification instead", async () => {
    const w = world();
    await w.runner.startInventory(ME);
    await w.settle();
    await w.store.saveList(OWN_START, null);
    const old = await w.store.startRun({ kind: "classify", startedBy: ME, owner: "proc-0", progress: { rules: 3, listVersion: "own-1", clients: {} } });
    await w.store.finish(old!.id, "proc-0", "stopped", "Stopped: the server restarted or scaled down");
    await w.act(ME, "patterns.list_change", { edit: { kind: "remove", name: "exploration" }, base: "own-1", why: "Not used" });
    expect(await w.act(ME, "patterns.resume", { runId: old!.id, total: 1000 })).toMatchObject({ ok: false, code: "list_changed" });
  });

  it("with AI off, a type naming a client by its name or project is still refused", async () => {
    const w = world({ aiOff: true });
    const add = (name: string) => w.act(ME, "patterns.list_change", { edit: { kind: "add", name, meaning: "x", example: "", relabel: "other" }, base: "own-1", why: "Seen" });
    expect(await add("Northwind Traders work")).toMatchObject({ ok: false, status: 422 });
    expect(await add("Tailspin Reporting fixes")).toMatchObject({ ok: false, status: 422 });
    expect(w.calls).toEqual([]);
  });
});

await forEachDriver("DevOps patterns: two people change the list at once (WP-3)", ({ open }) => {
  it("both start from version 1: the first save wins, the second is refused and writes nothing", async () => {
    const db = await open();
    try {
      const store = createPatternsStore(db.conn, () => Temporal.Instant.from(NOW));
      const a: TypeList = { ...OWN_START, version: "own-2", base: "own-1", by: ME, why: "A", changes: [{ kind: "rename", from: ["small change"], to: ["minor change"], reason: "A", count: 0 }] };
      const b: TypeList = { ...a, by: KIM, why: "B" };
      const [x, y] = await Promise.all([store.saveOwned(a, OWN_START), store.saveOwned(b, OWN_START)]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      const lists = await store.lists();
      expect(lists.map((l) => l.version).sort()).toEqual(["own-1", "own-2"]);
      // A save from an old base is refused.
      expect(await store.saveOwned({ ...a, version: "own-3", base: "own-1" }, OWN_START)).toBe(false);
      expect(await store.saveOwned({ ...a, version: "own-3", base: "own-2" }, OWN_START)).toBe(true);
      expect((await store.list("own-3"))).toMatchObject({ by: ME, why: "A", base: "own-2" });
    } finally {
      await db.conn.close().catch(() => undefined);
    }
  });
});
