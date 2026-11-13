// LP-1: Close the loop by Teams, Email, a DevOps comment or a Call. Graph and DevOps are fakes: nothing is sent.
// Fictional people and clients only (contoso is home, fabrikam a client, northwind another client).
import { beforeEach, describe, expect, it } from "vitest";
import { aChatMember, HOME_TENANT } from "../test/builders/index.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { planStoreOn, type PlanStore } from "../store/plan-store.ts";
import { audienceOf } from "../plan/loop.ts";
import { SendFailure, type SendClient } from "../sources/graph/send.ts";
import { forgetLoopPreviews, loopAction, type LoopContext, type LoopPromise, type LoopDraftView, type LoopPreviewView, type LoopResultView } from "./loop-actions.ts";
import type { ActionResponse } from "./types.ts";

const ME = "00000000-0000-4000-8000-0000000000aa";
const NOW = "2026-11-06T15:00:00Z";
const me = aChatMember({ userId: ME, displayName: "Sam Tester", email: "sam@contoso.example" });
const lee = aChatMember({ displayName: "Lee Colleague", email: "lee@contoso.example" });
const dana = aChatMember({ external: true, displayName: "Dana Client", email: "dana@fabrikam.example" });
const ravi = aChatMember({ external: true, displayName: "Ravi Client", email: "ravi@fabrikam.example" });
const guest = aChatMember({ displayName: "Gus Guest", email: "gus@contoso.example", guest: true });
const CHAT_ID = "19:fabrikam-delivery@thread.v2";

type Calls = { posts: string[]; drafts: number; sends: number; devops: { action: string; input: unknown }[] };

function fakeSender(c: Calls, o: { postFails?: boolean; readBack?: boolean; mailSent?: boolean } = {}): SendClient {
  return {
    oneOnOne: async (_me, them) => `19:${them.replace(/\W/g, "")}_me@unq.gbl.spaces`,
    post: async (_chat, html) => {
      if (o.postFails) throw new SendFailure("forbidden", "Microsoft refused it");
      c.posts.push(html);
      return String(1700000000000 + c.posts.length);
    },
    readMessage: async () => ({ found: o.readBack ?? true }),
    draft: async () => (c.drafts++, { id: `draft-${c.drafts}`, webLink: "https://outlook.office.com/mail/drafts" }),
    send: async () => void c.sends++,
    readMail: async () => ({ state: (o.mailSent ?? true) && c.sends ? "sent" : "draft", webLink: "https://outlook.office.com/mail/sent", sentAt: NOW }),
  };
}

type Opts = { promise?: Partial<LoopPromise>; internal?: boolean; access?: "granted" | "consent"; sender?: Parameters<typeof fakeSender>[1]; canComment?: boolean; ai?: boolean; aiRemoved?: number; tasks?: unknown[] };

async function setup(o: Opts = {}) {
  const db = sqliteDb();
  await addUsers(db.conn, ME);
  const plan: PlanStore = planStoreOn(db.conn, { now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York"), userId: ME });
  const f = await plan.addFollowUp({ who: "Dana Client", what: "Send the rerun counts", due: null, clientKey: "fabrikam", itemId: 4417 });
  const calls: Calls = { posts: [], drafts: 0, sends: 0, devops: [] };
  let promise: LoopPromise = {
    key: `f${f.id}`, kind: "followUp", id: f.id, clientKey: "fabrikam", clientName: "Fabrikam", what: "Send the rerun counts", closed: false,
    who: "Dana Client", whoRef: { kind: "external", memberId: dana.userId!, name: "Dana Client" }, itemId: 4417,
    chat: { chatId: CHAT_ID, name: "Contoso project chat", members: [me, lee, dana, ravi, guest] }, conversation: { title: "Rerun counts", summary: "Dana asked for the counts after the rerun." }, myWords: null,
    ...o.promise,
  };
  let preview = 0;
  const devops = async (action: string, input: unknown): Promise<ActionResponse> => {
    calls.devops.push({ action, input });
    if (action === "devops.states") return { ok: true, data: { itemId: 4417, type: "User Story", state: "Active", title: "Salesforce rerun", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }] } };
    if (action === "devops.preview") {
      const i = input as { change?: { kind: string; text?: string }; changes?: { kind: string; key: string; state?: string }[] };
      const mk = (kind: string, key?: string) => ({ previewId: `p${++preview}`, expiresAt: NOW, op: kind, summary: kind, system: "DevOps", org: "contoso", project: "Fabrikam", item: "#4417", identity: "sam@contoso.example", fields: [], links: [], notes: [], visibility: "", undo: true, ...(key ? { key } : {}) });
      if (i.change) return { ok: true, data: { preview: mk(i.change.kind) } };
      return { ok: true, data: { previews: i.changes!.map((c) => mk(c.kind, c.key)), nothing: [], refused: [] } };
    }
    if (action === "devops.confirm") return { ok: true, data: { entry: { id: 90 + calls.devops.length }, confirmed: true, message: "Comment added in DevOps", url: "https://dev.azure.com/contoso/_workitems/edit/4417" } };
    return { ok: false, status: 400, error: "unknown" };
  };
  const ctx: LoopContext = {
    plan,
    me: async () => ({ id: ME, name: "Sam Tester", email: "sam@contoso.example" }),
    promise: async (key) => (key === promise.key ? { ...promise, closed: !!(await plan.getFollowUp(promise.id))?.closedAt } : null),
    homeTenant: async () => HOME_TENANT,
    homeDomains: async () => ["contoso.example"],
    emailOf: async (p, ref, name) => p.chat?.members.find((m) => (ref?.kind === "external" ? m.userId === ref.memberId : ref?.kind === "cooptimizer" ? m.userId === ref.id : m.displayName === name))?.email ?? null,
    userIdOf: async (_p, ref) => (ref?.kind === "cooptimizer" ? ref.id : null),
    item: async () => ({ id: 4417, title: "Salesforce rerun", state: "Active", type: "User Story" }),
    canComment: async () => o.canComment ?? true,
    boundary: async () => ({ internal: !!o.internal, directory: [{ key: "fabrikam", names: ["Fabrikam"], projects: ["Fabrikam"], itemIds: [4417] }, { key: "northwind", names: ["Northwind"], projects: ["Northwind Data"], itemIds: [5120] }] }),
    ai: async () => (o.ai ? ({ run: async (task: unknown) => (o.tasks?.push(task), { ok: true, value: { text: "Hi Dana, the counts match now." }, ...(o.aiRemoved ? { namesRemoved: o.aiRemoved } : {}) }) } as never) : null),
    sender: async () => fakeSender(calls, o.sender),
    access: async () => o.access ?? "granted",
    devops: devops as LoopContext["devops"],
    close: async (p, how, note) => void (await plan.closeFollowUp(p.id, note, "me", { how, outcome: "done" })),
    reopen: async (p) => void (await plan.reopenFollowUp(p.id)),
    open: async () => [{ key: promise.key, what: promise.what, who: promise.who, clientKey: "fabrikam", clientName: "Fabrikam" }],
    now: () => NOW,
    log: () => {},
  };
  const run = async <T,>(action: Parameters<typeof loopAction>[1], input: unknown): Promise<T> => {
    const r = await loopAction(ctx, action, input);
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  return { plan, ctx, calls, key: promise.key, id: f.id, run, set: (p: Partial<LoopPromise>) => void (promise = { ...promise, ...p }) };
}

beforeEach(() => forgetLoopPreviews());

describe("the recipient", () => {
  it("never resolves to me: by my person, my name or my address", async () => {
    const byRef = await setup({ promise: { who: "Sam", whoRef: { kind: "cooptimizer", id: ME, name: "Sam" } } });
    const d1 = await byRef.run<LoopDraftView>("loop.draft", { key: byRef.key });
    expect(d1.recipient).toBeNull();
    expect(d1.noRecipient).toMatch(/Who is you/);
    const byName = await setup({ promise: { who: "sam tester", whoRef: null } });
    expect((await byName.run<LoopDraftView>("loop.draft", { key: byName.key })).recipient).toBeNull();
    const byMail = await setup({ promise: { who: "S. Tester", whoRef: null, chat: { chatId: CHAT_ID, name: "Contoso project chat", members: [{ ...me, displayName: "S. Tester" }] } } });
    expect((await byMail.run<LoopDraftView>("loop.draft", { key: byMail.key })).recipient).toBeNull();
    // And a send to me is refused at the preview.
    const r = await loopAction(byRef.ctx, "loop.preview", { key: byRef.key, channel: "teams", text: "Done" });
    expect(r.ok).toBe(false);
  });

  it("is prefilled from Who otherwise, with where each channel goes", async () => {
    const s = await setup();
    const d = await s.run<LoopDraftView>("loop.draft", { key: s.key });
    expect(d.recipient).toEqual({ name: "Dana Client", outside: true });
    expect(d.channels.map((c) => [c.channel, c.where])).toEqual([["teams", "Contoso project chat"], ["email", "Dana Client only"], ["devops", "#4417"], ["call", "A reminder only: nothing is sent"]]);
    expect(d.text).toMatch(/^Hi Dana,/);
    expect(d.draftedFrom).toBe("A plain draft from your promise, the conversation “Rerun counts” and #4417's state (Active). Edit it as you like.");
    expect(d.initial).toBe("teams");
  });

  it("AI drafts when it's on for the client, and says so", async () => {
    const s = await setup({ ai: true });
    const d = await s.run<LoopDraftView>("loop.draft", { key: s.key });
    expect(d.ai).toBe("ok");
    expect(d.text).toBe("Hi Dana, the counts match now.");
    expect(d.draftedFrom).toMatch(/^Drafted by AI from/);
  });
});

describe("GD-2: the AI draft", () => {
  it("asks for no other client and the check after; a name the check removed shows the notice; Internal keeps names", async () => {
    const tasks: { instructions: string; mentions?: unknown }[] = [];
    const s = await setup({ ai: true, aiRemoved: 1, tasks });
    const d = await s.run<LoopDraftView>("loop.draft", { key: s.key });
    expect(tasks[0]).toMatchObject({ mentions: { input: "words", answer: "scrub" } });
    expect(tasks[0]!.instructions).toContain("Never name any other client");
    expect(d.namesRemoved).toBe("Another client's name was removed");
    const it2: { instructions: string; mentions?: unknown }[] = [];
    const internal = await setup({ ai: true, internal: true, tasks: it2, promise: { clientKey: "internal", clientName: "Cooptimize Internal" } });
    const e = await internal.run<LoopDraftView>("loop.draft", { key: internal.key });
    expect(it2[0]!.instructions).not.toContain("Never name any other client");
    expect(e.namesRemoved).toBeUndefined();
  });
});

describe("the state change", () => {
  it("offers only the states the item's type has in its process (never its own, never Removed)", async () => {
    const s = await setup();
    const d = await s.run<LoopDraftView>("loop.draft", { key: s.key });
    expect(d.item?.states).toEqual(["New", "Resolved", "Closed"]);
    expect(s.calls.devops.some((c) => c.action === "devops.states")).toBe(true);
  });
});

describe("the preview", () => {
  it("counts who sees it inside and outside Cooptimize, and lists the outside people by name", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana, the counts match." });
    expect(p.audience).toMatchObject({ total: 5, inside: 1, outside: 3, outsideNames: ["Dana Client", "Gus Guest", "Ravi Client"] });
    expect(p.line).toBe("Contoso project chat, 5 people, 3 outside Cooptimize");
    expect(p.final).toBe("Sent Teams messages and emails can't be undone.");
    expect(audienceOf([me, lee], HOME_TENANT, ME)).toMatchObject({ total: 2, inside: 1, outside: 0 });
  });

  // GD-2 point 6: flagged with one click to replace; my own words can still go once I've seen it; Internal skips it.
  it("GD-2: another client's name is flagged in the preview with the replaced text; Send needs the flag seen; Internal isn't checked", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Same fix as we did for Northwind." });
    expect(p.blocked).toBeNull();
    expect(p.mentions).toMatchObject({ names: ["Northwind"], text: "Same fix as we did for another client." });
    expect(p.mentions?.line).toMatch(/Northwind/);
    const no = await loopAction(s.ctx, "loop.send", { previewId: p.previewId });
    expect(no).toMatchObject({ ok: false, status: 409, code: "mentions" });
    expect(s.calls.posts).toHaveLength(0);
    // Replace: preview the replaced text, nothing left to flag.
    const fixed = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: p.mentions!.text });
    expect(fixed.mentions).toBeUndefined();
    // Or send my own words after seeing the flag (the held preview is still there).
    const sent = await s.run<LoopResultView>("loop.send", { previewId: p.previewId, mentionsOk: true });
    expect(sent.ok).toBe(true);
    expect(s.calls.posts).toEqual(["Same fix as we did for Northwind."]);
    const internal = await setup({ internal: true, promise: { clientKey: "internal", clientName: "Cooptimize Internal" } });
    const q = await internal.run<LoopPreviewView>("loop.preview", { key: internal.key, channel: "teams", text: "Same fix as we did for Northwind." });
    expect(q.blocked).toBeNull();
    expect(q.mentions).toBeUndefined();
  });
});

describe("Teams", () => {
  it("success posts once, reads back, closes the loop with the message link, and writes the audit entry", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana, the counts match." });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.ok).toBe(true);
    expect(r.closed).toBe(true);
    expect(s.calls.posts).toEqual(["Hi Dana, the counts match."]);
    expect(r.send).toMatchObject({ channel: "teams", state: "sent", destination: "Contoso project chat", recipient: "Dana Client", insideCount: 1, outsideCount: 3, kept: true });
    expect(r.send.link).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/message\//);
    expect((await s.plan.getFollowUp(s.id))?.closedAt).toBeTruthy();
    expect((await s.plan.getFollowUp(s.id))?.closeHow).toBe("teams");
    const log = await s.run<{ sends: unknown[] }>("loop.sends", {});
    expect(log.sends).toHaveLength(1);
    // A preview is used once.
    expect((await loopAction(s.ctx, "loop.send", { previewId: p.previewId })).ok).toBe(false);
  });

  it("a failure leaves the loop open with the error in plain words and Retry", async () => {
    const s = await setup({ sender: { postFails: true } });
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana" });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r).toMatchObject({ ok: false, closed: false, retry: true });
    expect(r.message).toBe("Microsoft refused it. The loop is still open.");
    expect(r.send.state).toBe("failed");
    expect((await s.plan.getFollowUp(s.id))?.closedAt).toBeNull();
  });

  it("a post Teams doesn't show yet is unconfirmed; Retry reads back and never posts twice", async () => {
    const s = await setup({ sender: { readBack: false } });
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana" });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.send.state).toBe("unconfirmed");
    expect(r.retry).toBe(true);
    const again = await s.run<LoopResultView>("loop.retry", { sendId: r.send.id });
    expect(again.ok).toBe(false);
    expect(s.calls.posts).toHaveLength(1);
  });
});

describe("IB-4: a send is a touch", () => {
  it("sending on a promise found in a chat marks it touched, so an unconfirmed send never lets it expire", async () => {
    const s = await setup({ promise: { key: "c77", kind: "chatPromise", id: 77 }, sender: { readBack: false } });
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana" });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.send.state).toBe("unconfirmed");
    expect((await s.plan.inboxMarks()).get("c77")?.touchedAt).toBeTruthy();
  });
});

describe("Email", () => {
  it("a draft (the default) leaves the loop open until I sent it", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "email", text: "Hi Dana, the counts match." });
    expect(p.mode).toBe("draft");
    expect(p.final).toBeNull();
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.send.state).toBe("draft");
    expect(r.closed).toBe(false);
    expect(s.calls.sends).toBe(0);
    expect((await s.plan.getFollowUp(s.id))?.closedAt).toBeNull();
    const done = await s.run<LoopResultView>("loop.mark_sent", { key: s.key, sendId: r.send.id });
    expect(done.closed).toBe(true);
    expect(done.send.state).toBe("sent");
    expect((await s.plan.getFollowUp(s.id))?.closeHow).toBe("email");
  });

  it("Send now sends from my mailbox and closes the loop after reading it back from Sent Items", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "email", emailMode: "send", text: "Hi Dana" });
    expect(p.final).toMatch(/can't be undone/);
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(s.calls.sends).toBe(1);
    expect(r).toMatchObject({ ok: true, closed: true });
    expect(r.send.state).toBe("sent");
  });

  it("Send now that Sent Items doesn't show yet stays open, and isn't sent twice", async () => {
    const s = await setup({ sender: { mailSent: false } });
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "email", emailMode: "send", text: "Hi Dana" });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r).toMatchObject({ ok: false, closed: false, retry: true });
    await s.run<LoopResultView>("loop.retry", { sendId: r.send.id });
    expect(s.calls.sends).toBe(1);
  });
});

describe("after a confirmed send", () => {
  it("Mark this promise kept (on by default) closes it, and Undo opens it again", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana" });
    expect(p.kept).toBe(true);
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.parts).toContainEqual({ kind: "kept", ok: true, message: "Promise kept" });
    await s.run("loop.undo_kept", { sendId: r.send.id });
    expect((await s.plan.getFollowUp(s.id))?.closedAt).toBeNull();
    expect((await s.plan.loopSend(r.send.id))?.state).toBe("sent");
  });

  it("with kept off the message is sent and the promise stays open", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana, halfway there", kept: false });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.closed).toBe(false);
    expect((await s.plan.getFollowUp(s.id))?.closedAt).toBeNull();
  });

  it("the comment (off by default) runs the DevOps comment write from its own preview, after the send", async () => {
    const s = await setup();
    const plain = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana" });
    expect(plain.devops).toEqual([]);
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana", comment: true, state: "Resolved" });
    expect(p.devops.map((d) => d.kind)).toEqual(["comment", "state"]);
    const previewCall = s.calls.devops.find((c) => c.action === "devops.preview" && (c.input as { changes?: unknown[] }).changes);
    expect((previewCall!.input as { changes: { kind: string; mention?: string }[] }).changes).toEqual([
      { kind: "comment", itemId: 4417, key: "comment", text: "Hi Dana", mention: "dana@fabrikam.example" },
      { kind: "state", itemId: 4417, key: "state", state: "Resolved" },
    ]);
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.parts.map((x) => [x.kind, x.ok])).toEqual([["kept", true], ["comment", true], ["state", true]]);
    expect(s.calls.devops.filter((c) => c.action === "devops.confirm")).toHaveLength(2);
  });

  it("partial success says exactly what landed", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "teams", text: "Hi Dana", comment: true });
    s.ctx.devops = async (action) => (action === "devops.confirm" ? { ok: false, status: 409, error: "#4417 changed in DevOps since the preview" } : { ok: true, data: {} });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Posted in Contoso project chat. The comment didn't land: #4417 changed in DevOps since the preview.");
  });
});

describe("Comment and Call", () => {
  it("the Comment channel is the DevOps comment write (with an @mention when they're on the item)", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "devops", text: "Counts match." });
    expect(p.audienceNote).toMatch(/can include people outside Cooptimize/);
    const call = s.calls.devops.find((c) => c.action === "devops.preview");
    expect(call?.input).toEqual({ clientKey: "fabrikam", change: { kind: "comment", itemId: 4417, text: "Counts match.", mention: "dana@fabrikam.example" } });
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.send).toMatchObject({ channel: "devops", state: "sent" });
    expect(r.closed).toBe(true);
  });

  it("Call sends nothing: the note of what was agreed closes the loop", async () => {
    const s = await setup();
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "call", text: "Agreed the counts match; Dana signs off Monday." });
    expect(p.call).toBe("https://teams.microsoft.com/l/call/0/0?users=dana%40fabrikam.example");
    const r = await s.run<LoopResultView>("loop.send", { previewId: p.previewId });
    expect(r.send).toMatchObject({ channel: "call", mode: "note", state: "sent" });
    expect(s.calls.posts).toHaveLength(0);
    expect((await s.plan.getFollowUp(s.id))?.closeHow).toBe("call");
  });
});

describe("a missing permission", () => {
  it("falls back to the prefilled deep link, and Mark sent closes the loop", async () => {
    const s = await setup({ access: "consent" });
    const p = await s.run<LoopPreviewView>("loop.preview", { key: s.key, channel: "email", text: "Hi Dana" });
    expect(p.fallback?.label).toBe("Open in Outlook");
    expect(p.fallback?.open).toMatch(/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?to=dana%40fabrikam\.example/);
    expect(p.fallback?.note).toMatch(/needs an admin to approve access/);
    expect(p.fallback?.consent).toBe("mail_draft");
    const r = await s.run<LoopResultView>("loop.mark_sent", { key: s.key, channel: "email", text: "Hi Dana" });
    expect(r.closed).toBe(true);
    expect(r.send).toMatchObject({ mode: "link", state: "marked" });
    expect(s.calls.drafts).toBe(0);
  });
});

describe("the assistant and the command menu", () => {
  it("loop.find opens the draft (an address) and never sends", async () => {
    const s = await setup();
    const r = await s.run<{ matches: { key: string; href: string }[] }>("loop.find", { who: "Dana", about: "the Salesforce rerun counts" });
    expect(r.matches[0]).toMatchObject({ key: s.key, href: `#/inbox/item/${s.key}/loop` });
    expect(s.calls.posts).toHaveLength(0);
    expect(await s.plan.loopSends(null)).toHaveLength(0);
  });
});
