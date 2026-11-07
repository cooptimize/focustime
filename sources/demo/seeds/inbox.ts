// IB-1's seed: what the Inbox needs beyond the conversations, promises, captures and sends the other seeds make, so a
// demo shows every view (docs/demo/README.md). With the others it gives: Needs you with a reason on each item (a client
// question nobody answered, an urgent ask by name, my late promise, Priya's Must), Promises with a late one, Waiting on
// (Priya's commitment to me, and my send to Sam), In progress (#2211), Captures and drafts, Handled by teammates
// (Jordan's deploy), Done (a promise closed today and a conversation resolved this morning) and Chatter. Everything is
// fictional, and nothing leaves FocusTime: the Close the loop and Resolve go through the app's own actions.
import { DEMO_PEOPLE } from "../data.ts";
import { demoChats } from "../chats.ts";
import { thread } from "./conversations.ts";
import type { DemoSeed } from "./types.ts";

export const inboxSeed: DemoSeed = {
  name: "inbox",
  owner: "IB-1",
  seed: async (e) => {
    const chats = await demoChats(() => Date.parse(e.ctx.now())).groupChats();
    const member = (chatId: string, name: string) => chats.find((c) => c.id === chatId)!.members.find((m) => m.displayName === name)!;
    const priya = DEMO_PEOPLE[1]!;
    const ad = "19:demo-atlas-delivery@thread.v2";
    const nd = "19:demo-northwind-delivery@thread.v2";
    const hc = "19:demo-harbor-collab@thread.v2";
    const me = { id: e.me.id, name: e.me.name };

    // Needs you now: Priya asks me by name about a sign-in failure, and the request was sorted as needed now. Today's
    // urgent strip shows it with Start focus; it opens in the Inbox's detail pane.
    await thread(e, ad, "Atlas", "Warehouse sign-in fails after this morning's release", "Priya says warehouse users can't sign in since the 9:00 release.\nShe asks Alex to look before the afternoon shift.", [
      { id: "ib-ad-1", from: member(ad, priya.name), minutesAgo: 25, text: `${e.me.name.split(" ")[0]}, warehouse users can't sign in since the 9:00 release. Can you look before the afternoon shift starts?`, mentions: [me] },
    ]);
    await e.teams.addRequest({ chatId: ad, messageId: "ib-ad-1", clientKey: "Atlas", rule: "mention", ruleDetail: null, at: e.ago(25) });
    await e.teams.setSort(ad, "ib-ad-1", "sorted", { kind: "incident", urgency: "now", itemType: "bug", title: "Warehouse sign-in fails since the 9:00 release", description: "", likely: null, reason: "Users are blocked before a shift" }, null);

    // Waiting on: Priya's commitment to me, due tomorrow.
    const data = await thread(e, nd, "Northwind", "Test accounts for the loyalty points demo", "Alex needs test accounts with points balances for Thursday's demo.\nPriya will send them.", [
      { id: "ib-nd-1", from: member(nd, e.me.name), minutesAgo: 180, text: "Could someone set up a few test accounts with points balances for Thursday's client demo?" },
      { id: "ib-nd-2", from: member(nd, priya.name), minutesAgo: 170, text: "I'll send you three test accounts by tomorrow.", replyTo: "ib-nd-1" },
    ], { ownerId: e.me.id });
    await e.conversations.addCommitment({ conversationId: data, chatId: nd, clientKey: "Northwind", whoId: priya.aadId, whoName: priya.name, toId: e.me.id, toName: e.me.name, what: "Send Alex three test accounts with points balances", dueAt: null, dueDate: e.day(1), impliesItem: false, messageIds: ["ib-nd-2"], reason: "Said they'd send them by tomorrow" });

    // Done: a conversation resolved this morning, and a promise I closed the loop on today.
    const sms = await thread(e, hc, "Harbor", "Reminder text wording", "Lena asked for shorter appointment reminder wording.\nAlex sent the new text and Lena approved it.", [
      { id: "ib-hc-1", from: member(hc, "Lena Ortiz"), minutesAgo: 240, text: "Can the appointment reminder text be shorter? Patients say it gets cut off." },
      { id: "ib-hc-2", from: member(hc, e.me.name), minutesAgo: 225, text: "Here's a shorter version: 'Reminder: your Harbor Health visit is tomorrow at 10:00. Reply C to confirm.'" },
      { id: "ib-hc-3", from: member(hc, "Lena Ortiz"), minutesAgo: 210, text: "Perfect, approved." },
    ]);
    await e.run("conversations.resolve", { id: sms });
    const told = (await e.run("followup.add", { clientKey: "Harbor", who: "Lena Ortiz", what: "Send Lena the new reminder text", channel: "teams", due: e.today })) as { followUp: { id: number } };
    await e.run("followup.close", { id: told.followUp.id, how: "teams", note: "Sent it in the Harbor chat" });
  },
};
