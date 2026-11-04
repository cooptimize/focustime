// T-2 and T-2.1: Teams group chats in demo mode, as Cooptimize sets clients up: a Delivery Team chat with the internal
// team and a Customer Collaboration chat with the client's key people from their (fictional) tenants. No Graph calls;
// nothing here is real.
import type { ChatMember, ChatSummary } from "../../plan/chats.ts";
import type { ChatsClient } from "../graph/chats.ts";
import { DEMO_PEOPLE } from "./data.ts";

/** The demo's own tenant (DEMO_PERSON.tid) and two fictional client tenants. */
export const DEMO_TENANT = "00000000-0000-4000-8000-0000000000d1";
const NORTHWIND_TENANT = "00000000-0000-4000-8000-0000000000a2";
const HARBOR_TENANT = "00000000-0000-4000-8000-0000000000a3";

const us = (i: number): ChatMember => ({ userId: DEMO_PEOPLE[i]!.aadId, displayName: DEMO_PEOPLE[i]!.name, email: DEMO_PEOPLE[i]!.email, tenantId: DEMO_TENANT });
const me: ChatMember = { userId: "00000000-0000-4000-8000-0000000000e1", displayName: "Alex Rivera", email: "you@example.com", tenantId: DEMO_TENANT };
const them = (name: string, tenant: string, n: number): ChatMember => ({ userId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, displayName: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@${tenant === NORTHWIND_TENANT ? "northwind" : "harbor"}.example`, tenantId: tenant });

/** Days before now, as an instant (the demo's chats always look recent). */
const ago = (now: () => number, days: number) => new Date(now() - days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");

export function demoChats(now: () => number = Date.now): ChatsClient {
  const chats = (): ChatSummary[] => [
    { id: "19:demo-northwind-delivery@thread.v2", topic: "Northwind Delivery Team (Cooptimize)", webUrl: null, lastUpdated: ago(now, 20), lastRead: ago(now, 0), members: [me, us(0), us(1)], moreMembers: false },
    { id: "19:demo-northwind-collab@thread.v2", topic: "Northwind Customer Collaboration (Cooptimize)", webUrl: null, lastUpdated: ago(now, 25), lastRead: ago(now, 0), members: [me, us(0), them("Dana Whitfield", NORTHWIND_TENANT, 1), them("Marcus Bell", NORTHWIND_TENANT, 2)], moreMembers: false },
    { id: "19:demo-harbor-delivery@thread.v2", topic: "Harbor Health Delivery Team (Cooptimize)", webUrl: null, lastUpdated: ago(now, 40), lastRead: ago(now, 1), members: [me, us(2), them("Ravi Menon", HARBOR_TENANT, 4)], moreMembers: false },
    { id: "19:demo-harbor-collab@thread.v2", topic: "Harbor Health Customer Collaboration (Cooptimize)", webUrl: null, lastUpdated: ago(now, 35), lastRead: ago(now, 1), members: [me, us(2), them("Lena Ortiz", HARBOR_TENANT, 3), them("Ravi Menon", HARBOR_TENANT, 4), { userId: null, displayName: "Guest reviewer", email: null, tenantId: null }], moreMembers: false },
    { id: "19:demo-atlas-delivery@thread.v2", topic: "Atlas Freight Delivery Team (Cooptimize)", webUrl: null, lastUpdated: ago(now, 60), lastRead: ago(now, 6), members: [me, us(3), us(1)], moreMembers: false },
    { id: "19:demo-lunch@thread.v2", topic: "Friday lunch crew", webUrl: null, lastUpdated: ago(now, 90), lastRead: ago(now, 2), members: [me, us(0), us(1), us(2), us(3)], moreMembers: false },
  ];
  return {
    groupChats: async () => chats(),
    members: async (chatId) => {
      const c = chats().find((x) => x.id === chatId);
      if (!c) throw Object.assign(new Error("not found"), { status: 404 });
      return c.members;
    },
  };
}
