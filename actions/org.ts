// ADM-1: the team's settings and people, for everyone. One runtime per FocusTime (and one per demo, on the demo's own
// store): the org rules resolved over the app config's bootstrap values, people's levels and client leads with their
// overrides, and each client's team color, suggested and stored the first time a client has none. Reads are held for
// 30 seconds; an admin's change drops them at once (on this replica; the others within 30 seconds).
//
// For other steps (CV-1 and later): levelOf(user), clientLeads(client) and isClientLead(user, client). They are
// guidance (emphasis, defaults), never permissions to see or do someone else's work.
// ADM-2: clientAccounts(), the one answer to "which accounts are clients" (plan/client-accounts.ts), held like the rules.
import { applyOrg } from "../config/org-apply.ts";
import { clientScope, resolveRules, suggestColor, teamColors, type OrgBootstrap, type OrgRules } from "../config/org.ts";
import type { AppConfig } from "../config/schema.ts";
import { levels, type ClientLead, type Levels, type PersonLevel } from "../plan/levels.ts";
import { FOCUSTIME, type AdminStore } from "../store/admin-store.ts";
import { clientAccounts, type ClientAccounts } from "../plan/client-accounts.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { SignedInPerson } from "../plan/person-match.ts";

export type OrgRuntime = {
  store: AdminStore;
  bootstrap: OrgBootstrap;
  rules(): Promise<OrgRules>;
  levels(): Promise<Levels>;
  /** ADM-2: which accounts are clients (the customer rule and the admins' overrides). */
  clientAccounts(): Promise<ClientAccounts>;
  levelOf(userId: string | null): Promise<PersonLevel>;
  clientLeads(clientKey: string): Promise<ClientLead[]>;
  isClientLead(userId: string | null, clientKey: string): Promise<boolean>;
  /** A person's settings with the team's applied (Rules, Defaults, Defaults by level). */
  apply(cfg: AppConfig, userId: string | null): Promise<AppConfig>;
  /** Gives each of these clients a team color when it has none (distinct, never the brand's, readable in both themes). */
  suggestColors(clientKeys: readonly string[]): Promise<void>;
  invalidate(): void;
};

export const ORG_HOLD_MS = 30_000;

export function createOrgRuntime(o: {
  store: AdminStore;
  bootstrap: OrgBootstrap;
  now?: () => number;
  holdMs?: number;
  /** ADM-2: the people who signed in (Entra id, email, UPN, the Dataverse user their sign-in matched), for the one person match. */
  signedIn?: () => Promise<SignedInPerson[]>;
}): OrgRuntime {
  const now = o.now ?? Date.now;
  const hold = o.holdMs ?? ORG_HOLD_MS;
  let rulesHeld: { at: number; value: Promise<OrgRules> } | null = null;
  let levelsHeld: { at: number; value: Promise<Levels> } | null = null;
  let accountsHeld: { at: number; value: Promise<ClientAccounts> } | null = null;
  const fresh = (h: { at: number } | null) => !!h && now() - h.at < hold;

  function rules(): Promise<OrgRules> {
    if (!fresh(rulesHeld)) {
      const value = o.store.orgRows().then((rows) => resolveRules(rows, o.bootstrap));
      rulesHeld = { at: now(), value };
      value.catch(() => (rulesHeld = null));
    }
    return rulesHeld!.value;
  }
  function people(): Promise<Levels> {
    if (!fresh(levelsHeld)) {
      const value = Promise.all([o.store.directory(), o.store.leads(), o.store.overrides(), o.store.peopleClients(), rules(), accounts(), o.signedIn ? o.signedIn().catch(() => []) : Promise.resolve([])]).then(([directory, leads, overrides, clients, r, ca, signedIn]) =>
        levels({ directory, leads, overrides, clients, signedIn, automation: r.automation, domains: r.organization.inviteDomains, isClient: (k) => ca.isClient(k) }),
      );
      levelsHeld = { at: now(), value };
      value.catch(() => (levelsHeld = null));
    }
    return levelsHeld!.value;
  }
  function accounts(): Promise<ClientAccounts> {
    if (!fresh(accountsHeld)) {
      const value = Promise.all([o.store.accounts(), rules()]).then(([accts, r]) =>
        clientAccounts({ accounts: accts, overrides: Object.fromEntries(Object.entries(r.clients).map(([k, c]) => [k, { treatAsClient: c.treatAsClient, hidden: c.hidden }])), internal: INTERNAL_CLIENT, extra: Object.keys(r.clients) }),
      );
      accountsHeld = { at: now(), value };
      value.catch(() => (accountsHeld = null));
    }
    return accountsHeld!.value;
  }
  const invalidate = () => {
    rulesHeld = null;
    levelsHeld = null;
    accountsHeld = null;
  };

  let suggesting: Promise<void> = Promise.resolve();
  async function suggestColors(keys: readonly string[]): Promise<void> {
    // One at a time, so two people's first loads don't give two clients the same color.
    const run = suggesting.then(async () => {
      const r = await rules();
      const team = teamColors(r);
      const missing = [...new Set(keys)].filter((k) => k && !team[k]).sort();
      if (!missing.length) return;
      const taken = Object.values(team);
      for (const k of missing) {
        const c = suggestColor(taken);
        taken.push(c);
        await o.store.setOrg({ scope: clientScope(k), key: "color", value: c, actor: FOCUSTIME, area: "clients", target: k, note: "suggested" });
      }
      invalidate();
    });
    suggesting = run.catch(() => undefined);
    return run;
  }

  return {
    store: o.store,
    bootstrap: o.bootstrap,
    rules,
    levels: people,
    clientAccounts: accounts,
    levelOf: async (id) => (await people()).levelOf(id),
    clientLeads: async (k) => (await people()).clientLeads(k),
    isClientLead: async (id, k) => (await people()).isClientLead(id, k),
    async apply(cfg, userId) {
      const keys = Object.keys(cfg.clientSettings);
      const r = await rules();
      if (keys.some((k) => !r.clients[k]?.color)) await suggestColors(keys).catch(() => undefined);
      const lv = (await people().catch(() => null))?.levelOf(userId) ?? { level: null, source: null };
      return applyOrg(cfg, await rules(), { level: lv.level, levelSource: lv.source });
    },
    suggestColors,
    invalidate,
  };
}
