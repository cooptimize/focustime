// WP-2: the DevOps patterns run within a scope, on both store drivers, over a fake DevOps and the stub AI (fictional
// data): a whole project with several areas stops at "Choose its scope" and Resume carries on with the one chosen;
// items outside the scope are read for the layout only, counted once and never sent to AI; a parent outside the scope
// is read for its title and type only; the default from Admin › Clients needs no choice; a client with two projects;
// a scope that matches nothing; kinds fixed for a run; pass 2 covers every item in scope; an answer that fails its check
// is never paid for twice on Resume; and a run made before WP-2 isn't resumed.
import { afterEach, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall, ProviderReply } from "../ai/types.ts";
import { createPatternsStore } from "../store/patterns-store.ts";
import { forEachDriver, type TestDb } from "../test/db.ts";
import { aClientEntry, anAiApp } from "../test/builders/index.ts";
import { aRawItem, fakePatternsReader, patternsAnswer, type FakeReader, type RawItem } from "../test/builders/patterns.ts";
import { OLD_INVENTORY, createPatternsRunner, type ClassifyDeps } from "./patterns-run.ts";
import type { DevOpsScope } from "../plan/devops-scope.ts";
import { PARENT_FIELDS } from "../plan/patterns/inventory.ts";

const NOW = "2026-11-11T17:00:00Z";
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const OUTSIDE_TEXT = "The ERP rollout's own plan, never ours";

function world(db: TestDb, reader: FakeReader, o: { owner?: string; admin?: Record<string, DevOpsScope | null> } = {}) {
  let clock = Temporal.Instant.from(NOW);
  const store = createPatternsStore(db.conn, () => clock);
  const adminCalls: string[] = [];
  const runner = createPatternsRunner({
    store,
    reader,
    now: () => clock,
    sleep: async (ms) => void (clock = clock.add({ milliseconds: ms })),
    log: () => {},
    owner: o.owner ?? "proc-1",
    allowed: async () => true,
    staleMs: 60_000,
    prices: () => ({ inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2 }),
    adminScope: async (k) => (adminCalls.push(k), o.admin?.[k] ?? null),
  });
  const done = async () => {
    for (let l = runner.activeLoop(); l; l = runner.activeLoop()) await l;
  };
  return { store, runner, done, adminCalls, tick: (ms: number) => void (clock = clock.add({ milliseconds: ms })) };
}

function ai(o: { respond?: (c: ProviderCall) => string | ProviderReply; calls?: ProviderCall[]; allowed?: string[] } = {}): ClassifyDeps {
  const allowed = o.allowed ?? ["adatum", "fabrikam"];
  const respond = o.respond ?? patternsAnswer();
  const directory = [aClientEntry({ key: "adatum", names: ["Adatum Corp"], projects: [], itemIds: [] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam Inc"], projects: [], itemIds: [] })];
  const service = createAi({
    provider: async () => stubProvider({ respond: (c) => (o.calls?.push(c), respond(c)) }),
    app: anAiApp(),
    rules: async () => ({ on: true, allowedClients: allowed, personCapUsd: 1000 }),
    guard: async () => ({ directory, homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
  });
  return { ai: service, aiAllowed: async (k) => allowed.includes(k), directory, isInternal: () => false };
}

/** Adatum's project "Adatum": the BI work under Adatum\BI, the client's own ERP program under Adatum\ERP. */
function adatum(): RawItem[] {
  const c = "2026-04-01T10:00:00Z";
  return [
    // An ERP epic outside the scope, the parent of one BI feature.
    aRawItem({ id: 1, type: "Epic", title: "ERP program", area: "Adatum\\ERP", created: c, desc: `<p>${OUTSIDE_TEXT}</p>` }),
    aRawItem({ id: 2, type: "Feature", parent: 1, title: "Sales model", area: "Adatum\\BI", created: c, desc: "<p>Model the sales data.</p>" }),
    aRawItem({ id: 3, type: "Story", parent: 2, title: "Load orders", area: "Adatum\\BI", created: c }),
    aRawItem({ id: 4, type: "Story", parent: 2, title: "Margin page", area: "Adatum\\BI\\Reports", created: c }),
    ...Array.from({ length: 6 }, (_, k) => aRawItem({ id: 10 + k, type: "Ticket", title: `ERP ticket ${k}`, area: "Adatum\\ERP", created: c, state: "Closed", closed: c, desc: `<p>${OUTSIDE_TEXT}</p>` })),
  ];
}

let open: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of open) await c();
  open = [];
});

await forEachDriver("DevOps patterns within a scope (WP-2)", ({ open: openDb }) => {
  const fresh = async () => {
    const db = await openDb();
    open.push(() => db.conn.close().catch(() => undefined));
    return db;
  };

  it("a whole project with several areas stops at Choose its scope; the layout is kept; Resume reads only the scope", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() });
    const w = world(db, reader);
    await w.runner.startInventory(ME);
    await w.done();
    const run = (await w.store.latest("inventory")).last!;
    expect(run.state).toBe("stopped");
    expect(run.reason).toBe("Stopped: 1 client needs a scope: choose it below, then Resume inventory");
    expect(run.progress.clients.adatum).toMatchObject({ state: "needs_scope", reason: expect.stringMatching(/Admin › Clients says Automatic\. The project has more than one area/) });
    // The layout read only area, type, project and dates: no title, no text, and nothing kept as an item yet.
    expect(await w.store.layout("adatum")).toHaveLength(10);
    expect(JSON.stringify(await db.conn.all("SELECT * FROM patterns_layout"))).not.toMatch(/ERP program|Sales model|never ours/);
    expect(await w.store.items("adatum")).toEqual([]);

    await w.store.setScope("adatum", { kind: "areas", areas: [{ path: "Adatum\\BI", sub: true }] }, ME);
    const before = reader.read.get("adatum")!.length;
    expect((await w.runner.resume(run.id, ME)).ok).toBe(true);
    await w.done();
    expect((await w.store.latest("inventory")).last!.state).toBe("done");
    // Read in full: the three items in scope, then the parent outside it (title and type only).
    expect(reader.read.get("adatum")!.slice(before)).toEqual([2, 3, 4, 1]);
    const items = await w.store.items("adatum");
    expect(items.map((i) => [i.id, i.inWindow])).toEqual([[1, false], [2, true], [3, true], [4, true]]);
    expect(items.find((i) => i.id === 1)).toMatchObject({ title: "ERP program", type: "Epic", facts: { descLen: 0 } });
    const snap = (await w.store.snapshots()).adatum![0]!.numbers as { run: { read: number; outside: number; inScope: number; scope: unknown; scopeSource: string } };
    expect(snap.run).toMatchObject({ read: 10, outside: 7, inScope: 3, scopeSource: "page" });
    expect(snap.run.read).toBe(snap.run.outside + snap.run.inScope);
  });

  it("a parent outside the scope is read with its title and type only; items outside it never reach the AI", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() });
    const asked: string[][] = [];
    const batch = reader.batch.bind(reader);
    reader.batch = async (k, ids, fields, p) => (asked.push([...fields]), batch(k, ids, fields, p));
    const w = world(db, reader, { admin: { adatum: { kind: "areas", areas: [{ path: "Adatum\\BI", sub: true }] } } });
    await w.runner.startInventory(ME);
    await w.done();
    expect((await w.store.latest("inventory")).last!.state).toBe("done");
    // The default from Admin › Clients (areas) needed no choice; it was read, never written.
    expect(w.adminCalls).toContain("adatum");
    expect(await w.store.scopes()).toEqual({});
    expect(asked.at(-1)).toEqual([...PARENT_FIELDS]);
    expect(asked.at(-1)).not.toContain("System.Description");

    const calls: ProviderCall[] = [];
    const deps = ai({ calls });
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    expect(est.clients.adatum).toMatchObject({ toClassify: 3, skipped: null });
    expect(est.totalSeconds).toBeGreaterThan(0);
    await w.runner.startClassify(ME, deps, est.totalMicros * 10, ["adatum"]);
    await w.done();
    expect((await w.store.latest("classify")).last!.state).toBe("done");
    const sent = calls.filter((c) => c.schemaName === "patterns_classify").map((c) => c.input).join("\n");
    expect(sent).toMatch(/Sales model|Load orders/);
    expect(sent).not.toMatch(/ERP program|ERP ticket|never ours/);
  });

  it("a client with two projects: whole projects across both, each read in its own project", async () => {
    const db = await fresh();
    const two = [aRawItem({ id: 50, type: "Story", project: "One", title: "In one" }), aRawItem({ id: 60, type: "Story", project: "Two", title: "In two" }), aRawItem({ id: 61, type: "Story", project: "Two", title: "Also two" })];
    const reader = fakePatternsReader({ adatum: two }, { projects: { adatum: ["One", "Two"] } });
    const w = world(db, reader);
    await w.runner.startInventory(ME);
    await w.done();
    // Two projects: no single area, so a choice is needed.
    expect((await w.store.latest("inventory")).last!.progress.clients.adatum!.state).toBe("needs_scope");
    expect((await w.store.trees("adatum")).map((t) => t.project)).toEqual(["One", "Two"]);
    await w.store.setScope("adatum", { kind: "whole", projects: ["Two"] }, ME);
    await w.runner.resume((await w.store.latest("inventory")).last!.id, ME);
    await w.done();
    expect((await w.store.items("adatum")).map((i) => i.id)).toEqual([60, 61]);
  });

  it("a scope that matches nothing stops the client with plain words; a team on its own field can't match", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() }, { trees: { adatum: [{ project: "adatum", root: "Adatum", paths: ["Adatum", "Adatum\\BI", "Adatum\\ERP"], teams: [{ name: "Field Team", otherField: true, areas: [] }] }] } });
    const w = world(db, reader, { admin: { adatum: { kind: "teams", teams: ["Field Team"] } } });
    await w.runner.startInventory(ME);
    await w.done();
    expect((await w.store.latest("inventory")).last!.progress.clients.adatum).toMatchObject({ state: "needs_scope", reason: expect.stringMatching(/matches no item.*Team Field Team uses its own field/) });
  });

  it("kinds are fixed when a classification starts; Leave out is never sent; pass 2 labels every other item in scope", async () => {
    const db = await fresh();
    const many = [aRawItem({ id: 1, type: "Feature", title: "Big feature" }), ...Array.from({ length: 30 }, (_, k) => aRawItem({ id: 100 + k, type: "Story", parent: 1, title: `Story ${k}` })), ...Array.from({ length: 5 }, (_, k) => aRawItem({ id: 200 + k, type: "Chore", title: `Chore ${k}` }))];
    const reader = fakePatternsReader({ adatum: many });
    const w = world(db, reader);
    await w.runner.startInventory(ME);
    await w.done();
    await w.store.setKind("adatum", "Chore", "leave_out", ME);
    const calls: ProviderCall[] = [];
    const deps = ai({ calls });
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    expect(est.clients.adatum!.toClassify).toBe(31);
    // Changed while the run goes: applies to the next run, not this one.
    const started = w.runner.startClassify(ME, deps, est.totalMicros * 10, ["adatum"]);
    await started;
    await w.store.setKind("adatum", "Chore", "build", ME);
    await w.done();
    const run = (await w.store.latest("classify")).last!;
    expect(run.state).toBe("done");
    expect(run.progress.clients.adatum!.kinds).toMatchObject({ Chore: "leave_out" });
    expect(calls.map((c) => c.input).join("\n")).not.toMatch(/Chore \d/);
    const labels = await w.store.labels("adatum", run.progress.listVersion!);
    expect(labels.size).toBe(31);
    // Every item is in the agreement sample (fewer than 100), each with its second answer.
    expect([...labels.values()].filter((l) => l.labelsB).length).toBe(31);
  });

  it("answers that fail their check: counted, remembered, and never paid for again on Resume (interrupted twice)", async () => {
    const db = await fresh();
    const many = Array.from({ length: 60 }, (_, k) => aRawItem({ id: 100 + k, type: "Story", title: k % 4 === 0 ? `Thin ${k}` : `Story ${k}` }));
    const reader = fakePatternsReader({ adatum: many });
    let w = world(db, reader);
    await w.runner.startInventory(ME);
    await w.done();
    // WP-3: one pass against the list in use, no merge.
    const base = patternsAnswer({ other: (r) => r === "i2" });
    const sent = new Map<string, number>();
    let n = 0;
    let stopAt = 2;
    const respond = (c: ProviderCall): string | ProviderReply => {
      expect(c.schemaName).toBe("patterns_classify");
      const out = JSON.parse(base(c) as string) as { items?: { ref: string }[] };
      const input = JSON.parse(c.input) as { items: { ref: string; title: string }[] };
      for (const it of input.items) sent.set(it.title, (sent.get(it.title) ?? 0) + 1);
      // The "server" goes away after a few requests (the answer is kept first).
      if (++n === stopAt) w.runner.halt();
      // Thin items get no valid answer: dropped by the check.
      const thin = new Set(input.items.filter((i) => i.title.startsWith("Thin")).map((i) => i.ref));
      return JSON.stringify({ items: out.items!.filter((i) => !thin.has(i.ref)) });
    };
    const deps = ai({ respond });
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    await w.runner.startClassify(ME, deps, est.totalMicros * 10, ["adatum"]);
    await w.done();
    for (const [k, owner] of ["proc-2", "proc-3"].entries()) {
      w = world(db, reader, { owner });
      // Each "restart" well after the last heartbeat (the old process's clock ran ahead while it slept).
      w.tick((k + 1) * 24 * 3_600_000);
      await w.runner.reconcile();
      const stopped = (await w.store.latest("classify")).last!;
      expect(stopped.state).toBe("stopped");
      stopAt = owner === "proc-2" ? n + 2 : Infinity;
      expect((await w.runner.resume(stopped.id, ME, { deps, estimateMicros: est.totalMicros * 10 })).ok).toBe(true);
      await w.done();
    }
    const run = (await w.store.latest("classify")).last!;
    expect(run.state).toBe("done");
    // Each item at most twice (its answer and the agreement sample's), a failed one once.
    for (const [title, k] of sent) expect(k, title).toBeLessThanOrEqual(title.startsWith("Thin") ? 1 : 2);
    expect((await w.store.failures("adatum", run.progress.listVersion!)).a.size).toBe(15);
    expect(run.progress.clients.adatum).toMatchObject({ total: 60, done: 45, dropped: 15 });
  });

  it("review: a client whose newest inventory is WP-1's (no scope) is never classified, and the estimate says why", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() });
    const w = world(db, reader, { admin: { adatum: { kind: "areas", areas: [{ path: "Adatum\\BI", sub: true }] } } });
    await w.runner.startInventory(ME);
    await w.done();
    // As if a WP-1 inventory: the whole project's items, a snapshot with no scope.
    const snap = (await w.store.snapshots()).adatum![0]!;
    const { run: _drop, ...old } = snap.numbers as Record<string, unknown>;
    await w.store.saveSnapshot(snap.runId, "adatum", old);
    const calls: ProviderCall[] = [];
    const deps = ai({ calls });
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    expect(est.clients.adatum).toMatchObject({ items: 0, skipped: OLD_INVENTORY });
    await w.runner.startClassify(ME, deps, 1_000_000, ["adatum"]);
    await w.done();
    expect((await w.store.latest("classify")).last!.progress.clients.adatum).toMatchObject({ state: "skipped", reason: OLD_INVENTORY });
    expect(calls.filter((c) => c.schemaName === "patterns_classify")).toEqual([]);
  });

  it("review: a team renamed after the inventory still classifies the items that inventory read", async () => {
    const db = await fresh();
    const trees = { adatum: [{ project: "adatum", root: "Adatum", paths: ["Adatum", "Adatum\\BI", "Adatum\\BI\\Reports", "Adatum\\ERP"], teams: [{ name: "BI Team", otherField: false, areas: [{ path: "Adatum\\BI", sub: true }] }] }] };
    const reader = fakePatternsReader({ adatum: adatum() }, { trees });
    const w = world(db, reader, { admin: { adatum: { kind: "teams", teams: ["BI Team"] } } });
    await w.runner.startInventory(ME);
    await w.done();
    expect((await w.store.latest("inventory")).last!.state).toBe("done");
    // Renamed in DevOps; a second inventory reads the new tree and stops for a scope.
    trees.adatum[0]!.teams[0]!.name = "Data Team";
    await w.runner.startInventory(ME);
    await w.done();
    expect((await w.store.latest("inventory")).last!.progress.clients.adatum!.state).toBe("needs_scope");
    const deps = ai();
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    expect(est.clients.adatum!.toClassify).toBe(3);
    await w.runner.startClassify(ME, deps, est.totalMicros * 10, ["adatum"]);
    await w.done();
    const run = (await w.store.latest("classify")).last!;
    expect(run.progress.clients.adatum!.outsideNow ?? []).toEqual([]);
    expect((await w.store.labels("adatum", run.progress.listVersion!)).size).toBe(3);
  });

  it("review: an answer refused for naming another client is paid once, never sent again item by item", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() });
    const w = world(db, reader, { admin: { adatum: { kind: "areas", areas: [{ path: "Adatum\\BI", sub: true }] } } });
    await w.runner.startInventory(ME);
    await w.done();
    const calls: ProviderCall[] = [];
    const deps = ai({ calls, respond: patternsAnswer({ other: () => true, otherName: "Fabrikam Inc reports" }) });
    const est = await w.runner.estimate(["adatum"], deps.aiAllowed);
    await w.runner.startClassify(ME, deps, est.totalMicros * 10, ["adatum"]);
    await w.done();
    const sizes = calls.filter((c) => c.schemaName === "patterns_classify").map((c) => (JSON.parse(c.input) as { items: unknown[] }).items.length);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((n) => n === 3)).toBe(true);
    const run = (await w.store.latest("classify")).last!;
    expect((await w.store.failures("adatum", run.progress.listVersion!)).a.size).toBe(3);
  });

  it("review: an item deleted between the layout and the full read keeps the coverage adding up", async () => {
    const db = await fresh();
    const reader = fakePatternsReader({ adatum: adatum() });
    const batch = reader.batch.bind(reader);
    reader.batch = async (k, ids, fields, p) => (await batch(k, ids, fields, p)).filter((v) => !(fields.includes("System.Description") && v.id === 4));
    const w = world(db, reader, { admin: { adatum: { kind: "areas", areas: [{ path: "Adatum\\BI", sub: true }] } } });
    await w.runner.startInventory(ME);
    await w.done();
    const snap = (await w.store.snapshots()).adatum![0]!.numbers as { run: { read: number; outside: number; inScope: number; gone?: number } };
    expect(snap.run).toMatchObject({ read: 9, outside: 7, inScope: 2, gone: 1 });
  });

  it("a run made before WP-2 is kept as it is and isn't resumed", async () => {
    const db = await fresh();
    const w = world(db, fakePatternsReader({ adatum: adatum() }));
    await db.conn.run("INSERT INTO patterns_runs (kind, state, started_by, started_at, heartbeat_at, owner, progress) VALUES ('inventory', 'stopped', ?, ?, ?, 'old', ?)", [ME, NOW, NOW, JSON.stringify({ clients: { adatum: { state: "stopped", phase: "items" } } })]);
    const old = (await w.store.latest("inventory")).last!;
    expect(await w.runner.resume(old.id, ME)).toEqual({ ok: false, why: "old_rules" });
    expect((await w.store.run(old.id))!.state).toBe("stopped");
  });
});
