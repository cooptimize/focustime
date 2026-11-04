// AP-1: Asks, the main path, in a real (not demo) session on fake sources and a fake Graph (Teams) and DevOps. Register
// a client chat in Settings > Clients, switch Read for asks on, a message from someone outside Cooptimize arrives,
// Refresh in Inbox › Asks shows it as a card (author flagged External, the rule that matched), Show context opens the
// message before it, Create bug previews and creates it through the write framework, and the card resolves with the
// new item. Dismiss with Undo, and the empty state. Edge cases are unit tests (actions/ask-actions.test.ts,
// actions/devops-write.test.ts, plan/asks.test.ts). Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { CHROMIUM, openSettings } from "./harness.ts";
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

describe.skipIf(!CHROMIUM)("Asks", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("register a chat, switch it on, an external message arrives, create a bug, the card resolves", async () => {
    const graph = fakeGraph();
    const chats = createChatsClient({ fetch: graph.fetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    // The fake Dataverse's DevOps identity for Adatum is me@contoso.example on org "contoso".
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
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
      },
    });
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();

      // Settings > Clients: add the chat to Adatum, then switch Read for asks on.
      await openSettings(page);
      await page.locator(".set-nav").getByRole("button", { name: "Clients" }).click();
      const adatum = page.getByRole("group", { name: /^Delivery chats for Adatum/ });
      await adatum.getByRole("button", { name: "Add a chat" }).click();
      await adatum.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option").first().waitFor();
      await page.keyboard.type("adatum");
      await page.keyboard.press("Enter");
      const card = adatum.getByRole("region", { name: "Adatum Customer Collaboration" });
      const sw = card.getByRole("switch", { name: "Read for asks" });
      await expect(sw.isChecked()).resolves.toBe(false);
      await sw.click();
      await adatum.getByText("Reading for asks from now on").waitFor();
      await expect.poll(() => sw.isChecked()).toBe(true);
      await shotBoth(page, "asks-settings", card);

      // Messages arrive in Teams: a colleague's, then three from the client (one with a file); one is only thanks.
      graph.say(LEE, "Morning, the import ran fine overnight.", 31);
      graph.say(DANA, "Can you check why the export fails for the March report?\nIt shows an error after the second page.", 32);
      graph.say(DANA, "thanks!", 33);
      graph.say(DANA, "Please add the region field to the summary view", 34);
      graph.say(DANA, "Here is the file from finance", 35, { attachments: [{ contentType: "reference", name: "totals.xlsx" }] });

      // Inbox › Asks: Refresh reads Teams now.
      await page.keyboard.press("Escape");
      await page.keyboard.press("4");
      await page.getByRole("tab", { name: /^Asks/ }).click();
      await page.getByRole("main", { name: "Asks" }).getByText("No open asks").waitFor();
      await page.getByRole("button", { name: "Refresh asks" }).click();
      const asks = page.locator(".ask-card");
      await expect.poll(() => asks.count()).toBe(3);
      await expect(page.getByRole("tab", { name: /^Asks/ }).textContent()).resolves.toBe("Asks3");
      const first = page.getByRole("listitem", { name: "Ask from Dana Client" }).filter({ hasText: "export fails" });
      await expect(first.locator(".ask-ext").textContent()).resolves.toBe("External");
      await first.getByText("Matched: asks a question").waitFor();
      await page.getByRole("listitem", { name: "Ask from Dana Client" }).filter({ hasText: "file from finance" }).getByText("File attached").waitFor();

      // Show context (X on the selected card, here by its button): the colleague's message before it.
      await first.getByRole("button", { name: /Show context/ }).click();
      await first.getByText("Morning, the import ran fine overnight.").waitFor();
      await shotBoth(page, "asks-cards", page.locator(".ask-group").first());

      // Create bug: the preview, then Create in DevOps; the card resolves with the new item.
      await first.getByRole("button", { name: /^Create bug/ }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      await preview.getByText("New Bug: Can you check why the export fails for the March report?").waitFor();
      await preview.getByText(/From Dana Client in Teams/).waitFor();
      await shotBoth(page, "asks-create-preview", preview);
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await preview.waitFor({ state: "detached" });
      const bug = [...dv.items.values()].find((i) => i.fields["System.WorkItemType"] === "Bug")!;
      expect(bug.fields["System.Title"]).toBe("Can you check why the export fails for the March report?");
      await first.getByText(`#${bug.id} Can you check why the export fails for the March report?`).waitFor();
      await expect.poll(() => page.getByRole("tab", { name: /^Asks/ }).textContent()).toBe("Asks2");

      // D dismisses the selected ask, Undo brings it back; then both go and the empty state shows, the count hidden.
      await page.locator(".ask-card.selected").focus();
      await page.keyboard.press("d");
      await page.locator(".co-notice").getByText("Dismissed.").waitFor();
      await page.locator(".co-notice").getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => page.getByRole("tab", { name: /^Asks/ }).textContent()).toBe("Asks2");
      await page.locator(".ask-card:not(.resolved)").first().getByRole("button", { name: /^Dismiss/ }).click();
      await page.locator(".ask-card:not(.resolved)").first().getByRole("button", { name: /^Dismiss/ }).click();
      await page.getByRole("main", { name: "Asks" }).getByText("No open asks").waitFor();
      await expect.poll(() => page.getByRole("tab", { name: /^Asks/ }).textContent()).toBe("Asks");
      await shotBoth(page, "asks-empty");
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
