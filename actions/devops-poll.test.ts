// DV-1: the central DevOps poller against a fake dev.azure.com (with rate-limit headers): one query per client per
// check however many people read, only changed items fetched, the boundary overlap, slowing down and recovering per
// client, Refresh's limit, the change log, the daily reconcile, a bad token, and which accounts are polled.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aWeekConfig, ZONE } from "../test/builders/index.ts";
import { legacyHours } from "../config/schema.ts";
import { sqliteDb } from "../test/db.ts";
import { memorySnapshots } from "../host/fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { aFakeItem, fakeLiveDevOps, type OrgSetup } from "../sources/devops/poll-fakes.ts";
import { target } from "../sources/devops/test-fakes.ts";
import { createDevOpsStore } from "../store/devops-store.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import { createDevOpsPoller, createLimiter, pollAccounts, NO_SNAPSHOTS } from "./devops-poll.ts";

/** Thursday 10:00 in New York: inside the builders' working hours. */
const START = "2026-11-05T15:00:00Z";
const ME = { name: "Avery S", email: "avery@contoso.example" };
const DANA = { name: "Dana Ruiz", email: "dana@contoso.example" };

function harness(orgs: Record<string, OrgSetup>, o: { inHours?: boolean; allDay?: boolean; active?: boolean; rule?: number } = {}) {
  let t = Temporal.Instant.from(START);
  const clock = () => t;
  const fake = fakeLiveDevOps(orgs, clock);
  const db = sqliteDb();
  const store = createDevOpsStore(db.conn, clock);
  const limiter = createLimiter(clock);
  const keys = Object.keys(orgs);
  const appTargets = async (ks: string[]): Promise<TargetsResult> => ({ ok: true, targets: ks.filter((k) => keys.includes(k)).map((k) => target(k, k, { email: null, project: orgs[k]!.project, projectName: orgs[k]!.project })) });
  const app = createDevOpsSource({ fetch: fake.fetch, log: () => {}, snapshots: NO_SNAPSHOTS, timeZone: ZONE, targets: appTargets, limiter, now: clock, retryDelayMs: 0 });
  let active = o.active ?? true;
  const hours = o.inHours === false ? [] : o.allDay ? [legacyHours({ start: "00:00", split: "12:00", end: "23:59", timeZone: ZONE })] : [aWeekConfig().hours];
  const poller = createDevOpsPoller({ store, source: () => app.internal, limiter, accounts: async () => keys, targets: appTargets, hours: async () => hours, ruleMinutes: async () => o.rule ?? 1, active: () => active, now: clock, log: () => {} });
  /** One person's screens, on the store: no DevOps call of their own. */
  const reader = (email = ME.email) =>
    createDevOpsSource({
      fetch: (async () => {
        throw new Error("a reader called DevOps");
      }) as typeof fetch,
      log: () => {},
      snapshots: memorySnapshots(),
      timeZone: ZONE,
      targets: async (ks) => ({ ok: true, targets: ks.filter((k) => keys.includes(k)).map((k) => target(k, k, { email, pat: null, project: orgs[k]!.project, projectName: orgs[k]!.project })) }),
      central: poller.reads,
      limiter,
      now: clock,
    });
  const tick = async () => {
    const started = await poller.tick();
    await poller.idle();
    return started;
  };
  return {
    fake,
    store,
    poller,
    reader,
    tick,
    advance: (ms: number) => void (t = t.add({ milliseconds: ms })),
    at: (iso: string) => void (t = Temporal.Instant.from(iso)),
    now: clock,
    setActive: (a: boolean) => void (active = a),
    wiql: (org: string) => fake.calls.filter((c) => c.org === org && c.op === "wiql"),
    batches: (org: string) => fake.calls.filter((c) => c.org === org && c.op === "batch"),
  };
}

const project = (items: OrgSetup["items"], extra: Partial<OrgSetup> = {}): OrgSetup => ({ project: "Contoso Project", items, ...extra });
const ref = (k: string) => ({ clientKey: k, clientName: k });

describe("one poller per client", () => {
  it("makes one query per client per check, however many people read, and fetches only changed items", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME }), aFakeItem({ id: 2, assignee: DANA }), aFakeItem({ id: 3, assignee: ME, state: "Closed", changedAt: "2026-01-01T00:00:00Z" })]) });
    await h.tick();
    // The first read: the scope (open, or changed in 90 days), then those items. The old closed one is left out.
    expect(h.wiql("contoso")).toHaveLength(1);
    expect(h.batches("contoso").flatMap((b) => b.ids)).toEqual([1, 2]);

    const people = [h.reader(), h.reader(DANA.email), h.reader("lee@contoso.example")];
    const loads = await Promise.all(people.map((p) => p.load([ref("contoso")])));
    expect(loads[0]![0]!.items.map((i) => i.id)).toEqual([1]);
    expect(loads[1]![0]!.items.map((i) => i.id)).toEqual([2]);
    expect(loads[0]![0]!.status).toBe("ok");

    h.fake.reset();
    h.advance(61_000);
    h.fake.change("contoso", 2, { state: "Resolved" });
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(1);
    expect(h.wiql("contoso")[0]!.query).toMatch(/\[System\.ChangedDate\] >= '2026-11-05T14:58:00Z'/);
    expect(h.batches("contoso").flatMap((b) => b.ids)).toEqual([2]);

    // Usually nothing changed: one query, no batch read.
    h.fake.reset();
    h.advance(61_000);
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(1);
    expect(h.batches("contoso").flatMap((b) => b.ids)).toEqual([2]);
    h.advance(3 * 60_000);
    await h.tick();
    h.fake.reset();
    h.advance(61_000);
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(1);
    expect(h.batches("contoso")).toHaveLength(0);
  });

  it("checks every minute in hours; outside hours every 10 minutes and only while someone uses FocusTime", async () => {
    const inside = harness({ contoso: project([aFakeItem({ id: 1 })]) });
    await inside.tick();
    inside.advance(30_000);
    expect(await inside.tick()).toEqual([]);
    inside.advance(31_000);
    expect(await inside.tick()).toEqual(["contoso"]);

    const outside = harness({ contoso: project([aFakeItem({ id: 1 })]) }, { inHours: false });
    await outside.tick();
    outside.advance(5 * 60_000);
    expect(await outside.tick()).toEqual([]);
    outside.advance(5 * 60_000);
    expect(await outside.tick()).toEqual(["contoso"]);
    // Nobody using FocusTime outside hours: no check at all, and nothing to wake for until hours start.
    outside.setActive(false);
    outside.advance(60 * 60_000);
    expect(await outside.tick()).toEqual([]);
    expect(await outside.poller.wake()).toBeNull();
  });

  it("catches up from the watermark after a quiet night, in batches of 200", async () => {
    const items = Array.from({ length: 450 }, (_, i) => aFakeItem({ id: i + 1 }));
    const h = harness({ contoso: project(items) });
    await h.tick();
    h.at("2026-11-06T13:00:00Z");
    for (let i = 1; i <= 450; i++) h.fake.change("contoso", i, { title: `Changed ${i}` }, "2026-11-06T03:00:00Z");
    h.fake.reset();
    await h.tick();
    const sizes = h.batches("contoso").map((b) => b.ids!.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(450);
    expect((await h.store.items("contoso")).every((i) => String(i.fields["System.Title"]).startsWith("Changed"))).toBe(true);
  });
});

describe("which accounts", () => {
  const users = async () => [{ id: "u1", deleted: false }, { id: "u2", deleted: true }];
  const targets = async (keys: string[]): Promise<TargetsResult> => ({
    ok: true,
    targets: keys.flatMap((k) => (k === "fabrikam" ? [target(k, "fabrikam", { email: null, pat: null, org: null, project: null })] : [target(k, k, { email: null, pat: null })])),
  });

  it("polls only client accounts with DevOps set up, of people who use FocusTime; never a prospect or a hidden account", async () => {
    const peopleClients = async () => [
      { personId: "U1", clientKey: "contoso" },
      { personId: "u1", clientKey: "fabrikam" },
      { personId: "u1", clientKey: "northwind" },
      { personId: "u1", clientKey: "adatum" },
      { personId: "u2", clientKey: "tailspin" },
    ];
    const isClient = (k: string) => k !== "northwind" && k !== "adatum"; // a prospect and a hidden account
    expect(await pollAccounts({ peopleClients, users, targets, isClient, asked: [] })).toEqual(["contoso"]);
    // A client a screen asked for is polled too, through the same filter.
    expect(await pollAccounts({ peopleClients, users, targets, isClient, asked: ["woodgrove", "northwind"] })).toEqual(["contoso", "woodgrove"]);
  });

  it("asks Dataverse which accounts have DevOps without the PAT", async () => {
    let asked: unknown;
    await pollAccounts({ peopleClients: async () => [{ personId: "u1", clientKey: "contoso" }], users, targets: async (k) => ((asked = k), targets(k)), asked: [] });
    expect(asked).toEqual(["contoso"]);
  });
});

describe("the boundary", () => {
  it("a change landing during a read is caught on the next check, and nothing is logged twice", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME }), aFakeItem({ id: 2, assignee: ME })]) });
    await h.tick();
    h.advance(61_000);
    h.fake.change("contoso", 1, { assignee: DANA, changedBy: DANA });
    // Item 2 changes after the query was answered: this check doesn't see it.
    h.fake.duringNextWiql(() => h.fake.change("contoso", 2, { assignee: DANA, changedBy: DANA }, h.now().subtract({ seconds: 20 }).toString()));
    await h.tick();
    expect((await h.store.changes("contoso", START)).map((c) => c.itemId)).toEqual([1]);
    h.advance(61_000);
    await h.tick();
    const log = await h.store.changes("contoso", START);
    // Item 2 is caught by the overlap; item 1, read again in the overlap at the same revision, isn't logged again.
    expect(log.map((c) => [c.itemId, c.kind])).toEqual([[1, "assignee"], [2, "assignee"]]);
  });
});

describe("staying under the limits", () => {
  it("slows a client down when the remaining budget is low, recovers step by step, and leaves other clients alone", async () => {
    const low = { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "10", "x-ratelimit-cost": "0.5" };
    const orgs = { contoso: project([aFakeItem({ id: 1 })], { headers: low }), fabrikam: project([aFakeItem({ id: 9 })], { project: "Fabrikam Project" }) };
    const h = harness(orgs, { allDay: true });
    await h.tick();
    let rows = await h.poller.status();
    expect(rows.find((r) => r.clientKey === "contoso")).toMatchObject({ minutes: 2, slowed: "Close to the DevOps usage limit", rate: { limit: 200, remaining: 10, cost: 0.5 } });
    expect(rows.find((r) => r.clientKey === "fabrikam")).toMatchObject({ minutes: 1, slowed: null });
    h.advance(61_000);
    expect(await h.tick()).toEqual(["fabrikam"]);
    h.advance(61_000);
    await h.tick();
    // Still low: 4 minutes, then 8, then 15 at most.
    for (let i = 0; i < 4; i++) {
      h.advance(16 * 60_000);
      await h.tick();
    }
    expect((await h.poller.status()).find((r) => r.clientKey === "contoso")!.minutes).toBe(15);
    // Calm again: five calm checks halve the interval, one step at a time.
    delete orgs.contoso.headers;
    const steps: number[] = [];
    for (let i = 0; i < 25; i++) {
      h.advance(16 * 60_000);
      await h.tick();
      steps.push((await h.poller.status()).find((r) => r.clientKey === "contoso")!.minutes);
    }
    expect(steps.at(-1)).toBe(1);
    expect(steps.every((m, i) => i === 0 || m <= steps[i - 1]!)).toBe(true);
    expect([15, 8, 4, 2, 1].every((m) => steps.includes(m))).toBe(true);
    rows = await h.poller.status();
    expect(rows.find((r) => r.clientKey === "contoso")!.slowed).toBeNull();
  });

  it("slows down on a delay header", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1 })], { headers: { "x-ratelimit-delay": "1.5" } }) });
    await h.tick();
    expect((await h.poller.status())[0]).toMatchObject({ minutes: 2, slowed: "DevOps is delaying requests" });
  });

  it("honors Retry-After on a refusal, even for Refresh, and never retries in a loop; another client goes on", async () => {
    const orgs = { contoso: project([aFakeItem({ id: 1 })]), fabrikam: project([aFakeItem({ id: 9 })], { project: "Fabrikam Project" }) };
    const h = harness(orgs);
    await h.tick();
    orgs.contoso.status = 429;
    orgs.contoso.headers = { "retry-after": "120" };
    h.advance(61_000);
    h.fake.reset();
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(1);
    expect((await h.poller.status()).find((r) => r.clientKey === "contoso")!.slowed).toBe("DevOps asked FocusTime to wait");
    delete orgs.contoso.status;
    delete orgs.contoso.headers;
    h.fake.reset();
    for (let i = 0; i < 3; i++) {
      h.advance(30_000);
      await h.tick();
      await h.reader().load([ref("contoso")], { refresh: true });
    }
    expect(h.wiql("contoso")).toHaveLength(0);
    expect(h.wiql("fabrikam").length).toBeGreaterThan(0);
    h.advance(31_000);
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(1);
  });
});

describe("Refresh", () => {
  it("forces a check at most once per 30 seconds per client, shared across people", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME })]) });
    await h.tick();
    h.fake.reset();
    await h.reader().load([ref("contoso")], { refresh: true });
    await h.reader(DANA.email).load([ref("contoso")], { refresh: true });
    h.advance(20_000);
    await h.reader().load([ref("contoso")], { refresh: true });
    await h.poller.idle();
    expect(h.wiql("contoso")).toHaveLength(1);
    h.advance(11_000);
    await h.reader().load([ref("contoso")], { refresh: true });
    await h.poller.idle();
    expect(h.wiql("contoso")).toHaveLength(2);
    // A load that isn't a Refresh only reads the store.
    h.advance(31_000);
    await h.reader().load([ref("contoso")]);
    await h.poller.idle();
    expect(h.wiql("contoso")).toHaveLength(2);
  });

  it("shows the change at once after a write (the write asks for a check)", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME, state: "Active" })]) });
    await h.tick();
    const me = h.reader();
    await me.load([ref("contoso")]);
    h.advance(5_000);
    h.fake.change("contoso", 1, { state: "Resolved" });
    me.forget("contoso");
    const [w] = await me.load([ref("contoso")]);
    expect(w!.items[0]!.state).toBe("Resolved");
  });
});

describe("state changes for Watching (PL-1)", () => {
  it("are known only for a span the first full load came before, and list state changes only", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 5, type: "Feature", assignee: ME }), aFakeItem({ id: 6, assignee: ME }), aFakeItem({ id: 7, assignee: ME })]) });
    // Before anything was loaded, and for a span starting before the first load: not known.
    expect(await h.poller.reads.stateChanges!("contoso", START)).toEqual({ known: false, itemIds: [] });
    await h.tick();
    expect(await h.poller.reads.stateChanges!("contoso", "2026-11-02T05:00:00Z")).toEqual({ known: false, itemIds: [] });
    const since = h.now().toString();
    h.advance(61_000);
    h.fake.change("contoso", 6, { state: "Resolved", changedBy: ME });
    h.fake.change("contoso", 7, { assignee: DANA, changedBy: DANA });
    await h.tick();
    expect(await h.poller.reads.stateChanges!("contoso", since)).toEqual({ known: true, itemIds: [6] });
  });
});

describe("the change log", () => {
  it("records assignee and target date changes old to new, with who changed it per DevOps", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 5, type: "Feature", assignee: ME, target: "2026-11-20T00:00:00Z" }), aFakeItem({ id: 6, assignee: ME, comments: 1 })]) });
    await h.tick();
    expect(await h.store.changes("contoso", START)).toEqual([]);
    h.advance(61_000);
    h.fake.change("contoso", 5, { assignee: DANA, target: "2026-11-27T00:00:00Z", changedBy: DANA });
    h.fake.change("contoso", 6, { comments: 2, state: "Resolved", changedBy: ME });
    h.fake.add("contoso", { id: 7, type: "User Story", state: "New", title: "New story", parent: 5 });
    await h.tick();
    const log = (await h.store.changes("contoso", START)).map(({ itemId, kind, oldValue, newValue, byName }) => ({ itemId, kind, oldValue, newValue, byName }));
    expect(log).toEqual(
      expect.arrayContaining([
        { itemId: 5, kind: "assignee", oldValue: ME.name, newValue: DANA.name, byName: DANA.name },
        { itemId: 5, kind: "target_date", oldValue: "2026-11-20", newValue: "2026-11-27", byName: DANA.name },
        { itemId: 6, kind: "comments", oldValue: "1", newValue: "2", byName: ME.name },
        { itemId: 6, kind: "state", oldValue: "Active", newValue: "Resolved", byName: ME.name },
        { itemId: 5, kind: "new_child", oldValue: null, newValue: "7", byName: null },
      ]),
    );
    expect(log).toHaveLength(5);
    // The changer's uniqueName is kept only to match a FocusTime user.
    expect((await h.store.changes("contoso", START)).find((c) => c.kind === "assignee")!.byUnique).toBe(DANA.email);
  });

  it("keeps 30 days", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME })]) });
    await h.tick();
    h.advance(61_000);
    h.fake.change("contoso", 1, { assignee: DANA });
    await h.tick();
    expect(await h.store.changes("contoso", START)).toHaveLength(1);
    h.advance(31 * 24 * 3600_000);
    h.fake.change("contoso", 1, { assignee: ME });
    await h.tick();
    expect((await h.store.changes("contoso", START)).map((c) => c.newValue)).toEqual([ME.name]);
  });
});

describe("the daily reconcile", () => {
  it("removes a deleted item and an item moved to another project, at the first check of the day", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME }), aFakeItem({ id: 2, assignee: ME }), aFakeItem({ id: 3, assignee: ME })]) });
    await h.tick();
    h.fake.remove("contoso", 2);
    h.advance(61_000);
    await h.tick();
    expect((await h.store.items("contoso")).map((i) => i.id)).toEqual([1, 2, 3]);
    h.at("2026-11-06T14:00:00Z");
    await h.tick();
    expect((await h.store.items("contoso")).map((i) => i.id)).toEqual([1, 3]);
    expect((await h.store.changes("contoso", START)).map((c) => [c.itemId, c.kind])).toEqual([[2, "removed"]]);
    const [w] = await h.reader().load([ref("contoso")]);
    expect(w!.items.map((i) => i.id)).toEqual([1, 3]);
  });
});

describe("a bad token", () => {
  it("shows on Status in plain words, is tried every 30 minutes, and doesn't stop other clients", async () => {
    const orgs = { contoso: project([aFakeItem({ id: 1, assignee: ME })]), fabrikam: project([aFakeItem({ id: 9 })], { project: "Fabrikam Project" }) };
    const h = harness(orgs);
    await h.tick();
    orgs.contoso.status = 401;
    h.advance(61_000);
    await h.tick();
    const rows = await h.poller.status();
    expect(rows.find((r) => r.clientKey === "contoso")).toMatchObject({ error: "Token not valid", minutes: 30 });
    expect(rows.find((r) => r.clientKey === "fabrikam")).toMatchObject({ error: null, minutes: 1 });
    // Screens keep the stored items, with the reason and the time of the last good check.
    const [w] = await h.reader().load([ref("contoso")]);
    expect(w).toMatchObject({ status: "auth_failed", fromCache: true });
    expect(w!.message).toMatch(/^DevOps PAT expired or invalid for contoso\. Showing items from /);
    expect(w!.items.map((i) => i.id)).toEqual([1]);
    h.fake.reset();
    h.advance(10 * 60_000);
    await h.tick();
    expect(h.wiql("contoso")).toHaveLength(0);
    expect(h.wiql("fabrikam").length).toBeGreaterThan(0);
  });

  it("never puts the PAT in the store", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME })]) });
    await h.tick();
    const all = JSON.stringify([await h.store.items("contoso"), await h.store.states(), await h.poller.status()]);
    expect(all).not.toMatch(/FAKEPAT|basic /i);
  });
});

describe("guards", () => {
  it("names no client and no process in DV-1's code", () => {
    for (const f of ["actions/devops-poll.ts", "plan/devops-pace.ts", "sources/devops/changes.ts", "store/devops-store.ts"]) {
      const code = readFileSync(join(import.meta.dirname, "..", f), "utf8");
      expect(code, f).not.toMatch(/clientKey\s*===?\s*["'`]/);
      expect(code, f).not.toMatch(/["'`](Agile|Scrum|CMMI|Basic)["'`]/);
    }
  });
});
