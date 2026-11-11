// WP-1: the real DevOps patterns reader over a fake DevOps that answers with rate headers (fictional data): a nearly
// spent budget makes the run wait and say so while the poller's own limiter is never held or counted; a refusal holds
// both (DevOps asked); the poller's check of a client coming up (or running) makes the run give way.
import { describe, expect, it } from "vitest";
import { createLimiter } from "./devops-poll.ts";
import { createPatternsLimiter, createPatternsReader, LOW_WAIT_MS } from "./patterns-reader.ts";
import { createPatternsRunner } from "./patterns-run.ts";
import { createPatternsStore } from "../store/patterns-store.ts";
import { sqliteDb } from "../test/db.ts";
import { aSmallProject, fakePatternsReader } from "../test/builders/patterns.ts";
import type { DevOpsInternal } from "../sources/devops/source.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import type { Freshness } from "../plan/devops-fresh-types.ts";

const NOW = "2026-11-11T17:00:00Z";
const ME = "e2e00000-0000-4000-8000-0000000000aa";
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const target = (k: string): DevOpsTarget => ({ accountId: `acc-${k}`, clientKey: k, clientName: k, org: "contoso", project: "Sample", projectName: "Sample", email: null, pat: null });

/** The fake DevOps behind the second app-level source: each request goes through the limiter like the real client. */
function fakeInternal(limiter: ReturnType<typeof createPatternsLimiter>, answer: () => { status: number; h: Record<string, string> }) {
  const data = fakePatternsReader({ adatum: aSmallProject(100) });
  const through = async <T>(k: string, f: () => Promise<T>): Promise<T> => {
    limiter.before(k);
    const a = answer();
    limiter.after(k, a.status, headers(a.h));
    return f();
  };
  const categories = new Map([["Initiative", "Proposed"], ["Piece", "Proposed"], ["Step", "Proposed"]].map(([t]) => [t!, new Map([["new", "Proposed"], ["active", "InProgress"], ["done", "Completed"]])]));
  const internal = {
    meta: (t: DevOpsTarget) => through(t.clientKey, async () => ({ meta: { categories }, fields: { size: "Microsoft.VSTS.Scheduling.StoryPoints" } })),
    ids: (t: DevOpsTarget, wiql: string, top: number) => through(t.clientKey, async () => ({ ids: await data.ids(t.clientKey, wiql, top), asOf: NOW })),
    batch: (t: DevOpsTarget, ids: number[], fields: string[]) => through(t.clientKey, () => data.batch(t.clientKey, ids, fields)),
    updates: (t: DevOpsTarget, id: number) => through(t.clientKey, () => data.updates(t.clientKey, id)),
  } as unknown as DevOpsInternal;
  return { internal, data };
}

function setup(o: { answer?: () => { status: number; h: Record<string, string> }; nextAt?: () => string | null } = {}) {
  let clock = Temporal.Instant.from(NOW);
  const now = () => clock;
  const shared = createLimiter(now);
  const limiter = createPatternsLimiter(shared, now);
  const { internal, data } = fakeInternal(limiter, o.answer ?? (() => ({ status: 200, h: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "190" } })));
  const freshness = async (keys: readonly string[]) => keys.map((k) => ({ clientKey: k, nextAt: o.nextAt?.() ?? null }) as unknown as Freshness);
  const reader = createPatternsReader({ source: () => internal, limiter, target: async (k) => target(k), freshness, clients: async () => ["adatum"], now });
  return { shared, limiter, reader, data, tick: (ms: number) => void (clock = clock.add({ milliseconds: ms })), now };
}

describe("DevOps patterns reader (WP-1)", () => {
  it("a nearly spent budget: the run waits and says so; the poller's limiter is neither held nor counted", async () => {
    const s = setup({ answer: () => ({ status: 200, h: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "20" } }) });
    expect(await s.reader.wait("adatum")).toBeNull();
    await s.reader.ids("adatum", "SELECT [System.Id] FROM WorkItems ORDER BY [System.CreatedDate] ASC", 1);
    expect(await s.reader.wait("adatum")).toBe("Waiting for DevOps budget");
    // The poller: not held, and none of the patterns reader's responses in its pace.
    expect(s.shared.waiting("adatum")).toBe(false);
    expect(s.shared.take("adatum").calls).toBe(0);
    s.tick(LOW_WAIT_MS + 1);
    expect(await s.reader.wait("adatum")).toBeNull();
  });

  it("a refusal (429 with Retry-After) holds this reader and the shared limiter: DevOps asked", async () => {
    const s = setup({ answer: () => ({ status: 429, h: { "retry-after": "30" } }) });
    await s.reader.ids("adatum", "x", 1);
    expect(await s.reader.wait("adatum")).toBe("DevOps asked FocusTime to wait");
    expect(s.shared.waiting("adatum")).toBe(true);
    await expect(s.reader.ids("adatum", "x", 1)).rejects.toThrow(/wait/);
    s.tick(31_000);
    expect(s.shared.waiting("adatum")).toBe(false);
    expect(await s.reader.wait("adatum")).toBeNull();
  });

  it("a delayed response waits five minutes", async () => {
    const s = setup({ answer: () => ({ status: 200, h: { "x-ratelimit-delay": "0.5" } }) });
    await s.reader.ids("adatum", "x", 1);
    expect(await s.reader.wait("adatum")).toBe("DevOps is delaying requests");
    s.tick(5 * 60_000 + 1);
    expect(await s.reader.wait("adatum")).toBeNull();
  });

  it("gives way while the poller's check of the client is due within 15 s or ran in the last minute", async () => {
    let next: string | null = null;
    const s = setup({ nextAt: () => next });
    const at = (ms: number) => s.now().add({ milliseconds: ms }).toString();
    next = at(10_000);
    expect(await s.reader.wait("adatum")).toBe("Giving way to FocusTime's own DevOps check");
    next = at(-30_000);
    expect(await s.reader.wait("adatum")).toBe("Giving way to FocusTime's own DevOps check");
    next = at(60_000);
    expect(await s.reader.wait("adatum")).toBeNull();
    next = at(-120_000);
    expect(await s.reader.wait("adatum")).toBeNull();
  });

  it("a whole inventory over the real reader with a low budget: it waits between requests and still finishes", async () => {
    const db = sqliteDb();
    let calls = 0;
    // Every third answer says the budget is low.
    const s = setup({ answer: () => (++calls % 3 === 0 ? { status: 200, h: { "x-ratelimit-limit": "200", "x-ratelimit-remaining": "30" } } : { status: 200, h: {} }) });
    const store = createPatternsStore(db.conn, s.now);
    const sleeps: number[] = [];
    const runner = createPatternsRunner({ store, reader: s.reader, now: s.now, sleep: async (ms) => (sleeps.push(ms), s.tick(ms)), log: () => {}, owner: "proc-1", allowed: async () => true });
    await runner.startInventory(ME);
    for (let l = runner.activeLoop(); l; l = runner.activeLoop()) await l;
    expect((await store.latest("inventory")).last!.state).toBe("done");
    expect(sleeps.some((ms) => ms >= 30_000)).toBe(true);
    expect(s.shared.waiting("adatum")).toBe(false);
    expect(s.shared.take("adatum").calls).toBe(0);
  });
});
