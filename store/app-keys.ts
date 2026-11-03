// A4: app-wide keys kept in the database, wrapped (host/azure/datakey.ts): one row per name in app_keys (SQL Server
// migration 28), written once. An app table: no person's data.
import type { Conn } from "./sql/conn.ts";

export function appKeyStore(conn: Conn, name: string, now: () => Temporal.Instant) {
  return {
    load: async (): Promise<string | null> => ((await conn.get("SELECT value FROM app_keys WHERE name = ?", [name]))?.value as string | undefined) ?? null,
    async keep(wrapped: string): Promise<string> {
      await conn.run("INSERT INTO app_keys (name, value, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING", [name, wrapped, now().toString()]);
      const kept = await this.load();
      if (!kept) throw new Error("The app key wasn't kept");
      return kept;
    },
  };
}
