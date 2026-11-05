// AH-2: what the DevOps scope needs from the org runtime, built in one place for the hosted app and the demo: the
// client's scope from Admin › Clients (null: automatic) and who is a Cooptimizer, by the email DevOps shows as an
// assignee (cooptimizers(): the directory's and signed-in people's addresses; no guests, no automation accounts).
// Before the people are read, the Cooptimize email domains Rule decides.
import { inDomains } from "../plan/person-match.ts";
import type { ScopeDeps } from "../sources/devops/source.ts";
import type { OrgRuntime } from "./org.ts";

export function scopeDepsOf(org: Pick<OrgRuntime, "rules" | "levels">): (clientKey: string) => Promise<ScopeDeps | null> {
  return async (clientKey) => {
    const [rules, lv] = await Promise.all([org.rules(), org.levels().catch(() => null)]);
    const rule = rules.clients[clientKey]?.devopsScope ?? null;
    const emails = new Set<string>();
    for (const e of lv?.people.cooptimizers ?? []) for (const x of [e.dir?.email, e.signedIn?.email, e.signedIn?.upn]) if (x) emails.add(x.toLowerCase());
    const domains = rules.organization.inviteDomains;
    const isCooptimizer = emails.size ? (e: string) => emails.has(e.toLowerCase()) : (e: string) => domains.length > 0 && inDomains(e, domains);
    return { rule, isCooptimizer };
  };
}
