// ADM-1: the demo's people directory: fictional levels and client leads, the same shape Dataverse gives. Northwind has
// two leads (its owner and a Lead Consultant on it), so Admin › People shows several leads on one client.
// ADM-2: the demo's accounts (three customers and Internal, plus a prospect and a vendor that aren't clients), a guest
// from a partner and an automation account, so Admin shows Customers and All accounts and the Not Cooptimizers fold.
import type { DirectoryRead } from "../dataverse/directory.ts";
import { DEMO_PERSON } from "./azure.ts";
import { DEMO_LOGINS, DEMO_ME, DEMO_PEOPLE } from "./data.ts";

/** ADM-2: the demo's guest and automation account (fictional). */
export const DEMO_GUEST = { personId: "a4d00000-0000-4000-8000-000000000021", systemUserId: "d3300000-0000-4000-8000-000000000021", name: "Rowan Vale", email: "rowan.vale@partner.example" };
export const DEMO_BOT = { personId: "a4d00000-0000-4000-8000-000000000022", systemUserId: "d3300000-0000-4000-8000-000000000022", name: "Helper bot", email: "helper.bot@example.com" };
const acct = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function demoDirectory(): DirectoryRead {
  const [jordan, priya, sam, kim] = DEMO_PEOPLE;
  const people: DirectoryRead["people"] = [
    { personId: DEMO_PERSON.oid, systemUserId: DEMO_ME, name: DEMO_PERSON.name, email: DEMO_PERSON.email, level: "lead", positionName: "Lead Consultant", guest: false },
    { personId: jordan!.aadId, systemUserId: jordan!.id, name: jordan!.name, email: jordan!.email, level: "senior", positionName: "Senior Consultant", guest: false },
    { personId: priya!.aadId, systemUserId: priya!.id, name: priya!.name, email: priya!.email, level: "lead", positionName: "Lead Consultant", guest: false },
    { personId: sam!.aadId, systemUserId: sam!.id, name: sam!.name, email: sam!.email, level: "consultant", positionName: "Consultant", guest: false },
    { personId: kim!.aadId, systemUserId: kim!.id, name: kim!.name, email: kim!.email, level: "consultant", positionName: "Consultant", guest: false },
    { ...DEMO_GUEST, level: null, positionName: null, guest: true },
    { ...DEMO_BOT, level: null, positionName: null, guest: false },
  ];
  return {
    people,
    leads: [
      { clientKey: "Northwind", personId: DEMO_PERSON.oid, source: "owner" },
      { clientKey: "Northwind", personId: priya!.aadId, source: "lead_worker" },
      { clientKey: "Harbor", personId: priya!.aadId, source: "owner" },
      { clientKey: "Atlas", personId: jordan!.aadId, source: "owner" },
      { clientKey: "Cooptimize", personId: DEMO_PERSON.oid, source: "owner" },
      // Owning a prospect or a vendor never makes a lead (ADM-2).
      { clientKey: "Bluebird", personId: priya!.aadId, source: "owner" },
      { clientKey: "Registered Agent Co", personId: DEMO_BOT.personId, source: "owner" },
    ],
    clients: [
      { personId: DEMO_PERSON.oid, clientKey: "Northwind" },
      { personId: DEMO_PERSON.oid, clientKey: "Harbor" },
      { personId: DEMO_PERSON.oid, clientKey: "Atlas" },
      { personId: jordan!.aadId, clientKey: "Atlas" },
      { personId: priya!.aadId, clientKey: "Northwind" },
      { personId: priya!.aadId, clientKey: "Harbor" },
      { personId: sam!.aadId, clientKey: "Northwind" },
      { personId: kim!.aadId, clientKey: "Harbor" },
    ].map((c) => ({ ...c, worker: true })),
    accounts: [
      { accountId: acct(1), clientKey: "Atlas", name: "Atlas Freight", type: "customer", workers: 2, focus: 1 },
      { accountId: acct(2), clientKey: "Bluebird", name: "Bluebird Supply", type: "prospect", workers: 0, focus: 0 },
      { accountId: acct(3), clientKey: "Cooptimize", name: "Cooptimize", type: "customer", workers: 5, focus: 5 },
      { accountId: acct(4), clientKey: "Harbor", name: "Harbor Health", type: "customer", workers: 3, focus: 2 },
      { accountId: acct(5), clientKey: "Northwind", name: "Northwind Foods", type: "customer", workers: 3, focus: 2 },
      { accountId: acct(6), clientKey: "Registered Agent Co", name: "Registered Agent Co", type: "vendor", workers: 0, focus: 0 },
    ],
    // AH-3: Priya's Account Worker row on Harbor has her Harbor login, so it's her everywhere. Sam's Harbor login isn't
    // in Dataverse, so Admin › People suggests it for him (sources/demo/data.ts, DEMO_LOGINS).
    identities: [{ personId: priya!.aadId, clientKey: "Harbor", email: DEMO_LOGINS["Ext-Priya Shah"]! }],
  };
}
