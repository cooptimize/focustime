// GD-2: the client boundary in the demo. In Northwind's customer chat (people outside Cooptimize), a teammate's message
// names Harbor, so it waits in "held back" for someone to sort by hand. In Northwind's delivery team chat (Cooptimizers
// only), the same kind of message was sorted as usual, and its conversation shows "mentions Harbor".
import { HELD_MENTION } from "../../../plan/conversations.ts";
import { demoChats } from "../chats.ts";
import { DEMO_PEOPLE } from "../data.ts";
import { thread } from "./conversations.ts";
import type { DemoSeed } from "./types.ts";

export const boundarySeed: DemoSeed = {
  name: "boundary",
  owner: "GD-2",
  seed: async (e) => {
    const chats = await demoChats(() => Date.parse(e.ctx.now())).groupChats();
    const member = (chatId: string, name: string) => chats.find((c) => c.id === chatId)!.members.find((m) => m.displayName === name)!;
    const [jordan, priya] = DEMO_PEOPLE;
    // Held: a client-facing chat, a message naming another client.
    const nc = "19:demo-northwind-collab@thread.v2";
    const at = e.ago(30);
    const text = "Dana, the date filter fix is the same one we shipped for Harbor last month, so it should be quick.";
    await e.teams.saveMessages([{ chatId: nc, messageId: "gd2-held-1", clientKey: "Northwind", senderId: member(nc, jordan!.name).userId, senderName: jordan!.name, senderTenant: member(nc, jordan!.name).tenantId, createdAt: at, modifiedAt: at, html: `<p>${text}</p>`, text, hasImage: false, hasFile: false, replyToId: null, mentions: [], fetchedAt: at }]);
    await e.conversations.place([{ chatId: nc, messageId: "gd2-held-1", conversationId: null, role: "unsorted", reason: HELD_MENTION, placedBy: "rule", at }]);
    // Sorted, with the tag: an internal chat.
    const nd = "19:demo-northwind-delivery@thread.v2";
    const id = await thread(e, nd, "Northwind", "Reuse the intake export approach for loyalty points", "Priya suggests building the loyalty points export the way the Harbor intake export works.\nJordan will check the field mapping first.", [
      { id: "gd2-nd-1", from: member(nd, priya!.name), minutesAgo: 55, text: "For the loyalty points export, could we reuse how we built the Harbor intake export? Same paging and the CSV writer." },
      { id: "gd2-nd-2", from: member(nd, jordan!.name), minutesAgo: 50, text: "Probably. I'll check the field mapping first and report back.", replyTo: "gd2-nd-1" },
    ]);
    await e.conversations.updateConversation(id, { mentions: ["Harbor"] });
  },
};
