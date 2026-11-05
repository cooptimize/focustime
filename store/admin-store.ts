// ADM-1: the team's settings, the admin audit, people's levels and client leads, and who was last seen as an admin.
// App tables (store/migrations/20261105T0200_admin.ts), read and written on the database itself: nothing here is one
// person's plan, and nothing here reads a person's plan tables. Every write runs in a transaction; a setting's change
// and its audit row are one transaction. Values are JSON; secrets are never org settings (config/org.ts has no key for one).
import type { Conn, Row } from "./sql/conn.ts";
import type { Level, OrgRow } from "../config/org.ts";
import type { AdminVia } from "../actions/admin.ts";

/** Who made a change: a person (their Entra object id and name), or FocusTime itself (id null). */
export type Actor = { id: string | null; name: string };
export const FOCUSTIME: Actor = { id: null, name: "FocusTime" };

export type AuditEntry = { id: number; at: string; actorId: string | null; actorName: string; area: string; target: string; setting: string; oldValue: string | null; newValue: string | null; note: string | null };
export type AuditInput = Omit<AuditEntry, "id" | "at" | "actorId" | "actorName">;

export type DirectoryPerson = { personId: string; systemUserId: string; name: string; email: string | null; level: Level | null; positionName: string | null; refreshedAt: string };
export type LeadSource = "owner" | "lead_worker";
export type DirectoryLead = { clientKey: string; personId: string; source: LeadSource };
export type PersonClient = { personId: string; clientKey: string };
export type OverrideKind = "level" | "lead_add" | "lead_remove";
export type PersonOverride = { personId: string; kind: OverrideKind; clientKey: string; value: string | null; byId: string | null; byName: string; at: string };
export type SeenAdmin = { personId: string; isAdmin: boolean; via: AdminVia | null; checkedAt: string };

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === "string" ? Temporal.Instant.from(v).toString() : "");
const toAudit = (r: Row): AuditEntry => ({
  id: Number(r.id),
  at: iso(r.at),
  actorId: (r.actor_id as string | null) ?? null,
  actorName: r.actor_name as string,
  area: r.area as string,
  target: r.target as string,
  setting: r.setting as string,
  oldValue: (r.old_value as string | null) ?? null,
  newValue: (r.new_value as string | null) ?? null,
  note: (r.note as string | null) ?? null,
});

/** The most audit rows kept in view (Admin › Audit shows the last 200). */
export const AUDIT_SHOWN = 200;

export function createAdminStore(db: Conn, now: () => Temporal.Instant) {
  const stamp = () => now().toString();
  const audit = (actor: Actor, e: AuditInput) =>
    db.run("INSERT INTO admin_audit (at, actor_id, actor_name, area, target, setting, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [stamp(), actor.id, actor.name.slice(0, 200), e.area, e.target.slice(0, 200), e.setting, e.oldValue, e.newValue, e.note]);

  async function orgRow(scope: string, key: string): Promise<OrgRow | null> {
    const r = (await db.get("SELECT scope, skey, value, updated_at, updated_by FROM org_settings WHERE scope = ? AND skey = ?", [scope, key])) as Row | undefined;
    return r ? { scope: r.scope as string, key: r.skey as string, value: r.value as string, updatedAt: iso(r.updated_at), updatedBy: (r.updated_by as string | null) ?? null } : null;
  }

  return {
    // ---- org settings ----
    async orgRows(): Promise<OrgRow[]> {
      return ((await db.all("SELECT scope, skey, value, updated_at, updated_by FROM org_settings ORDER BY scope, skey")) as Row[]).map((r) => ({ scope: r.scope as string, key: r.skey as string, value: r.value as string, updatedAt: iso(r.updated_at), updatedBy: (r.updated_by as string | null) ?? null }));
    },
    orgRow,
    /**
     * Sets one org value (JSON) and audits it in one transaction: who, the area, the target (the client, level or
     * "everyone"), old and new value. `value` undefined clears it (back to the built-in). Returns the old JSON.
     */
    async setOrg(o: { scope: string; key: string; value: unknown; actor: Actor; area: string; target: string; note?: string | null }): Promise<{ old: string | null; next: string | null }> {
      let old: string | null = null;
      const next = o.value === undefined ? null : JSON.stringify(o.value);
      await db.tx(async () => {
        old = (await orgRow(o.scope, o.key))?.value ?? null;
        if (next === null) await db.run("DELETE FROM org_settings WHERE scope = ? AND skey = ?", [o.scope, o.key]);
        else if (old !== null) await db.run("UPDATE org_settings SET value = ?, updated_at = ?, updated_by = ? WHERE scope = ? AND skey = ?", [next, stamp(), o.actor.id, o.scope, o.key]);
        else await db.run("INSERT INTO org_settings (scope, skey, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)", [o.scope, o.key, next, stamp(), o.actor.id]);
        if (old !== next) await audit(o.actor, { area: o.area, target: o.target, setting: `${o.scope}/${o.key}`, oldValue: old, newValue: next, note: o.note ?? null });
      });
      return { old, next };
    },

    // ---- the audit ----
    audit: async (actor: Actor, e: AuditInput) => void (await db.tx(() => audit(actor, e))),
    /** The newest first, at most 200; `area` and `text` filter (the text matches the setting, target, who or note). */
    async auditList(f: { area?: string | null; text?: string | null } = {}): Promise<AuditEntry[]> {
      const where: string[] = [];
      const params: string[] = [];
      if (f.area) (where.push("area = ?"), params.push(f.area));
      if (f.text?.trim()) {
        const q = `%${f.text.trim().toLowerCase().replace(/[%_[]/g, "")}%`;
        where.push("(LOWER(setting) LIKE ? OR LOWER(target) LIKE ? OR LOWER(actor_name) LIKE ? OR LOWER(COALESCE(note, '')) LIKE ?)");
        params.push(q, q, q, q);
      }
      const rows = (await db.all(`SELECT id, at, actor_id, actor_name, area, target, setting, old_value, new_value, note FROM admin_audit${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${AUDIT_SHOWN}`, params)) as Row[];
      return rows.map(toAudit);
    },
    async auditEntry(id: number): Promise<AuditEntry | null> {
      const r = (await db.get("SELECT id, at, actor_id, actor_name, area, target, setting, old_value, new_value, note FROM admin_audit WHERE id = ?", [id])) as Row | undefined;
      return r ? toAudit(r) : null;
    },

    // ---- admins seen ----
    async seen(personId: string, isAdmin: boolean, via: AdminVia | null): Promise<void> {
      const id = personId.toLowerCase();
      await db.tx(async () => {
        if (await db.get("SELECT 1 AS x FROM admin_seen WHERE person_id = ?", [id])) await db.run("UPDATE admin_seen SET is_admin = ?, via = ?, checked_at = ? WHERE person_id = ?", [isAdmin ? 1 : 0, via, stamp(), id]);
        else await db.run("INSERT INTO admin_seen (person_id, is_admin, via, checked_at) VALUES (?, ?, ?, ?)", [id, isAdmin ? 1 : 0, via, stamp()]);
      });
    },
    async seenAdmins(): Promise<SeenAdmin[]> {
      return ((await db.all("SELECT person_id, is_admin, via, checked_at FROM admin_seen WHERE is_admin = 1 ORDER BY person_id")) as Row[]).map((r) => ({ personId: r.person_id as string, isAdmin: !!r.is_admin, via: (r.via as AdminVia | null) ?? null, checkedAt: iso(r.checked_at) }));
    },

    // ---- people and client leads (Dataverse, daily) ----
    /** Replaces the whole directory with a fresh read (a read that failed never gets here, so the old one stays). */
    async replaceDirectory(people: readonly Omit<DirectoryPerson, "refreshedAt">[], leads: readonly DirectoryLead[], clients: readonly PersonClient[]): Promise<void> {
      const at = stamp();
      await db.tx(async () => {
        await db.run("DELETE FROM people_directory");
        await db.run("DELETE FROM client_leads");
        await db.run("DELETE FROM people_clients");
        for (const p of people) await db.run("INSERT INTO people_directory (person_id, systemuser_id, name, email, level, position_name, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [p.personId.toLowerCase(), p.systemUserId, p.name.slice(0, 200), p.email, p.level, p.positionName, at]);
        const seenLead = new Set<string>();
        for (const l of leads) {
          const k = `${l.clientKey}\u0000${l.personId.toLowerCase()}\u0000${l.source}`;
          if (seenLead.has(k)) continue;
          seenLead.add(k);
          await db.run("INSERT INTO client_leads (client_key, person_id, source, refreshed_at) VALUES (?, ?, ?, ?)", [l.clientKey.slice(0, 100), l.personId.toLowerCase(), l.source, at]);
        }
        const seenClient = new Set<string>();
        for (const c of clients) {
          const k = `${c.personId.toLowerCase()}\u0000${c.clientKey}`;
          if (seenClient.has(k)) continue;
          seenClient.add(k);
          await db.run("INSERT INTO people_clients (person_id, client_key, refreshed_at) VALUES (?, ?, ?)", [c.personId.toLowerCase(), c.clientKey.slice(0, 100), at]);
        }
      });
    },
    async directory(): Promise<DirectoryPerson[]> {
      return ((await db.all("SELECT person_id, systemuser_id, name, email, level, position_name, refreshed_at FROM people_directory ORDER BY name")) as Row[]).map((r) => ({ personId: r.person_id as string, systemUserId: r.systemuser_id as string, name: r.name as string, email: (r.email as string | null) ?? null, level: (r.level as Level | null) ?? null, positionName: (r.position_name as string | null) ?? null, refreshedAt: iso(r.refreshed_at) }));
    },
    async directoryRefreshedAt(): Promise<string | null> {
      const r = (await db.get("SELECT MAX(refreshed_at) AS at FROM people_directory")) as Row | undefined;
      return r?.at ? iso(r.at) : null;
    },
    async leads(): Promise<DirectoryLead[]> {
      return ((await db.all("SELECT client_key, person_id, source FROM client_leads ORDER BY client_key, person_id")) as Row[]).map((r) => ({ clientKey: r.client_key as string, personId: r.person_id as string, source: r.source as LeadSource }));
    },
    async peopleClients(): Promise<PersonClient[]> {
      return ((await db.all("SELECT person_id, client_key FROM people_clients ORDER BY person_id, client_key")) as Row[]).map((r) => ({ personId: r.person_id as string, clientKey: r.client_key as string }));
    },

    // ---- admin overrides ----
    async overrides(): Promise<PersonOverride[]> {
      return ((await db.all("SELECT person_id, kind, client_key, value, by_id, by_name, at FROM people_overrides ORDER BY person_id, kind, client_key")) as Row[]).map((r) => ({ personId: r.person_id as string, kind: r.kind as OverrideKind, clientKey: (r.client_key as string) ?? "", value: (r.value as string | null) ?? null, byId: (r.by_id as string | null) ?? null, byName: r.by_name as string, at: iso(r.at) }));
    },
    /** Sets or clears (value undefined) one override, with its audit row, in one transaction. */
    async setOverride(o: { personId: string; personName: string; kind: OverrideKind; clientKey?: string; value?: string | null; clear?: boolean; actor: Actor }): Promise<void> {
      const id = o.personId.toLowerCase();
      const client = o.clientKey ?? "";
      await db.tx(async () => {
        const cur = (await db.get("SELECT value FROM people_overrides WHERE person_id = ? AND kind = ? AND client_key = ?", [id, o.kind, client])) as Row | undefined;
        await db.run("DELETE FROM people_overrides WHERE person_id = ? AND kind = ? AND client_key = ?", [id, o.kind, client]);
        // Adding a lead clears a removal of the same lead, and the other way round.
        if (o.kind !== "level") await db.run("DELETE FROM people_overrides WHERE person_id = ? AND kind = ? AND client_key = ?", [id, o.kind === "lead_add" ? "lead_remove" : "lead_add", client]);
        if (!o.clear) await db.run("INSERT INTO people_overrides (person_id, kind, client_key, value, by_id, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, o.kind, client, o.value ?? null, o.actor.id, o.actor.name.slice(0, 200), stamp()]);
        const setting = o.kind === "level" ? "level" : "client_lead";
        const oldValue = o.kind === "level" ? ((cur?.value as string | null) ?? null) : cur ? o.kind : null;
        const newValue = o.clear ? null : o.kind === "level" ? (o.value ?? null) : o.kind;
        await audit(o.actor, { area: "people", target: client ? `${o.personName} · ${client}` : o.personName, setting, oldValue: oldValue === null ? null : JSON.stringify(oldValue), newValue: newValue === null ? null : JSON.stringify(newValue), note: o.clear ? "override removed" : "override" });
      });
    },
    /** A person's overrides and seen row go when they are removed (their directory row comes back with the next read only if Dataverse still has them). */
    async forgetPerson(personId: string): Promise<void> {
      const id = personId.toLowerCase();
      await db.tx(async () => {
        await db.run("DELETE FROM people_overrides WHERE person_id = ?", [id]);
        await db.run("DELETE FROM admin_seen WHERE person_id = ?", [id]);
      });
    },
  };
}

export type AdminStore = ReturnType<typeof createAdminStore>;
