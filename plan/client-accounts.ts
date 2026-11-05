// ADM-2: which accounts are FocusTime clients. Pure: the last Dataverse read of the active accounts and the admins'
// two per-account overrides in, one answer out, used by every screen and job that lists or works out clients (Admin ›
// Clients and AI, Settings › Clients, the week's clients and pickers, client leads). The rule (D585):
//   a client  = an active account whose relationship type is Customer, plus Cooptimize Internal always,
//               plus any account an admin marked "Treat as a client";
//   never     = an account an admin marked "Hide from FocusTime" (Internal can't be hidden).
// Nothing is deleted: a non-client's settings stay stored and show under All accounts ("Has settings, not a client").
// Before the first read with this build (or with no Dataverse, as in the demo), every key counts as a client, so
// nothing disappears while the accounts aren't known yet; Status says so.

export type ClientWhy = "customer" | "internal" | "treated" | "hidden" | "not_customer" | "not_in_dataverse" | "not_read";
export type AccountIn = { clientKey: string; name: string; type: string | null; workers: number; focus: number };
export type AccountOverrides = Readonly<Record<string, { treatAsClient?: boolean; hidden?: boolean } | undefined>>;

export type ClientAccountRow = {
  clientKey: string;
  /** The Dataverse account names under this key (two accounts may share a reporting nickname). */
  names: string[];
  /** The relationship types under this key, as words ("customer", "prospect", ...). */
  types: string[];
  isClient: boolean;
  why: ClientWhy;
  workers: number;
  focus: number;
  treatAsClient: boolean;
  hidden: boolean;
};

export type ClientAccounts = {
  /** False before the first account read (everything counts as a client then). */
  read: boolean;
  isClient(clientKey: string | null | undefined): boolean;
  /** Every client key, sorted. */
  keys: string[];
  /** One row per known key (the accounts read, plus `extra` keys such as ones with settings), sorted. */
  rows: ClientAccountRow[];
  row(clientKey: string): ClientAccountRow | null;
};

const lower = (s: string) => s.toLowerCase();

export function clientAccounts(i: { accounts: readonly AccountIn[]; overrides: AccountOverrides; internal: string; extra?: readonly string[] }): ClientAccounts {
  const read = i.accounts.length > 0;
  const byKey = new Map<string, AccountIn[]>();
  for (const a of i.accounts) {
    const l = byKey.get(a.clientKey);
    if (l) l.push(a);
    else byKey.set(a.clientKey, [a]);
  }
  const overrideOf = (k: string) => i.overrides[k] ?? Object.entries(i.overrides).find(([x]) => lower(x) === lower(k))?.[1];
  const internalKey = lower(i.internal);
  const decide = (k: string): ClientAccountRow => {
    const accts = byKey.get(k) ?? [];
    const o = overrideOf(k);
    const isInternal = lower(k) === internalKey;
    const treated = !!o?.treatAsClient;
    const hidden = !!o?.hidden && !isInternal;
    const customer = accts.some((a) => a.type === "customer");
    const why: ClientWhy = isInternal ? "internal" : hidden ? "hidden" : customer ? "customer" : treated ? "treated" : !read ? "not_read" : accts.length ? "not_customer" : "not_in_dataverse";
    return {
      clientKey: k,
      names: [...new Set(accts.map((a) => a.name))].sort(),
      types: [...new Set(accts.map((a) => a.type).filter((t): t is string => !!t))].sort(),
      isClient: why === "internal" || why === "customer" || why === "treated" || why === "not_read",
      why,
      workers: accts.reduce((n, a) => n + a.workers, 0),
      focus: accts.reduce((n, a) => n + a.focus, 0),
      treatAsClient: treated,
      hidden,
    };
  };
  const allKeys = [...new Set([...byKey.keys(), ...Object.keys(i.overrides), ...(i.extra ?? []), i.internal])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const rows = allKeys.map(decide);
  const index = new Map(rows.map((r) => [lower(r.clientKey), r]));
  const isClient = (k: string | null | undefined): boolean => {
    if (!k) return false;
    const r = index.get(lower(k)) ?? decide(k);
    return r.isClient;
  };
  return {
    read,
    isClient,
    keys: rows.filter((r) => r.isClient).map((r) => r.clientKey),
    rows,
    row: (k) => index.get(lower(k)) ?? null,
  };
}

/** Plain words for why an account is or isn't a client (Admin › Clients, All accounts). */
export const CLIENT_WHY_TEXT: Record<ClientWhy, string> = {
  customer: "Customer in Dataverse",
  internal: "Cooptimize Internal",
  treated: "Treated as a client by an admin",
  hidden: "Hidden from FocusTime by an admin",
  not_customer: "Not a customer in Dataverse",
  not_in_dataverse: "Not an active Dataverse account",
  not_read: "Accounts not read from Dataverse yet",
};
