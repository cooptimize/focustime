// CV-4 chat images without storage, the main path, in a real (not demo) session on a fake Graph, a fake AI behind the
// real ai/ service and a fake DevOps. An admin turns on "Send attachments to AI" for the client in Admin › AI; the
// client pastes three images (one Teams can no longer give); Refresh reads the chat and sends the two readable images
// with the batch, labelled with their message; their descriptions show on the card ("3 images: ...") and under the
// thumbnails, read from Teams on view; the third shows "Image in Teams" with Open in Teams. Create DevOps item: the preview
// lists the images with checkboxes, all ticked; one unticked; confirm uploads the rest with my token and links them to
// the new item. Nothing is stored. Edge cases are unit tests (actions/chat-images, actions/conversation-images,
// actions/devops-write). Fictional names. Screenshots at 1920, Larger and the phone when FOCUSTIME_SHOTS is set.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { requestContext } from "../actions/dispatch.ts";
import { pollCycle, type PollDeps } from "../actions/request-poll.ts";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
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
import { chartPng } from "../test/images.ts";
import { CHROMIUM, openInboxItem, openInboxView, openSettings } from "./harness.ts";
import { liveAdminOps, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { SHOTS, shotBoth } from "./shots.ts";

const HOME = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ALLIANCE = "19:adatum-images@thread.v2";
const BLAKE = "00000000-0000-4000-8000-0000000000c1";
const NAMES: Record<string, string> = { [ME]: "Sam Tester", [BLAKE]: "Blake Novak" };
const member = (userId: string, tenantId: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: `m-${userId}`, roles: [], displayName: NAMES[userId], userId, email: `${NAMES[userId]!.split(" ")[0]!.toLowerCase()}@${tenantId === HOME ? "contoso" : "fabrikam"}.example`, tenantId });
const MEMBERS = [member(ME, HOME), member(BLAKE, CLIENT)];
const HOSTED = { a: "aWQ9eDtpbWc9MQ==", b: "aWQ9eDtpbWc9Mg==", gone: "aWQ9eDtpbWc9Mw==" };
const DESCRIPTIONS: Record<string, string> = { i1: "Bar chart: October totals about 4% under the finance report", i2: "Refresh failed error: gateway timeout after 30 minutes" };

function fakeGraph() {
  const messages: Record<string, unknown>[] = [];
  const images: Record<string, Uint8Array> = { [HOSTED.a]: chartPng(480, 300), [HOSTED.b]: chartPng(420, 300, [170, 60, 60]) };
  const hostedCalls: string[] = [];
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const fetch = (async (input: string | URL) => {
    const u = new URL(String(input));
    const path = decodeURIComponent(u.pathname);
    if (path === "/v1.0/me/chats") return json({ value: [{ id: ALLIANCE, chatType: "group", topic: "Adatum Analytics Alliance", webUrl: "https://teams.microsoft.com/l/chat/x", lastUpdatedDateTime: "2026-11-02T14:00:00Z", members: MEMBERS }] });
    if (path === `/v1.0/chats/${ALLIANCE}/members`) return json({ value: MEMBERS });
    if (path === `/v1.0/chats/${ALLIANCE}/messages`) return json({ value: [...messages].reverse() });
    const hosted = /\/hostedContents\/([^/]+)\/\$value$/.exec(path);
    if (hosted) {
      hostedCalls.push(hosted[1]!);
      const b = images[hosted[1]!];
      return b ? new Response(Buffer.from(b), { status: 200, headers: { "content-type": "image/png" } }) : new Response("", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  let n = 0;
  const say = (from: string, html: string, minute: number) => {
    const at = `2026-11-02T14:${String(30 + minute).padStart(2, "0")}:00Z`;
    const id = String(1_730_000_000_000 + ++n);
    messages.push({ id, messageType: "message", createdDateTime: at, lastModifiedDateTime: at, from: { user: { id: from, displayName: NAMES[from], tenantId: from === BLAKE ? CLIENT : HOME } }, body: { contentType: "html", content: html.replace(/\{msg\}/g, id) }, attachments: [], mentions: [], reactions: [] });
    return id;
  };
  return { fetch, hostedCalls, say };
}
const img = (hosted: string, w: number) => `<p><img src="https://graph.microsoft.com/v1.0/chats/${ALLIANCE}/messages/{msg}/hostedContents/${hosted}/$value" width="${w}" height="300" alt="image" itemtype="http://schema.skype.com/AMSImage"></p>`;

/** One conversation; my reply commits to a ticket; a description for each image given (by its label). */
function answer(c: ProviderCall): string {
  const input = JSON.parse(c.input) as { people: { ref: string; name: string }[]; messages: { ref: string; from: string }[] };
  const me = input.people.find((p) => p.name === "Sam Tester")?.ref ?? "p1";
  const a: UpdateAnswer & { images?: { ref: string; description: string }[] } = {
    messages: input.messages.map((m) => ({ ref: m.ref, kind: "work", conversation: "n1", confident_new_topic: false })),
    conversations: [{ ref: "n1", title: "Dashboard refresh fails overnight", summary: "Blake pasted the totals chart and the refresh error.\nSam will log a bug.", owner: me, wrapped_up: false, change: "Sam will log a bug", item_change: null, scope_changed: false, likely_item: null,
      commitments: [{ who: me, what: "Log a bug for the overnight refresh", due: null, to: null, implies_item: true, messages: input.messages.filter((m) => m.from === me).map((m) => m.ref), status_only: false }] }],
  };
  if (c.images) a.images = c.images.map((i) => /^Image (i\d+),/.exec(i.label)![1]!).map((ref) => ({ ref, description: DESCRIPTIONS[ref] ?? "An image" }));
  return JSON.stringify(a);
}

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

describe.skipIf(!CHROMIUM)("Chat images, CV-4", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("the switch, images described in the same AI request, read on view, Open in Teams when gone, attached to the new DevOps item", async () => {
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
    const calls: ProviderCall[] = [];
    const provider = stubProvider({ respond: (c) => (calls.push(c), answer(c)) });
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
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();

      // Admin › Clients: register the chat. Admin › AI: Send attachments to AI for Adatum.
      await openSettings(page);
      await page.locator('.ps-rail [data-settings-section="admin-clients"]').click();
      const adatum = page.getByRole("group", { name: /^Delivery chats for Adatum/ });
      await adatum.getByRole("button", { name: "Add a chat" }).click();
      await adatum.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option").first().waitFor();
      await page.keyboard.type("alliance");
      await page.keyboard.press("Enter");
      await adatum.getByText(/^Added Adatum .*\. Read from now on/).waitFor();
      await page.locator('.ps-rail [data-settings-section="admin-ai"]').click();
      const sw = page.getByRole("switch", { name: "Send attachments to AI for Adatum" });
      await sw.check();
      await expect.poll(async () => {
        const l = await ctx.loadConfig();
        return l.parsed.ok ? l.parsed.config.org?.clients.Adatum?.attachmentsAi : null;
      }).toBe(true);
      await page.keyboard.press("Escape");

      // Blake pastes the chart, the error and a third image Teams won't give; I say I'll log a bug.
      graph.say(BLAKE, `<p>The overnight refresh failed again. Totals and the error:</p>${img(HOSTED.a, 480)}${img(HOSTED.b, 420)}${img(HOSTED.gone, 300)}`, 1);
      graph.say(ME, "<p>Thanks Blake, I'll log a bug for the overnight refresh.</p>", 3);

      // Refresh: one AI request with the two readable images after their message's label.
      // The Inbox opens a view's first item at once, so Refresh runs from Captures and drafts (no conversation open).
      await page.keyboard.press("4");
      const caps = await openInboxView(page, "captures");
      await caps.getByRole("button", { name: "Refresh conversations" }).click();
      await page.getByText("Chats read").first().waitFor();
      const withImages = calls.filter((c) => c.images?.length);
      expect(withImages).toHaveLength(1);
      expect(withImages[0]!.images!.map((i) => i.label)).toEqual(["Image i1, in message m1:", "Image i2, in message m1:"]);
      expect(await conn.all("SELECT id FROM teams_message_images WHERE bytes IS NOT NULL")).toEqual([]);

      // Opened, the messages show: read from Teams now with my token; descriptions under the thumbnails; the third: Open in Teams.
      graph.hostedCalls.length = 0;
      await openInboxView(page, "needs-you");
      const card = await openInboxItem(page, "Dashboard refresh fails overnight");
      await card.getByText("3\u00a0images: Bar chart: October totals about 4% under the finance report").waitFor();
      const thread = card.getByRole("list", { name: "The messages" });
      const thumbs = thread.locator(".tm-thumb img");
      await expect.poll(() => thumbs.evaluateAll((xs) => xs.map((x) => (x as HTMLImageElement).naturalWidth))).toEqual([480, 420]);
      await thread.getByText("Refresh failed error: gateway timeout after 30 minutes").waitFor();
      const gone = thread.locator(".tm-image-gone");
      await gone.getByText("Image in Teams").waitFor();
      expect(await gone.getByRole("link", { name: "Open in Teams" }).getAttribute("href")).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/message\//);
      expect([...new Set(graph.hostedCalls)].sort()).toEqual([HOSTED.a, HOSTED.b, HOSTED.gone].sort());
      const src = await thumbs.first().getAttribute("src");
      const headers = await page.evaluate(async (u) => Object.fromEntries((await fetch(u!)).headers), src);
      expect(headers["cache-control"]).toBe("no-store");
      await shotAll(page, "cv4-images-described", card);

      // Create DevOps item: the preview lists the images (all ticked); untick the second; confirm attaches the rest.
      await card.getByRole("button", { name: /^Create DevOps item/ }).first().click();
      const draft = card.getByRole("form", { name: "Create DevOps item" });
      await draft.getByRole("textbox", { name: /^Title/ }).waitFor();
      // CV-5: without AI for my draft the form is empty; I type the title.
      const title = draft.getByRole("textbox", { name: /^Title/ });
      if (!(await title.inputValue())) await title.fill("Overnight refresh fails");
      await draft.getByRole("button", { name: "Preview in DevOps" }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      const pick = preview.getByRole("group", { name: /^Attach 3 images/ });
      await pick.getByText("· 3 of 3").waitFor();
      await shotAll(page, "cv4-create-preview-images", pick);
      await pick.getByRole("checkbox", { name: /^Attach image 2 from Blake Novak/ }).click();
      await pick.getByText("· 2 of 3").waitFor();
      await preview.getByText(/Attached: 2 images from the chat\./).waitFor();
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await preview.waitFor({ state: "detached" });
      const made = [...dv.items.values()].at(-1)!;
      // The first image and the gone one were ticked: one attached, the gone one reported and left out.
      expect(made.relations.filter((r) => r.rel === "AttachedFile")).toHaveLength(1);
      expect(dv.attachments.size).toBe(1);
      await page.getByText(new RegExp(`Created #${made.id} in DevOps with 1 image\\. 1 image couldn't be read`)).first().waitFor();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
