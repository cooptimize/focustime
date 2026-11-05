// CV-1, ADM-1: who leads a client (sees its unclaimed commitments in Needs you). The real leads: Dataverse's (the
// account's owner and Lead Consultants on the account) with an admin's overrides, from the org runtime (actions/org.ts).
// No org runtime (a test or a context without the admin store): nobody is a lead. Admins are not leads by being admins.
import type { OrgRuntime } from "./org.ts";

export async function isClientLead(org: Pick<OrgRuntime, "isClientLead"> | null | undefined, userId: string | null, clientKey: string): Promise<boolean> {
  if (!org || !userId) return false;
  return org.isClientLead(userId, clientKey).catch(() => false);
}
