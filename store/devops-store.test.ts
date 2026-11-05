// DV-1: the central DevOps store on both drivers: items replaced by revision, removals, the change log and its 30
// days, and the poll state, each check in one transaction.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { createDevOpsStore, emptyPoll } from "./devops-store.ts";

await forEachDriver("devops store", ({ open }) => {
  it("keeps items, the change log for 30 days and the poll state", async () => {
    const db = await open();
    let t = Temporal.Instant.from("2026-11-05T15:00:00Z");
    const s = createDevOpsStore(db.conn, () => t);
    const item = (id: number, rev: number) => ({ id, project: "Contoso Project", rev, changedAt: "2026-11-05T14:00:00Z", fields: { "System.Id": id, "System.Rev": rev, "System.Title": `Item ${id}` } });
    const change = { itemId: 1, kind: "assignee" as const, oldValue: "Avery S", newValue: "Dana Ruiz", byName: "Dana Ruiz", byUnique: "dana@contoso.example", changedAt: "2026-11-05T14:00:00Z", rev: 2 };
    await s.apply("contoso", { upsert: [item(1, 1), item(2, 1)], changes: [], state: { ...emptyPoll("contoso"), watermark: "2026-11-05T15:00:00Z" } });
    await s.apply("contoso", { upsert: [item(1, 2)], remove: [2], changes: [change], state: { ...emptyPoll("contoso"), changedToday: 2 } });
    expect((await s.items("contoso")).map((i) => [i.id, i.rev, i.fields["System.Title"]])).toEqual([[1, 2, "Item 1"]]);
    expect(await s.items("fabrikam")).toEqual([]);
    expect((await s.changes("contoso", "2026-11-01T00:00:00Z")).map((c) => [c.itemId, c.kind, c.oldValue, c.newValue, c.byUnique])).toEqual([[1, "assignee", "Avery S", "Dana Ruiz", "dana@contoso.example"]]);
    expect(await s.state("contoso")).toMatchObject({ changedToday: 2, slow: 1 });
    t = t.add({ hours: 24 * 31 });
    expect(await s.prune()).toBe(1);
    expect(await s.changes("contoso", "2026-11-01T00:00:00Z")).toEqual([]);
  });
});
