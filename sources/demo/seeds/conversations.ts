// DM-1: the demo's client chats and what the conversations pipeline would have made of them (CV-1, CV-5): one that
// needs me (a client's question nobody has answered: Create DevOps item), one I committed to (a promise due Friday),
// one a teammate has (Handled by teammates), one tracked as an item (In progress), my late promise, and chatter. The
// rows are written as the pipeline leaves them (messages, their places, conversations, commitments), then each status
// is decided by the pipeline's own rule (refreshStatus). The demo reads no Teams messages and runs no sorting for them.
import { refreshStatus } from "../../../actions/conversations-pipeline.ts";
import type { ChatKind, ChatMember } from "../../../plan/chats.ts";
import type { Participant } from "../../../plan/conversations.ts";
import type { Mention, TeamsMessage } from "../../../plan/requests.ts";
import { demoChats, DEMO_TENANT } from "../chats.ts";
import { DEMO_PEOPLE } from "../data.ts";
import type { DemoSeed, DemoSeedEnv } from "./types.ts";

/** The chats registered for clients (the others in demoChats stay unregistered: Add a chat still has some to offer). */
const REGISTERED: [chatId: string, clientKey: string, kind: ChatKind][] = [
  ["19:demo-northwind-collab@thread.v2", "Northwind", "customer"],
  ["19:demo-northwind-delivery@thread.v2", "Northwind", "delivery"],
  ["19:demo-harbor-collab@thread.v2", "Harbor", "customer"],
  ["19:demo-atlas-delivery@thread.v2", "Atlas", "delivery"],
];

/** One demo message (IB-1 slice 4: `mentions` for an @mention, so a conversation asks me by name). Exported for IB-1's seed. */
export type Line = { id: string; from: ChatMember; minutesAgo: number | { on: string; at: string }; text: string; role?: "work" | "chatter" | "ack"; replyTo?: string; mentions?: Mention[] };

export const conversationsSeed: DemoSeed = {
  name: "conversations",
  owner: "DM-1 (CV-1, CV-5)",
  seed: async (e) => {
    const chats = await demoChats(() => Date.parse(e.ctx.now())).groupChats();
    const members = (chatId: string) => chats.find((c) => c.id === chatId)!.members;
    for (const [chatId, clientKey, kind] of REGISTERED) {
      const c = chats.find((x) => x.id === chatId)!;
      await e.teams.addChat({ chatId, clientKey, kind, displayName: c.topic!, webUrl: null, members: c.members, by: e.me.id });
    }
    const person = (chatId: string, name: string) => members(chatId).find((m) => m.displayName === name)!;
    const meIn = (chatId: string) => members(chatId).find((m) => m.userId?.toLowerCase() === e.me.id.toLowerCase())!;
    const [jordan, priya] = DEMO_PEOPLE;

    // 1. Northwind's client asks; nobody at Cooptimize has answered yet: New, Needs you, Create DevOps item.
    const nc = "19:demo-northwind-collab@thread.v2";
    await thread(e, nc, "Northwind", "Delivery fee missing from the order export", "Dana asks for the delivery fee as its own column in the order history export, before the month-end close.\nMarcus says finance reconciles fees by hand today.", [
      { id: "nc-1", from: person(nc, "Dana Whitfield"), minutesAgo: 95, text: "Quick one on the order history export: finance needs the delivery fee as its own column. Today it's folded into the order total." },
      { id: "nc-2", from: person(nc, "Marcus Bell"), minutesAgo: 88, text: "Yes please. We reconcile fees by hand every month end, so having it before the close on the 28th would really help." },
      { id: "nc-3", from: person(nc, "Dana Whitfield"), minutesAgo: 80, text: "Thanks!", role: "ack" },
    ]);
    // My late promise, in the same chat: on my last workday I said I'd send the spec by end of day; still open.
    const spec = await thread(e, nc, "Northwind", "Updated export spec for review", "Marcus asked for the updated export spec with the new filters.\nAlex said they'd send it.", [
      { id: "nc-4", from: person(nc, "Marcus Bell"), minutesAgo: { on: e.lastWorkday, at: "09:40" }, text: "Could you share the updated export spec with the date filters? We'd like to review it with the controllers." },
      { id: "nc-5", from: meIn(nc), minutesAgo: { on: e.lastWorkday, at: "10:00" }, text: "Sure, I'll send the updated spec over by end of day.", replyTo: "nc-4" },
    ]);
    await e.conversations.addCommitment({ conversationId: spec, chatId: nc, clientKey: "Northwind", whoId: e.me.id, whoName: e.me.name, toId: person(nc, "Marcus Bell").userId, toName: "Marcus Bell", what: "Send Marcus the updated export spec", dueAt: null, dueDate: e.lastWorkday, impliesItem: false, messageIds: ["nc-5"], reason: "Said they'd send it by end of day" });

    // 2. Harbor's client asks me directly; I said I'd confirm by Friday: my promise due Friday, Needs you.
    const hc = "19:demo-harbor-collab@thread.v2";
    const golive = await thread(e, hc, "Harbor", "Intake form go-live date", "Lena needs a go-live date for the new intake form to brief the front desks.\nAlex will confirm the date by Friday after the accessibility review.", [
      { id: "hc-1", from: person(hc, "Lena Ortiz"), minutesAgo: 140, text: "Alex, can you confirm the go-live date for the new intake form? I need to brief the front desk teams next week." },
      { id: "hc-2", from: person(hc, "Ravi Menon"), minutesAgo: 132, text: "The accessibility review is the last thing on our side." },
      { id: "hc-3", from: meIn(hc), minutesAgo: 120, text: "I'll confirm the go-live date by Friday, once the accessibility review is back.", replyTo: "hc-1" },
    ]);
    await e.conversations.addCommitment({ conversationId: golive, chatId: hc, clientKey: "Harbor", whoId: e.me.id, whoName: e.me.name, toId: person(hc, "Lena Ortiz").userId, toName: "Lena Ortiz", what: "Confirm the intake form go-live date", dueAt: null, dueDate: e.weekDay(4), impliesItem: false, messageIds: ["hc-3"], reason: "Said they'd confirm by Friday" });

    // 3. Harbor: the insurance card upload bug, tracked as #2211 (In progress).
    await thread(e, hc, "Harbor", "Large insurance card photos fail to upload", "Phone photos over 5 MB fail on the insurance card step.\nTracked in #2211; the fix resizes photos before upload.", [
      { id: "hc-4", from: person(hc, "Ravi Menon"), minutesAgo: 60 * 26, text: "Patients are telling us the insurance card upload fails with photos straight from their phones." },
      { id: "hc-5", from: meIn(hc), minutesAgo: 60 * 25, text: "Thanks Ravi, those are over 5 MB. I'm adding a resize step before the upload under #2211." },
    ], { item: { id: 2211, url: "https://dev.azure.com/harbor-demo/Patient%20Experience/_workitems/edit/2211", title: "Insurance card upload" } });

    // 4. Northwind's delivery team: Jordan has the failed staging deploy (Handled by teammates).
    const nd = "19:demo-northwind-delivery@thread.v2";
    const deploy = await thread(e, nd, "Northwind", "Staging deploy failed on the loyalty branch", "The staging deploy for the loyalty points branch failed on a missing setting.\nJordan is rerunning it after adding the setting.", [
      { id: "nd-1", from: person(nd, priya!.name), minutesAgo: 70, text: "Staging deploy for the loyalty branch failed. Looks like the points expiry setting is missing." },
      { id: "nd-2", from: person(nd, jordan!.name), minutesAgo: 62, text: "I'll add the setting and rerun the pipeline after lunch.", replyTo: "nd-1" },
    ], { ownerId: person(nd, jordan!.name).userId });
    await e.conversations.addCommitment({ conversationId: deploy, chatId: nd, clientKey: "Northwind", whoId: person(nd, jordan!.name).userId, whoName: jordan!.name, toId: person(nd, priya!.name).userId, toName: priya!.name, what: "Add the setting and rerun the staging deploy", dueAt: null, dueDate: e.today, impliesItem: false, messageIds: ["nd-2"], reason: "Said they'd rerun it after lunch" });

    // 5. Chatter (never a conversation): "Filtered as chatter".
    await chatter(e, nd, [
      { id: "nd-3", from: person(nd, jordan!.name), minutesAgo: 40, text: "Who's in for tacos on Friday? 🌮" },
      { id: "nd-4", from: person(nd, priya!.name), minutesAgo: 38, text: "Count me in!" },
    ]);
    const ad = "19:demo-atlas-delivery@thread.v2";
    await chatter(e, ad, [{ id: "ad-1", from: person(ad, priya!.name), minutesAgo: 300, text: "Happy Monday everyone ☕" }]);
  },
};

/** One conversation with its messages, as the pipeline would have placed them. The status comes from its own rule. */
export async function thread(e: DemoSeedEnv, chatId: string, clientKey: string, title: string, summary: string, lines: Line[], o: { item?: { id: number; url: string; title: string }; ownerId?: string | null } = {}): Promise<number> {
  const msgs = await save(e, chatId, clientKey, lines);
  const people = new Map<string, Participant>();
  for (const l of lines) if (l.from.userId) people.set(l.from.userId, { id: l.from.userId, name: l.from.displayName ?? "", external: l.from.tenantId !== DEMO_TENANT });
  const first = msgs[0]!.createdAt, last = msgs.at(-1)!.createdAt;
  const lastWork = msgs.filter((_, i) => (lines[i]!.role ?? "work") === "work").at(-1)!.createdAt;
  const c = await e.conversations.addConversation({ chatId, clientKey, title, summary, participants: [...people.values()], firstAt: first, lastAt: last, lastWorkAt: lastWork, ownerId: o.ownerId ?? null, ...(o.item ? { item: o.item, status: "tracked" as const } : {}), changeNote: o.item ? `Tracked as #${o.item.id}` : null });
  await e.conversations.place(lines.map((l, i) => ({ chatId, messageId: l.id, conversationId: c.id, role: l.role ?? "work", reason: null, placedBy: "ai" as const, at: msgs[i]!.createdAt })));
  await refreshStatus({ convs: e.conversations, teams: e.teams, homeTenant: DEMO_TENANT }, c.id);
  // Part 0: a seeded owner is the shared owner, the same as the one-time backfill sets.
  const owner = o.ownerId ? people.get(o.ownerId) : undefined;
  if (owner) await e.conversations.backfillOwner(c.id, { id: owner.id, name: owner.name });
  return c.id;
}

async function chatter(e: DemoSeedEnv, chatId: string, lines: Line[]): Promise<void> {
  const chat = await e.teams.chat(chatId);
  const msgs = await save(e, chatId, chat!.clientKey, lines);
  await e.conversations.place(lines.map((l, i) => ({ chatId, messageId: l.id, conversationId: null, role: "chatter" as const, reason: "social", placedBy: "rule" as const, at: msgs[i]!.createdAt })));
}

async function save(e: DemoSeedEnv, chatId: string, clientKey: string, lines: Line[]): Promise<TeamsMessage[]> {
  const msgs = lines.map((l): TeamsMessage => {
    const at = typeof l.minutesAgo === "number" ? e.ago(l.minutesAgo) : Temporal.PlainDateTime.from(`${l.minutesAgo.on}T${l.minutesAgo.at}`).toZonedDateTime(e.zone).toInstant().toString();
    const html = `<p>${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;
    return { chatId, messageId: l.id, clientKey, senderId: l.from.userId, senderName: l.from.displayName, senderTenant: l.from.tenantId, createdAt: at, modifiedAt: at, html, text: l.text, hasImage: false, hasFile: false, replyToId: l.replyTo ?? null, mentions: l.mentions ?? [], fetchedAt: at };
  });
  await e.teams.saveMessages(msgs);
  return msgs;
}
