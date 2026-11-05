// CV-1, ADM-1: a client's leads are the real ones (Dataverse's plus admins' overrides); being an admin isn't enough.
import { describe, expect, it } from "vitest";
import { createAdminStore } from "../store/admin-store.ts";
import { sqliteDb } from "../test/db.ts";
import { anAccount, aDirectoryPerson } from "../test/builders/index.ts";
import { isClientLead } from "./client-lead.ts";
import { createOrgRuntime } from "./org.ts";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000b2";
const ADDED = "00000000-0000-4000-8000-0000000000c3";

describe("isClientLead", () => {
  it("reads the client's leads and overrides; an admin who isn't one is not a lead", async () => {
    const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from("2026-11-05T15:00:00Z"));
    await store.replaceDirectory([], [{ clientKey: "contoso", personId: OWNER, source: "owner" }], []);
    await store.setOverride({ personId: ADDED, personName: "Added Lead", kind: "lead_add", clientKey: "contoso", actor: { id: ADMIN, name: "An admin" } });
    const org = createOrgRuntime({ store, bootstrap: { model: "m", appCapUsd: 100, inviteDomains: [], feedback: null }, holdMs: 0 });
    expect(await isClientLead(org, OWNER, "contoso")).toBe(true);
    expect(await isClientLead(org, ADDED.toUpperCase(), "contoso")).toBe(true);
    expect(await isClientLead(org, ADMIN, "contoso")).toBe(false);
    expect(await isClientLead(org, OWNER, "fabrikam")).toBe(false);
    expect(await isClientLead(null, OWNER, "contoso")).toBe(false);
    expect(await isClientLead(org, null, "contoso")).toBe(false);
  });
  it("ADM-2: escalation recipients come only from client accounts: owning a prospect, or a hidden client, leads nothing", async () => {
    const store = createAdminStore(sqliteDb().conn, () => Temporal.Instant.from("2026-11-06T15:00:00Z"));
    const owner = aDirectoryPerson({ personId: OWNER, email: "owner@contoso.example", level: "lead", positionName: "Lead Consultant" });
    await store.replaceDirectory(
      [owner],
      ["Adatum", "Prospect Co", "Hidden Co"].map((clientKey) => ({ clientKey, personId: OWNER, source: "owner" as const })),
      [],
      [anAccount({ clientKey: "Adatum" }), anAccount({ clientKey: "Prospect Co", type: "prospect" }), anAccount({ clientKey: "Hidden Co" })],
    );
    await store.setOrg({ scope: "client:Hidden Co", key: "hidden", value: true, actor: { id: ADMIN, name: "An admin" }, area: "clients", target: "Hidden Co" });
    // A lead added on a non-client stays stored, unused.
    await store.setOverride({ personId: ADDED, personName: "Added Lead", kind: "lead_add", clientKey: "Prospect Co", actor: { id: ADMIN, name: "An admin" } });
    const org = createOrgRuntime({ store, bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["contoso.example"], feedback: null }, holdMs: 0 });
    expect(await isClientLead(org, OWNER, "Adatum")).toBe(true);
    expect(await isClientLead(org, OWNER, "Prospect Co")).toBe(false);
    expect(await isClientLead(org, OWNER, "Hidden Co")).toBe(false);
    expect(await isClientLead(org, ADDED, "Prospect Co")).toBe(false);
    expect((await store.overrides()).some((o) => o.personId === ADDED && o.clientKey === "Prospect Co")).toBe(true);
  });
});
