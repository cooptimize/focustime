// CV-2 Conversations and My promises fixes, the main path, in a real (not demo) session on a fake Graph and a fake AI
// behind the real ai/ service. A client chat with a pasted chart (two hosted images), reactions and a quoted reply:
// Show messages shows them like Teams, the thumbnails come only from FocusTime's /media/chat-images/<id> (stripped,
// never a Graph URL), the viewer opens with Next and Esc. A teammate's topic is merged into mine and undone. My
// promises: Make it a follow-up with Who prefilled through the PersonPicker; an overdue loose promise ("I'll log a
// ticket") is amber "Was due" with Create DevOps item, which opens the draft. Today's urgent strip: an
// urgent line opens its conversation (#/inbox/conversation/<id>). Edge cases are unit tests (actions/chat-images,
// actions/promise-fixes, actions/people-picker, actions/conversation-merge, ui/PersonPicker). Fictional names. Screenshots
// at 1920, Text size Larger and the phone (390 wide, a 17px root font as on iPhone) when FOCUSTIME_SHOTS is set.
import type { Page } from "playwright-core";
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
import { aDirectoryPerson, anAiApp, anAiRules } from "../test/builders/index.ts";
import { chartPng, SECRET } from "../test/images.ts";
import { CHROMIUM, openInboxItem, openInboxView, openSettings } from "./harness.ts";
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
const img = (chat: string, hosted: string, w: number) => `<p><img src="https://graph.microsoft.com/v1.0/chats/${chat}/messages/{msg}/hostedContents/${hosted}/$value" width="${w}" height="300" alt="image" itemtype="http://schema.skype.com/AMSImage"></p>`;

/** The fake provider: the Alliance chat is two topics (my totals, Lena's refresh); the Delivery chat is work, unplaced. */
function answer(inputText: string): string {
  const input = JSON.parse(inputText) as { people: { ref: string; name: string }[]; messages: { ref: string; from: string; text: string }[] };
  const ref = (name: string) => input.people.find((p) => p.name === name)?.ref ?? null;
  if (input.messages.some((m) => /log a ticket/.test(m.text))) return JSON.stringify({ messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: null, confident_new_topic: false })), conversations: [] } satisfies UpdateAnswer);
  const lena = input.messages.filter((m) => /refresh/.test(m.text)).map((m) => m.ref);
  const mine = input.messages.filter((m) => m.from === ref("Sam Tester")).map((m) => m.ref);
  const a: UpdateAnswer = {
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: lena.includes(m.ref) ? "n2" : "n1", confident_new_topic: lena.includes(m.ref) })),
    conversations: [
      { ref: "n1", title: "October totals on the Movement Dashboard", summary: "Blake sees October totals about 4% lower than the finance report and pasted the chart.\nEvan traced it to the date filter.\nSam will send corrected totals tomorrow.", owner: ref("Sam Tester"), wrapped_up: false, change: "Sam will send corrected totals tomorrow", item_change: null, scope_changed: false, likely_item: null,
        commitments: [{ who: ref("Sam Tester")!, what: "Send Blake the corrected October totals", due: "2026-11-03", to: ref("Blake Novak"), implies_item: false, messages: mine, status_only: false }] },
      { ref: "n2", title: "Dashboard refresh time", summary: "Blake asks whether the refresh can move to 6 AM.\nLena is moving it.", owner: ref("Lena Hart"), wrapped_up: false, change: "Lena is moving it", item_change: null, scope_changed: false, likely_item: null,
        commitments: [{ who: ref("Lena Hart")!, what: "Move the refresh to 6 AM", due: null, to: ref("Blake Novak"), implies_item: false, messages: lena.filter((r) => input.messages.find((m) => m.ref === r)?.from === ref("Lena Hart")), status_only: false }] },
    ],
  };
  return JSON.stringify(a);
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

describe.skipIf(!CHROMIUM)("Conversations, CV-2", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("Teams-style messages with images and the viewer, a merge with Undo, the PersonPicker, an overdue loose promise with the DevOps offer, an urgent line to its conversation", async () => {
    const graph = fakeGraph();
    const chats = createChatsClient({ fetch: graph.fetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: HOME, name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
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

      // The client's question with a pasted chart (two images) and reactions, a quoted reply, my commitment; Lena's topic.
      const ask = graph.say(ALLIANCE, BLAKE, `<p>The October totals on the Movement Dashboard are about 4% lower than the finance report. Here is what I see:</p>${img(ALLIANCE, HOSTED.a, 480)}${img(ALLIANCE, HOSTED.b, 420)}`, 1, { reactions: ["like", "like", "👀"] });
      graph.say(ALLIANCE, EVAN, "<p>Looking now. The date filter stops at the 30th, so the 31st is missing.</p>", 4, { quotes: ask, reactions: ["heart"] });
      graph.say(ALLIANCE, ME, `<p><at id="0">Blake Novak</at> I'll send you corrected totals tomorrow.</p>`, 6, { mentions: [BLAKE] });
      graph.say(ALLIANCE, BLAKE, "<p>Separate thing: can the dashboard refresh move to 6 AM?</p>", 9);
      graph.say(ALLIANCE, LENA, "<p>Yes, I'll move the refresh to 6 AM today.</p>", 10);
      graph.say(DELIVERY, EVAN, "<p>The filter bug needs to be tracked somewhere.</p>", 12);
      const ticket = graph.say(DELIVERY, ME, "<p>I'll log a ticket for the filter.</p>", 13);

      // The Inbox (IB-1): Refresh reads the chats; the conversation opens in the detail pane.
      // CV-4: the poll never reads images; they are read from Teams when shown, with the viewer's token. The Inbox opens a
      // view's first item at once, so Refresh runs from Captures and drafts, where no conversation is open.
      await page.keyboard.press("4");
      const caps = await openInboxView(page, "captures");
      await caps.getByRole("button", { name: "Refresh conversations" }).click();
      await page.getByText("Chats read").first().waitFor();
      expect(graph.hostedCalls).toEqual([]);
      const main = await openInboxView(page, "needs-you");
      const totals = await openInboxItem(page, "October totals on the Movement Dashboard");

      // The messages, in the pane: grouped like Teams, the quote, the reactions, and the two thumbnails from FocusTime's own address.
      const thread = totals.getByRole("list", { name: "The messages" });
      await thread.getByText(/date filter stops at the 30th/).waitFor();
      await thread.getByLabel("👍 2, 👀 1").waitFor();
      const thumbs = thread.getByRole("list", { name: "2 images" }).locator("img");
      await expect.poll(() => thumbs.evaluateAll((xs) => xs.map((x) => (x as HTMLImageElement).naturalWidth))).toEqual([480, 420]);
      expect([...new Set(graph.hostedCalls)].sort()).toEqual([HOSTED.a, HOSTED.b].sort());
      const srcs = await thumbs.evaluateAll((xs) => xs.map((x) => (x as HTMLImageElement).getAttribute("src")));
      for (const s of srcs) expect(s).toMatch(/^\/media\/chat-images\/\d+$/);
      expect(await page.content()).not.toMatch(/graph\.microsoft\.com|hostedContents/);
      // The bytes served are stripped.
      const served = await page.evaluate(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()).length, srcs[0]!);
      expect(served).toBeGreaterThan(1000);
      const text = await page.evaluate(async (u) => new TextDecoder("latin1").decode(await (await fetch(u)).arrayBuffer()), srcs[0]!);
      expect(text).not.toContain(SECRET.place);
      await shotAll(page, "cv2-messages-images", totals);

      // The viewer: the first image, Next, Esc.
      await thread.getByRole("button", { name: "Open image 1 of 2" }).click();
      const viewer = page.getByRole("dialog", { name: "Image 1 of 2" });
      await viewer.waitFor();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("dialog", { name: "Image 2 of 2" }).waitFor();
      await shotAll(page, "cv2-image-viewer");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: /^Image \d of 2/ }).waitFor({ state: "detached" });

      // Merge: Lena's topic (Handled by teammates) into mine, then Undo.
      await main.getByRole("navigation", { name: "Inbox views and clients" }).getByRole("button", { name: /^Handled by teammates\s*1/ }).click();
      const refresh = await openInboxItem(page, "Dashboard refresh time");
      await refresh.getByRole("button", { name: "More for Dashboard refresh time" }).click();
      await refresh.getByRole("menuitem", { name: "Merge into…" }).click();
      const mergeForm = refresh.getByRole("group", { name: "Merge Dashboard refresh time into another conversation" });
      await mergeForm.getByRole("button", { name: /October totals on the Movement Dashboard/ }).waitFor();
      await shotAll(page, "cv2-merge", mergeForm);
      await mergeForm.getByRole("button", { name: /October totals on the Movement Dashboard/ }).click();
      await main.getByText(/Merged into "October totals on the Movement Dashboard" for everyone on the chat/).waitFor();
      await expect.poll(async () => (await convs.conversations([ALLIANCE])).filter((c) => !c.mergedInto).length).toBe(1);
      await main.getByRole("button", { name: "Undo" }).click();
      await main.getByText("Merge undone").first().waitFor();
      await expect.poll(async () => (await convs.conversations([ALLIANCE])).filter((c) => !c.mergedInto).length).toBe(2);

      // A loose promise from the Delivery chat (rules found it there; nothing grouped it), due last Friday: overdue.
      await convs.addCommitment({ conversationId: null, chatId: DELIVERY, clientKey: "Adatum", whoId: ME, whoName: "Sam Tester", toId: EVAN, toName: "Evan Ford", what: "Log a ticket for the filter bug", dueAt: null, dueDate: "2026-10-30", impliesItem: true, messageIds: [ticket], reason: "You said you'd log a ticket" });

      // The directory (ADM-2, after the app's own read of the fake Dataverse): who's at Cooptimize, Adatum's Account Workers.
      const ARI = "00000000-0000-4000-8000-0000000000c4";
      const dirPerson = (personId: string, name: string, n: number) => aDirectoryPerson({ personId, systemUserId: `d3300000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`, name, email: `${name.split(" ")[0]!.toLowerCase()}@contoso.example` });
      await team.store.replaceDirectory([dirPerson(ME, "Sam Tester", 1), dirPerson(EVAN, "Evan Ford", 2), dirPerson(LENA, "Lena Hart", 3), dirPerson(ARI, "Ari Quinn", 4), dirPerson("00000000-0000-4000-8000-0000000000c5", "Nova Lane", 5), dirPerson("00000000-0000-4000-8000-0000000000c6", "Theo Marsh", 6)], [], [{ personId: ARI, clientKey: "Adatum", worker: true }, { personId: LENA, clientKey: "Adatum", worker: true }]);
      team.org.invalidate();
      // Promises (IB-1: no Make it a follow-up): Who on mine to Blake, prefilled through the PersonPicker.
      const myp = await openInboxView(page, "promises");
      const sendTotals = await openInboxItem(page, "Send Blake the corrected October totals");
      await expect(page.locator(".ib-row", { hasText: "Send Blake the corrected October totals" }).first().textContent()).resolves.toContain("For Blake Novak");
      await sendTotals.getByRole("button", { name: "Who", exact: true }).click();
      const who = sendTotals.getByRole("combobox", { name: "Who" });
      await expect.poll(() => who.inputValue()).toBe("Blake Novak");
      await sendTotals.getByText("External").first().waitFor();
      await who.fill("");
      const pop = sendTotals.getByRole("listbox", { name: "Choose who" });
      await pop.getByRole("group", { name: "In this conversation" }).getByRole("option", { name: /Evan Ford/ }).waitFor();
      await pop.getByRole("group", { name: "On Adatum" }).getByRole("option", { name: /Ari Quinn/ }).waitFor();
      await pop.getByRole("group", { name: "Everyone at Cooptimize" }).getByRole("option", { name: /Nova Lane/ }).waitFor();
      await shotAll(page, "cv2-person-picker", sendTotals);
      await page.keyboard.press("Escape");
      await sendTotals.getByRole("button", { name: "Cancel" }).click();

      // The overdue loose promise: amber "3 days late", Close the loop leads (it's late), Create DevOps item opens the draft.
      // It was added behind the page's back: Refresh reads the Inbox again.
      await myp.getByRole("button", { name: "Refresh conversations" }).click();
      const loose = await openInboxItem(page, "Log a ticket for the filter bug");
      await loose.locator(".ib-pill.late", { hasText: /days? late/ }).waitFor();
      expect(await loose.locator(".ib-pill.late").evaluate((e) => getComputedStyle(e).color)).not.toMatch(/rgb\((2[0-5]\d|1[5-9]\d), (\d|[1-5]\d), (\d|[1-5]\d)\)/);
      await loose.getByRole("button", { name: /^Create DevOps item/ }).waitFor();
      await shotAll(page, "cv2-my-promises-overdue", myp);
      await loose.getByRole("button", { name: /^Create DevOps item/ }).click();
      await loose.getByRole("form", { name: "Create DevOps item" }).getByRole("textbox", { name: /^Title/ }).waitFor();
      expect((await convs.commitmentsInChat(DELIVERY))[0]!.conversationId).not.toBeNull();
      await loose.getByRole("button", { name: "Cancel" }).first().click();

      // Today's urgent strip: an urgent request from the totals conversation opens it; the overdue promise is amber "was due".
      await teams.addRequest({ chatId: ALLIANCE, messageId: ask, clientKey: "Adatum", rule: "question", ruleDetail: null, at: "2026-11-02T14:31:00Z" });
      await teams.setSort(ALLIANCE, ask, "sorted", { kind: "question", urgency: "now", itemType: null, title: "October totals look 4% low", description: "", likely: null, reason: "A client question about today's numbers" }, "ai");
      // Today's data is read when it opens.
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();
      const strip = page.getByRole("region", { name: "Urgent" });
      await strip.getByText("October totals look 4% low").waitFor();
      await strip.getByText(/Promise · was due Fri, Oct 30/).waitFor();
      await shotAll(page, "cv2-urgent-strip", strip);
      await strip.getByRole("button", { name: /October totals look 4% low/ }).click();
      const conv = (await convs.conversations([ALLIANCE])).find((c) => c.title.startsWith("October"))!;
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/inbox/item/v${conv.id}`);
      const opened = page.locator(".ib-pane");
      await opened.locator(".ib-detail-title", { hasText: "October totals on the Movement Dashboard" }).waitFor();
      await expect(page.locator(`.ib-row[data-key="v${conv.id}"]`).getAttribute("aria-current")).resolves.toBe("true");
      await shotAll(page, "cv2-urgent-opens-conversation", opened);

      expect(graphRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
