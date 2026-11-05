// ADM-1: the demo's people directory: fictional levels and client leads, the same shape Dataverse gives. Northwind has
// two leads (its owner and a Lead Consultant on it), so Admin › People shows several leads on one client.
import type { DirectoryRead } from "../dataverse/directory.ts";
import { DEMO_PERSON } from "./azure.ts";
import { DEMO_ME, DEMO_PEOPLE } from "./data.ts";

export function demoDirectory(): DirectoryRead {
  const [jordan, priya, sam, kim] = DEMO_PEOPLE;
  const people: DirectoryRead["people"] = [
    { personId: DEMO_PERSON.oid, systemUserId: DEMO_ME, name: DEMO_PERSON.name, email: DEMO_PERSON.email, level: "lead", positionName: "Lead Consultant" },
    { personId: jordan!.aadId, systemUserId: jordan!.id, name: jordan!.name, email: jordan!.email, level: "senior", positionName: "Senior Consultant" },
    { personId: priya!.aadId, systemUserId: priya!.id, name: priya!.name, email: priya!.email, level: "lead", positionName: "Lead Consultant" },
    { personId: sam!.aadId, systemUserId: sam!.id, name: sam!.name, email: sam!.email, level: "consultant", positionName: "Consultant" },
    { personId: kim!.aadId, systemUserId: kim!.id, name: kim!.name, email: kim!.email, level: "consultant", positionName: "Consultant" },
  ];
  return {
    people,
    leads: [
      { clientKey: "Northwind", personId: DEMO_PERSON.oid, source: "owner" },
      { clientKey: "Northwind", personId: priya!.aadId, source: "lead_worker" },
      { clientKey: "Harbor", personId: priya!.aadId, source: "owner" },
      { clientKey: "Atlas", personId: jordan!.aadId, source: "owner" },
      { clientKey: "Cooptimize", personId: DEMO_PERSON.oid, source: "owner" },
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
    ],
  };
}
