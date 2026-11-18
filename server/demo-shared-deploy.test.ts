// DP-3: other people on a deployment, on the demo. Who can be added is checked on the server (Cooptimizers who use
// FocusTime only: never a guest, an automation account, someone not on FocusTime yet or an id typed in); a person
// added sees it in their own week at once (demo.be: a second signed-in person on the demo's database), and an admin
// or a client lead who isn't on it sees nothing of it.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { Pick } from "../plan/types.ts";
import { DEMO_PEOPLE } from "../sources/demo/data.ts";
import { DEMO_BOT, DEMO_GUEST } from "../sources/demo/directory.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-05T15:00:00Z"; // Thursday 10:00 AM in New York
const SAT = "2026-11-07";
const [JORDAN, PRIYA, , TAYLOR] = DEMO_PEOPLE;

async function demo() {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return ctx;
}
const call = (ctx: ActionContext, action: string, input: unknown = {}) => dispatch(ctx, { action, input });
const run = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await call(ctx, action, input);
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};
const deployments = async (ctx: ActionContext) => (await ctx.plan!.picksBetween("2026-11-02", "2026-11-08")).filter((p) => p.todoKind === "deployment" && p.status !== "dropped");
const plan = (people: string[]) => ({ clientKey: "Northwind", date: SAT, start: "09:00", end: "11:00", title: "Release 4.2", people });

describe("people on a deployment (DP-3, demo)", () => {
  useNoOutbound();

  it("only Cooptimizers who use FocusTime can be added, checked on the server", async () => {
    const ctx = await demo();
    for (const [who, why] of [[DEMO_GUEST.personId, /Only Cooptimizers/], [DEMO_BOT.personId, /Only Cooptimizers/], ["someone@outside.example", /Only Cooptimizers/], [TAYLOR!.aadId, /hasn't signed in to FocusTime yet/]] as const) {
      const r = await call(ctx, "deploy.add", plan([who]));
      expect(r.ok, who).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(why);
    }
    expect(await deployments(ctx)).toEqual([]);
  });

  it("a person added sees it at once in their own week; a teammate not on it, an admin among them, sees nothing", async () => {
    const ctx = await demo();
    const { pick } = await run<{ pick: Pick }>(ctx, "deploy.add", plan([JORDAN!.aadId]));
    expect(pick.shared?.people.map((p) => p.name)).toEqual(["Alex Rivera", "Jordan Lee"]);
    await run(ctx, "demo.be", { who: JORDAN!.aadId });
    const theirs = await deployments(ctx);
    expect(theirs.map((p) => [p.title, p.window, p.shared?.addedBy])).toEqual([["Release 4.2", { start: "09:00", end: "11:00" }, "00000000-0000-4000-8000-0000000000e1"]]);
    const week = await run<{ afterHours: { minutes: number } }>(ctx, "week.load", { weekStart: "2026-11-02" });
    expect(week.afterHours.minutes).toBe(120);
    // Priya leads Northwind in the demo and isn't on it: nothing, by the week or by the id.
    await run(ctx, "demo.be", { who: PRIYA!.aadId });
    expect(await deployments(ctx)).toEqual([]);
    expect((await call(ctx, "deploy.leave", { id: pick.id })).ok).toBe(false);
    expect((await call(ctx, "deploy.people", { id: pick.id, people: [PRIYA!.aadId] })).ok).toBe(false);
    expect((await call(ctx, "pick.mark_done", { id: pick.id, done: true })).ok).toBe(false);
    // The demo's own person is an admin of the demo: still only what they're on.
    await run(ctx, "demo.be", { who: "me" });
    expect((await deployments(ctx)).map((p) => p.id)).toEqual([pick.id]);
  });
});
