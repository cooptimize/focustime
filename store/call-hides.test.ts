// MC-4: the meetings a person hid from Calls (call_hides). Only which meeting and when, never its name, time, people or
// link; each person's own; a single meeting forgotten at 60 days, a series kept until put back; in Export my data and
// gone with Delete my data. Fictional data only.
import { describe, expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { createAccountStore } from "./accounts.ts";
import { CALL_HIDE_DAYS, planStoreOn } from "./plan-store.ts";
import { exportUser, hardDeleteUser } from "./user-data.ts";

const NY = "America/New_York";
let at = Temporal.Instant.from("2026-11-18T14:30:00Z");
const now = () => at;

await forEachDriver("call hides", ({ open }) => {
  async function setup() {
    at = Temporal.Instant.from("2026-11-18T14:30:00Z");
    const db = (await open()).conn;
    const accounts = createAccountStore(db, now);
    const person = async (id: string) => {
      await accounts.users.signedIn({ id, tenantId: "t", upn: `${id}@cooptimize.example`, displayName: id, email: `${id}@cooptimize.example` });
      return planStoreOn(db, { userId: id, now: () => now().toZonedDateTimeISO(NY) });
    };
    return { db, accounts, person };
  }

  describe("MC-4: call_hides", () => {
    it("keeps only which meeting and when", async () => {
      const t = await setup();
      const ana = await t.person("ana");
      await ana.hideCalls([{ kind: "one", key: "ical-1" }, { kind: "every", key: "series-1" }]);
      const rows = (await t.db.all("SELECT * FROM call_hides ORDER BY kind")) as Record<string, unknown>[];
      expect(Object.keys(rows[0]!).map((k) => k.toLowerCase()).sort()).toEqual(["hidden_at", "kind", "meeting_key", "user_id"]);
      expect(rows.map((r) => [r.kind, r.meeting_key])).toEqual([["every", "series-1"], ["one", "ical-1"]]);
    });

    it("is each person's own: one person's hide never hides a meeting for another, and Put back puts back only mine", async () => {
      const t = await setup();
      const ana = await t.person("ana");
      const ben = await t.person("ben");
      await ana.hideCalls([{ kind: "one", key: "ical-1" }]);
      await ben.hideCalls([{ kind: "one", key: "ical-1" }, { kind: "every", key: "series-2" }]);
      expect([...(await ana.callHides()).keys]).toEqual(["ical-1"]);
      expect([...(await ana.callHides()).series]).toEqual([]);
      await ana.unhideCalls([{ kind: "one", key: "ical-1" }, { kind: "every", key: "series-2" }]);
      expect((await ana.callHides()).keys.size).toBe(0);
      expect([...(await ben.callHides()).keys]).toEqual(["ical-1"]);
      expect([...(await ben.callHides()).series]).toEqual(["series-2"]);
    });

    it("hiding twice keeps the first; a single meeting goes at 60 days, a series stays until put back", async () => {
      const t = await setup();
      const ana = await t.person("ana");
      await ana.hideCalls([{ kind: "one", key: "ical-1" }, { kind: "every", key: "series-1" }]);
      at = at.add({ hours: 24 });
      await ana.hideCalls([{ kind: "one", key: "ical-1" }]);
      expect(((await t.db.all("SELECT hidden_at FROM call_hides WHERE kind = 'one'")) as { hidden_at: string }[]).map((r) => r.hidden_at)).toEqual(["2026-11-18T14:30:00Z"]);
      at = Temporal.Instant.from("2026-11-18T14:30:00Z").add({ hours: 24 * CALL_HIDE_DAYS + 1 });
      const h = await ana.callHides();
      expect([...h.keys]).toEqual([]);
      expect([...h.series]).toEqual(["series-1"]);
    });

    it("is in Export my data (mine only) and gone with Delete my data", async () => {
      const t = await setup();
      const ana = await t.person("ana");
      const ben = await t.person("ben");
      await ana.hideCalls([{ kind: "one", key: "ical-ana" }]);
      await ben.hideCalls([{ kind: "one", key: "ical-ben" }]);
      const out = (await exportUser(t.db, (await t.accounts.users.get("ana"))!, now())) as { tables: Record<string, Record<string, unknown>[]> };
      expect(out.tables.call_hides!.map((r) => r.meeting_key)).toEqual(["ical-ana"]);
      expect(JSON.stringify(out)).not.toContain("ical-ben");
      await hardDeleteUser(t.db, "ana", now());
      expect(((await t.db.all("SELECT meeting_key FROM call_hides")) as { meeting_key: string }[]).map((r) => r.meeting_key)).toEqual(["ical-ben"]);
    });
  });
});
