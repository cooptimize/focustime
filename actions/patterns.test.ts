// WP-1: the DevOps patterns page's actions over a real store and runner, a fake DevOps and the stub AI (fictional data):
// the switch (off: the page doesn't exist, admin or not; requests refused), counts for every client but item rows only
// for clients I'm on (checked on every request), Run classification only for the estimate it named, downloads with no
// titles, item text or people, and nothing that starts on its own (a new process with a stopped run reads nothing).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import { BACKGROUND_NAMES } from "../config/background-policy.ts";
import { createPatternsStore } from "../store/patterns-store.ts";
import { sqliteDb } from "../test/db.ts";
import { aClientEntry, anAiApp } from "../test/builders/index.ts";
import { aRawItem, aSmallProject, fakePatternsReader, patternsAnswer, type FakeReader } from "../test/builders/patterns.ts";
import { patternsAction, type PatternsContext, type PatternsPort } from "./patterns.ts";
import { createPatternsRunner, type ClassifyDeps } from "./patterns-run.ts";

const NOW = "2026-11-11T17:00:00Z";
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const OTHER = "e2e00000-0000-4000-8000-0000000000bb";
const root = join(import.meta.dirname, "..");

const projects = () => ({
  adatum: [...aSmallProject(100), aRawItem({ id: 120, type: "Step", title: "Ask Pat Example about totals", desc: "<p>Long text that must never be kept</p>", created: "2026-05-01T10:00:00Z" })],
  fabrikam: aSmallProject(300),
});

function ai(allowed: string[]): ClassifyDeps {
  const directory = [aClientEntry({ key: "adatum", names: ["Adatum Corp"], projects: [], itemIds: [] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam Inc"], projects: [], itemIds: [] })];
  const service = createAi({
    provider: async () => stubProvider({ respond: patternsAnswer() }),
    app: anAiApp(),
    rules: async () => ({ on: true, allowedClients: allowed, personCapUsd: 100 }),
    guard: async () => ({ directory, homeDomains: ["cooptimize.example"], forbidden: [] }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => NOW,
  });
  return { ai: service, aiAllowed: async (k) => allowed.includes(k), directory, isInternal: () => false };
}

function world(o: { reader?: FakeReader; owner?: string; db?: ReturnType<typeof sqliteDb> } = {}) {
  const db = o.db ?? sqliteDb();
  let clock = Temporal.Instant.from(NOW);
  const reader = o.reader ?? fakePatternsReader(projects());
  const store = createPatternsStore(db.conn, () => clock);
  const on = new Set<string>([ME]);
  const allowedAi = ["adatum", "fabrikam"];
  const runner = createPatternsRunner({ store, reader, now: () => clock, sleep: async (ms) => void (clock = clock.add({ milliseconds: ms })), log: () => {}, owner: o.owner ?? "proc-1", allowed: async (id) => on.has(id), staleMs: 60_000, prices: () => ({ inputPerMillion: 1, cachedInputPerMillion: 0.5, outputPerMillion: 2 }) });
  const port: PatternsPort = { store, runner, clients: async () => ["adatum", "fabrikam"], itemUrl: async (k, id) => `https://dev.azure.com/contoso/${k}/_workitems/edit/${id}` };
  const mine = new Map<string, string[]>([[ME, ["adatum"]], [OTHER, ["fabrikam"]]]);
  let aiOn = true;
  const ctxFor = (who: string): PatternsContext => ({
    port,
    me: async () => who,
    allowed: async (id) => on.has(id),
    myClients: async () => mine.get(who) ?? [],
    dataPlatform: async () => null,
    ai: async () => (aiOn ? { deps: ai(allowedAi) } : { why: "Classification needs an AI provider, and AI isn't set up here." }),
    aiAllowed: async (k) => allowedAi.includes(k),
    now: () => clock.toString(),
  });
  const act = (who: string, name: Parameters<typeof patternsAction>[1], input: unknown = {}) => patternsAction(ctxFor(who), name, input);
  const settle = async () => {
    for (let l = runner.activeLoop(); l; l = runner.activeLoop()) await l;
  };
  return { db, store, runner, reader, on, mine, allowedAi, act, settle, noAi: () => void (aiOn = false), tick: (ms: number) => void (clock = clock.add({ milliseconds: ms })) };
}

describe("DevOps patterns actions (WP-1)", () => {
  it("off: every action but access answers as for a page that doesn't exist; access says off", async () => {
    const w = world();
    w.on.clear();
    expect(await w.act(ME, "patterns.access")).toEqual({ ok: true, data: { on: false } });
    for (const a of ["patterns.status", "patterns.run_inventory", "patterns.estimate", "patterns.download"] as const) {
      const r = await w.act(ME, a, a === "patterns.download" ? { kind: "summary" } : {});
      expect(r, a).toMatchObject({ ok: false, status: 404 });
    }
    expect(w.reader.calls).toEqual([]);
  });

  it("on for one person only: another gets 404", async () => {
    const w = world();
    expect(await w.act(ME, "patterns.access")).toEqual({ ok: true, data: { on: true } });
    expect(await w.act(OTHER, "patterns.access")).toEqual({ ok: true, data: { on: false } });
    expect(await w.act(OTHER, "patterns.status")).toMatchObject({ ok: false, status: 404 });
  });

  it("inventory, then counts for every client; item rows only for clients I'm on, checked on every request", async () => {
    const w = world();
    expect(await w.act(ME, "patterns.run_inventory")).toMatchObject({ ok: true });
    expect(await w.act(ME, "patterns.run_inventory")).toMatchObject({ ok: false, status: 409 });
    await w.settle();
    const e = await w.act(ME, "patterns.estimate");
    expect(e.ok).toBe(true);
    const total = (e as { data: { totalMicros: number } }).data.totalMicros;
    expect(await w.act(ME, "patterns.run_classification", { total: total * 3 + 1_000_000 })).toMatchObject({ ok: false, status: 409, code: "estimate_changed" });
    expect(await w.act(ME, "patterns.run_classification", {})).toMatchObject({ ok: false, code: "needs_estimate" });
    expect(await w.act(ME, "patterns.run_classification", { total })).toMatchObject({ ok: true });
    await w.settle();

    const s = (await w.act(ME, "patterns.status")) as { ok: true; data: { clients: { key: string; mine: boolean; snapshot: unknown; results: { coverage: { labeled: number } } | null }[] } };
    expect(s.data.clients.map((c) => [c.key, c.mine, !!c.snapshot, (c.results?.coverage.labeled ?? 0) > 0])).toEqual([["adatum", true, true, true], ["fabrikam", false, true, true]]);
    // The status carries no title, no item text and no item ids.
    const text = JSON.stringify(s.data);
    expect(text).not.toMatch(/Ask Pat Example|Long text|Sales reporting/);

    const mineRows = await w.act(ME, "patterns.check", { clientKey: "adatum" });
    expect(mineRows.ok && (mineRows.data as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    expect(await w.act(ME, "patterns.check", { clientKey: "fabrikam" })).toMatchObject({ ok: false, status: 403 });
    // Taken off the client: the rows go at once.
    w.mine.set(ME, []);
    expect(await w.act(ME, "patterns.check", { clientKey: "adatum" })).toMatchObject({ ok: false, status: 403 });
  });

  it("downloads: counts, shares, shapes and meanings; no title, item text, item id or person", async () => {
    const w = world();
    await w.act(ME, "patterns.run_inventory");
    await w.settle();
    const e = (await w.act(ME, "patterns.estimate")) as { data: { totalMicros: number } };
    await w.act(ME, "patterns.run_classification", { total: e.data.totalMicros });
    await w.settle();
    for (const kind of ["summary", "types"]) {
      const r = (await w.act(ME, "patterns.download", { kind })) as { ok: true; data: { text: string } };
      expect(r.ok).toBe(true);
      expect(r.data.text).not.toMatch(/Ask Pat Example|Long text|Sales reporting|Margin report|Pat Example|#\d|\b(10[0-6]|120|30[0-5])\b(?!%)/);
    }
  });

  it("no AI provider: the inventory works; Estimate and classification say they need one", async () => {
    const w = world();
    w.noAi();
    expect(await w.act(ME, "patterns.run_inventory")).toMatchObject({ ok: true });
    await w.settle();
    expect((await w.store.latest("inventory")).last!.state).toBe("done");
    expect(await w.act(ME, "patterns.estimate")).toMatchObject({ ok: false, code: "no_ai" });
    expect(await w.act(ME, "patterns.run_classification", { total: 0 })).toMatchObject({ ok: false, code: "no_ai" });
    const s = (await w.act(ME, "patterns.status")) as { data: { ai: { ready: boolean; words: string } } };
    expect(s.data.ai).toEqual({ ready: false, words: expect.stringMatching(/needs an AI provider/) });
  });

  it("a client without Allow AI is skipped in the estimate and the classification", async () => {
    const w = world();
    w.allowedAi.splice(0, w.allowedAi.length, "adatum");
    await w.act(ME, "patterns.run_inventory");
    await w.settle();
    const e = (await w.act(ME, "patterns.estimate")) as { data: { clients: Record<string, { skipped: string | null }>; totalMicros: number } };
    expect(e.data.clients.fabrikam!.skipped).toBeTruthy();
    expect(e.data.clients.adatum!.skipped).toBeNull();
    await w.act(ME, "patterns.run_classification", { total: e.data.totalMicros });
    await w.settle();
    const s = (await w.act(ME, "patterns.status")) as { data: { clients: { key: string; results: { coverage: { labeled: number; aiOff: number; toClassify: number } } }[] } };
    // WP-2: the client still shows, with every item counted as not labeled because AI isn't allowed for it.
    const fab = s.data.clients.find((c) => c.key === "fabrikam")!.results.coverage;
    expect(fab).toMatchObject({ labeled: 0, aiOff: fab.toClassify });
    expect(fab.toClassify).toBeGreaterThan(0);
  });

  it("bad input is refused before anything runs", async () => {
    const w = world();
    expect(await w.act(ME, "patterns.status", { x: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await w.act(ME, "patterns.set_platform", { clientKey: "adatum", platform: "mainframe" })).toMatchObject({ ok: false, status: 400 });
    expect(await w.act(ME, "patterns.set_platform", { clientKey: "nobody", platform: "azure" })).toMatchObject({ ok: false, status: 404 });
    expect(await w.act(ME, "patterns.set_platform", { clientKey: "adatum", platform: "fabric" })).toMatchObject({ ok: true });
    expect(await w.act(ME, "patterns.download", { kind: "everything" })).toMatchObject({ ok: false, status: 400 });
    expect(w.reader.calls).toEqual([]);
  });
});

describe("WP-2: scope and kinds on the page", () => {
  const split = () => ({
    adatum: [aRawItem({ id: 1, type: "Story", area: "adatum\\BI", title: "Our story" }), aRawItem({ id: 2, type: "Ticket", area: "adatum\\ERP", title: "Their ticket" }), aRawItem({ id: 3, type: "Ticket", area: "adatum\\ERP", title: "Their other ticket" })],
    fabrikam: aSmallProject(300),
  });

  it("status lays out each client's projects and areas with counts and types, and says what Admin › Clients has and that a choice is needed", async () => {
    const w = world({ reader: fakePatternsReader(split()) });
    await w.act(ME, "patterns.run_inventory");
    await w.settle();
    const s = (await w.act(ME, "patterns.status")) as { data: { clients: { key: string; layout: { projects: { project: string; areas: { path: string; items: number; types: Record<string, number> }[] }[] }; scope: { next: unknown; nextWords: string; admin: string } }[]; inventory: { last: { state: string; reason: string } } } };
    const a = s.data.clients.find((c) => c.key === "adatum")!;
    expect(a.layout.projects[0]!.areas.map((x) => [x.path, x.items, x.types])).toEqual([["adatum", 0, {}], ["adatum\\BI", 1, { Story: 1 }], ["adatum\\ERP", 2, { Ticket: 2 }]]);
    expect(a.scope).toMatchObject({ next: null, admin: "Automatic", nextWords: expect.stringMatching(/choose the part that is Cooptimize's BI and analytics work/) });
    expect(s.data.inventory.last).toMatchObject({ state: "stopped", reason: expect.stringMatching(/needs a scope/) });
    // Layout counts, never a title.
    expect(JSON.stringify(s.data)).not.toMatch(/Our story|Their ticket/);
  });

  it("set_scope: checked against the client's layout, kept for the page only; Admin › Clients is never written", async () => {
    const w = world({ reader: fakePatternsReader(split()) });
    await w.act(ME, "patterns.run_inventory");
    await w.settle();
    expect(await w.act(ME, "patterns.set_scope", { clientKey: "adatum", scope: { kind: "areas", areas: [{ path: "elsewhere\\BI", sub: true }] } })).toMatchObject({ ok: false, code: "not_in_layout" });
    expect(await w.act(ME, "patterns.set_scope", { clientKey: "adatum", scope: { kind: "areas", areas: [{ path: "adatum\\BI" }] } })).toMatchObject({ ok: false, status: 400 });
    expect(await w.act(ME, "patterns.set_scope", { clientKey: "nobody", scope: null })).toMatchObject({ ok: false, status: 404 });
    const r = await w.act(ME, "patterns.set_scope", { clientKey: "adatum", scope: { kind: "areas", areas: [{ path: "adatum\\BI", sub: true }] } });
    expect(r).toMatchObject({ ok: true, data: { words: expect.stringMatching(/^Saved for this page only\. Admin › Clients is unchanged\./) } });
    expect(Object.keys(await w.store.scopes())).toEqual(["adatum"]);
    // Resume carries on with it: only the story is read in full.
    await w.act(ME, "patterns.resume", { runId: (await w.store.latest("inventory")).last!.id });
    await w.settle();
    expect((await w.store.items("adatum")).map((i) => i.id)).toEqual([1]);
    // The actions never reach Admin › Clients' settings: no writer is handed to them, and the module names none.
    const src = readFileSync(join(root, "actions/patterns.ts"), "utf8") + readFileSync(join(root, "actions/patterns-run.ts"), "utf8");
    expect(src).not.toMatch(/setRule|org\.set|saveOrg|devops_scope|admin-actions/);
  });

  it("set_kind: a type of the client's own, kept and applied (Leave out leaves the counts)", async () => {
    const w = world();
    await w.act(ME, "patterns.run_inventory");
    await w.settle();
    expect(await w.act(ME, "patterns.set_kind", { clientKey: "adatum", type: "Nope", kind: "build" })).toMatchObject({ ok: false, status: 404 });
    expect(await w.act(ME, "patterns.set_kind", { clientKey: "adatum", type: "Step", kind: "sideways" })).toMatchObject({ ok: false, status: 400 });
    expect(await w.act(ME, "patterns.set_kind", { clientKey: "adatum", type: "Step", kind: "leave_out" })).toMatchObject({ ok: true });
    const s = (await w.act(ME, "patterns.status")) as { data: { clients: { key: string; analysis: { kinds: { type: string; kind: string; chosen: boolean }[]; leftOut: number } }[] } };
    const a = s.data.clients.find((c) => c.key === "adatum")!.analysis;
    expect(a.kinds.find((k) => k.type === "Step")).toMatchObject({ kind: "leave_out", chosen: true });
    expect(a.leftOut).toBe(4);
    const e = (await w.act(ME, "patterns.estimate")) as { data: { clients: Record<string, { toClassify: number }> } };
    expect(e.data.clients.adatum!.toClassify).toBe(3);
  });
});

describe("nothing runs on its own (WP-1)", () => {
  it("a new process with a stopped run and a running one it doesn't own reads nothing until someone presses a button", async () => {
    const db = sqliteDb();
    const first = world({ db, owner: "proc-1" });
    let stop = false;
    first.reader.before = () => {
      if (stop) first.runner.halt();
    };
    await first.act(ME, "patterns.run_inventory");
    stop = true;
    await first.settle();
    expect((await first.store.latest("inventory")).last!.state).toBe("running");

    // The "restart": a new runner (a new owner) over the same database, and time passing.
    const reader = fakePatternsReader(projects());
    const second = world({ db, owner: "proc-2", reader });
    second.tick(10 * 60_000);
    expect(second.runner.activeLoop()).toBeNull();
    expect(reader.calls).toEqual([]);
    // Opening the page says it stopped; still nothing read.
    const s = (await second.act(ME, "patterns.status")) as { data: { inventory: { last: { state: string; reason: string } } } };
    expect(s.data.inventory.last).toMatchObject({ state: "stopped", reason: expect.stringMatching(/restarted|scaled down/) });
    expect(reader.calls).toEqual([]);
    expect(second.runner.activeLoop()).toBeNull();
  });

  it("no scheduler job, no start-up work and no background name for the page", () => {
    expect(BACKGROUND_NAMES.some((n) => /pattern/.test(n))).toBe(false);
    const main = readFileSync(join(root, "server/main.ts"), "utf8");
    const scheduler = main.slice(main.indexOf("const scheduler = createScheduler({"), main.indexOf("people: async () =>", main.indexOf("const scheduler = createScheduler({")));
    expect(scheduler).not.toMatch(/pattern/i);
    for (const l of main.split("\n").filter((x) => /atStart\(/.test(x))) expect(l).not.toMatch(/pattern/i);
    // The runner starts only from the page's actions.
    for (const f of ["server/main.ts", "server/scheduler.ts"]) expect(readFileSync(join(root, f), "utf8")).not.toMatch(/startInventory|startClassify|runner\.resume/);
  });
});
