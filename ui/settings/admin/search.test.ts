// SA-4: Search Admin finds parts, tabs, clients by name or other name, people by name and settings by label.
import { describe, expect, it } from "vitest";
import { searchAdmin } from "./search.ts";

const clients = [{ key: "Atlas", names: ["Atlas Freight"], aliases: ["AF"] }, { key: "Harbor" }];
const people = [{ id: "p1", name: "Priya Shah" }];

describe("Search Admin", () => {
  it("finds each kind, by its own words", () => {
    const at = { part: null, tab: null, client: null };
    expect(searchAdmin("health", { clients, people, at }).map((h) => h.href)).toContain("#/admin/health");
    expect(searchAdmin("who's set", { clients, people, at })[0]).toMatchObject({ kind: "tab", href: "#/admin/people/setup" });
    expect(searchAdmin("freight", { clients, people, at })[0]).toMatchObject({ kind: "client", label: "Atlas", href: "#/admin/clients/Atlas" });
    expect(searchAdmin("priya", { clients, people, at })[0]).toMatchObject({ kind: "person", href: "#/admin/people/people" });
    expect(searchAdmin("model", { clients, people, at })[0]).toMatchObject({ kind: "setting", label: "Model", where: "Team defaults › AI", href: "#/admin/defaults/ai" });
    expect(searchAdmin("nothing like this", { clients, people, at })).toEqual([]);
  });
  it("sends a client's setting to the open client's tab", () => {
    const hit = searchAdmin("allow ai", { clients, people, at: { part: "clients", tab: "overview", client: "Harbor" } }).find((h) => h.kind === "setting");
    expect(hit).toMatchObject({ label: "Allow AI", where: "Harbor › AI", href: "#/admin/clients/Harbor/ai" });
    expect(searchAdmin("allow ai", { clients, people, at: null }).find((h) => h.kind === "setting")?.href).toBe("#/admin/clients");
  });
});
