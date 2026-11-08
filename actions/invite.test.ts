// IN-1: Who's set up and Invite to FocusTime, through the admin actions. Cooptimizers only (never a guest, someone
// outside the Cooptimize domains or an automation account); yes or no marks for signed in, partly set up and never
// signed in; no PAT value, scope, expiry or the client a PAT is for anywhere in what the API returns; non-admins get
// 403; an invite records only who, when and how, and the same person can be invited again.
import { describe, expect, it } from "vitest";
import { sqliteDb } from "../test/db.ts";
import { aDirectoryPerson } from "../test/builders/index.ts";
import { createAccountStore } from "../store/accounts.ts";
import { createAdminStore } from "../store/admin-store.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { createAdminOps } from "../server/admin-ops.ts";
import { createAdminCheck } from "./admin.ts";
import { adminAction, type AdminContext } from "./admin-actions.ts";
import { createOrgRuntime } from "./org.ts";
import type { SetupRow } from "../plan/invite.ts";
import { forgetInviteSends, type InviteSendPort } from "./invite-send.ts";
import { SendFailure, type SendClient } from "../sources/graph/send.ts";

const NOW = "2026-11-06T15:00:00Z";
const ADA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const PAT_VALUE = "PRIVATE-PAT-VALUE-abc123";
// A client only a PAT names (nobody works there in Dataverse): it must never show up.
const PAT_CLIENT = "Fabrikam PAT Only";
const TEAMS_APP = "https://teams.microsoft.com/l/app/6f84bb2c-364d-4d76-8a62-153904d0551a";

type Setup = { people: SetupRow[]; counts: { text: string }; teamsKnown: boolean; invite: { appUrl: string; teamsAppLink: string | null; subject: string; template: string } | null };

async function setup(o: { teams?: boolean; send?: InviteSendPort } = {}) {
  const db = sqliteDb().conn;
  let now = Temporal.Instant.from(NOW);
  const clock = () => now;
  const accounts = createAccountStore(db, clock);
  await accounts.users.signedIn({ id: ADA, tenantId: "t", upn: "ada@cooptimize.example", displayName: "Ada Admin", email: "ada@cooptimize.example" });
  await accounts.users.signedIn({ id: BEN, tenantId: "t", upn: "ben@cooptimize.example", displayName: "Ben Person", email: "ben@cooptimize.example" });
  const store = createAdminStore(db, clock);
  const ada = aDirectoryPerson({ personId: ADA, name: "Ada Admin", email: "ada@cooptimize.example" });
  const ben = aDirectoryPerson({ personId: BEN, name: "Ben Person", email: "ben@cooptimize.example" });
  const cy = aDirectoryPerson({ name: "Cy Person", email: "cy@cooptimize.example" });
  const dee = aDirectoryPerson({ name: "Dee Person", email: "dee@cooptimize.example" });
  const gus = aDirectoryPerson({ name: "Gus Guest", email: "gus@partner.example", guest: true });
  const oz = aDirectoryPerson({ name: "Oz Outside", email: "oz@elsewhere.example" });
  const bot = aDirectoryPerson({ name: "Build Bot", email: "build.bot@cooptimize.example" });
  await store.replaceDirectory([ada, ben, cy, dee, gus, oz, bot], [], [{ personId: BEN, clientKey: "Adatum", worker: true }]);
  const org = createOrgRuntime({
    store,
    bootstrap: { model: "m", appCapUsd: 100, inviteDomains: ["cooptimize.example"], feedback: null },
    holdMs: 0,
    signedIn: async () => (await accounts.users.all()).map((u) => ({ id: u.id, email: u.email, upn: u.upn })),
  });
  // Ada: Outlook and a write PAT (for a client only her PAT names) and the Teams app. Ben: Outlook only.
  const secrets = new Map<string, string>([
    [`${ADA}|outlook-refresh-token`, "rt"],
    [`${ADA}|devops-write-pat:${PAT_CLIENT}`, PAT_VALUE],
    [`${BEN}|outlook-refresh-token`, "rt"],
  ]);
  const teams = createTeamsStore(db, clock);
  const ops = createAdminOps({
    check: createAdminCheck({ groupId: null, breakGlass: [ADA], graph: async () => null, now: Date.now }),
    org,
    groupId: null,
    breakGlass: [ADA],
    tenantId: "t",
    users: () => accounts.users.all(),
    personStore: (id) => ({ setupState: async () => ({}), devopsIdentities: async () => (id === ADA ? [{ clientKey: PAT_CLIENT }] : []) }),
    hasSecret: async (id, account) => secrets.has(`${id}|${account}`),
    teamsApp: o.teams ? async (id) => id === ADA : null,
    lastSeen: () => accounts.sessions.lastSeenByUser(),
    invite: { appUrl: "https://focustime-dev.example.com/", teamsAppLink: o.teams ? TEAMS_APP : null },
    chats: () => teams.chats(),
    ai: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    feedback: async () => null,
    build: { env: "dev", sha: "abc", pr: "", builtAt: null },
    directory: null,
    removePerson: async () => {},
    log: () => {},
  });
  const admin: AdminContext = { ops, me: async () => ({ id: ADA, name: "Ada Admin" }), zone: async () => "America/New_York", ...(o.send ? { send: o.send } : {}) };
  const benCtx: AdminContext = { ops, me: async () => ({ id: BEN, name: "Ben Person" }) };
  // Flag the bot as an automation account, the existing Rule.
  expect((await adminAction(admin, "admin.set", { scope: `person:${bot.personId}`, key: "automation", value: true })).ok).toBe(true);
  const raw = async (ctx: AdminContext = admin) => adminAction(ctx, "admin.load", { section: "setup" });
  const load = async () => ((await raw()) as { data: Setup }).data;
  return { db, accounts, store, admin, ops, ben: benCtx, raw, load, cy, dee, gus, oz, bot, advance: (h: number) => void (now = now.add({ hours: h })) };
}

const byName = (d: Setup) => Object.fromEntries(d.people.map((p) => [p.name, p]));

describe("Who's set up", () => {
  it("lists Cooptimizers only: never a guest, someone outside the domains or an automation account", async () => {
    const s = await setup();
    const names = (await s.load()).people.map((p) => p.name).sort();
    // Dataverse users with no email are outside the domains too (the existing rule), so every Cooptimizer has an address.
    expect(names).toEqual(["Ada Admin", "Ben Person", "Cy Person", "Dee Person"]);
  });

  it("marks signed in, partly set up and never signed in as yes or no, with plain counts", async () => {
    const s = await setup();
    const d = await s.load();
    const p = byName(d);
    expect(p["Ada Admin"]).toMatchObject({ signedIn: true, devops: true, calendar: true, teams: null, lastActiveDay: "2026-11-06", me: true, invited: null });
    expect(p["Ben Person"]).toMatchObject({ signedIn: true, devops: false, calendar: true, teams: null });
    expect(p["Cy Person"]).toMatchObject({ signedIn: false, devops: false, calendar: false, teams: null, lastActiveDay: null });
    expect(d.counts.text).toBe("2 of 4 signed in · 1 set up partly");
    // Teams isn't known here, so the column is left out and the invite has no Teams app link.
    expect(d.teamsKnown).toBe(false);
    expect(d.invite?.template).toContain("Open it here: https://focustime-dev.example.com/");
    expect(d.invite?.template).not.toContain("teams.microsoft.com");
  });

  it("with the Teams app set up: the Teams mark from its 1:1 chat, and the app's link in the message", async () => {
    const s = await setup({ teams: true });
    const d = await s.load();
    expect(d.teamsKnown).toBe(true);
    expect(byName(d)["Ada Admin"]!.teams).toBe(true);
    expect(byName(d)["Ben Person"]!.teams).toBe(false);
    expect(byName(d)["Cy Person"]!.teams).toBe(false);
    expect(d.counts.text).toBe("2 of 4 signed in · 1 set up partly");
    expect(d.invite?.template).toContain(TEAMS_APP);
  });

  it("last active is a day: the latest request in a live session, never a time", async () => {
    const s = await setup();
    await s.accounts.sessions.create(ADA);
    s.advance(30); // the next day in New York
    const { cookie } = await s.accounts.sessions.create(ADA);
    await s.accounts.sessions.resolve(cookie);
    expect(byName(await s.load())["Ada Admin"]!.lastActiveDay).toBe("2026-11-07");
  });

  it("no PAT value, scope, expiry or the client a PAT is for, in Who's set up or Admin › People", async () => {
    const s = await setup();
    for (const section of ["setup", "people"]) {
      const json = JSON.stringify(await adminAction(s.admin, "admin.load", { section }));
      expect(json).not.toContain(PAT_VALUE);
      expect(json).not.toContain(PAT_CLIENT);
      expect(json).not.toMatch(/devops-write-pat|expir|scope/i);
    }
  });

  it("non-admins get 403 from Who's set up and from recording an invite", async () => {
    const s = await setup();
    expect(await s.raw(s.ben)).toMatchObject({ ok: false, status: 403, code: "admin" });
    expect(await adminAction(s.ben, "admin.load", { section: "people" })).toMatchObject({ ok: false, status: 403 });
    expect(await adminAction(s.ben, "admin.invited", { personIds: [s.cy.personId], via: "copy" })).toMatchObject({ ok: false, status: 403, code: "admin" });
    expect(byName(await s.load())["Cy Person"]!.invited).toBeNull();
  });
});

describe("Invite", () => {
  it("records Invited <day> by <admin>, audited, and the same person can be invited again", async () => {
    const s = await setup();
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "teams" })).toMatchObject({ ok: true, data: { invited: 1 } });
    expect(byName(await s.load())["Cy Person"]!.invited).toEqual({ day: "2026-11-06", byName: "Ada Admin", via: "teams" });
    s.advance(48);
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId, s.dee.personId], via: "copy" })).toMatchObject({ ok: true, data: { invited: 2 } });
    const p = byName(await s.load());
    expect(p["Cy Person"]!.invited).toEqual({ day: "2026-11-08", byName: "Ada Admin", via: "copy" });
    expect(p["Dee Person"]!.invited).toEqual({ day: "2026-11-08", byName: "Ada Admin", via: "copy" });
    const audit = (await s.store.auditList({ area: "people" })).filter((e) => e.setting === "invite");
    expect(audit.map((e) => [e.actorName, e.target, e.note])).toEqual([
      ["Ada Admin", "Cy Person, Dee Person", "copied, 2 people"],
      ["Ada Admin", "Cy Person", "opened in Teams, 1 person"],
    ]);
  });

  it("refuses someone who signed in, anyone who isn't a Cooptimizer, and bad input", async () => {
    const s = await setup();
    expect(await adminAction(s.admin, "admin.invited", { personIds: [BEN], via: "outlook" })).toMatchObject({ ok: false, status: 409 });
    for (const p of [s.gus, s.oz, s.bot]) expect(await adminAction(s.admin, "admin.invited", { personIds: [p.personId], via: "copy" })).toMatchObject({ ok: false, status: 404 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "graph" })).toMatchObject({ ok: false, status: 400 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [], via: "copy" })).toMatchObject({ ok: false, status: 400 });
    expect(await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "copy", message: "x" })).toMatchObject({ ok: false, status: 400 });
    expect((await s.store.auditList({})).filter((e) => e.setting === "invite")).toEqual([]);
  });

  it("removing a person forgets their invite", async () => {
    const s = await setup();
    await adminAction(s.admin, "admin.invited", { personIds: [s.cy.personId], via: "copy" });
    await s.store.forgetPerson(s.cy.personId);
    expect(byName(await s.load())["Cy Person"]!.invited).toBeNull();
  });
});

// ---- IN-2: sending the invite from FocusTime, through Close the loop's send path (a fake Graph; nothing leaves). ----
type Sent = { chats: string[]; posts: { chatId: string; html: string }[]; drafts: { to: string[]; subject: string; html: string }[]; sends: string[] };
type FakeOpts = { access?: Partial<Record<"send" | "mail" | "mail_send", "granted" | "consent">>; failFor?: Set<string>; postNotShown?: boolean; sendFails?: boolean };
function fakeGraph(o: FakeOpts = {}) {
  const sent: Sent = { chats: [], posts: [], drafts: [], sends: [] };
  const shown = new Set<string>();
  const mail = new Map<string, "draft" | "sent">();
  let n = 1700000000000;
  const fake: SendClient = {
    async oneOnOne(me, them) {
      if (o.failFor?.has(them)) throw new SendFailure("forbidden", "Microsoft refused it");
      sent.chats.push(`${me}>${them}`);
      return `19:${them.replace(/[^a-z]/g, "")}_${me.slice(-4)}@unq.gbl.spaces`;
    },
    async post(chatId, html) {
      const id = String(++n);
      sent.posts.push({ chatId, html });
      if (!o.postNotShown) shown.add(`${chatId}|${id}`);
      return id;
    },
    async readMessage(chatId, id) {
      return { found: shown.has(`${chatId}|${id}`) };
    },
    async draft(m) {
      const to = (Array.isArray(m.to) ? m.to : [m.to]).map((t: { address: string }) => t.address);
      if (to.some((a) => o.failFor?.has(a))) throw new SendFailure("error", "Microsoft answered 500");
      const id = `AAMk${sent.drafts.length + 1}`;
      sent.drafts.push({ to, subject: m.subject, html: m.html });
      mail.set(id, "draft");
      return { id, webLink: `https://outlook.office.com/mail/drafts/${id}` };
    },
    async send(id) {
      if (o.sendFails) throw new SendFailure("throttled", "Microsoft is busy. Try again in a minute");
      sent.sends.push(id);
      mail.set(id, "sent");
    },
    async readMail(id) {
      const s = mail.get(id);
      return s ? { state: s, webLink: `https://outlook.office.com/mail/${id}`, sentAt: s === "sent" ? NOW : null } : { state: "missing", webLink: null, sentAt: null };
    },
  };
  const port: InviteSendPort = { sender: async () => fake, access: async (k) => o.access?.[k] ?? "granted" };
  return { sent, port, opts: o, shown };
}

const MESSAGE = "Hi {first name}, try FocusTime: https://focustime-dev.example.com/";
type Preview = { previewId: string; how: string; recipients: { name: string }[]; messages: { to: string[]; text: string }[]; subject: string | null; note: string; split: string | null };
type Result = { batchId: string; ok: boolean; retry: boolean; invited: number; message: string; items: { names: string[]; ok: boolean; state: string; line: string }[] };

async function sending(o: FakeOpts = {}) {
  forgetInviteSends();
  const g = fakeGraph(o);
  const s = await setup({ send: g.port });
  const preview = async (input: Record<string, unknown>) => adminAction(s.admin, "admin.invite_preview", { message: MESSAGE, ...input });
  const send = async (previewId: string) => (await adminAction(s.admin, "admin.invite_send", { previewId })) as { ok: boolean; data: Result };
  const inviteAudit = async () => (await s.store.auditList({ area: "people" })).filter((e) => e.setting === "invite").map((e) => e.note);
  return { ...s, ...g, preview, send, inviteAudit };
}

describe("IN-2: send the invite from FocusTime", () => {
  it("Teams: previews the recipient, the way and the final text, then sends a 1:1, reads it back, records Invited and audits it", async () => {
    const s = await sending();
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "teams" })) as { ok: boolean; data: Preview };
    expect(p.ok).toBe(true);
    expect(p.data).toMatchObject({ how: "Teams: a 1:1 chat with Cy, as you", recipients: [{ name: "Cy Person" }], messages: [{ to: ["Cy Person"], text: "Hi Cy, try FocusTime: https://focustime-dev.example.com/" }], subject: null });
    expect(p.data.note).toBe("Sent Teams messages and emails can't be undone.");
    // The preview sends nothing.
    expect(s.sent.posts).toEqual([]);
    const r = await s.send(p.data.previewId);
    expect(r.data).toMatchObject({ ok: true, retry: false, invited: 1, message: "Sent in Teams to Cy Person.", items: [{ names: ["Cy Person"], ok: true, state: "sent", line: "Sent in Teams" }] });
    expect(s.sent.chats).toEqual([`${ADA}>cy@cooptimize.example`]);
    expect(s.sent.posts.map((x) => x.html)).toEqual(["Hi Cy, try FocusTime: https://focustime-dev.example.com/"]);
    expect(byName(await s.load())["Cy Person"]!.invited).toEqual({ day: "2026-11-06", byName: "Ada Admin", via: "teams_sent" });
    expect(await s.inviteAudit()).toEqual(["sent in Teams from FocusTime, 1 person: read back"]);
    // A preview is used once.
    expect(await adminAction(s.admin, "admin.invite_send", { previewId: p.data.previewId })).toMatchObject({ ok: false, status: 410 });
    expect(s.sent.posts).toHaveLength(1);
  });

  it("email draft (the default): one Outlook draft, read back as a draft, Invited via Email (Outlook draft)", async () => {
    const s = await sending();
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "Try FocusTime" })) as { data: Preview };
    expect(p.data.how).toBe("Email, an Outlook draft in your mailbox, as you");
    expect(p.data.note).toBe("The draft waits in your Outlook Drafts for you to send.");
    const r = await s.send(p.data.previewId);
    expect(r.data).toMatchObject({ ok: true, invited: 1, message: "Outlook draft for Cy Person. Send it from Outlook.", items: [{ state: "draft", line: "Draft in your Outlook" }] });
    expect(s.sent.drafts).toEqual([{ to: ["cy@cooptimize.example"], subject: "Try FocusTime", html: "Hi Cy, try FocusTime: https://focustime-dev.example.com/" }]);
    expect(s.sent.sends).toEqual([]);
    expect(byName(await s.load())["Cy Person"]!.invited?.via).toBe("email_draft");
    expect(await s.inviteAudit()).toEqual(["saved as an Outlook draft from FocusTime, 1 person: read back"]);
  });

  it("email sent now: the draft, then sent, then read back from Sent Items", async () => {
    const s = await sending();
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "email", mode: "send", subject: "Try FocusTime" })) as { data: Preview };
    expect(p.data.how).toBe("Email, sent now, as you");
    const r = await s.send(p.data.previewId);
    expect(r.data).toMatchObject({ ok: true, invited: 1, message: "Emailed Cy Person.", items: [{ state: "sent", line: "Emailed" }] });
    expect(s.sent.sends).toEqual(["AAMk1"]);
    expect(byName(await s.load())["Cy Person"]!.invited?.via).toBe("email_sent");
    expect(await s.inviteAudit()).toEqual(["emailed from FocusTime, 1 person: read back"]);
  });

  it("several: Teams sends one 1:1 per person, each with their own first name", async () => {
    const s = await sending();
    const p = (await s.preview({ personIds: [s.cy.personId, s.dee.personId], channel: "teams" })) as { data: Preview };
    expect(p.data.how).toBe("Teams: a 1:1 chat with each of the 2, as you");
    expect(p.data.messages.map((m) => [m.to, m.text.split(",")[0]])).toEqual([[["Cy Person"], "Hi Cy"], [["Dee Person"], "Hi Dee"]]);
    const r = await s.send(p.data.previewId);
    expect(r.data).toMatchObject({ ok: true, invited: 2, message: "Sent in Teams to all 2." });
    expect(s.sent.chats).toHaveLength(2);
    expect(s.sent.posts).toHaveLength(2);
    expect(await s.inviteAudit()).toHaveLength(2);
  });

  it("several by email: one email each by default; one email to everyone when chosen", async () => {
    const s = await sending();
    const each = (await s.preview({ personIds: [s.cy.personId, s.dee.personId], channel: "email", subject: "Try FocusTime" })) as { data: Preview };
    expect(each.data.split).toBe("each");
    expect(each.data.how).toBe("Email, an Outlook draft in your mailbox: one email each to 2 people, as you");
    await s.send(each.data.previewId);
    expect(s.sent.drafts.map((d) => [d.to, d.html.split(",")[0]])).toEqual([[["cy@cooptimize.example"], "Hi Cy"], [["dee@cooptimize.example"], "Hi Dee"]]);
    const one = (await s.preview({ personIds: [s.cy.personId, s.dee.personId], channel: "email", mode: "send", split: "one", subject: "Try FocusTime" })) as { data: Preview };
    expect(one.data.messages).toEqual([{ to: ["Cy Person", "Dee Person"], text: "Hi all, try FocusTime: https://focustime-dev.example.com/" }]);
    const r = await s.send(one.data.previewId);
    expect(r.data).toMatchObject({ ok: true, invited: 2, message: "Emailed all 2." });
    expect(s.sent.drafts[2]!.to).toEqual(["cy@cooptimize.example", "dee@cooptimize.example"]);
    // One audit entry for that one email, naming both.
    expect((await s.store.auditList({ area: "people" })).find((e) => e.note?.startsWith("emailed"))).toMatchObject({ target: "Cy Person, Dee Person", note: "emailed from FocusTime, 2 people: read back" });
  });

  it("a partial failure names who wasn't reached, marks only the others invited, and Retry sends only to them", async () => {
    const failFor = new Set(["dee@cooptimize.example"]);
    const s = await sending({ failFor });
    const p = (await s.preview({ personIds: [s.cy.personId, s.dee.personId], channel: "teams" })) as { data: Preview };
    const r = await s.send(p.data.previewId);
    expect(r.data).toMatchObject({ ok: false, retry: true, invited: 1, message: "Sent in Teams to 1 of 2. Not sent to Dee Person." });
    expect(r.data.items.map((i) => [i.names[0], i.ok, i.line])).toEqual([["Cy Person", true, "Sent in Teams"], ["Dee Person", false, "Microsoft refused it"]]);
    let rows = byName(await s.load());
    expect(rows["Cy Person"]!.invited?.via).toBe("teams_sent");
    expect(rows["Dee Person"]!.invited).toBeNull();
    expect(await s.inviteAudit()).toEqual(["sent in Teams from FocusTime, 1 person: not sent: Microsoft refused it", "sent in Teams from FocusTime, 1 person: read back"]);
    failFor.clear();
    const again = (await adminAction(s.admin, "admin.invite_retry", { batchId: r.data.batchId })) as { data: Result };
    expect(again.data).toMatchObject({ ok: true, retry: false, invited: 2 });
    // Cy got one message, Dee one: Retry never sent Cy's again.
    expect(s.sent.posts).toHaveLength(2);
    rows = byName(await s.load());
    expect(rows["Dee Person"]!.invited?.via).toBe("teams_sent");
    expect((await s.inviteAudit())[0]).toBe("sent in Teams from FocusTime, 1 person: read back on retry");
  });

  it("Retry reads back a message Teams took but didn't show, and never posts it twice", async () => {
    const s = await sending({ postNotShown: true });
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "teams" })) as { data: Preview };
    const r = await s.send(p.data.previewId);
    expect(r.data.items[0]).toMatchObject({ ok: false, state: "unconfirmed" });
    expect(byName(await s.load())["Cy Person"]!.invited).toBeNull();
    // Now Teams shows it.
    s.shown.add(`${[...s.sent.posts][0]!.chatId}|1700000000001`);
    const again = (await adminAction(s.admin, "admin.invite_retry", { batchId: r.data.batchId })) as { data: Result };
    expect(again.data).toMatchObject({ ok: true, invited: 1 });
    expect(s.sent.posts).toHaveLength(1);
  });

  it("Send now that Outlook refuses keeps the draft, and Retry sends that draft, not a second email", async () => {
    const s = await sending({ sendFails: true });
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "email", mode: "send", subject: "Try FocusTime" })) as { data: Preview };
    const r = await s.send(p.data.previewId);
    expect(r.data.items[0]).toMatchObject({ ok: false, state: "draft_kept", line: "Microsoft is busy. Try again in a minute. The draft is in your Outlook; Retry sends it." });
    s.opts.sendFails = false;
    const again = (await adminAction(s.admin, "admin.invite_retry", { batchId: r.data.batchId })) as { data: Result };
    expect(again.data).toMatchObject({ ok: true, invited: 1 });
    expect(s.sent.drafts).toHaveLength(1);
    expect(s.sent.sends).toEqual(["AAMk1"]);
  });

  it("without the permission: access says what to allow with the admin note, and nothing is sent", async () => {
    const s = await sending({ access: { send: "consent", mail: "consent", mail_send: "consent" } });
    const a = (await adminAction(s.admin, "admin.invite_access", {})) as { data: { teams: { state: string; consent?: string; note?: string }; draft: { state: string }; send: { state: string } } };
    expect(a.data.teams).toMatchObject({ state: "consent", consent: "teams_send" });
    expect(a.data.teams.note).toContain("Sending from FocusTime needs an admin to approve access.");
    expect(a.data.draft.state).toBe("consent");
    expect(await s.preview({ personIds: [s.cy.personId], channel: "teams" })).toMatchObject({ ok: false, status: 409, code: "consent" });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "Try FocusTime" })).toMatchObject({ ok: false, status: 409, code: "consent" });
    expect(s.sent).toEqual({ chats: [], posts: [], drafts: [], sends: [] });
    expect(await s.inviteAudit()).toEqual([]);
  });

  it("a draft is allowed without Mail.Send, but Send now isn't", async () => {
    const s = await sending({ access: { mail_send: "consent" } });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "email", mode: "send", subject: "Try FocusTime" })).toMatchObject({ ok: false, status: 409, code: "consent" });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "Try FocusTime" })).toMatchObject({ ok: true });
  });

  it("with no Microsoft sign-in here, everything says unavailable and nothing sends", async () => {
    forgetInviteSends();
    const s = await setup();
    const a = (await adminAction(s.admin, "admin.invite_access", {})) as { data: { teams: { state: string } } };
    expect(a.data.teams.state).toBe("unavailable");
    expect(await adminAction(s.admin, "admin.invite_preview", { personIds: [s.cy.personId], channel: "teams", message: MESSAGE })).toMatchObject({ ok: false, status: 409 });
  });

  it("guests, people outside the domains, automation accounts and people who signed in can't be recipients", async () => {
    const s = await sending();
    for (const p of [s.gus, s.oz, s.bot]) {
      expect(await s.preview({ personIds: [p.personId], channel: "teams" })).toMatchObject({ ok: false, status: 404, code: "not_cooptimizer" });
      // Mixed in with a Cooptimizer, the whole send is refused.
      expect(await s.preview({ personIds: [s.cy.personId, p.personId], channel: "email", subject: "Try FocusTime" })).toMatchObject({ ok: false, status: 404 });
    }
    expect(await s.preview({ personIds: [BEN], channel: "teams" })).toMatchObject({ ok: false, status: 409, code: "signed_in" });
    expect(s.sent).toEqual({ chats: [], posts: [], drafts: [], sends: [] });
  });

  it("refuses bad input, non-admins, and another admin's preview", async () => {
    const s = await sending();
    expect(await s.preview({ personIds: [s.cy.personId], channel: "fax" })).toMatchObject({ ok: false, status: 400 });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "teams", subject: "x" })).toMatchObject({ ok: false, status: 400 });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "" })).toMatchObject({ ok: false, status: 400 });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "s", split: "both" })).toMatchObject({ ok: false, status: 400 });
    expect(await s.preview({ personIds: [s.cy.personId], channel: "teams", message: " " })).toMatchObject({ ok: false, status: 400 });
    expect(await adminAction({ ...s.ben, send: s.port }, "admin.invite_preview", { personIds: [s.cy.personId], channel: "teams", message: MESSAGE })).toMatchObject({ ok: false, status: 403, code: "admin" });
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "teams" })) as { data: Preview };
    // Someone else never sends Ada's preview (Ben isn't an admin, so the one admin check stops him first).
    const other: AdminContext = { ops: s.ops, me: async () => ({ id: BEN, name: "Ben Person" }), send: s.port };
    expect(await adminAction(other, "admin.invite_send", { previewId: p.data.previewId })).toMatchObject({ ok: false, status: 403 });
    expect(s.sent.posts).toEqual([]);
  });

  it("the audit and the logs never hold the message or an address", async () => {
    const s = await sending();
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "email", subject: "Try FocusTime" })) as { data: Preview };
    await s.send(p.data.previewId);
    const json = JSON.stringify(await s.store.auditList({}));
    expect(json).not.toContain("cy@cooptimize.example");
    expect(json).not.toContain("try FocusTime");
  });
});

describe("IN-2: Retry after Send now", () => {
  it("an email Outlook took but still shows as a draft is only read back on Retry, never sent again", async () => {
    const s = await sending();
    // Outlook takes the send but the read back still says draft.
    const fake = (await s.port.sender())!;
    const realSend = fake.send.bind(fake);
    const realRead = fake.readMail.bind(fake);
    let lag = true;
    fake.send = async (id) => {
      await realSend(id);
    };
    fake.readMail = async (id) => (lag ? { state: "draft", webLink: null, sentAt: null } : realRead(id));
    const p = (await s.preview({ personIds: [s.cy.personId], channel: "email", mode: "send", subject: "Try FocusTime" })) as { data: Preview };
    const r = await s.send(p.data.previewId);
    expect(r.data.items[0]).toMatchObject({ ok: false, state: "unconfirmed" });
    await adminAction(s.admin, "admin.invite_retry", { batchId: r.data.batchId });
    expect(s.sent.sends).toEqual(["AAMk1"]);
    lag = false;
    const again = (await adminAction(s.admin, "admin.invite_retry", { batchId: r.data.batchId })) as { data: Result };
    expect(again.data).toMatchObject({ ok: true, invited: 1 });
    expect(s.sent.sends).toEqual(["AAMk1"]);
  });
});
