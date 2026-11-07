// TB-1: the bot's core with fake Teams activities, a fake assistant on AS-1's interface, a fake sender and the real
// store (SQLite and SQL Server): who may talk to it, the quick commands without AI, a proposal card's Confirm running
// once however often it is tapped, Cancel, Expired, a changed preview, a slow confirm, and the immediate answer with
// the follow-up when a turn takes a while.
import { expect, it } from "vitest";
import { addUsers, forEachDriver } from "../../test/db.ts";
import type { LogRecord } from "../../log/logger.ts";
import { createTeamsBotStore } from "../../store/teams-bot-store.ts";
import type { NowStrip } from "../../plan/now.ts";
import type { AssistantService, ConfirmResult, HandleResult, Proposal } from "./assistant.ts";
import { createBotCore, NOT_READY, ON_IT, type BotDeps, type InActivity, type OutActivity, type Sender } from "./bot.ts";
import { ONLY_PERSONAL, REFUSED } from "./gate.ts";
import type { TodayFacts } from "./quick.ts";

const TENANT = "abf29d42-0000-0000-0000-000000000001";
const URL_ = "https://ft-dev-app.example.azurecontainerapps.io";
const ANA = "aaaaaaaa-0000-0000-0000-00000000000a";
const GUEST = "bbbbbbbb-0000-0000-0000-00000000000b";
const BOT = "cccccccc-0000-0000-0000-00000000000c";
const NEWBIE = "dddddddd-0000-0000-0000-00000000000d";
const SECRET_TEXT = "move my dentist appointment please";

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
};
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function strip(o: Partial<NowStrip> = {}): NowStrip {
  return { kind: "slot", half: "AM", title: "Northwind until 12:00", until: "12:00", untilMinutes: 90, event: { title: "Standup", at: "10:30", minutes: 20, now: false }, picks: { done: 1, total: 3 }, draft: false, overBy: null, nextPick: "Fix the login timeout", flex: false, next: null, ...o };
}
const facts = (): TodayFacts => ({ date: "2026-11-05", strip: strip(), committed: true, blocks: [{ half: "AM", client: "Northwind", start: "08:00", end: "12:00", picks: [{ title: "Fix the login timeout", done: false }, { title: "Review the export", done: true }] }] });
const proposal = (id: string, o: Partial<Proposal> = {}): Proposal => ({ id, title: "Move #4211 to Thursday", whoSees: "Everyone on Northwind's DevOps project", changes: [{ field: "Target date", before: "Nov 5", after: "Nov 6" }], expiresAt: "2026-11-05T15:15:00Z", ...o });
const handled = (o: Partial<HandleResult> = {}): HandleResult => ({ turnId: "t1", status: "ok", reply: "", cards: [], proposals: [], links: [], ...o });

async function setup(d: { open: () => Promise<{ conn: import("../../store/sql/conn.ts").Conn }> }, o: { assistant?: Partial<AssistantService> | null; confirmWaitMs?: number; ackAfterMs?: number; rhythm?: BotDeps["rhythm"] } = {}) {
  const db = await d.open();
  await addUsers(db.conn, ANA, GUEST, BOT);
  let now = Temporal.Instant.from("2026-11-05T15:00:00Z");
  const sent: { to: string; a: OutActivity }[] = [];
  const updates: { id: string; a: OutActivity }[] = [];
  const pending: Promise<void>[] = [];
  const logs: LogRecord[] = [];
  const calls = { handle: [] as string[], confirm: [] as string[], cancel: [] as string[], today: 0 };
  let n = 0;
  const sender: Sender = {
    send: async (to, a) => (sent.push({ to: to.conversationId, a }), { id: `msg-${++n}` }),
    update: async (_to, id, a) => void updates.push({ id, a }),
  };
  const assistant: AssistantService | null =
    o.assistant === null
      ? null
      : {
          handle: async (i) => (calls.handle.push(i.text), handled()),
          confirm: async (i): Promise<ConfirmResult> => (calls.confirm.push(i.proposalId), { status: "ok", message: "Target date is Nov 6 now." }),
          cancel: async (i) => void calls.cancel.push(i.proposalId),
          propose: async () => ({ ok: false, message: "Not in this test" }),
          ...o.assistant,
        };
  const users = new Map([
    [ANA, { id: ANA, upn: "ana@cooptimize.example", email: "ana@cooptimize.example", deletedAt: null }],
    [GUEST, { id: GUEST, upn: "pat_contoso.com#EXT#@cooptimize.example", email: "pat@contoso.com", deletedAt: null }],
    [BOT, { id: BOT, upn: "build-bot@cooptimize.example", email: "build-bot@cooptimize.example", deletedAt: null }],
  ]);
  const core = createBotCore({
    publicUrl: URL_,
    gate: { tenantId: TENANT, user: async (oid) => users.get(oid) ?? null, isCooptimizer: async (oid) => oid === ANA },
    assistant,
    today: async () => (calls.today++, facts()),
    store: (userId) => createTeamsBotStore({ db: db.conn, userId, now: () => now }),
    sender,
    log: (r) => logs.push({ source: "server", ...r }),
    now: () => now,
    ackAfterMs: o.ackAfterMs ?? 1000,
    confirmWaitMs: o.confirmWaitMs ?? 1000,
    background: (p) => void pending.push(p),
    rhythm: o.rhythm ?? null,
  });
  let id = 0;
  const msg = (text: string, o2: Partial<InActivity> = {}): InActivity => ({
    id: `in-${++id}`,
    type: "message",
    text,
    channelId: "msteams",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    conversation: { id: "a:ana-1", conversationType: "personal", tenantId: TENANT },
    from: { aadObjectId: ANA },
    recipient: { id: "28:bot" },
    ...o2,
  });
  const tapAct = (verb: "confirm" | "cancel", proposalId: string, replyToId = "msg-1"): InActivity => ({ ...msg(""), type: "invoke", name: "adaptiveCard/action", replyToId, value: { action: { type: "Action.Execute", verb, data: { ft: verb, proposalId } }, trigger: "manual" } });
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  const texts = () => sent.filter((s) => s.a.type === "message").map((s) => ("text" in s.a ? s.a.text : undefined) ?? (("attachments" in s.a ? JSON.stringify(s.a.attachments) : "")));
  return { db, core, sent, updates, logs, calls, msg, tapAct, settle, texts, store: createTeamsBotStore({ db: db.conn, userId: ANA, now: () => now }), advance: (m: number) => (now = now.add({ minutes: m })) };
}

const cardOf = (r: { value: unknown } | null) => JSON.stringify((r as { value: unknown }).value);

await forEachDriver("the Teams bot (TB-1)", (d) => {
  it("answers a Cooptimizer, and refuses guests, automation accounts, other tenants and group chats with one line", async () => {
    const t = await setup(d);
    expect(await t.core.activity(t.msg("hello there"))).toBeNull();
    await t.settle();
    expect(t.calls.handle).toEqual(["hello there"]);

    const before = t.sent.length;
    await t.core.activity(t.msg("hi", { from: { aadObjectId: GUEST } }));
    await t.core.activity(t.msg("hi", { from: { aadObjectId: BOT } }));
    await t.core.activity(t.msg("hi", { conversation: { id: "a:x", conversationType: "personal", tenantId: "99999999-0000-0000-0000-000000000000" } }));
    await t.core.activity(t.msg("hi", { conversation: { id: "19:group", conversationType: "groupChat", tenantId: TENANT } }));
    await t.core.activity(t.msg("hi", { conversation: { id: "19:chan", conversationType: "channel", tenantId: TENANT } }));
    await t.core.activity(t.msg("hi", { from: { aadObjectId: NEWBIE } }));
    await t.settle();
    const lines = t.sent.slice(before).map((s) => ("text" in s.a ? s.a.text : null));
    expect(lines).toEqual([REFUSED, REFUSED, REFUSED, ONLY_PERSONAL, ONLY_PERSONAL, `Sign in to FocusTime once at ${URL_}, then message me again.`]);
    expect(t.calls.handle).toEqual(["hello there"]);
    expect(await createTeamsBotStore({ db: t.db.conn, userId: GUEST, now: () => Temporal.Now.instant() }).chat()).toBeNull();
  });

  it("keeps where the 1:1 chat is from the first message, and marks it removed on uninstall", async () => {
    const t = await setup(d);
    await t.core.activity(t.msg("help"));
    await t.settle();
    expect(await t.store.chat()).toMatchObject({ conversationId: "a:ana-1", serviceUrl: "https://smba.trafficmanager.net/amer/", tenantId: TENANT, removedAt: null });
    await t.core.activity({ ...t.msg(""), type: "installationUpdate", action: "remove" });
    expect((await t.store.chat())?.removedAt).not.toBeNull();
  });

  it("answers a message once when another replica already took it, and forgets the ids after a day (TB-1b)", async () => {
    const t = await setup(d);
    const a = t.msg("hello from Teams");
    // Another replica handled this delivery first: its unique insert won.
    expect(await t.store.firstSeen(a.id!)).toBe(true);
    await t.core.activity(a);
    await t.settle();
    expect(t.calls.handle).toEqual([]);
    expect(t.logs.some((l) => l.op === "activity" && l.kind === "duplicate")).toBe(true);
    const b = t.msg("and this one");
    await t.core.activity(b);
    await t.settle();
    expect(t.calls.handle).toEqual(["and this one"]);
    expect(await t.store.firstSeen(b.id!)).toBe(false);
    const rows = Number((await t.db.conn.get("SELECT COUNT(*) AS n FROM teams_bot_seen"))!.n);
    expect(rows).toBe(2);
    t.advance(25 * 60);
    expect(await t.store.firstSeen("in-new")).toBe(true);
    expect(Number((await t.db.conn.get("SELECT COUNT(*) AS n FROM teams_bot_seen"))!.n)).toBe(1);
    expect(JSON.stringify(await t.db.conn.all("SELECT * FROM teams_bot_seen"))).not.toContain("in-new");
  });

  it("answers one person's messages in the order they were sent, even when the first takes longer", async () => {
    const t = await setup(d, {
      assistant: { handle: async (i) => (t.calls.handle.push(i.text), await new Promise((r) => setTimeout(r, i.text === "slow one" ? 150 : 0)), { ...handled(), reply: `about ${i.text}` }) },
    });
    await t.core.activity(t.msg("slow one"));
    await t.core.activity(t.msg("fast one"));
    await t.settle();
    expect(t.texts().filter((x) => x?.startsWith("about "))).toEqual(["about slow one", "about fast one"]);
  });

  it("TB-2: capture: goes to Captures with no AI, a reply to an open Close out card goes there, other text to the assistant", async () => {
    const got: string[] = [];
    let closeoutOpen = true;
    const rhythm: NonNullable<BotDeps["rhythm"]> = {
      tapOf: () => null,
      tap: async () => ({ statusCode: 200, type: "application/vnd.microsoft.card.adaptive", value: {} }) as never,
      capture: async (_u, text) => (got.push(`capture:${text}`), { card: { type: "AdaptiveCard", body: [{ type: "TextBlock", text: "Captured to sort later" }] } as never }),
      closeoutReply: async (_u, text) => (closeoutOpen ? (got.push(`closeout:${text}`), (closeoutOpen = false), "Updated the Close out card above. Check it and Confirm.") : null),
    };
    const t = await setup(d, { rhythm });
    await t.core.activity(t.msg("capture: call Dana about the export"));
    await t.core.activity(t.msg("C: ship it"));
    await t.core.activity(t.msg("the login fix and the notes"));
    await t.core.activity(t.msg("what's on my plate tomorrow"));
    await t.settle();
    expect(got).toEqual(["capture:call Dana about the export", "capture:ship it", "closeout:the login fix and the notes"]);
    expect(t.calls.handle).toEqual(["what's on my plate tomorrow"]);
    expect(t.texts().join(" ")).toContain("Captured to sort later");
    expect(JSON.stringify(t.logs)).not.toContain("Dana");
  });

  it("answers the quick commands without the assistant", async () => {
    const t = await setup(d, { assistant: null });
    for (const q of ["What's next?", "today", "help", "Open FocusTime", "move my 2pm"]) await t.core.activity(t.msg(q));
    await t.settle();
    const out = t.texts();
    expect(out[0]).toContain("Next to-do: Fix the login timeout");
    expect(out[0]).toContain("Next meeting: Standup at 10:30");
    expect(out[1]).toContain("Morning 08:00–12:00: Northwind");
    expect(out[1]).toContain("✓ Review the export");
    expect(out[2]).toContain("what's next");
    expect(out[3]).toContain(URL_);
    expect(out[4]).toBe(NOT_READY);
    expect(t.calls.today).toBe(2);
    // A typing indicator before every answer.
    expect(t.sent.filter((s) => s.a.type === "typing").length).toBe(5);
  });

  it("says what the assistant says when AI is off, for FocusTime or a client", async () => {
    const t = await setup(d, { assistant: { handle: async () => handled({ status: "client_off", reply: "AI is off for Northwind. Ask a FocusTime admin to allow it." }) } });
    await t.core.activity(t.msg("break down the export feature"));
    await t.settle();
    expect(t.texts().at(-1)).toBe("AI is off for Northwind. Ask a FocusTime admin to allow it.");
  });

  it("sends a proposal as a preview card; Confirm runs once however often it's tapped, and the card shows Done", async () => {
    const t = await setup(d, { assistant: { handle: async () => handled({ reply: "Here's the change:", proposals: [proposal("p-1")] }) } });
    await t.core.activity(t.msg("move 4211 to thursday"));
    await t.settle();
    const card = t.texts().at(-1)!;
    expect(card).toContain("Who sees it: Everyone on Northwind's DevOps project");
    expect(card).toContain("Nov 5 → Nov 6");
    expect(card).toContain('"verb":"confirm"');
    expect(card).toContain('"type":"Action.Submit"');
    expect((await t.store.card("p-1"))?.state).toBe("open");

    // A double tap (both at once) and a third tap later.
    const [a, b] = await Promise.all([t.core.activity(t.tapAct("confirm", "p-1")), t.core.activity(t.tapAct("confirm", "p-1"))]);
    const c = await t.core.activity(t.tapAct("confirm", "p-1"));
    expect(t.calls.confirm).toEqual(["p-1"]);
    const shown = [a, b, c].map(cardOf);
    expect(shown.filter((x) => x.includes("Done: Move #4211 to Thursday")).length).toBeGreaterThanOrEqual(2);
    expect(shown.every((x) => x.includes("Done:") || x.includes("Working on it"))).toBe(true);
    expect(cardOf(c)).toContain("Target date is Nov 6 now.");
    expect((await t.store.card("p-1"))?.state).toBe("done");
  });

  it("AS-2: a question's choices are buttons; a tap answers it once, with the choice as the answer, and the reply follows", async () => {
    const asked: { text: string; answer?: string }[] = [];
    const t = await setup(d, {
      assistant: {
        handle: async (i) => (asked.push({ text: i.text, ...(i.answer ? { answer: i.answer } : {}) }), i.answer ? handled({ reply: "Here's the move:", proposals: [proposal("p-9", { title: "Move 1 to-do to Fri, Nov 6" })] }) : handled({ turnId: "41", reply: "", question: { text: "Which to-dos on Thu, Nov 5?", choices: [{ label: "Thu, Nov 5 AM · Fabrikam · 1 to-do", value: "b1" }, { label: "All 2", value: "all" }], expiresAt: "2026-11-05T15:10:00Z" } })),
      },
    });
    await t.core.activity(t.msg("move some of today's to-dos to friday"));
    await t.settle();
    const q = t.texts().at(-1)!;
    expect(q).toContain("Which to-dos on Thu, Nov 5?");
    expect(q).toContain('"verb":"answer"');
    expect(q).toContain("All 2");
    const row = (await t.store.card("q41"))!;
    expect(row.state).toBe("open");
    const tap = (): InActivity => ({ ...t.msg(""), type: "invoke", name: "adaptiveCard/action", replyToId: "msg-1", value: { action: { type: "Action.Execute", verb: "answer", data: { ft: "answer", questionId: "q41", value: "all", label: "All 2" } }, trigger: "manual" } });
    const [a, b] = await Promise.all([t.core.activity(tap()), t.core.activity(tap())]);
    await t.settle();
    const shown = [a, b].map(cardOf);
    expect(shown.some((x) => x.includes("You chose: All 2"))).toBe(true);
    expect(shown.every((x) => x.includes("You chose: All 2") || x.includes("Working on it"))).toBe(true);
    expect(cardOf(await t.core.activity(tap()))).toContain("You chose: All 2");
    expect(asked).toEqual([{ text: "move some of today's to-dos to friday" }, { text: "All 2", answer: "all" }]);
    expect(t.texts().at(-1)).toContain("Move 1 to-do to Fri, Nov 6");
    // A forged choice (not one of ours) is refused before the assistant sees it.
    const bad = await t.core.activity({ ...tap(), value: { action: { verb: "answer", data: { ft: "answer", questionId: "q41", value: "DROP TABLE", label: "x" } } } });
    expect(cardOf(bad)).not.toContain("You chose");
  });

  it("AS-2: a multi-to-do move confirms once on a double tap, and its Undo runs once", async () => {
    const undos: string[] = [];
    const t = await setup(d, {
      assistant: {
        handle: async () => handled({ reply: "Here's the move:", proposals: [proposal("12", { title: "Move 2 to-dos to Fri, Nov 6", whoSees: "Only you", changes: [{ field: "Fabrikam · Export spec", before: "Thu morning", after: "Fri morning" }, { field: "Northwind Traders · Ledger review", before: "Thu afternoon", after: "Fri morning" }] })] }),
        confirm: async (i): Promise<ConfirmResult> => (t.calls.confirm.push(i.proposalId), { status: "ok", message: "Moved 2 to-dos.", undo: { label: "Undo", proposalId: "12" } }),
        undo: async (i) => (undos.push(i.proposalId), { ok: true, message: "Put 2 to-dos back." }),
      },
    });
    await t.core.activity(t.msg("push everything from today to tomorrow"));
    await t.settle();
    expect(t.texts().at(-1)).toContain("Northwind Traders · Ledger review");
    const [a, b] = await Promise.all([t.core.activity(t.tapAct("confirm", "12")), t.core.activity(t.tapAct("confirm", "12"))]);
    expect(t.calls.confirm).toEqual(["12"]);
    const done = [a, b].map(cardOf).find((x) => x.includes("Moved 2 to-dos."))!;
    expect(done).toContain('"verb":"undo"');
    const undoTap = (): InActivity => ({ ...t.tapAct("confirm", "12"), value: { action: { type: "Action.Execute", verb: "undo", data: { ft: "undo", proposalId: "12" } }, trigger: "manual" } });
    const [u1, u2] = await Promise.all([t.core.activity(undoTap()), t.core.activity(undoTap())]);
    const u3 = await t.core.activity(undoTap());
    expect(undos).toEqual(["12"]);
    expect(cardOf(u3)).toContain("Put 2 to-dos back.");
    expect([u1, u2].map(cardOf).some((x) => x.includes("Undone: Move 2 to-dos"))).toBe(true);
  });

  it("Cancel cancels once and nothing is confirmed; a tap after 15 minutes shows Expired", async () => {
    const t = await setup(d, { assistant: { handle: async () => handled({ proposals: [proposal("p-2"), proposal("p-3", { title: "Assign #77 to me" })] }) } });
    await t.core.activity(t.msg("do the things"));
    await t.settle();
    expect(cardOf(await t.core.activity(t.tapAct("cancel", "p-2")))).toContain("Cancelled: Move #4211 to Thursday");
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-2")))).toContain("Cancelled");
    t.advance(16);
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-3")))).toContain("Expired: Assign #77 to me");
    expect(t.calls.cancel).toEqual(["p-2"]);
    expect(t.calls.confirm).toEqual([]);
  });

  it("replaces the card with the new preview when things changed, and the new one confirms", async () => {
    let first = true;
    const t = await setup(d, {
      assistant: {
        handle: async () => handled({ proposals: [proposal("p-4")] }),
        confirm: async (i) => {
          if (first) return (first = false), { status: "changed", message: "Someone changed the target date since. Here's the new preview.", proposal: proposal("p-5", { changes: [{ field: "Target date", before: "Nov 7", after: "Nov 6" }] }) };
          return { status: "ok", message: `Done ${i.proposalId}` };
        },
      },
    });
    await t.core.activity(t.msg("move it"));
    await t.settle();
    const again = cardOf(await t.core.activity(t.tapAct("confirm", "p-4")));
    expect(again).toContain("Someone changed the target date since");
    expect(again).toContain("Nov 7 → Nov 6");
    expect(again).toContain('"proposalId":"p-5"');
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-5")))).toContain("Done p-5");
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-4")))).toContain("Nov 7 → Nov 6");
  });

  it("not_allowed and gone show why; a tap on a card it doesn't know says so", async () => {
    const t = await setup(d, { assistant: { handle: async () => handled({ proposals: [proposal("p-6")] }), confirm: async () => ({ status: "not_allowed", message: "Only the feature's owner can move its dates." }) } });
    await t.core.activity(t.msg("move it"));
    await t.settle();
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-6")))).toContain("Only the feature's owner can move its dates.");
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-nope")))).toContain("doesn't know this card");
  });

  it("a slow confirm answers Working on it, then updates the card", async () => {
    const gate = deferred<ConfirmResult>();
    const t = await setup(d, { confirmWaitMs: 20, assistant: { handle: async () => handled({ proposals: [proposal("p-7")] }), confirm: () => gate.promise } });
    await t.core.activity(t.msg("move it"));
    await t.settle();
    const cardMsg = t.sent.filter((s) => s.a.type === "message").length;
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-7", `msg-${cardMsg}`)))).toContain("Working on it");
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-7")))).toContain("Working on it");
    gate.resolve({ status: "ok", message: "Moved." });
    await t.settle();
    expect(t.updates.length).toBe(1);
    expect(JSON.stringify(t.updates[0]!.a)).toContain("Done: Move #4211 to Thursday");
    expect(cardOf(await t.core.activity(t.tapAct("confirm", "p-7")))).toContain("Moved.");
  });

  it("answers at once, shows typing, says On it when the assistant is slow, then replies; a redelivered activity is handled once", async () => {
    const gate = deferred<HandleResult>();
    const t = await setup(d, { ackAfterMs: 15, assistant: { handle: async (i) => (t.calls.handle.push(i.text), gate.promise) } });
    const a = t.msg(SECRET_TEXT);
    const started = Date.now();
    expect(await t.core.activity(a)).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
    expect(await t.core.activity(a)).toBeNull();
    // The turn runs after the 200 (the chat and seen writes, then typing, then On it after ackAfterMs): wait for it,
    // up to 2 s on a loaded SQL Server, while the assistant still hasn't answered.
    for (let i = 0; i < 200 && !t.texts().length; i++) await wait(10);
    expect(t.sent[0]!.a.type).toBe("typing");
    expect(t.texts()).toEqual([ON_IT]);
    gate.resolve(handled({ reply: "Moved your dentist block to 3:00." }));
    await t.settle();
    expect(t.texts()).toEqual([ON_IT, "Moved your dentist block to 3:00."]);
    expect(t.calls.handle).toEqual([SECRET_TEXT]);
    expect(JSON.stringify(t.logs)).not.toContain(SECRET_TEXT);
    expect(JSON.stringify(t.logs)).not.toContain("dentist");
  });
});
