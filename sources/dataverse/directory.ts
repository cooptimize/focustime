// ADM-1: people's levels and each client's leads, from Dataverse (read only, with the shared reader, once a day).
//   A person's level:  systemuser.positionid → position.name ("Consultant", "Senior Consultant", "Lead Consultant").
//   A client's leads:  the account's owner (account.ownerid; the primary lead), plus every Account Worker on the
//                      account (coop_accountworker: account and user) whose position is Lead Consultant.
//   Who works where:   Account Workers and current Focus Time (ended at most 14 days ago), by client key.
// Account Worker has no role column (checked Nov 4), so "lead on a client" comes from the level. Only names, email
// addresses, Entra object ids and client keys come out of here; nothing else of a client's is read.
import { levelFromPosition, type Level } from "../../config/org.ts";
import { clientKeyOf } from "./normalize.ts";

export type DvPosition = { positionid?: unknown; name?: unknown };
export type DvUser = { systemuserid?: unknown; fullname?: unknown; internalemailaddress?: unknown; azureactivedirectoryobjectid?: unknown; _positionid_value?: unknown };
export type DvAccount = { accountid?: unknown; name?: unknown; coop_reportingnickname?: unknown; _ownerid_value?: unknown };
export type DvWorker = { _coop_user_value?: unknown; _coop_account_value?: unknown };
export type DvFocus = { _coop_systemuser_value?: unknown; _coop_account_value?: unknown; coop_AccountWorker?: DvWorker | null };

export type DirectoryRead = {
  people: { personId: string; systemUserId: string; name: string; email: string | null; level: Level | null; positionName: string | null }[];
  leads: { clientKey: string; personId: string; source: "owner" | "lead_worker" }[];
  clients: { personId: string; clientKey: string }[];
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && GUID.test(v) ? v.toLowerCase() : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function buildDirectory(r: { positions: DvPosition[]; users: DvUser[]; accounts: DvAccount[]; workers: DvWorker[]; focus: DvFocus[] }): DirectoryRead {
  const positionName = new Map(r.positions.map((p) => [id(p.positionid), str(p.name)] as const).filter((x): x is [string, string] => !!x[0] && !!x[1]));
  // Only people FocusTime can sign in: an Entra object id.
  const bySystemUser = new Map<string, DirectoryRead["people"][number]>();
  for (const u of r.users) {
    const sid = id(u.systemuserid);
    const aad = id(u.azureactivedirectoryobjectid);
    if (!sid || !aad) continue;
    const pos = id(u._positionid_value);
    const pname = pos ? (positionName.get(pos) ?? null) : null;
    const email = str(u.internalemailaddress);
    bySystemUser.set(sid, { personId: aad, systemUserId: sid, name: str(u.fullname) ?? email ?? aad, email: email ? email.toLowerCase() : null, level: levelFromPosition(pname), positionName: pname });
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
  for (const w of r.workers) {
    const key = clientOf.get(id(w._coop_account_value) ?? "");
    const p = bySystemUser.get(id(w._coop_user_value) ?? "");
    if (!key || !p) continue;
    clients.push({ personId: p.personId, clientKey: key });
    if (p.level === "lead") leads.push({ clientKey: key, personId: p.personId, source: "lead_worker" });
  }
  for (const f of r.focus) {
    const p = bySystemUser.get(id(f._coop_systemuser_value) ?? id(f.coop_AccountWorker?._coop_user_value) ?? "");
    const key = clientOf.get(id(f._coop_account_value) ?? id(f.coop_AccountWorker?._coop_account_value) ?? "");
    if (p && key) clients.push({ personId: p.personId, clientKey: key });
  }
  const uniq = <T>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];
  return {
    people: [...bySystemUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
    leads: uniq(leads, (l) => `${l.clientKey}|${l.personId}|${l.source}`),
    clients: uniq(clients, (c) => `${c.personId}|${c.clientKey}`),
  };
}
