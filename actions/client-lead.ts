// CV-1: who leads a client (sees its unclaimed commitments in Needs you). ADM-1 (admin console) owns people and client
// leads and will expose isClientLead(user, client); until it merges, a FocusTime admin counts as every client's lead.
// Switching is this one function.
import { isAdmin } from "./admin.ts";

export function isClientLead(userId: string | null, _clientKey: string, admins: readonly string[] | undefined): boolean {
  return isAdmin(userId, admins);
}
