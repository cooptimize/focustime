// IB-4: three more, so the slim Inbox has each of its cases on any weekday: a second suggestion (a Harbor request from
// my last workday), a conversation that isn't one (a question about which story I'll take next), a promise of mine
// nobody touched for weeks (it clears as expired) and one whose item is Closed (it clears as done).
//
// IB-1's seed: what the Inbox needs beyond the conversations, promises, captures and sends the other seeds make, so a
// demo shows every view (docs/demo/README.md). With the others it gives: Needs you with a reason on each item (a client
// question nobody answered, Priya's question to me by name, my late promise, Priya's Must), Promises with a late one, Waiting on
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

    // Needs you: Priya asks me by name about a sign-in failure. (Not sorted as urgent: Today keeps one Start focus on
    // the demo day, NV-1.)
    await thread(e, ad, "Atlas", "Warehouse sign-in fails after this morning's release", "Priya says warehouse users can't sign in since the 9:00 release.\nShe asks Alex to look before the afternoon shift.", [
      { id: "ib-ad-1", from: member(ad, priya.name), minutesAgo: 25, text: `${e.me.name.split(" ")[0]}, warehouse users can't sign in since the 9:00 release. Can you look before the afternoon shift starts?`, mentions: [me] },
    ]);

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

    // IB-4: From chats: Ravi asked for the intake form in Spanish on my last workday; nobody has made an item.
    await thread(e, hc, "Harbor", "Intake form in Spanish", "Ravi asks for a Spanish version of the new intake form; front desks help many patients fill it in today.\nLena agrees it should come before the go-live.", [
      { id: "ib4-hc-1", from: member(hc, "Ravi Menon"), minutesAgo: { on: e.lastWorkday, at: "11:10" }, text: "Could the new intake form also come in Spanish? The front desks fill it in for a lot of patients today." },
      { id: "ib4-hc-2", from: member(hc, "Lena Ortiz"), minutesAgo: { on: e.lastWorkday, at: "11:25" }, text: "Agreed, ideally before we go live." },
    ], { itemNeeded: { why: "Asks for a Spanish version of the intake form, which no item covers", title: "Spanish version of the intake form", level: "feature" } });
    // Not a suggestion: only which story I'll pick up next (the sorting step says no item is needed).
    await thread(e, nd, "Northwind", "Which loyalty story is next", "Jordan asks which loyalty story Alex picks up next.\nAlex says the points expiry one.", [
      { id: "ib4-nd-1", from: member(nd, DEMO_PEOPLE[0]!.name), minutesAgo: { on: e.lastWorkday, at: "11:00" }, text: "Which of the loyalty stories are you picking up next?" },
      { id: "ib4-nd-2", from: member(nd, e.me.name), minutesAgo: { on: e.lastWorkday, at: "11:04" }, text: "The points expiry one, then the balance email.", replyTo: "ib4-nd-1" },
    ]);
    // Cleared on their own: a promise from three weeks ago nobody touched (expired), and one whose item is Closed (done).
    const labels = await thread(e, ad, "Atlas", "Pallet label sample", "Priya asked for a sample pallet label for the carrier.\nAlex said they'd share one.", [
      { id: "ib4-ad-1", from: member(ad, priya.name), minutesAgo: 60 * 24 * 21, text: "Could you share a sample pallet label we can send the carrier?" },
      { id: "ib4-ad-2", from: member(ad, e.me.name), minutesAgo: 60 * 24 * 21 - 10, text: "I'll share a sample label tomorrow.", replyTo: "ib4-ad-1" },
    ]);
    await e.conversations.addCommitment({ conversationId: labels, chatId: ad, clientKey: "Atlas", whoId: e.me.id, whoName: e.me.name, toId: priya.aadId, toName: priya.name, what: "Share a sample pallet label with Priya", dueAt: null, dueDate: e.day(-20), impliesItem: false, messageIds: ["ib4-ad-2"], reason: "Said they'd share one tomorrow" });
    const email = await thread(e, hc, "Harbor", "Intake confirmation email", "Lena asked when patients get a confirmation email after the intake form.\nAlex said it ships with #2216.", [
      { id: "ib4-hc-3", from: member(hc, "Lena Ortiz"), minutesAgo: { on: e.lastWorkday, at: "09:15" }, text: "Do patients get a confirmation email once they send the intake form?" },
      { id: "ib4-hc-4", from: member(hc, e.me.name), minutesAgo: { on: e.lastWorkday, at: "09:30" }, text: "Not yet. I'll get the confirmation email out with the next release.", replyTo: "ib4-hc-3" },
    ]);
    await e.conversations.addCommitment({ conversationId: email, chatId: hc, clientKey: "Harbor", whoId: e.me.id, whoName: e.me.name, toId: member(hc, "Lena Ortiz").userId, toName: "Lena Ortiz", what: "Ship the intake confirmation email", dueAt: null, dueDate: e.day(2), impliesItem: false, messageIds: ["ib4-hc-4"], reason: "Said they'd get it out with the next release" });
    const [k] = (await e.conversations.commitmentsIn([email]));
    await e.conversations.updateCommitment(k!.id, { itemId: 2216, itemUrl: "https://dev.azure.com/harbor-demo/Patient%20Experience/_workitems/edit/2216", itemTitle: "Intake confirmation email" });
  },
};
