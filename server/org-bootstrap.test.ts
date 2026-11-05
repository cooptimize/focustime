// ADM-1: the one-time move of team settings out of people's own settings. AI on if anyone had it on, a client allowed if
// anyone allowed it (both audited "migrated"); team colors by majority; the newest house style wins and the others are
// audited "replaced by team style"; people keep only the phrases they added; poll_minutes goes; it runs once.
import { describe, expect, it } from "vitest";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import { DEFAULT_REQUEST_PHRASES } from "../plan/asks.ts";
import type { HouseStyle } from "../plan/stories.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { sqliteDb } from "../test/db.ts";
import { BOOTSTRAP_MARK, orgBootstrap, type BootstrapPerson } from "./org-bootstrap.ts";

const base = () => setValue(starterToml("America/Chicago"), "dataverse", "my_email", "me@example.com");
const style = (clientKey: string, edited: string, editedAt: string): HouseStyle => ({ clientKey, computed: null, computedAt: null, learned: false, edited, editedAt });

function person(id: string, name: string, extra: string, houseStyles: HouseStyle[] = []) {
  let text = `${base()}\n${extra}\n`;
  const p: BootstrapPerson & { text: () => string } = {
    id,
    name,
    get config() {
      const r = parseConfig(text);
      return r.ok ? r.config : null;
    },
    houseStyles,
    write: async (edit) => {
      const next = edit(text);
      if (!parseConfig(next).ok) return false;
      text = next;
      return true;
    },
    text: () => text,
  };
  return p;
}

describe("orgBootstrap", () => {
  it("moves AI, colors, open states, house styles and phrases to the team, once", async () => {
    const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from("2026-11-04T15:00:00Z"));
    const phrases = JSON.stringify([...DEFAULT_REQUEST_PHRASES, "by friday"]);
    const ana = person("a", "Ana", `[ai]\nuse = true\nallowed_clients = ["contoso"]\n\n[asks]\npoll_minutes = 5\nrequest_phrases = ${phrases}\n\n[clients]\ncontoso = { color = "teal", name = "Contoso" }`, [style("contoso", "Old style", "2026-10-01T00:00:00Z")]);
    const ben = person("b", "Ben", `[ai]\nuse = false\nallowed_clients = ["fabrikam"]\n\n[clients]\ncontoso = { color = "teal", name = "Contoso", open_states = ["Resolved"] }`, [style("contoso", "New style", "2026-10-20T00:00:00Z")]);
    const cy = person("c", "Cy", `[clients]\ncontoso = { color = "rose", name = "Contoso" }`);
    const r = await orgBootstrap({ store, people: async () => [ana, ben, cy] });
    expect(r).toMatchObject({ ran: true, people: 3, aiOn: true, allowed: ["contoso", "fabrikam"], colors: 1, styles: 1, replaced: 1 });
    const rows = new Map((await store.orgRows()).map((x) => [`${x.scope}/${x.key}`, JSON.parse(x.value)]));
    expect(rows.get("org/ai.on")).toBe(true);
    expect([rows.get("client:contoso/allow_ai"), rows.get("client:fabrikam/allow_ai")]).toEqual([true, true]);
    expect(rows.get("client:contoso/color")).toBe("teal");
    expect(rows.get("client:contoso/open_states")).toEqual(["Resolved"]);
    expect(rows.get("client:contoso/house_style")).toBe("New style");
    const audit = await store.auditList({});
    expect(audit.filter((e) => e.note === "migrated").map((e) => e.setting).sort()).toEqual(["client:contoso/allow_ai", "client:contoso/color", "client:contoso/open_states", "client:fabrikam/allow_ai", "org/ai.on"]);
    expect(audit.find((e) => e.note === "replaced by team style")).toMatchObject({ target: "Ana · contoso", oldValue: '"Old style"', newValue: '"New style"' });
    // Ana keeps only "by friday"; poll_minutes is gone; a color equal to the team's follows the team; Cy's stays hers.
    expect(ana.config!.mine.requestPhrases).toEqual(["by friday"]);
    expect(ana.text()).not.toMatch(/poll_minutes/);
    expect(ana.config!.clientSettings.contoso?.color ?? null).toBeNull();
    expect(cy.config!.clientSettings.contoso?.color).toBe("rose");
    expect(await store.orgRow(BOOTSTRAP_MARK.scope, BOOTSTRAP_MARK.key)).not.toBeNull();
    // Never again.
    expect((await orgBootstrap({ store, people: async () => [ana, ben, cy] })).ran).toBe(false);
  });

  it("nobody had AI on: off, and no allows", async () => {
    const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from("2026-11-04T15:00:00Z"));
    const r = await orgBootstrap({ store, people: async () => [person("a", "Ana", "")] });
    expect([r.aiOn, r.allowed]).toEqual([false, []]);
    expect(JSON.parse((await store.orgRow("org", "ai.on"))!.value)).toBe(false);
  });

  it("WT-1's type lists go into each of the person's clients' Rules, together; the old settings go", async () => {
    const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from("2026-11-04T15:00:00Z"));
    await store.replaceDirectory([], [], [{ personId: "b", clientKey: "fabrikam" }, { personId: "x", clientKey: "northwind" }]);
    const lists = (pick: string[], bg: string[]) => (t: string) => setValue(setValue(t, "plan", "pickable_portfolio_types", pick), "plan", "background_types", bg);
    const ana = person("a", "Ana", `[clients]\ncontoso = { name = "Contoso" }`);
    await ana.write(lists(["Recurring"], ["Test Case"]));
    const ben = person("b", "Ben", "");
    await ben.write(lists(["recurring", "Ongoing"], []));
    // No clients of her own anywhere: her list applies to every client known.
    const cy = person("c", "Cy", "");
    await cy.write(lists([], ["Issue"]));
    const r = await orgBootstrap({ store, people: async () => [ana, ben, cy] });
    expect(r.processClients).toBe(3);
    const rows = new Map((await store.orgRows()).map((x) => [`${x.scope}/${x.key}`, JSON.parse(x.value)]));
    expect(rows.get("client:contoso/no_breakdown")).toEqual(["Recurring"]);
    expect(rows.get("client:contoso/background")).toEqual(["Issue", "Test Case"]);
    expect(rows.get("client:fabrikam/no_breakdown")).toEqual(["Ongoing", "recurring"]);
    expect(rows.get("client:fabrikam/background")).toEqual(["Issue"]);
    expect(rows.get("client:northwind/background")).toEqual(["Issue"]);
    expect(rows.has("client:northwind/no_breakdown")).toBe(false);
    const audit = await store.auditList({ text: "no_breakdown" });
    expect(audit.every((e) => e.note === "migrated" && e.actorName === "FocusTime")).toBe(true);
    for (const p of [ana, ben, cy]) expect(p.text()).not.toMatch(/^(pickable_portfolio_types|background_types)\s*=/m);
    expect(ana.config!.plan.pickablePortfolioTypes).toEqual([]);
  });
});
