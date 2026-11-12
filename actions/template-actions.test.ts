// TP-1: the work templates on both databases: seeded once, an edit surviving a restart, only admins saving, every save
// audited with who, when and why, two admins at once, and the counts per type.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { SEED, type WorkTemplates } from "../plan/work-templates.ts";
import { workTemplatesStoreOn } from "../store/work-templates-store.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { templateAction, type TemplatesView } from "./template-actions.ts";

const NOW = "2026-11-12T15:00:00Z";
const ADA = { id: "00000000-0000-4000-8000-0000000000a1", name: "Ada Admin" };
const BO = { id: "00000000-0000-4000-8000-0000000000b2", name: "Bo Admin" };
const clone = (t: WorkTemplates): WorkTemplates => JSON.parse(JSON.stringify(t)) as WorkTemplates;
const data = (r: Awaited<ReturnType<typeof templateAction>>) => {
  if (!r.ok) throw new Error(r.error);
  return r.data as TemplatesView;
};

await forEachDriver("work templates (TP-1)", ({ open }) => {
  it("the seed loads once; an edit survives a restart (a new store on the same database)", async () => {
    const { conn } = await open();
    const first = workTemplatesStoreOn(conn, () => NOW);
    const ctx = { store: first, admin: async () => ADA };
    const v = data(await templateAction(ctx, "templates.load", {}));
    expect(v.doc).toEqual(SEED);
    expect(v.version).toBe(1);
    const next = clone(v.doc);
    next.types[2]!.lines.where.hint = "Which model.";
    data(await templateAction(ctx, "templates.save", { doc: next, version: 1, why: "Shorter hint" }));
    const restarted = workTemplatesStoreOn(conn, () => NOW);
    const again = data(await templateAction({ store: restarted, admin: async () => null }, "templates.load", {}));
    expect(again.doc.types[2]!.lines.where.hint).toBe("Which model.");
    expect(again.version).toBe(2);
    expect(again.admin).toBe(false);
    expect(again.uses).toBeUndefined();
  });

  it("only admins can change them", async () => {
    const { conn } = await open();
    const r = await templateAction({ store: workTemplatesStoreOn(conn, () => NOW), admin: async () => null }, "templates.save", { doc: SEED, version: 1, why: "x" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("each change is audited with who, when and the one line of why; no why, no save", async () => {
    const { conn } = await open();
    const ctx = { store: workTemplatesStoreOn(conn, () => NOW), admin: async () => ADA };
    const next = clone(SEED);
    next.types[0]!.name = "Tweak";
    next.lists.notWithout = [...next.lists.notWithout, "Delete anything"];
    expect(await templateAction(ctx, "templates.save", { doc: next, version: 1, why: " " })).toMatchObject({ ok: false, code: "why" });
    data(await templateAction(ctx, "templates.save", { doc: next, version: 1, why: "Clearer words" }));
    const audit = await createAdminStore(conn, () => Temporal.Instant.from(NOW)).auditList({ area: "work_templates" });
    expect(audit.map((a) => [a.actorName, a.target, a.setting, a.oldValue, a.newValue, a.note]).sort()).toEqual([
      ["Ada Admin", "Choice lists", "Not without asking", "Deploy to production, Rerun or reload data, Change or fix data, Change who can see it", "Deploy to production, Rerun or reload data, Change or fix data, Change who can see it, Delete anything", "Clearer words"],
      ["Ada Admin", "Tweak", "Name", "Small change", "Tweak", "Clearer words"],
    ]);
    expect(audit[0]!.at).toBe(NOW);
  });

  it("two admins at once: the second save, made from the old version, is refused and changes nothing", async () => {
    const { conn } = await open();
    const store = workTemplatesStoreOn(conn, () => NOW);
    const a = clone(SEED);
    a.types[0]!.meaning = "Ada's words";
    const b = clone(SEED);
    b.types[0]!.meaning = "Bo's words";
    data(await templateAction({ store, admin: async () => ADA }, "templates.save", { doc: a, version: 1, why: "a" }));
    expect(await templateAction({ store, admin: async () => BO }, "templates.save", { doc: b, version: 1, why: "b" })).toMatchObject({ ok: false, status: 409, code: "conflict" });
    expect((await store.read()).doc.types[0]!.meaning).toBe("Ada's words");
  });

  it("a bad edit is refused in plain words", async () => {
    const { conn } = await open();
    const next = clone(SEED);
    next.types[1]!.name = next.types[0]!.name;
    expect(await templateAction({ store: workTemplatesStoreOn(conn, () => NOW), admin: async () => ADA }, "templates.save", { doc: next, version: 1, why: "x" })).toMatchObject({ ok: false, status: 422, error: "Two types are called Small change" });
  });

  it("counts per type, for admins only: created, and with all four lines", async () => {
    const { conn } = await open();
    const store = workTemplatesStoreOn(conn, () => NOW);
    await store.used("new-measure", true);
    await store.used("new-measure", false);
    await store.used("deployment", false);
    expect(data(await templateAction({ store, admin: async () => ADA }, "templates.load", {})).uses).toEqual({ "new-measure": { created: 2, complete: 1 }, deployment: { created: 1, complete: 0 } });
  });
});
