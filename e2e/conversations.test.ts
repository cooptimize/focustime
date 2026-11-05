// CV-1 Conversations and My promises, the main path, in a real (not demo) session on fake sources, a fake Graph (Teams)
// and a fake DevOps, with a fake AI provider behind the real ai/ service (the app's cap). A FocusTime admin adds two
// chats for Adatum in Settings > Clients; messages arrive; Refresh in Inbox › Conversations reads them through the
// shared job: the Alliance-shaped conversation (a client question, two teammates, my commitment that implies an item) sits
// in Needs you, a teammate's one under Handled by teammates. Show messages, then Create item: the draft with only the
// valid types under its feature, the preview, Create in DevOps, Tracked #id. A comment suggestion with Post comment or
// Skip. My promises shows the Wingtip-shaped promise, due today 7:30 PM, and Today shows it under After your blocks.
// Edge cases are unit tests (actions/conversation*.test.ts, actions/devops-write.test.ts, plan/conversations.test.ts).
// Fictional names throughout (the repo's names rule). Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { requestContext } from "../actions/dispatch.ts";
import { pollCycle, type PollDeps } from "../actions/request-poll.ts";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { UpdateAnswer } from "../plan/conversations.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { anAiApp, anAiRules } from "../test/builders/index.ts";
import { CHROMIUM, openSettings } from "./harness.ts";
import { appReady, liveAdminOps, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

const HOME = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ALLIANCE = "19:adatum-alliance@thread.v2";
const DELIVERY = "19:adatum-delivery@thread.v2";
const BLAKE = "00000000-0000-4000-8000-0000000000c1";
const EVAN = "00000000-0000-4000-8000-0000000000c2";
const LENA = "00000000-0000-4000-8000-0000000000c3";
const member = (userId: string, displayName: string, tenantId: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: `m-${userId}`, roles: [], displayName, userId, email: `${displayName.split(" ")[0]!.toLowerCase()}@${tenantId === HOME ? "contoso" : "fabrikam"}.example`, tenantId });
const SAM_M = member(ME, "Sam Tester", HOME);
const CHATS: Record<string, { topic: string; members: ReturnType<typeof member>[] }> = {
  [ALLIANCE]: { topic: "Adatum Analytics Alliance", members: [SAM_M, member(EVAN, "Evan Ford", HOME), member(LENA, "Lena Hart", HOME), member(BLAKE, "Blake Novak", CLIENT)] },
  [DELIVERY]: { topic: "Adatum Delivery Team (Cooptimize)", members: [SAM_M, member(EVAN, "Evan Ford", HOME)] },
};

/** A fake Graph for two group chats: listings, members and messages (newest first, filtered by lastModifiedDateTime). */
function fakeGraph() {
  const messages: Record<string, Record<string, unknown>[]> = { [ALLIANCE]: [], [DELIVERY]: [] };
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
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    fetch: graphFetch,
    say: (chat: string, from: string, text: string, minute: number) => {
      // After the registration (now, 14:30Z): only messages newer than it are read.
      const at = `2026-11-02T14:${String(30 + minute).padStart(2, "0")}:00Z`;
      messages[chat]!.push({ id: String(1_730_000_000_000 + ++n), messageType: "message", createdDateTime: at, lastModifiedDateTime: at, from: { user: { id: from, tenantId: from === BLAKE ? CLIENT : HOME } }, body: { contentType: "text", content: text }, attachments: [], mentions: [] });
    },
  };
}

/** The fake provider: reads its own request (refs only) and answers like the model would for these two chats. */
function answer(inputText: string): string {
  const input = JSON.parse(inputText) as { people: { ref: string; name: string }[]; messages: { ref: string; from: string; text: string }[] };
  const ref = (name: string) => input.people.find((p) => p.name === name)?.ref ?? null;
  const work = (conversation: string) => input.messages.map((m) => ({ ref: m.ref, kind: "work" as const, conversation, confident_new_topic: false }));
  const by = (name: string) => input.messages.filter((m) => m.from === ref(name)).map((m) => m.ref);
  if (input.messages.some((m) => /CRM_Silver/.test(m.text))) {
    const a: UpdateAnswer = {
      messages: work("n1"),
      conversations: [{ ref: "n1", title: "Rerun the Salesforce data from CRM_Silver", summary: "Evan asked for a rerun today.\nSam will do it tonight.", owner: ref("Sam Tester"), wrapped_up: false, change: "Sam will rerun it tonight", item_change: null, scope_changed: false, likely_item: null,
        commitments: [{ who: ref("Sam Tester")!, what: "Rerun the Salesforce data from CRM_Silver", due: "2026-11-02T19:30", to: ref("Evan Ford"), implies_item: false, messages: by("Sam Tester"), status_only: false }] }],
    };
    return JSON.stringify(a);
  }
  const lena = input.messages.filter((m) => /refresh schedule/.test(m.text)).map((m) => m.ref);
  const a: UpdateAnswer = {
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: lena.includes(m.ref) ? "n2" : "n1", confident_new_topic: lena.includes(m.ref) })),
    conversations: [
      { ref: "n1", title: "Movement Dashboard quantity gap on 4417001", summary: "Blake sees about 7.7k lb less on the Movement Dashboard than the BOM report for 4417001.\nEvan and Lena traced it to BOM bridging.\nSam will add the fix to the development queue.", owner: ref("Sam Tester"), wrapped_up: false, change: "Sam will add the fix to the development queue", item_change: null, scope_changed: false, likely_item: null,
        commitments: [{ who: ref("Sam Tester")!, what: "Add the BOM bridging fix to the development queue", due: null, to: ref("Blake Novak"), implies_item: true, messages: by("Sam Tester"), status_only: false }] },
      { ref: "n2", title: "Dashboard refresh schedule", summary: "Blake asks whether the dashboard can refresh at 6 AM.\nLena is changing the schedule.", owner: ref("Lena Hart"), wrapped_up: false, change: "Lena is changing the schedule", item_change: null, scope_changed: false, likely_item: null,
        commitments: [{ who: ref("Lena Hart")!, what: "Move the refresh to 6 AM", due: null, to: ref("Blake Novak"), implies_item: false, messages: lena.filter((r) => input.messages.find((m) => m.ref === r)?.from === ref("Lena Hart")), status_only: false }] },
    ],
  };
  return JSON.stringify(a);
}

describe.skipIf(!CHROMIUM)("Conversations", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("the Alliance conversation: Needs you, the DevOps draft and create, a comment suggestion; the Wingtip promise on Today", async () => {
    const graph = fakeGraph();
    const chats = createChatsClient({ fetch: graph.fetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
    // ADM-1: AI and Allow AI are the team's; chats are registered in Admin › Clients.
    const team = liveTeam();
    await team.set("org", "ai.on", true);
    await team.set("client:Adatum", "allow_ai", true);
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
    const provider = stubProvider({ respond: (c) => answer(c.input) });
    const pipelineAi = createAi({
      provider: async () => provider,
      app: anAiApp({ provider: "openai", appCapUsd: 100 }),
      rules: async () => anAiRules({ on: true, allowedClients: ["Adatum"] }),
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
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await appReady(page);

      // Admin › Clients: add both chats to Adatum (an admin, once for everyone on them who follows Adatum).
      await openSettings(page);
      await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Clients" }).click();
      const adatum = page.getByRole("group", { name: /^Delivery chats for Adatum/ });
      for (const word of ["alliance", "delivery"]) {
        await adatum.getByRole("button", { name: "Add a chat" }).click();
        await adatum.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option").first().waitFor();
        await page.keyboard.type(word);
        await page.keyboard.press("Enter");
        await adatum.getByText(/^Added Adatum .*\. Read from now on/).waitFor();
      }
      await page.keyboard.press("Escape");

      // The Alliance-shaped thread: a client question, two teammates digging in, my commitment; and a teammate's topic.
      graph.say(ALLIANCE, BLAKE, "The Movement Dashboard shows about 7.7k lb less than the BOM report for project 4417001. Can you check?", 1);
      graph.say(ALLIANCE, EVAN, "Looking now. The BOM lines for 4417001 are bridged through the old warehouse.", 4);
      graph.say(ALLIANCE, LENA, "Confirmed: the dashboard skips bridged BOM lines.", 9);
      graph.say(ALLIANCE, BLAKE, "Could the dashboard refresh schedule move to 6 AM too?", 11);
      graph.say(ALLIANCE, LENA, "Yes, I'll move the refresh schedule to 6 AM today.", 12);
      graph.say(ALLIANCE, ME, "I'll add the BOM bridging fix to the development queue.", 14);
      // The Wingtip-shaped promise in the internal chat: Evan asks, I answer in two messages.
      graph.say(DELIVERY, EVAN, "Can we rerun the Salesforce data from CRM_Silver today?", 20);
      graph.say(DELIVERY, ME, "Absolutely. I'll get this done tonight.", 21);
      graph.say(DELIVERY, ME, "I'll be back online around 7:30 PM.", 22);

      // Inbox › Conversations: Refresh reads the chats now.
      await page.keyboard.press("4");
      await page.getByRole("navigation", { name: "Inbox modes" }).getByRole("button", { name: /^Conversations/ }).click();
      const main = page.getByRole("main", { name: "Conversations" });
      await main.getByRole("button", { name: "Refresh conversations" }).click();
      const needs = main.getByRole("region", { name: "Needs you" });
      const alliance = needs.getByRole("listitem", { name: "Movement Dashboard quantity gap on 4417001" });
      await alliance.waitFor();
      await alliance.getByText(/Sam will add the fix to the development queue/).waitFor();
      await alliance.getByRole("button", { name: /^Create item/ }).waitFor();
      const mates = main.getByRole("region", { name: "Handled by teammates" });
      await mates.getByRole("button", { name: /Handled by teammates \(1\)/ }).waitFor();
      await shotBoth(page, "conversations-needs-you", main);
      await mates.getByRole("button", { name: /Handled by teammates/ }).click();
      await mates.getByText("Dashboard refresh schedule").waitFor();
      await shotBoth(page, "conversations-teammates", mates);

      // A card collapsed, then its messages.
      await shotBoth(page, "conversations-card", alliance);
      await alliance.getByRole("button", { name: /^Show messages/ }).click();
      await alliance.getByRole("list", { name: "The messages" }).getByText(/skips bridged BOM lines/).waitFor();
      await shotBoth(page, "conversations-card-messages", alliance);
      await alliance.getByRole("button", { name: /^Hide messages/ }).click();

      // Create item: the draft, then the preview through the write framework, then Tracked.
      await alliance.getByRole("button", { name: /^Create item/ }).click();
      const draft = alliance.getByRole("form", { name: "Create the DevOps item" });
      await draft.getByRole("textbox", { name: /^Title/ }).waitFor();
      await shotBoth(page, "conversations-devops-draft", draft);
      await draft.getByRole("button", { name: "Preview in DevOps" }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      await preview.getByText(/original messages? from Adatum Analytics Alliance/).waitFor();
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await preview.waitFor({ state: "detached" });
      const made = [...dv.items.values()].at(-1)!;
      expect(String(made.fields["System.Description"] ?? made.fields["Microsoft.VSTS.TCM.ReproSteps"])).toContain("Blake Novak");
      await expect.poll(async () => (await convs.conversations([ALLIANCE])).find((c) => c.title.startsWith("Movement"))?.status).toBe("tracked");
      await main.getByRole("listitem", { name: "Movement Dashboard quantity gap on 4417001" }).getByText(new RegExp(`#${made.id}`)).first().waitFor();

      // A comment suggestion for the item's owner (made by the shared job after a change and a pause).
      const conv = (await convs.conversations([ALLIANCE])).find((c) => c.title.startsWith("Movement"))!;
      await convs.addSuggestion({ conversationId: conv.id, itemId: made.id, kind: "comment", forUser: ME, body: "Blake confirmed the gap is about 7.7k lb on 4417001.\nThe fix is in the development queue.", before: null, after: null, internal: [], day: "2026-11-02" });
      await main.getByRole("button", { name: "Refresh conversations" }).click();
      const tracked = main.getByRole("listitem", { name: "Movement Dashboard quantity gap on 4417001" });
      await tracked.getByRole("button", { name: /^Post comment/ }).waitFor();
      await shotBoth(page, "conversations-comment-suggestion", tracked);

      // My promises: the Wingtip promise, one, to Evan, due today 7:30 PM.
      await page.getByRole("navigation", { name: "Inbox modes" }).getByRole("button", { name: /^Promises/ }).click();
      const mine = page.getByRole("main", { name: "Promises" });
      const promise = mine.getByRole("listitem", { name: "Promise: Rerun the Salesforce data from CRM_Silver" });
      await promise.waitFor();
      await promise.getByText(/7:30 PM/).first().waitFor();
      await expect(mine.getByRole("listitem", { name: /^Promise: / }).count()).resolves.toBe(2);
      await shotBoth(page, "my-promises", mine);

      // Today: the promise under After your blocks.
      await page.keyboard.press("1");
      const after = page.locator(".day-outside").filter({ hasText: "After your blocks" });
      await after.getByText("Rerun the Salesforce data from CRM_Silver").waitFor();
      await after.getByText(/7:30\sPM/).waitFor();
      await shotBoth(page, "today-promise-after-blocks", page.getByRole("main", { name: "Today" }));

      // CV-3b: made a follow-up, its Who is the person it was promised to (Evan), never me.
      await page.keyboard.press("4");
      await page.getByRole("navigation", { name: "Inbox modes" }).getByRole("button", { name: /^Promises/ }).click();
      const card = page.getByRole("main", { name: "Promises" }).getByRole("listitem", { name: "Promise: Rerun the Salesforce data from CRM_Silver" });
      await card.getByRole("button", { name: "Make it a follow-up" }).click();
      await card.getByRole("button", { name: "Add follow-up" }).click();
      await card.getByText("A follow-up now", { exact: false }).waitFor();
      await page.getByRole("navigation", { name: "Inbox modes" }).getByRole("button", { name: /^Captures/ }).click();
      const row = page.locator("li.follow-up").filter({ hasText: "Rerun the Salesforce data from CRM_Silver" }).first();
      await row.waitFor();
      expect(await row.locator(".follow-up-who").textContent()).toMatch(/^Evan/);
      await shotBoth(page, "followup-who-row", row);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
