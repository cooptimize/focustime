// CV-3 follow-ups, the main path, in a real (not demo) session on a fake Graph, with AI off for the client (Allow AI
// off, so no AI request runs). Admin › AI shows the client's "Group messages without AI" switch, on. The chat's messages
// group by rules: Blake's request mentioning Evan starts a conversation, Evan (mentioned) and my reply to Blake join it,
// titled by its first message with no summary. A loose promise in the Delivery chat: Link to item… lists likely items
// with reasons. Today: a promise due within 2 hours and one overdue in the urgent strip, one later only in the agenda.
// Week's Board rail: the overdue one amber "was due …" at now. Capture: Who through the PersonPicker with the link offer.
// Edge cases are unit tests (actions/conversations-rules-only, plan/promise-items, plan/urgent, plan/rail-promises,
// actions/capture-actions). Fictional names. Screenshots at 1920, Text size Larger and the phone (390 wide, a 17px root
// font) when FOCUSTIME_SHOTS is set.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { requestContext } from "../actions/dispatch.ts";
import { pollCycle, type PollDeps } from "../actions/request-poll.ts";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { aDirectoryPerson, anAiApp, anAiRules } from "../test/builders/index.ts";
import { chartPng } from "../test/images.ts";
import { CHROMIUM, openInboxItem, timelineOn, openInboxView, openSettings } from "./harness.ts";
import { liveAdminOps, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const HOME = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ALLIANCE = "19:adatum-alliance@thread.v2";
const DELIVERY = "19:adatum-delivery@thread.v2";
const BLAKE = "00000000-0000-4000-8000-0000000000c1";
const EVAN = "00000000-0000-4000-8000-0000000000c2";
const LENA = "00000000-0000-4000-8000-0000000000c3";
const NAMES: Record<string, string> = { [ME]: "Sam Tester", [BLAKE]: "Blake Novak", [EVAN]: "Evan Ford", [LENA]: "Lena Hart" };
const member = (userId: string, tenantId: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: `m-${userId}`, roles: [], displayName: NAMES[userId], userId, email: `${NAMES[userId]!.split(" ")[0]!.toLowerCase()}@${tenantId === HOME ? "contoso" : "fabrikam"}.example`, tenantId });
const CHATS: Record<string, { topic: string; members: ReturnType<typeof member>[] }> = {
  [ALLIANCE]: { topic: "Adatum Analytics Alliance", members: [member(ME, HOME), member(EVAN, HOME), member(LENA, HOME), member(BLAKE, CLIENT)] },
  [DELIVERY]: { topic: "Adatum Delivery Team (Cooptimize)", members: [member(ME, HOME), member(EVAN, HOME)] },
};
const HOSTED = { a: "aWQ9eDtpbWc9MQ==", b: "aWQ9eDtpbWc9Mg==" };

/** A fake Graph: two group chats, html bodies with hosted images, reactions and quotes, and the hosted content bytes. */
function fakeGraph() {
  const messages: Record<string, Record<string, unknown>[]> = { [ALLIANCE]: [], [DELIVERY]: [] };
  const images: Record<string, Uint8Array> = { [HOSTED.a]: chartPng(480, 300), [HOSTED.b]: chartPng(420, 300, [60, 96, 170]) };
  const hostedCalls: string[] = [];
  let n = 0;
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const graphFetch = (async (input: string | URL) => {
    const u = new URL(String(input));
    const path = decodeURIComponent(u.pathname);
    if (path === "/v1.0/me/chats") return json({ value: Object.entries(CHATS).map(([id, c]) => ({ id, chatType: "group", topic: c.topic, webUrl: "https://teams.microsoft.com/l/chat/x", lastUpdatedDateTime: "2026-11-02T14:00:00Z", members: c.members })) });
    for (const id of [ALLIANCE, DELIVERY]) {
      if (path === `/v1.0/chats/${id}/members`) return json({ value: CHATS[id]!.members });
      if (path === `/v1.0/chats/${id}/messages`) {
        const since = Date.parse(/gt (\S+)/.exec(u.searchParams.get("$filter") ?? "")?.[1] ?? "1970-01-01T00:00:00Z");
        return json({ value: messages[id]!.filter((m) => Date.parse(String(m.lastModifiedDateTime)) > since).reverse() });
      }
      const hosted = new RegExp(`^/v1\\.0/chats/${id.replace(/[.:@]/g, "\\$&")}/messages/\\d+/hostedContents/([^/]+)/\\$value$`).exec(path);
      if (hosted) {
        hostedCalls.push(hosted[1]!);
        const b = images[hosted[1]!];
        return b ? new Response(Buffer.from(b), { status: 200, headers: { "content-type": "image/png" } }) : new Response("", { status: 404 });
      }
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    fetch: graphFetch,
    hostedCalls,
    say: (chat: string, from: string, html: string, minute: number, o: { reactions?: string[]; quotes?: string; mentions?: string[] } = {}) => {
      // After the registration (now, 14:30Z): only messages newer than it are read.
      const at = `2026-11-02T14:${String(30 + minute).padStart(2, "0")}:00Z`;
      const id = String(1_730_000_000_000 + ++n);
      const quoted = o.quotes ? messages[chat]!.find((m) => m.id === o.quotes) : null;
      messages[chat]!.push({
        id,
        messageType: "message",
        createdDateTime: at,
        lastModifiedDateTime: at,
        from: { user: { id: from, displayName: NAMES[from], tenantId: from === BLAKE ? CLIENT : HOME } },
        body: { contentType: "html", content: html.replace(/\{msg\}/g, id) },
        attachments: quoted ? [{ id: o.quotes, contentType: "messageReference", content: JSON.stringify({ messageId: o.quotes, messagePreview: "", messageSender: { user: { id: (quoted.from as { user: { id: string } }).user.id } } }) }] : [],
        mentions: (o.mentions ?? []).map((u, i) => ({ id: i, mentionText: NAMES[u], mentioned: { user: { id: u, displayName: NAMES[u] } } })),
        reactions: (o.reactions ?? []).map((r) => ({ reactionType: r, createdDateTime: at, user: { user: { id: EVAN } } })),
      });
      return id;
    },
  };
}


/** 1920 and Larger, then the phone: 390 by 844 with a 17px root font, nothing wider than the phone, then back. */
async function shotAll(page: Page, name: string, keep?: Parameters<typeof shotBoth>[2]) {
  await shotBoth(page, name, keep);
  if (!SHOTS) return;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
  await page.waitForTimeout(250);
  await keep?.scrollIntoViewIfNeeded();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = over > 0 ? await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > 391).slice(-4).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`)) : [];
  expect(over, `${name}: the page is wider than the phone (${wide.join(", ")})`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  await page.evaluate(() => void (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(150);
}


describe.skipIf(!CHROMIUM)("CV-3 follow-ups", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("rules-only grouping with AI off, likely items for a loose promise, the strip and agenda, the Board rail, Capture's Who", async () => {
    const graph = fakeGraph();
    const chats = createChatsClient({ fetch: graph.fetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: HOME, name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
    const team = liveTeam();
    await team.set("org", "ai.on", true);
    const ctx = await liveContext({
      team,
      extra: {
        account: () =>
          ({
            identity: async () => ({ oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example" }),
            writeAccess: async () => ({ status: "not_connected", message: "Not connected" }),
            armToken: async () => {
              throw new Error("no Azure here");
            },
            signIn: async () => ({ status: "failed", message: "not here" }),
            chats,
            chatMessages: chats,
            probe: async (kind: string) => ({ kind, state: "granted", granted: [] }),
          }) as never,
        devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
        writePats: { get: async (k) => new Pat(pats.get(k) ?? ""), set: async (k, v) => void pats.set(k, v), clear: async (k) => void pats.delete(k) },
      },
    });
    const clock = () => Temporal.Instant.from(ctx.now());
    const conn = sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") }));
    const teams = createTeamsStore(conn, clock);
    const convs = createConversationStore(conn, clock, teams);
    let aiCalls = 0;
    const provider = stubProvider({ respond: () => (aiCalls++, '{"messages":[],"conversations":[]}') });
    const pipelineAi = createAi({
      provider: async () => provider,
      app: anAiApp({ provider: "openai", appCapUsd: 100 }),
      rules: async () => anAiRules({ on: true, allowedClients: [] }),
      guard: async () => ({ directory: [], homeDomains: ["contoso.example"], forbidden: [] }),
      log: convs.appAiLog,
      appSpend: { get: async () => 0, add: async () => {} },
      now: ctx.now,
      cap: "app",
    });
    const deps: PollDeps = {
      teams,
      conversations: convs,
      users: async () => [{ id: ME, name: "Sam Tester", deleted: false }],
      person: async (uid) => {
        if (uid !== ME) return null;
        const loaded = await ctx.loadConfig();
        return { name: "Sam Tester", config: loaded.parsed.ok ? loaded.parsed.config : null, chatMessages: chats, chats, ai: null, pipelineAi: async () => pipelineAi, plan: ctx.plan ?? null, openItems: (await requestContext(ctx)).openItems };
      },
      homeTenant: async () => HOME,
      now: ctx.now,
      log: () => {},
    };
    ctx.requests = { teams, conversations: convs, users: async () => [{ id: ME, name: "Sam Tester", deleted: false }], refresh: (chatIds) => pollCycle(deps, { force: true, chatIds }) };
    ctx.admins = [ME];
    ctx.adminOps = await liveAdminOps(team, { admins: [ME], clients: ["Adatum"], chats: () => teams.chats() });
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: HOME, name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      const graphRequests: string[] = [];
      page.on("request", (r) => /graph\.microsoft\.com|hostedContents/.test(r.url()) && graphRequests.push(r.url()));
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();

      // Admin › Clients: add both chats to Adatum.
      await openSettings(page);
      await page.locator('.ps-rail [data-settings-section="admin-clients"]').click();
      const adatum = page.getByRole("group", { name: /^Delivery chats for Adatum/ });
      for (const word of ["alliance", "delivery"]) {
        await adatum.getByRole("button", { name: "Add a chat" }).click();
        await adatum.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option").first().waitFor();
        await page.keyboard.type(word);
        await page.keyboard.press("Enter");
        await adatum.getByText(/^Added Adatum .*\. Read from now on/).waitFor();
      }
      await page.keyboard.press("Escape");


      // Admin › AI: the client's Group messages without AI switch, on by default, beside Allow AI (off).
      await openSettings(page);
      await page.locator('.ps-rail [data-settings-section="admin-ai"]').click();
      const groupSwitch = page.getByRole("switch", { name: "Group messages without AI for Adatum" });
      await expect.poll(() => groupSwitch.isChecked()).toBe(true);
      expect(await page.getByRole("switch", { name: "Allow AI for Adatum" }).isChecked()).toBe(false);
      await shotAll(page, "cv3-admin-group-without-ai", groupSwitch);
      await page.keyboard.press("Escape");

      // Blake asks Evan (a Request); Evan answers (he was mentioned) and I reply to Blake: one conversation by rules.
      graph.say(ALLIANCE, BLAKE, `<p><at id="0">Evan Ford</at> the October totals on the Movement Dashboard look 4% low, can you check?</p>`, 1, { mentions: [EVAN] });
      graph.say(ALLIANCE, EVAN, "<p>Looking now. The date filter stops at the 30th.</p>", 4);
      graph.say(ALLIANCE, ME, `<p><at id="0">Blake Novak</at> I'll send you corrected totals tomorrow.</p>`, 6, { mentions: [BLAKE] });
      graph.say(DELIVERY, EVAN, "<p>The filter bug needs tracking somewhere.</p>", 12);
      graph.say(DELIVERY, ME, "<p>I'll log a ticket for the unassigned feature.</p>", 13);

      await page.keyboard.press("5");
      const main = await openInboxView(page, "needs-you");
      await main.getByRole("button", { name: "Refresh conversations" }).click();
      const conv = await openInboxItem(page, /^Evan Ford the October totals on the Movement Dashboard look 4% low/);
      await conv.getByText("Grouped without AI, so there's no summary. The messages are below.").waitFor();
      const [c] = (await convs.conversations([ALLIANCE]));
      expect((await convs.placesIn([c!.id])).filter((p) => p.role === "work")).toHaveLength(3);
      expect(aiCalls).toBe(0);
      await shotAll(page, "cv3-rules-only-conversation", conv);

      // Promises: the loose one (no conversation) suggests likely items with reasons.
      await openInboxView(page, "promises");
      const loose = await openInboxItem(page, /unassigned feature/i);
      await loose.getByRole("button", { name: /^More for / }).click();
      await loose.getByRole("menuitem", { name: "Link to item" }).click();
      const likely = loose.getByRole("list", { name: "Likely items" });
      await likely.getByText(/My story under an unassigned feature/).waitFor();
      await likely.getByText("Assigned to you · matches unassigned, feature").waitFor();
      await shotAll(page, "cv3-link-likely", loose);
      await page.keyboard.press("Escape");

      // Day: due in an hour and overdue in the strip; due at 3 PM in the chips line ("1 promise due"), with its time.
      const k = (await convs.commitmentsInChat(ALLIANCE))[0]!;
      await convs.addCommitment({ conversationId: k.conversationId, chatId: ALLIANCE, clientKey: "Adatum", whoId: ME, whoName: "Sam Tester", toId: BLAKE, toName: "Blake Novak", what: "Share the filter fix plan", dueAt: "2026-11-02T15:30:00Z", dueDate: "2026-11-02", impliesItem: false, messageIds: [], reason: "test" });
      await convs.addCommitment({ conversationId: k.conversationId, chatId: ALLIANCE, clientKey: "Adatum", whoId: ME, whoName: "Sam Tester", toId: BLAKE, toName: "Blake Novak", what: "Walk Blake through the totals", dueAt: "2026-11-02T20:00:00Z", dueDate: "2026-11-02", impliesItem: false, messageIds: [], reason: "test" });
      await convs.addCommitment({ conversationId: null, chatId: DELIVERY, clientKey: "Adatum", whoId: ME, whoName: "Sam Tester", toId: EVAN, toName: "Evan Ford", what: "Send Evan the October export", dueAt: null, dueDate: "2026-10-30", impliesItem: false, messageIds: [], reason: "test" });
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();
      const strip = page.getByRole("region", { name: "Urgent" });
      await strip.getByText("Share the filter fix plan").waitFor();
      await strip.getByText(/Promise · was due Fri, Oct 30/).waitFor();
      expect(await strip.getByText("Walk Blake through the totals").count()).toBe(0);
      await page.locator(".day-chips .att-chip.due").click();
      const dueRow = page.locator(".day-chips .att-rows li", { hasText: "Walk Blake through the totals" });
      await dueRow.waitFor();
      await expect(dueRow.textContent()).resolves.toMatch(/Promise · 3:00 PM/);
      await shotAll(page, "cv3-today-strip-agenda", strip);

      // Week's rail: the overdue one marked at now on today's block; WD-1's slim rail has no labels, so the card's late
      // chip names it ("Late promise: Send Evan the October export") and opens it. The timeline is off by default
      // (WD-1 review), so turn it on.
      await timelineOn(page);
      await page.keyboard.press("2");
      expect(await page.locator(".r-promise.overdue", { hasText: "Send Evan the October export" }).count()).toBeGreaterThan(0);
      const mark = page.locator('.day.today .late-chip[title^="Late promise: Send Evan the October export"]').first();
      await mark.waitFor();
      await shotAll(page, "cv3-board-rail", page.locator(".day.today").first());
      // IB-1 slice 4: the mark opens that promise in the Inbox's detail pane, then back to the Board.
      await mark.click();
      await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/inbox\/item\/c\d+$/);
      await page.locator(".ib-pane .ib-detail-title", { hasText: "Send Evan the October export" }).waitFor();
      await page.keyboard.press("2");

      // Capture: Who through the PersonPicker, with the link offer for an exact name.
      const dirPerson = (personId: string, name: string, n: number) => aDirectoryPerson({ personId, systemUserId: `d3300000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`, name, email: `${name.split(" ")[0]!.toLowerCase()}@contoso.example` });
      await team.store.replaceDirectory([dirPerson(ME, "Sam Tester", 1), dirPerson(EVAN, "Evan Ford", 2), dirPerson(LENA, "Lena Hart", 3)], [], []);
      team.org.invalidate();
      await page.keyboard.press("n");
      const box = page.locator(".cap-box textarea[aria-label='Quick capture']");
      await box.fill("Told Evan Ford I'd send the October export");
      await page.getByRole("radiogroup", { name: "Save as" }).getByRole("radio", { name: /Promise/ }).click();
      const fields = page.getByRole("group", { name: "Promise details" });
      await expect.poll(() => fields.getByRole("combobox", { name: "Who" }).inputValue()).toBe("Evan Ford");
      await fields.getByRole("button", { name: "Link to Evan Ford" }).waitFor();
      await shotAll(page, "cv3-capture-person-picker", fields);
      await fields.getByRole("button", { name: "Link to Evan Ford" }).click();
      await box.focus();
      await page.keyboard.press("Enter");
      await page.getByText(/as a promise, owed to Evan Ford/).waitFor();
      const saved = (await ctx.plan!.openFollowUps()).find((f) => /October export/.test(f.what));
      expect(saved?.whoRef).toMatchObject({ kind: "cooptimizer", name: "Evan Ford" });
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, 300_000);
});
