// DV-2: DevOps changes show up on their own. The poller's per-client version (moves on every kind of change and only
// then), the versions answer scoped to the person, Refresh's forced check and its words, the interval outside hours
// with and without a follower working late, Find an item's read by id, and new items of every tier reaching the store.
import { describe, expect, it } from "vitest";
import { aWeekConfig, ZONE } from "../test/builders/index.ts";
import { sqliteDb } from "../test/db.ts";
import { memorySnapshots } from "../host/fakes.ts";
import { createDevOpsSource, type ScopeDeps } from "../sources/devops/source.ts";
import { aFakeItem, fakeLiveDevOps, type OrgSetup } from "../sources/devops/poll-fakes.ts";
import { target } from "../sources/devops/test-fakes.ts";
import { createDevOpsStore } from "../store/devops-store.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import { createDevOpsPoller, createLimiter, nextVersion, NO_SNAPSHOTS, problemOf, type ForcedCheck } from "./devops-poll.ts";
import { freshAction, refreshWords, type FindAnswer, type FreshContext, type RefreshAnswer, type VersionsAnswer } from "./devops-fresh-actions.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";

const aConfig = () => {
  const r = parseConfig(STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "you@cooptimize.example"'));
  if (!r.ok) throw new Error("starter config");
  return r.config;
};

const START = "2026-11-05T15:00:00Z";
const ME = { name: "Avery S", email: "avery@contoso.example" };
const DANA = { name: "Dana Ruiz", email: "dana@contoso.example" };
const P = "Contoso Project";

function harness(orgs: Record<string, OrgSetup>, o: { inHours?: boolean; active?: boolean; activeFor?: (k: string) => boolean } = {}) {
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
  const hours = o.inHours === false ? [] : [aWeekConfig().hours];
  const poller = createDevOpsPoller({ store, source: () => app.internal, limiter, accounts: async () => keys, targets: appTargets, hours: async () => hours, ruleMinutes: async () => 1, active: () => active, ...(o.activeFor ? { activeFor: o.activeFor } : {}), now: clock, log: () => {} });
  /** One person's source on the store; `sees`: the clients they are an Account Worker on. */
  const reader = (o2: { email?: string; sees?: string[]; scope?: (k: string) => Promise<ScopeDeps | null> } = {}) =>
    createDevOpsSource({
      fetch: (async () => {
        throw new Error("a reader called DevOps");
      }) as typeof fetch,
      log: () => {},
      snapshots: memorySnapshots(),
      timeZone: ZONE,
      targets: async (ks) => ({ ok: true, targets: ks.filter((k) => (o2.sees ?? keys).includes(k)).map((k) => target(k, k, { email: o2.email ?? ME.email, pat: null, project: orgs[k]!.project, projectName: orgs[k]!.project })) }),
      central: poller.reads,
      limiter,
      now: clock,
      ...(o2.scope ? { scope: o2.scope } : {}),
    });
  const tick = async () => {
    const started = await poller.tick();
    await poller.idle();
    return started;
  };
  const version = async (k: string) => (await poller.freshness([k]))[0]!.version;
  return { fake, store, poller, reader, tick, version, advance: (ms: number) => void (t = t.add({ milliseconds: ms })), at: (iso: string) => void (t = Temporal.Instant.from(iso)), now: clock, setActive: (a: boolean) => void (active = a) };
}
const project = (items: OrgSetup["items"], extra: Partial<OrgSetup> = {}): OrgSetup => ({ project: P, items, ...extra });
const ref = (k: string) => ({ clientKey: k, clientName: k });

describe("the version", () => {
  it("moves on the first load, a change, a new item and a removal, and only then", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME }), aFakeItem({ id: 2 })]) });
    expect(await h.version("contoso")).toBeNull();
    await h.tick();
    const v1 = await h.version("contoso");
    expect(v1).not.toBeNull();

    // A quiet check: the watermark moves, the version doesn't.
    h.advance(61_000);
    await h.tick();
    expect(await h.version("contoso")).toBe(v1);

    // A title change (not in the change log) still moves it.
    h.advance(61_000);
    h.fake.change("contoso", 2, { title: "Renamed" });
    await h.tick();
    const v2 = await h.version("contoso");
    expect(v2).not.toBe(v1);

    // The overlap reads item 2 again at the same revision: no move.
    h.advance(61_000);
    await h.tick();
    expect(await h.version("contoso")).toBe(v2);

    // A new item.
    h.advance(61_000);
    h.fake.add("contoso", { id: 3, type: "User Story", state: "New", title: "New" });
    await h.tick();
    const v3 = await h.version("contoso");
    expect(v3).not.toBe(v2);

    // A deletion, found by the next day's reconcile.
    h.fake.remove("contoso", 3);
    h.at("2026-11-06T15:00:00Z");
    await h.tick();
    const v4 = await h.version("contoso");
    expect(v4).not.toBe(v3);
  });

  it("moves on a write's read-back, survives a restart, and two changes in one millisecond still differ", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME })]) });
    await h.tick();
    const v1 = await h.version("contoso");
    await h.poller.reads.stored!("contoso", { id: 1, fields: { "System.Id": 1, "System.Rev": 5, "System.State": "Resolved", "System.WorkItemType": "User Story" } });
    const v2 = await h.version("contoso");
    expect(v2).not.toBe(v1);
    expect((await h.store.state("contoso"))!.versionAt).toBe(v2);
    const t = Temporal.Instant.from("2026-11-05T15:00:00Z");
    expect(nextVersion(t.toString(), t)).not.toBe(t.toString());
    expect(Date.parse(nextVersion(t.toString(), t))).toBeGreaterThan(t.epochMilliseconds);
  });

  it("doesn't move when a check fails", async () => {
    const orgs = { contoso: project([aFakeItem({ id: 1 })]) };
    const h = harness(orgs);
    await h.tick();
    const v = await h.version("contoso");
    orgs.contoso.status = 401;
    h.advance(61_000);
    await h.tick();
    expect(await h.version("contoso")).toBe(v);
    expect((await h.poller.freshness(["contoso"]))[0]!.problem).toEqual({ kind: "refused", words: "DevOps sign-in was refused" });
  });
});

describe("new items reach the store after the next check", () => {
  for (const type of ["Epic", "Feature", "User Story", "Task"]) {
    it(`a ${type} with no assignee and no parent`, async () => {
      const h = harness({ contoso: project([aFakeItem({ id: 1 })]) });
      await h.tick();
      h.advance(61_000);
      h.fake.add("contoso", { id: 50, type, state: "New", title: `A new ${type}`, assignee: null, parent: null });
      await h.tick();
      const stored = (await h.store.items("contoso")).find((i) => i.id === 50);
      expect(stored?.fields["System.WorkItemType"]).toBe(type);
      expect(stored?.fields["System.AssignedTo"]).toBeUndefined();
    });
  }
  it("a feature under an epic shows in Ahead with the whole project", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, type: "Epic", assignee: ME })]) });
    await h.tick();
    h.advance(61_000);
    h.fake.add("contoso", { id: 60, type: "Feature", state: "New", title: "Made in DevOps", parent: 1 });
    await h.tick();
    const [c] = await h.reader().aheadItems!([ref("contoso")], { whole: true });
    expect(c!.items.map((i) => i.id)).toContain(60);
  });
});

describe("the interval outside working hours", () => {
  it("is the Rule's while a follower of the client works late, 10 minutes for anyone else, nothing when nobody does", async () => {
    let late = true;
    const h = harness({ contoso: project([aFakeItem({ id: 1 })]) }, { inHours: false, activeFor: () => late });
    await h.tick();
    h.advance(61_000);
    expect(await h.tick()).toEqual(["contoso"]);
    // Someone else is using FocusTime, not a follower: back to every 10 minutes.
    late = false;
    h.advance(61_000);
    expect(await h.tick()).toEqual([]);
    h.advance(9 * 60_000);
    expect(await h.tick()).toEqual(["contoso"]);
    // Nobody: nothing at all, and no wake (the database can sleep).
    h.setActive(false);
    late = true;
    h.advance(60 * 60_000);
    expect(await h.tick()).toEqual([]);
    expect(await h.poller.wake()).toBeNull();
  });
});

describe("freshness and Refresh", () => {
  it("answers only for clients the person can see, with versions and times only", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1 })]), fabrikam: project([aFakeItem({ id: 2 })]) });
    await h.tick();
    const mine = await h.reader({ sees: ["contoso"] }).freshness!([ref("contoso"), ref("fabrikam")]);
    expect(mine.map((f) => f.clientKey)).toEqual(["contoso"]);
    expect(Object.keys(mine[0]!).sort()).toEqual(["checkedAt", "clientKey", "nextAt", "okAt", "problem", "version"]);
  });

  it("Refresh checks now, waits for it, and says how many changed; a second within 30 s says when the last check was", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1 }), aFakeItem({ id: 2 })]) });
    await h.tick();
    h.advance(5_000);
    h.fake.change("contoso", 1, { state: "Resolved" });
    h.fake.change("contoso", 2, { title: "Two" });
    const [r] = await h.reader().refreshNow!([ref("contoso")]);
    expect(r).toMatchObject({ forced: true, pending: false, changes: 2 });
    h.advance(5_000);
    const [again] = await h.reader().refreshNow!([ref("contoso")]);
    expect(again).toMatchObject({ forced: false, changes: null });
    expect(refreshWords([{ ...again!, clientName: "Contoso" }], Date.parse(again!.checkedAt!) + 20_000).line).toBe("DevOps was checked 20s ago");
  });

  it("the week load's Refresh now waits for the check it starts (it used to start one a tick too late to wait)", async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME })]) });
    await h.tick();
    h.advance(31_000);
    h.fake.change("contoso", 1, { title: "Seen at once" });
    const [w] = await h.reader().load([ref("contoso")], { refresh: true });
    expect(w!.items.find((i) => i.id === 1)?.title).toBe("Seen at once");
  });

  it("a slowed client says so with its next check", () => {
    const now = Temporal.Instant.from(START);
    expect(problemOf({ errorKind: null, error: null, loadedAt: START }, { slow: 4, retryAt: null, reason: "x" }, now)?.kind).toBe("slowed");
    expect(problemOf({ errorKind: null, error: null, loadedAt: START }, { slow: 1, retryAt: null, reason: null }, now)).toBeNull();
    expect(problemOf({ errorKind: null, error: null, loadedAt: null }, { slow: 1, retryAt: null, reason: null }, now)?.kind).toBe("first");
  });
});

describe("Refresh's words", () => {
  const base = { version: "v", checkedAt: START, okAt: START, nextAt: null, problem: null, forced: true, pending: false } as const;
  const one = (o: Partial<ForcedCheck> & { clientName: string }) => ({ ...base, clientKey: o.clientName, changes: 0, ...o }) as ForcedCheck & { clientName: string };
  const now = Date.parse(START);
  it("counts changes across clients", () => {
    expect(refreshWords([one({ clientName: "Contoso", changes: 3 })], now).line).toBe("DevOps checked just now · 3 changes");
    expect(refreshWords([one({ clientName: "Contoso", changes: 0 }), one({ clientName: "Fabrikam", changes: 1 })], now).line).toBe("DevOps checked just now · 1 change");
    expect(refreshWords([one({ clientName: "Contoso", changes: 0 })], now).line).toBe("DevOps checked just now · no changes");
  });
  it("names a slowed client with its next check, and a refused sign-in", () => {
    const r = refreshWords([one({ clientName: "Contoso", changes: 2 }), one({ clientName: "Fabrikam", changes: null, forced: false, problem: { kind: "slowed", words: "slowed by DevOps" }, nextAt: new Date(now + 4 * 60_000).toISOString() }), one({ clientName: "Tailspin", changes: null, problem: { kind: "refused", words: "DevOps sign-in was refused" } })], now);
    expect(r.line).toBe("DevOps checked just now · 2 changes · Fabrikam is slowed by DevOps, next check in 4 min · Tailspin's DevOps sign-in was refused");
  });
});

describe("the actions", () => {
  const setup = async () => {
    const h = harness({ contoso: project([aFakeItem({ id: 1, assignee: ME, type: "Feature" }), aFakeItem({ id: 2, area: `${P}\\Finance` })], { areas: [`${P}\\BI`, `${P}\\Finance`] }), fabrikam: project([aFakeItem({ id: 7 })]), elsewhere: { project: "Other Project", items: [aFakeItem({ id: 99, project: "Other Project" })] } });
    await h.tick();
    const src = h.reader({ sees: ["contoso", "fabrikam", "elsewhere"], scope: async () => ({ rule: { kind: "areas", areas: [{ path: `${P}\\BI`, sub: true }] }, isCooptimizer: () => true }) });
    const who = {};
    const ctx = (o: Partial<FreshContext> = {}): FreshContext => ({
      config: async () => aConfig(),
      // I follow contoso only (fabrikam is someone else's).
      clients: async () => [ref("contoso")],
      devops: () => src,
      nowMs: () => h.now().epochMilliseconds,
      who,
      ...o,
    });
    return { h, ctx };
  };

  it("versions: only my clients, whatever is asked for", async () => {
    const { ctx } = await setup();
    const r = await freshAction(ctx(), "devops.versions", { clientKeys: ["contoso", "fabrikam"] });
    expect(r.ok && (r.data as VersionsAnswer).clients.map((c) => c.clientKey)).toEqual(["contoso"]);
    expect(JSON.stringify(r)).not.toMatch(/Item \d|title/i);
  });

  it("refresh: forces my clients only and answers in words", async () => {
    const { h, ctx } = await setup();
    h.advance(31_000);
    h.fake.change("contoso", 1, { title: "x" });
    const r = await freshAction(ctx(), "devops.refresh", {});
    const a = r.ok ? (r.data as RefreshAnswer) : null;
    expect(a?.clients.map((c) => c.clientKey)).toEqual(["contoso"]);
    expect(a?.line).toBe("DevOps checked just now · 1 change");
  });

  it("find: a client I can't see is refused without a word about it, and at most 10 a minute", async () => {
    const { ctx } = await setup();
    const c = ctx();
    expect((await freshAction(c, "devops.find", { clientKey: "fabrikam", itemId: 7 })).ok).toBe(false);
    for (let i = 0; i < 10; i++) expect((await freshAction(c, "devops.find", { clientKey: "contoso", itemId: 1 })).ok).toBe(true);
    const r = await freshAction(c, "devops.find", { clientKey: "contoso", itemId: 1 });
    expect(r.ok === false && r.status).toBe(429);
  });

  it("find: in scope, out of area, missing, and in another project read the same as missing", async () => {
    const { ctx } = await setup();
    const lines = async (k: string, id: number) => {
      const r = await freshAction(ctx({ clients: async () => [ref(k)], who: {} }), "devops.find", { clientKey: k, itemId: id });
      return r.ok ? (r.data as FindAnswer).lines.map((l) => l.text) : [JSON.stringify(r)];
    };
    const one = await lines("contoso", 1);
    expect(one[0]).toMatch(/^DevOps has #1 "Item 1", a Feature in Active\.$/);
    expect(one[1]).toMatch(/^FocusTime has it/);
    const two = await lines("contoso", 2);
    expect(two.join("\n")).toMatch(/It's in area Contoso Project\\Finance, outside what FocusTime shows for contoso/);
    const none = await lines("contoso", 4242);
    expect(none[0]).toMatch(/^FocusTime's last check of contoso's project \(.+\) found no #4242\. If you just made it, Refresh checks now\. If you made it in another project, FocusTime doesn't read that project for contoso\.$/);
    // #7 exists, in fabrikam's org (another client): from contoso it's the same answer as one that doesn't exist.
    const other = await lines("contoso", 99);
    expect(other[0]).toBe(none[0]!.replace("#4242", "#99"));
    expect(other.join(" ")).not.toMatch(/Other Project|Item 99/);
  });

  it("find: answers from the store only; a person's lookup never sends a request to DevOps", async () => {
    const { h, ctx } = await setup();
    h.advance(61_000);
    h.fake.add("contoso", { id: 30, type: "User Story", state: "New", title: "Not checked yet" });
    h.fake.reset();
    const r = await freshAction(ctx(), "devops.find", { clientKey: "contoso", itemId: 30 });
    const text = r.ok ? (r.data as FindAnswer).lines.map((l) => l.text).join("\n") : "";
    expect(text).toMatch(/found no #30\. If you just made it, Refresh checks now/);
    expect(h.fake.calls).toEqual([]);
    expect((await h.store.items("contoso")).some((i) => i.id === 30)).toBe(false);
  });
});

void DANA;
