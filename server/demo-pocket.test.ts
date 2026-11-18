// PK-2: the demo shows Settings › Pocket recorder and connects to a pretend Pocket that answers from invented data;
// its failure keys show each failure's words. And nothing calls Pocket but a person's press: the only code that asks
// Pocket for anything is pocket.connect and pocket.check; no job, schedule, page load or other action reaches it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch, DEMO_REFUSED } from "../actions/dispatch.ts";
import { DEMO_POCKET_KEYS } from "../sources/demo/pocket.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-17T15:00:00Z";

describe("PK-2: the demo's Pocket", () => {
  it("connects with any pk_ key and counts invented recordings; Disconnect forgets it", async () => {
    const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
    await seedDemo(ctx);
    for (const a of ["pocket.status", "pocket.connect", "pocket.check", "pocket.disconnect"]) expect(DEMO_REFUSED).not.toContain(a);
    expect(await dispatch(ctx, { action: "pocket.status", input: {} })).toEqual({ ok: true, data: { connected: false, checkedAt: null, recordings: null, addresses: [], last: null } });
    expect(await dispatch(ctx, { action: "pocket.connect", input: { key: "pk_demo_mine" } })).toEqual({ ok: true, data: { connected: true, checkedAt: "2026-11-17T15:00:00.000Z", recordings: 1, addresses: [], last: null } });
    expect(await dispatch(ctx, { action: "pocket.connect", input: { key: DEMO_POCKET_KEYS.busy } })).toMatchObject({ ok: false, code: "pocket_busy" });
    expect(await dispatch(ctx, { action: "pocket.disconnect", input: {} })).toMatchObject({ ok: true, data: { connected: false } });
  });
});

describe("PK-2: only a press reaches Pocket", () => {
  const ROOT = join(import.meta.dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (["node_modules", ".git", "dist", "e2e", "screenshots"].includes(n)) return [];
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
    });
  const src = files(ROOT).map((p) => ({ p: p.slice(ROOT.length + 1), t: readFileSync(p, "utf8") }));

  it("the client is built only in server/main.ts and server/demo.ts, and counted only in actions/pocket-actions.ts", () => {
    expect(src.filter((f) => /createPocketClient\(/.test(f.t)).map((f) => f.p).sort()).toEqual(["server/demo.ts", "server/main.ts", "sources/pocket/client.ts"]);
    expect(src.filter((f) => /\.count(LastWeek|Recordings)\(/.test(f.t)).map((f) => f.p).sort()).toEqual(["actions/pocket-actions.ts"]);
  });

  it("pocket.connect and pocket.check are called only from the Settings section's buttons, never by a job or the assistant", () => {
    const callers = src.filter((f) => /["']pocket\.(connect|check)["']/.test(f.t)).map((f) => f.p).sort();
    expect(callers).toEqual(["actions/dispatch.ts", "actions/pocket-actions.ts", "actions/registry.ts", "ui/menu.ts", "ui/settings/Pocket.tsx"]);
    const allow = src.find((f) => f.p === "assistant/allowlist.ts")?.t ?? "";
    expect(allow).not.toMatch(/pocket/i);
    for (const f of src.filter((x) => /^server\/(scheduler|ticks|.*-job)\.ts$/.test(x.p))) expect(f.t, f.p).not.toMatch(/pocket/i);
  });

  it("MC-2b: the list and one recording are asked only from meeting.pocket_list and meeting.pocket_bring", () => {
    expect(src.filter((f) => /\.(listRecordings|recording)\(/.test(f.t)).map((f) => f.p).sort()).toEqual(["actions/meeting-pocket.ts"]);
    const fns = src.find((f) => f.p === "actions/meeting-pocket.ts")!.t;
    // listRecordings only inside pocketList, recording only inside pocketBring.
    const body = (name: string) => fns.slice(fns.indexOf(`export async function ${name}(`), fns.indexOf("\nexport ", fns.indexOf(`export async function ${name}(`) + 10));
    expect(body("pocketList")).toMatch(/\.listRecordings\(/);
    expect(body("pocketBring")).toMatch(/\.recording\(/);
    expect(body("pocketAdd")).not.toMatch(/\.(listRecordings|recording)\(/);
    const callers = src.filter((f) => /["']meeting\.pocket_(list|bring)["']/.test(f.t)).map((f) => f.p).sort();
    expect(callers).toEqual(["actions/dispatch.ts", "actions/meeting-actions.ts", "actions/registry.ts", "ui/meetings/Meetings.tsx", "ui/menu.ts"]);
  });

  it("MC-2b: no job, schedule, background policy, the assistant or the Teams bot reaches Pocket", () => {
    const policy = src.find((f) => f.p === "config/background-policy.ts")!.t;
    expect(policy).not.toMatch(/pocket/i);
    expect(src.find((f) => f.p === "assistant/allowlist.ts")?.t ?? "").not.toMatch(/pocket/i);
    for (const f of src.filter((x) => /^server\/(scheduler|ticks|.*-job|teams\/.*)\.ts$/.test(x.p) || /^assistant\//.test(x.p))) expect(f.t, f.p).not.toMatch(/pocket_(list|bring|add)|listRecordings|PocketHold/);
  });
});
