// AI-0: the app's AI spend per calendar month (UTC), across everyone, for the app-wide cap. An app table (no person in
// it), so it is read and written on the database itself, not through a person's scoped store. Only a total: who spent
// it is in each person's own ai_requests.
import type { AppSpendStore } from "../ai/service.ts";
import type { Conn } from "./sql/conn.ts";

const MONTH = /^\d{4}-\d\d$/;

export function appSpendStore(conn: Conn, now: () => Temporal.Instant): AppSpendStore {
  return {
    async get(month) {
      if (!MONTH.test(month)) throw new Error("Not a month");
      const r = await conn.get("SELECT cost_micros FROM ai_app_spend WHERE month = ?", [month]);
      return Number(r?.cost_micros ?? 0);
    },
    async add(month, micros) {
      if (!MONTH.test(month)) throw new Error("Not a month");
      const n = Math.max(0, Math.round(micros));
      if (!n) return;
      await conn.tx(() => conn.run("INSERT INTO ai_app_spend (month, cost_micros, updated_at) VALUES (?, ?, ?) ON CONFLICT (month) DO UPDATE SET cost_micros = ai_app_spend.cost_micros + excluded.cost_micros, updated_at = excluded.updated_at", [month, n, now().toString()]));
    },
  };
}
