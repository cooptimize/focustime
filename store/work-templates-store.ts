// TP-1: the team's work templates (app tables, no person's plan in them). One row holds the whole set as JSON with a
// version: it is seeded once from plan/work-templates.ts the first time anyone reads it, and after that only an admin's
// save changes it. A save names the version it was made from and is refused when someone saved since, so two admins
// editing at once never overwrite each other; the change and its audit rows (who, when, what, old and new, and the one
// line of why) are one transaction. Uses are counts only: a tag, when, and whether all four lines were filled.
import type { Actor } from "./admin-store.ts";
import type { Conn, Row } from "./sql/conn.ts";
import { SEED, type TemplateChange, type WorkTemplates } from "../plan/work-templates.ts";

export type TemplatesRow = { doc: WorkTemplates; version: number; updatedAt: string; updatedBy: string | null };
export type TemplateUses = Record<string, { created: number; complete: number }>;
export type TemplatesStore = ReturnType<typeof workTemplatesStoreOn>;

/** The audit's area for every template change. */
export const TEMPLATES_AREA = "work_templates";

const rowOf = (r: Row): TemplatesRow => ({ doc: JSON.parse(String(r.doc)) as WorkTemplates, version: Number(r.version), updatedAt: String(r.updated_at), updatedBy: (r.updated_by as string | null) ?? null });

export function workTemplatesStoreOn(db: Conn, now: () => string) {
  async function read(): Promise<TemplatesRow> {
    const r = await db.get("SELECT doc, version, updated_at, updated_by FROM work_templates WHERE id = 1");
    if (r) return rowOf(r);
    // Seeded once: an insert that does nothing when another server or request seeded it first.
    await db.tx(() => db.run("INSERT INTO work_templates (id, doc, version, updated_at, updated_by) VALUES (1, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING", [JSON.stringify(SEED), now(), null]));
    return rowOf((await db.get("SELECT doc, version, updated_at, updated_by FROM work_templates WHERE id = 1"))!);
  }
  return {
    read,
    /**
     * An admin's save, made from `base`. "conflict" when someone saved since (nothing is written). Each change is one
     * audit row with the save's note; a save that changes nothing writes nothing.
     */
    async save(next: WorkTemplates, base: number, actor: Actor, why: string, changes: readonly TemplateChange[]): Promise<TemplatesRow | "conflict"> {
      await read();
      return db.tx(async () => {
        const at = now();
        const cur = rowOf((await db.get("SELECT doc, version, updated_at, updated_by FROM work_templates WHERE id = 1"))!);
        if (cur.version !== base) return "conflict" as const;
        if (!changes.length) return cur;
        const r = await db.run("UPDATE work_templates SET doc = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ?", [JSON.stringify(next), base + 1, at, actor.name.slice(0, 200), base]);
        if (r.changes !== 1) return "conflict" as const;
        for (const c of changes)
          await db.run("INSERT INTO admin_audit (at, actor_id, actor_name, area, target, setting, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [at, actor.id, actor.name.slice(0, 200), TEMPLATES_AREA, c.target.slice(0, 200), c.setting.slice(0, 120), c.oldValue, c.newValue, why]);
        return { doc: next, version: base + 1, updatedAt: at, updatedBy: actor.name };
      });
    },
    /** An item was created with a request type (counted, nothing else kept). */
    async used(tag: string, complete: boolean): Promise<void> {
      await db.tx(() => db.run("INSERT INTO work_template_uses (tag, created_at, complete) VALUES (?, ?, ?)", [tag.slice(0, 60), now(), complete]));
    },
    /** Per tag: items created with it, and how many of those had all four lines. */
    async uses(): Promise<TemplateUses> {
      const rows = await db.all("SELECT tag, COUNT(*) AS n, SUM(CASE WHEN complete = 1 THEN 1 ELSE 0 END) AS c FROM work_template_uses GROUP BY tag");
      return Object.fromEntries(rows.map((r) => [String(r.tag), { created: Number(r.n), complete: Number(r.c ?? 0) }]));
    },
  };
}
