// CV-3b: Admin › Status's "Client accounts" row. Warns while the account types aren't read from Dataverse (the
// fallback decides who is a client then: active accounts, Internal, treated as clients), with Refresh, which reads
// people, leads and accounts now (the same read as the daily refresh). Counts and states only.
import type { ClientAccounts } from "../plan/client-accounts.ts";
import type { StatusSource } from "./status-rows.ts";

export function clientAccountsStatusSource(d: { accounts: () => Promise<ClientAccounts>; refreshedAt: () => Promise<string | null>; refresh: () => Promise<unknown> }): StatusSource {
  return {
    id: "client_accounts",
    title: "Client accounts",
    note: "Which Dataverse accounts are clients: Customers, Cooptimize Internal and accounts treated as clients.",
    async rows() {
      const [ca, at] = await Promise.all([d.accounts(), d.refreshedAt().catch(() => null)]);
      const n = ca.keys.length;
      return [
        {
          id: "types",
          label: "Account types from Dataverse",
          state: ca.read ? "ok" : "warn",
          detail: ca.read
            ? `Read · ${n} ${n === 1 ? "client" : "clients"}`
            : `Not read yet · ${n} ${n === 1 ? "client" : "clients"} for now, from Account Workers and Focus Time in Dataverse, Internal and accounts treated as clients; prospects don't count`,
          lastCheck: at,
          action: { id: "refresh", label: "Refresh" },
        },
      ];
    },
    async act(_row, actionId) {
      if (actionId === "refresh") await d.refresh();
    },
  };
}
