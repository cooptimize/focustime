// TB-1: who may talk to the bot, decided after the Teams SDK has verified the token (server/teams/sdk.ts). In order:
// the activity is from Teams, in Cooptimize's tenant (pinned here: the SDK takes a token's tenant from the token), in a
// 1:1 chat, and from a FocusTime person who is a Cooptimizer (their Entra object id is their user id: a users row not
// deleted, not a guest, not an automation account, inside the Cooptimize domains when that Rule is set). Anything else
// gets one short line and nothing more. Pure except for the two lookups it is handed.
import { isGuestUpn } from "../../plan/person-match.ts";

/** The parts of a Teams activity the gate reads (never the text). */
export type GateActivity = {
  channelId?: string;
  conversation?: { conversationType?: string; tenantId?: string } | null;
  channelData?: { tenant?: { id?: string } | null } | null;
  from?: { aadObjectId?: string } | null;
};

export type GateUser = { id: string; upn: string | null; email: string | null; deletedAt: string | null };
export type GateDeps = {
  /** Cooptimize's tenant id (the app's Entra tenant). */
  tenantId: string;
  /** The users row for an Entra object id, or null. */
  user: (oid: string) => Promise<GateUser | null>;
  /** cooptimizers(): guests, automation accounts and addresses outside the domains Rule are not. */
  isCooptimizer: (oid: string) => Promise<boolean>;
};

export type Refusal = "not_teams" | "tenant" | "not_personal" | "no_person" | "not_signed_in" | "not_cooptimizer" | "deleted";
export type GateResult = { ok: true; userId: string } | { ok: false; why: Refusal };

const low = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
export const tenantOf = (a: GateActivity) => low(a.conversation?.tenantId) || low(a.channelData?.tenant?.id);

/** The checks that need no lookup: Teams, the tenant, a 1:1 chat. */
export function whereFrom(a: GateActivity, tenantId: string): { ok: true } | { ok: false; why: "not_teams" | "tenant" | "not_personal" } {
  if (a.channelId !== "msteams") return { ok: false, why: "not_teams" };
  if (!tenantId || tenantOf(a) !== low(tenantId)) return { ok: false, why: "tenant" };
  if (a.conversation?.conversationType !== "personal") return { ok: false, why: "not_personal" };
  return { ok: true };
}

export async function gate(a: GateActivity, d: GateDeps): Promise<GateResult> {
  const w = whereFrom(a, d.tenantId);
  if (!w.ok) return w;
  const oid = low(a.from?.aadObjectId);
  if (!/^[0-9a-f-]{36}$/.test(oid)) return { ok: false, why: "no_person" };
  const u = await d.user(oid);
  if (!u) return { ok: false, why: "not_signed_in" };
  if (u.deletedAt) return { ok: false, why: "deleted" };
  if (isGuestUpn(u.upn) || isGuestUpn(u.email)) return { ok: false, why: "not_cooptimizer" };
  if (!(await d.isCooptimizer(oid))) return { ok: false, why: "not_cooptimizer" };
  return { ok: true, userId: u.id };
}

export const REFUSED = "FocusTime is for Cooptimize accounts.";
export const ONLY_PERSONAL = "FocusTime only works in 1:1 chats. Message me directly.";
export const signInFirst = (url: string) => `Sign in to FocusTime once at ${url}, then message me again.`;
export const DELETED = "Your FocusTime account was deleted. Ask a FocusTime admin if that's a mistake.";

/** The one line a refusal gets, or null for nothing at all (not from Teams: there is nobody to answer). */
export function refusalText(why: Refusal, publicUrl: string): string | null {
  switch (why) {
    case "not_teams":
      return null;
    case "not_personal":
      return ONLY_PERSONAL;
    case "not_signed_in":
      return signInFirst(publicUrl);
    case "deleted":
      return DELETED;
    case "tenant":
    case "no_person":
    case "not_cooptimizer":
      return REFUSED;
  }
}
