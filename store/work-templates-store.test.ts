// TP-1's stored work templates on both databases, kept by TP-1b while the page is hidden (Break down will offer a
// type's typical stories later): seeded once, an edit surviving a restart, every save audited with who, when and why,
// two admins at once, and the counts per type. The admin-only rule and the one line of why were the action's, which
// TP-1b took out with the page; checkTemplates and templateChanges stay tested in plan/work-templates.test.ts.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { checkTemplates, SEED, templateChanges, type WorkTemplates } from "../plan/work-templates.ts";
import { workTemplatesStoreOn } from "./work-templates-store.ts";
import { createAdminStore } from "./admin-store.ts";

const NOW = "2026-11-12T15:00:00Z";
const ADA = { id: "00000000-0000-4000-8000-0000000000a1", name: "Ada Admin" };
const BO = { id: "00000000-0000-4000-8000-0000000000b2", name: "Bo Admin" };
const clone = (t: WorkTemplates): WorkTemplates => JSON.parse(JSON.stringify(t)) as WorkTemplates;
const save = (store: ReturnType<typeof workTemplatesStoreOn>, next: WorkTemplates, version: number, actor = ADA, why = "Clearer words") => store.read().then((was) => store.save(checkTemplates(next, was.doc), version, actor, why, templateChanges(was.doc, next)));

await forEachDriver("work templates store (TP-1, kept by TP-1b)", ({ open }) => {
  it("the seed loads once; an edit survives a restart (a new store on the same database)", async () => {
    const { conn } = await open();
    const first = workTemplatesStoreOn(conn, () => NOW);
    const v = await first.read();
    expect(v.doc).toEqual(SEED);
    expect(v.version).toBe(1);
    const next = clone(v.doc);
    next.types[2]!.lines.where.hint = "Which model.";
    await save(first, next, 1);
    const again = await workTemplatesStoreOn(conn, () => NOW).read();
    expect(again.doc.types[2]!.lines.where.hint).toBe("Which model.");
    expect(again.version).toBe(2);
  });

  it("each change is audited with who, when and the one line of why", async () => {
    const { conn } = await open();
    const store = workTemplatesStoreOn(conn, () => NOW);
    const next = clone(SEED);
    next.types[0]!.name = "Tweak";
    next.lists.notWithout = [...next.lists.notWithout, "Delete anything"];
    await save(store, next, 1);
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
    expect(await save(store, a, 1)).not.toBe("conflict");
    expect(await save(store, b, 1, BO, "b")).toBe("conflict");
    expect((await store.read()).doc.types[0]!.meaning).toBe("Ada's words");
  });

  it("counts per type: created, and with all four lines", async () => {
    const { conn } = await open();
    const store = workTemplatesStoreOn(conn, () => NOW);
    await store.used("new-measure", true);
    await store.used("new-measure", false);
    await store.used("deployment", false);
    expect(await store.uses()).toEqual({ "new-measure": { created: 2, complete: 1 }, deployment: { created: 1, complete: 0 } });
  });
});
