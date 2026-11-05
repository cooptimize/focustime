// ADM-1: the demo's person is an admin of their own demo only. The demo's team settings, People, chats and audit live
// in the demo's own memory: it never reads or changes the real ones, and a demo's admin powers stop at its edge.
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import { createAdminStore, FOCUSTIME } from "../store/admin-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { sqliteDb } from "../test/db.ts";
import { DEMO_PERSON } from "../sources/demo/azure.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

const NOW = "2026-11-02T13:30:00Z";
async function demo(): Promise<ActionContext> {
  const ctx = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  return ctx;
}
const data = async <T = Record<string, unknown>>(ctx: ActionContext, action: string, input: unknown = {}): Promise<T> => {
  const r = await dispatch(ctx, { action, input });
  if (!r.ok) throw new Error(`${action}: ${r.error}`);
  return r.data as T;
};

describe("the demo's admin console", () => {
  it("the demo person is an admin of the demo; its changes stay in the demo's memory", async () => {
    // A real FocusTime's team settings, chats and audit, on their own database.
    const real = sqliteDb().conn;
    const now = () => Temporal.Instant.from(NOW);
    const realStore = createAdminStore(real, now);
    const realTeams = createTeamsStore(real, now);
    await realStore.setOrg({ scope: "org", key: "ai.on", value: true, actor: FOCUSTIME, area: "ai", target: "Everyone" });
    await realStore.setOrg({ scope: "client:contoso", key: "color", value: "rose", actor: FOCUSTIME, area: "clients", target: "contoso" });
    await realStore.replaceDirectory([{ personId: "00000000-0000-4000-8000-0000000000f1", systemUserId: "00000000-0000-4000-8000-0000000000f2", name: "Real Person", email: "real@cooptimize.example", level: "lead", positionName: "Lead Consultant" }], [], []);
    await realTeams.addChat({ chatId: "19:real@thread.v2", clientKey: "contoso", kind: "delivery", displayName: "Real chat", webUrl: null, members: null, by: "00000000-0000-4000-8000-0000000000f1" });
    const before = { rows: await realStore.orgRows(), audit: await realStore.auditList({}), dir: await realStore.directory(), chats: await realTeams.chats() };

    const ctx = await demo();
    expect(await data(ctx, "admin.status")).toEqual({ admin: true, via: "demo" });
    const ai = await data<{ on: boolean; allowedClients: string[] }>(ctx, "admin.load", { section: "ai" });
    expect(ai.on).toBe(false); // not the real FocusTime's "on"
    await data(ctx, "admin.set", { scope: "org", key: "ai.on", value: true });
    await data(ctx, "admin.set", { scope: "client:Northwind", key: "allow_ai", value: true });
    const people = await data<{ people: { name: string }[] }>(ctx, "admin.load", { section: "people" });
    expect(people.people.map((p) => p.name)).not.toContain("Real Person");
    expect(people.people.map((p) => p.name)).toContain(DEMO_PERSON.name);
    const status = await data<{ chats: { name: string }[] }>(ctx, "admin.load", { section: "status" });
    expect(status.chats.map((c) => c.name)).not.toContain("Real chat");
    const audit = await data<{ entries: { setting: string }[] }>(ctx, "admin.audit", {});
    expect(audit.entries.map((e) => e.setting)).toContain("client:Northwind/allow_ai");
    // Removing anyone is refused in the demo (its people are pretend).
    expect((await dispatch(ctx, { action: "admin.remove_person", input: { personId: "00000000-0000-4000-8000-0000000000f1", confirmName: "Real Person" } })).ok).toBe(false);

    // The real FocusTime is exactly as it was.
    expect({ rows: await realStore.orgRows(), audit: await realStore.auditList({}), dir: await realStore.directory(), chats: await realTeams.chats() }).toEqual(before);
  });

  it("two demos don't share their team settings", async () => {
    const a = await demo();
    const b = await demo();
    await data(a, "admin.set", { scope: "org", key: "ai.on", value: true });
    expect((await data<{ on: boolean }>(b, "admin.load", { section: "ai" })).on).toBe(false);
  });
});
