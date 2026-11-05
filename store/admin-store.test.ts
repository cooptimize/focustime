// ADM-1: the team's settings, admin audit, people's levels and leads, and overrides, on both databases.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { AUDIT_SHOWN, createAdminStore } from "./admin-store.ts";

const NOW = "2026-11-04T15:00:00Z";
const ADA = { id: "00000000-0000-4000-8000-0000000000a1", name: "Ada Admin" };
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CY = "00000000-0000-4000-8000-0000000000c3";

await forEachDriver("the admin store (ADM-1)", ({ open }) => {
  const store = async () => createAdminStore((await open()).conn, () => Temporal.Instant.from(NOW));

  it("a setting saves, changes and clears, each in the audit with old and new values", async () => {
    const s = await store();
    expect(await s.setOrg({ scope: "org", key: "ai.on", value: true, actor: ADA, area: "ai", target: "Everyone" })).toEqual({ old: null, next: "true" });
    expect(await s.setOrg({ scope: "client:fabrikam", key: "open_states", value: ["Resolved"], actor: ADA, area: "clients", target: "fabrikam" })).toMatchObject({ next: '["Resolved"]' });
    expect(await s.setOrg({ scope: "org", key: "ai.on", value: false, actor: ADA, area: "ai", target: "Everyone" })).toEqual({ old: "true", next: "false" });
    expect((await s.orgRows()).map((r) => [r.scope, r.key, r.value, r.updatedBy])).toEqual([
      ["client:fabrikam", "open_states", '["Resolved"]', ADA.id],
      ["org", "ai.on", "false", ADA.id],
    ]);
    await s.setOrg({ scope: "org", key: "ai.on", value: undefined, actor: ADA, area: "ai", target: "Everyone" });
    expect(await s.orgRow("org", "ai.on")).toBeNull();
    const audit = await s.auditList({});
    expect(audit.map((e) => [e.setting, e.oldValue, e.newValue])).toEqual([
      ["org/ai.on", "false", null],
      ["org/ai.on", "true", "false"],
      ["client:fabrikam/open_states", null, '["Resolved"]'],
      ["org/ai.on", null, "true"],
    ]);
    expect(audit[0]).toMatchObject({ actorId: ADA.id, actorName: "Ada Admin", area: "ai", target: "Everyone", at: NOW });
  });

  it("the audit shows the last 200, filtered by area or text", async () => {
    const s = await store();
    for (let i = 0; i < AUDIT_SHOWN + 5; i++) await s.audit(ADA, { area: i % 2 ? "ai" : "clients", target: `t${i}`, setting: `org/k${i}`, oldValue: null, newValue: String(i), note: null });
    const all = await s.auditList({});
    expect(all).toHaveLength(AUDIT_SHOWN);
    expect(all[0]!.target).toBe(`t${AUDIT_SHOWN + 4}`);
    expect((await s.auditList({ area: "ai" })).every((e) => e.area === "ai")).toBe(true);
    expect((await s.auditList({ text: "t204" })).map((e) => e.target)).toEqual(["t204"]);
    // The text is literal: _ % [ and ! match only themselves.
    await s.audit(ADA, { area: "ai", target: "Fabrikam", setting: "client:fabrikam/allow_ai", oldValue: null, newValue: "true", note: null });
    await s.audit(ADA, { area: "ai", target: "Fabrikam", setting: "client:fabrikam/allowxai", oldValue: null, newValue: "true", note: "50% [beta]!" });
    expect((await s.auditList({ text: "allow_ai" })).map((e) => e.setting)).toEqual(["client:fabrikam/allow_ai"]);
    expect((await s.auditList({ text: "50% [beta]!" })).map((e) => e.setting)).toEqual(["client:fabrikam/allowxai"]);
    expect(await s.auditList({ text: "[b" })).toHaveLength(1);
  });

  it("the directory is replaced whole each refresh; overrides stay, are logged and marked", async () => {
    const s = await store();
    const person = (id: string, name: string, level: "lead" | "consultant") => ({ personId: id, systemUserId: id.replace(/^0/, "1"), name, email: `${name.split(" ")[0]!.toLowerCase()}@cooptimize.example`, level, positionName: null });
    await s.replaceDirectory([person(BEN, "Ben Person", "consultant"), person(CY, "Cy Person", "lead")], [{ clientKey: "fabrikam", personId: CY, source: "owner" }, { clientKey: "fabrikam", personId: CY, source: "lead_worker" }], [{ personId: BEN, clientKey: "fabrikam" }]);
    await s.setOverride({ personId: BEN, personName: "Ben Person", kind: "lead_add", clientKey: "fabrikam", actor: ADA });
    await s.setOverride({ personId: BEN, personName: "Ben Person", kind: "level", value: "senior", actor: ADA });
    await s.replaceDirectory([person(BEN, "Ben Person", "consultant")], [], []);
    expect((await s.directory()).map((p) => p.personId)).toEqual([BEN]);
    expect(await s.leads()).toEqual([]);
    expect(await s.directoryRefreshedAt()).toBe(NOW);
    expect((await s.overrides()).map((o) => [o.kind, o.clientKey, o.value, o.byName]).sort()).toEqual([["lead_add", "fabrikam", null, "Ada Admin"], ["level", "", "senior", "Ada Admin"]]);
    await s.setOverride({ personId: BEN, personName: "Ben Person", kind: "level", clear: true, actor: ADA });
    expect((await s.overrides()).map((o) => o.kind)).toEqual(["lead_add"]);
    expect((await s.auditList({ area: "people" })).map((e) => e.note)).toEqual(["override removed", "override", "override"]);
    await s.forgetPerson(BEN);
    expect(await s.overrides()).toEqual([]);
  });

  it("who was last seen as an admin", async () => {
    const s = await store();
    await s.seen(BEN, true, "group");
    await s.seen(CY, false, null);
    await s.seen(BEN, true, "group");
    expect((await s.seenAdmins()).map((a) => [a.personId, a.via])).toEqual([[BEN, "group"]]);
  });
});
