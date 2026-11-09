// TX-1b: the week list reads its stories' time left through an index, not by scanning the person's whole to-do history.
import { describe, expect, it } from "vitest";
import { openPlanDb, weekLeftSql } from "../plan-store.ts";

const now = () => Temporal.Now.zonedDateTimeISO("UTC");

describe("picks_client_item", () => {
  it("exists after the migrations and is what the week's query uses", () => {
    const db = openPlanDb({ path: ":memory:", now });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'picks_client_item'").get()).toBeTruthy();
    const scoped = weekLeftSql(2).replace(" WHERE client_key", " WHERE user_id = 'u' AND client_key");
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${scoped}`).all("Adatum", 1, 2, "2026-11-15") as { detail: string }[]).map((r) => r.detail).join("\n");
    expect(plan).toContain("USING INDEX picks_client_item");
    expect(plan).not.toContain("SCAN");
    db.close();
  });
});
