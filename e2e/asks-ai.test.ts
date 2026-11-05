// AP-2: AI sorts Requests (called asks until shared polling, D520), and Promises, the main path, in a real (not demo) session on fake sources, a fake Graph (Teams),
// a fake DevOps and the stub AI provider (it answers like OpenAI would, from the request's own context). With Use AI and
// Allow AI on for Adatum, an external message is sorted as a bug with a draft and "Looks like" an open item; another
// isn't sorted (the provider failed) and offers Sort again; a thanks-like message the AI calls none is hidden and can be
// shown. Create bug opens the preview with the AI's title and is confirmed. My own reply "I'll ..." becomes a promise
// that answers the Request; Make it a follow-up is prefilled and the follow-up shows in the Inbox. Edge cases are unit tests
// (plan/asks-ai.test.ts, actions/ask-ai.test.ts). Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { aiFor, requestContext } from "../actions/dispatch.ts";
import { pollCycle, type PollDeps } from "../actions/request-poll.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { aClassifyAnswer, anAiApp, aPromiseAnswer } from "../test/builders/index.ts";
import { CHROMIUM } from "./harness.ts";
import { liveBrowser, liveContext, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

const HOME = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CHAT = "19:adatum-collab@thread.v2";
const DANA = "00000000-0000-4000-8000-0000000000c1";
const LEE = "00000000-0000-4000-8000-0000000000c2";
const member = (userId: string, displayName: string, tenantId: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: `m-${userId}`, roles: [], displayName, userId, email: `${displayName.split(" ")[0]!.toLowerCase()}@${tenantId === HOME ? "contoso" : "fabrikam"}.example`, tenantId });
const MEMBERS = [member(ME, "Sam Tester", HOME), member(LEE, "Lee Colleague", HOME), member(DANA, "Dana Client", CLIENT)];

/** A fake Graph for one group chat: its listing, members and messages (newest first, filtered by lastModifiedDateTime). */
function fakeGraph() {
  const messages: Record<string, unknown>[] = [];
  let n = 0;
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const graphFetch = (async (input: string | URL) => {
    const u = new URL(String(input));
    const path = decodeURIComponent(u.pathname);
    if (path === "/v1.0/me/chats") return json({ value: [{ id: CHAT, chatType: "group", topic: "Adatum Customer Collaboration", webUrl: "https://teams.microsoft.com/l/chat/x", lastUpdatedDateTime: "2026-11-02T14:00:00Z", members: MEMBERS }] });
    if (path === `/v1.0/chats/${CHAT}/members`) return json({ value: MEMBERS });
    if (path === `/v1.0/chats/${CHAT}/messages`) {
      const since = Date.parse(/gt (\S+)/.exec(u.searchParams.get("$filter") ?? "")?.[1] ?? "1970-01-01T00:00:00Z");
      return json({ value: messages.filter((m) => Date.parse(String(m.lastModifiedDateTime)) > since).reverse() });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    fetch: graphFetch,
    say: (from: string, text: string, minute: number, o: Record<string, unknown> = {}) => {
      const at = `2026-11-02T14:${String(minute).padStart(2, "0")}:00Z`;
      messages.push({ id: String(1_730_000_000_000 + ++n), messageType: "message", createdDateTime: at, lastModifiedDateTime: at, from: { user: { id: from, tenantId: from === DANA ? CLIENT : HOME } }, body: { contentType: "text", content: text }, attachments: [], mentions: [], ...o });
    },
  };
}

/** The stub's answers, from what each request was given (never another client's data: the guard checks the input). */
function answer(c: ProviderCall): string {
  const input = JSON.parse(c.input) as { open_items: { id: number; title: string; type: string }[]; earlier_messages: { id: string; from: string; text: string }[]; message: { id: string; text: string } };
  const text = input.message.text;
  if (c.schemaName === "promises_extract") {
    const ask = [...input.earlier_messages].reverse().find((m) => m.from === "client" && /export/.test(m.text));
    return JSON.stringify(aPromiseAnswer({ what: "Send the fix for the March export", due_hint: "2026-11-03", to_whom: "Dana Client", answers_message_id: ask?.id ?? null, reason: "It commits to sending a fix." }));
  }
  if (/export fails/.test(text)) return JSON.stringify(aClassifyAnswer({ kind: "bug", urgency: "this_week", item_type: "bug", title: "March report export fails after page two", description: "Exporting the March report shows an error after the second page.", likely_existing_item: { id: (input.open_items.find((i) => i.type !== "Epic") ?? input.open_items[0]!).id, confidence: 0.8 }, reason: "It describes something broken in the export." }));
  if (/sounds good/i.test(text)) return JSON.stringify(aClassifyAnswer({ kind: "none", urgency: "backlog", item_type: null, title: "", description: "", reason: "It only agrees; nothing to do." }));
  return "";
}

describe.skipIf(!CHROMIUM)("AI sorts Requests, and Promises", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("a sorted bug is created from its draft; a promise becomes a follow-up", async () => {
    const graph = fakeGraph();
    const chats = createChatsClient({ fetch: graph.fetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
    // The second sort request fails once at the provider (the "region field" ask): Not sorted, then Sort again works.
    let failRegion = true;
    const provider = stubProvider({
      respond: (c) => {
        const r = answer(c);
        if (r) return r;
        if (failRegion) return { ok: false, kind: "provider", status: 500 };
        return JSON.stringify(aClassifyAnswer({ kind: "request", urgency: "now", item_type: "story", title: "Add the region field to the summary view", description: "The client wants the region field in the summary view.", reason: "It asks for a change today." }));
      },
    });
    const ctx = await liveContext({
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
        ai: { app: anAiApp({ provider: "openai", model: "gpt-6-luna" }), provider: async () => provider, appSpend: { get: async () => 0, add: async () => {} } },
      },
    });
    await ctx.writeConfig!((t) => `${t}\n[ai]\nuse = true\nallowed_clients = ["Adatum"]\n`);
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    // The shared store with the chat registered for Adatum by me, and the poll job (Refresh polls through it).
    const clock = () => Temporal.Instant.from(ctx.now());
    const teams = createTeamsStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") })), clock);
    const deps: PollDeps = {
      teams,
      users: async () => [{ id: ME, name: "Sam Tester", deleted: false }],
      person: async (uid) => {
        if (uid !== ME) return null;
        const loaded = await ctx.loadConfig();
        return { name: "Sam Tester", config: loaded.parsed.ok ? loaded.parsed.config : null, chatMessages: chats, chats, ai: () => aiFor(ctx), plan: ctx.plan ?? null, openItems: (await requestContext(ctx)).openItems };
      },
      homeTenant: async () => HOME,
      now: ctx.now,
      log: () => {},
    };
    ctx.requests = { teams, refresh: (chatIds) => pollCycle(deps, { force: true, chatIds }) };
    ctx.admins = [ME]; // D522: I register the chat
    await teams.addChat({ chatId: CHAT, clientKey: "Adatum", kind: "customer", displayName: "Adatum Customer Collaboration", webUrl: "https://teams.microsoft.com/l/chat/x", members: MEMBERS.map((m) => ({ userId: m.userId, displayName: m.displayName, email: null, tenantId: m.tenantId })), by: ME });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();

      graph.say(DANA, "Can you check why the export fails for the March report?\nIt shows an error after the second page.", 32);
      graph.say(DANA, "Please add the region field to the summary view", 34);
      graph.say(DANA, "Sounds good, can we keep Thursday's call?", 36);

      await page.goto(`${app.url}#/inbox/requests`);
      await page.getByRole("button", { name: "Refresh requests" }).click();
      const bugCard = page.getByRole("listitem", { name: "Request from Dana Client" }).filter({ hasText: "export fails" });
      await bugCard.locator(".ask-label").getByText("Bug").waitFor();
      await bugCard.getByText("Looks like").waitFor();
      await bugCard.getByText("March report export fails after page two").waitFor();
      const region = page.getByRole("listitem", { name: "Request from Dana Client" }).filter({ hasText: "region field" });
      await region.getByText(/^Not sorted:/).waitFor();
      await shotBoth(page, "requests-sorted", page.locator(".ask-group").first());

      // The AI called the third one none: hidden, and Show it anyway brings it back as a card.
      const hidden = page.getByRole("region", { name: "Hidden by AI" });
      await hidden.getByText("Hidden by AI (1)").waitFor();
      await hidden.getByText("Hidden by AI (1)").click();
      await shotBoth(page, "requests-hidden", hidden);
      await hidden.getByRole("button", { name: "Show it anyway" }).click();
      await page.getByRole("listitem", { name: "Request from Dana Client" }).filter({ hasText: "Thursday's call" }).waitFor();

      // Sort again on the one that failed: it sorts now (a request, urgent).
      failRegion = false;
      await region.getByRole("button", { name: "Sort again" }).click();
      await region.locator(".ask-label").getByText("Request").waitFor();

      // Urgent ("now"): a walk-on in Today's attention line with Start focus.
      await page.goto(`${app.url}#/today`);
      const walkOn = page.locator(".att-chip.urgent").filter({ hasText: "Add the region field to the summary view" });
      await walkOn.getByText("Walked in").waitFor();
      await walkOn.getByRole("button", { name: "Start focus" }).waitFor();
      await shotBoth(page, "requests-walk-on", page.locator("section.attention"));
      await page.goto(`${app.url}#/inbox/requests`);

      // Create bug: the preview carries the AI's title and description with the message; confirm.
      await bugCard.getByRole("button", { name: /^Create bug/ }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      await preview.getByText("New Bug: March report export fails after page two").waitFor();
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await preview.waitFor({ state: "detached" });
      const bug = [...dv.items.values()].find((i) => i.fields["System.WorkItemType"] === "Bug")!;
      expect(bug.fields["System.Title"]).toBe("March report export fails after page two");
      expect(String(bug.fields["Microsoft.VSTS.TCM.ReproSteps"])).toContain("second page");
      await bugCard.getByText(`#${bug.id} March report export fails after page two`).waitFor();

      // My reply commits to something: a promise that answers the Request.
      graph.say(ME, "I'll send a fix for the March export tomorrow", 40);
      await page.getByRole("button", { name: "Refresh requests" }).click();
      await bugCard.getByText("Promised: Send the fix for the March export").waitFor();
      await page.getByRole("tab", { name: /^Promises/ }).click();
      const promise = page.getByRole("listitem", { name: "Promise: Send the fix for the March export" });
      await promise.getByText("To Dana Client").waitFor();
      await promise.getByText(/^Answers:/).waitFor();
      await shotBoth(page, "promises", page.getByRole("main", { name: "Promises" }));
      await promise.getByRole("button", { name: "Make it a follow-up" }).click();
      await expect(promise.getByLabel("What").inputValue()).resolves.toBe("Send the fix for the March export");
      await expect(promise.getByLabel(/^Who/).inputValue()).resolves.toBe("Dana Client");
      await expect(promise.getByLabel(/^Due/).inputValue()).resolves.toBe("2026-11-03");
      await promise.getByRole("button", { name: "Add follow-up" }).click();
      await promise.getByText("Follow-up added. It closes when the follow-up is done").waitFor();
      await page.getByRole("tab", { name: /^Inbox/ }).click();
      await page.getByText("Send the fix for the March export").first().waitFor();
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
