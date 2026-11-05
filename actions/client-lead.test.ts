// CV-1, ADM-1: a client's leads are the real ones (Dataverse's plus admins' overrides); being an admin isn't enough.
import { describe, expect, it } from "vitest";
import { createAdminStore } from "../store/admin-store.ts";
import { sqliteDb } from "../test/db.ts";
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
});
