// ADM-1: people's levels and each client's leads, from Dataverse (read only, with the shared reader, once a day).
//   A person's level:  systemuser.positionid → position.name ("Consultant", "Senior Consultant", "Lead Consultant").
//   A client's leads:  the account's owner (account.ownerid; the primary lead), plus every Account Worker on the
//                      account (coop_accountworker: account and user) whose position is Lead Consultant.
//   Who works where:   Account Workers and current Focus Time (ended at most 14 days ago), by client key.
// Account Worker has no role column (checked Nov 4), so "lead on a client" comes from the level. Only names, email
// addresses, Entra object ids and client keys come out of here; nothing else of a client's is read.
// ADM-2: also every active account's relationship type (customertypecode, as a word) with its Account Worker and
// current Focus Time counts, for clientAccounts() (plan/client-accounts.ts); people without an Entra object id are kept
// (as "dv:<systemuserid>", matched to a sign-in by email, plan/people.ts), and a guest (#EXT# in domainname) is marked.
// Leads are read for every account; plan/levels.ts keeps only those on clients.
// AH-3: each Account Worker's DevOps email too (coop_devopsemail, the same field Settings › Clients shows a person for
// themselves), so a client login maps to its Cooptimizer for everyone. Matching only; never shown or logged.
import { levelFromPosition, type Level } from "../../config/org.ts";
import { clientKeyOf } from "./normalize.ts";

export type DvPosition = { positionid?: unknown; name?: unknown };
export type DvUser = { systemuserid?: unknown; fullname?: unknown; internalemailaddress?: unknown; domainname?: unknown; azureactivedirectoryobjectid?: unknown; _positionid_value?: unknown };
export type DvAccount = { accountid?: unknown; name?: unknown; coop_reportingnickname?: unknown; _ownerid_value?: unknown; customertypecode?: unknown };
export type DvWorker = { _coop_user_value?: unknown; _coop_account_value?: unknown; /** AH-3: their DevOps sign-in on that client (for matching only). */ coop_devopsemail?: unknown };
export type DvFocus = { _coop_systemuser_value?: unknown; _coop_account_value?: unknown; coop_AccountWorker?: DvWorker | null };

export type DirectoryRead = {
  /** `personId`: the Entra object id, or "dv:<systemuserid>" when Dataverse has none. */
  people: { personId: string; systemUserId: string; name: string; email: string | null; level: Level | null; positionName: string | null; guest: boolean }[];
  leads: { clientKey: string; personId: string; source: "owner" | "lead_worker" }[];
  /** `worker`: an Account Worker on it (else only Focus Time). Lead Consultants among the workers are leads (plan/levels.ts, by the mapped level). */
  clients: { personId: string; clientKey: string; worker: boolean }[];
  accounts: { accountId: string; clientKey: string; name: string; type: AccountType | null; workers: number; focus: number }[];
  /** AH-3: each Account Worker's DevOps email on that client (often a client login), for matching only: never shown or logged. */
  identities: { personId: string; clientKey: string; email: string }[];
};

/** Dataverse's relationship type (account.customertypecode, the standard option values), as a word. */
export type AccountType = "competitor" | "consultant" | "customer" | "investor" | "partner" | "influencer" | "press" | "prospect" | "reseller" | "supplier" | "vendor" | "other";
const ACCOUNT_TYPES: Record<number, AccountType> = { 1: "competitor", 2: "consultant", 3: "customer", 4: "investor", 5: "partner", 6: "influencer", 7: "press", 8: "prospect", 9: "reseller", 10: "supplier", 11: "vendor", 12: "other" };
export const accountType = (v: unknown): AccountType | null => (typeof v === "number" ? (ACCOUNT_TYPES[v] ?? null) : null);
/** A B2B guest in the Cooptimize tenant: Dataverse's domainname is the guest UPN (name_home.com#EXT#@tenant). */
export const isGuestName = (v: unknown): boolean => typeof v === "string" && v.toUpperCase().includes("#EXT#");

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && GUID.test(v) ? v.toLowerCase() : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function buildDirectory(r: { positions: DvPosition[]; users: DvUser[]; accounts: DvAccount[]; workers: DvWorker[]; focus: DvFocus[] }): DirectoryRead {
  const positionName = new Map(r.positions.map((p) => [id(p.positionid), str(p.name)] as const).filter((x): x is [string, string] => !!x[0] && !!x[1]));
  // Everyone the reader returns (enabled, licensed people with an email); one without an Entra object id is kept by
  // their systemuserid and matched to a sign-in by email.
  const bySystemUser = new Map<string, DirectoryRead["people"][number]>();
  for (const u of r.users) {
    const sid = id(u.systemuserid);
    if (!sid) continue;
    const aad = id(u.azureactivedirectoryobjectid);
    const pos = id(u._positionid_value);
    const pname = pos ? (positionName.get(pos) ?? null) : null;
    const email = str(u.internalemailaddress);
    const personId = aad ?? `dv:${sid}`;
    bySystemUser.set(sid, { personId, systemUserId: sid, name: str(u.fullname) ?? email ?? personId, email: email ? email.toLowerCase() : null, level: levelFromPosition(pname), positionName: pname, guest: isGuestName(u.domainname) });
  }
  const clientOf = new Map<string, string>();
  for (const a of r.accounts) {
    const aid = id(a.accountid);
    const key = clientKeyOf({ name: str(a.name), coop_reportingnickname: str(a.coop_reportingnickname) });
    if (aid && key) clientOf.set(aid, key);
  }
  const leads: DirectoryRead["leads"] = [];
  for (const a of r.accounts) {
    const key = clientOf.get(id(a.accountid) ?? "");
    const owner = bySystemUser.get(id(a._ownerid_value) ?? "");
    if (key && owner) leads.push({ clientKey: key, personId: owner.personId, source: "owner" });
  }
  const clients: DirectoryRead["clients"] = [];
  const identities: DirectoryRead["identities"] = [];
  for (const w of r.workers) {
    const key = clientOf.get(id(w._coop_account_value) ?? "");
    const p = bySystemUser.get(id(w._coop_user_value) ?? "");
    if (!key || !p) continue;
    clients.push({ personId: p.personId, clientKey: key, worker: true });
    const de = str(w.coop_devopsemail)?.toLowerCase();
    if (de && de.includes("@") && de.length <= 320) identities.push({ personId: p.personId, clientKey: key, email: de });
    if (p.level === "lead") leads.push({ clientKey: key, personId: p.personId, source: "lead_worker" });
  }
  for (const f of r.focus) {
    const p = bySystemUser.get(id(f._coop_systemuser_value) ?? id(f.coop_AccountWorker?._coop_user_value) ?? "");
    const key = clientOf.get(id(f._coop_account_value) ?? id(f.coop_AccountWorker?._coop_account_value) ?? "");
    if (p && key) clients.push({ personId: p.personId, clientKey: key, worker: false });
  }
  const workersOf = new Map<string, number>();
  for (const w of r.workers) {
    const a = id(w._coop_account_value);
    if (a) workersOf.set(a, (workersOf.get(a) ?? 0) + 1);
  }
  const focusOf = new Map<string, number>();
  for (const f of r.focus) {
    const a = id(f._coop_account_value) ?? id(f.coop_AccountWorker?._coop_account_value);
    if (a) focusOf.set(a, (focusOf.get(a) ?? 0) + 1);
  }
  const accounts: DirectoryRead["accounts"] = [];
  for (const a of r.accounts) {
    const aid = id(a.accountid);
    const key = aid ? clientOf.get(aid) : undefined;
    if (!aid || !key) continue;
    accounts.push({ accountId: aid, clientKey: key, name: str(a.name) ?? key, type: accountType(a.customertypecode), workers: workersOf.get(aid) ?? 0, focus: focusOf.get(aid) ?? 0 });
  }
  const uniq = <T>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];
  return {
    people: [...bySystemUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
    leads: uniq(leads, (l) => `${l.clientKey}|${l.personId}|${l.source}`),
    // A worker link wins over a Focus Time one for the same person and client.
    clients: uniq([...clients].sort((a, b) => Number(a.worker) - Number(b.worker)), (c) => `${c.personId}|${c.clientKey}`),
    accounts: accounts.sort((a, b) => a.clientKey.localeCompare(b.clientKey)),
    identities: uniq(identities, (i) => `${i.clientKey}|${i.email}`),
  };
}
