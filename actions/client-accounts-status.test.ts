// CV-3b: Admin › Status warns while account types aren't read (the fallback is in use), and Refresh reads them.
import { describe, expect, it } from "vitest";
import { clientAccounts } from "../plan/client-accounts.ts";
import { anAccount } from "../test/builders/index.ts";
import { clientAccountsStatusSource } from "./client-accounts-status.ts";
import { createStatusRegistry } from "./status-rows.ts";

describe("Client accounts status", () => {
  it("warns with Refresh before types are read, and is OK after", async () => {
    let typed = false;
    let refreshed = 0;
    const registry = createStatusRegistry();
    registry.register(
      clientAccountsStatusSource({
        accounts: async () => clientAccounts({ accounts: typed ? [anAccount({ clientKey: "adatum" })] : [], overrides: {}, internal: "cooptimize", active: ["adatum"] }),
        refreshedAt: async () => null,
        refresh: async () => {
          refreshed++;
          typed = true;
        },
      }),
    );
    const before = (await registry.groups())[0]!.rows[0]!;
    expect(before).toMatchObject({ state: "warn", action: { id: "refresh", label: "Refresh" } });
    expect(before.detail).toMatch(/^Not read yet · 2 clients/);
    expect(await registry.act("client_accounts", "types", "refresh")).toBe(true);
    expect(refreshed).toBe(1);
    expect((await registry.groups())[0]!.rows[0]).toMatchObject({ state: "ok", detail: "Read · 2 clients" });
  });
});
