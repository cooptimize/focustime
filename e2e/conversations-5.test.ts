// CV-5, the main path, in a real (not demo) session on fake Teams rows and a fake DevOps. A conversation In discussion
// (Create used to be under ⋯ only) leads with Create DevOps item; AI isn't on, so the form is empty and I fill it in;
// the preview says who will see it; confirm creates it once, and the card moves to In progress with the item's live
// state. A promise that implied no item (it had no Create at all) leads with Create DevOps item too; Link to item
// searches the client's items in scope, with "Also add a comment" going through the comment's own preview; the
// promise stays open with its item; when the item closes in DevOps it shows Item closed with Mark done, never done by
// itself. Edge cases are unit tests (actions/conversation-create, actions/devops-write). Fictional names. Screenshots
// at 1920 and 1366, light and dark, Larger, and the phone when FOCUSTIME_SHOTS is set.
import type { Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { AheadItem } from "../actions/types.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { Pat } from "../sources/devops/pat.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import type { WorkItem } from "../week/types.ts";
import { CHROMIUM, openInboxItem, openInboxView } from "./harness.ts";
import { liveBrowser, liveContext, ME, T, type LiveBrowser } from "./live.ts";
import { SHOTS } from "./shots.ts";

const HOME = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const CHAT = "19:adatum-cv5@thread.v2";
const BLAKE = "00000000-0000-4000-8000-0000000000c1";

/** Each shot at 1920 and 1366 in light and dark, at Larger, and at the phone width (iOS-like root font, no sideways scroll). */
async function shots(page: Page, name: string, keep: Locator) {
  if (!SHOTS) return;
  for (const [w, h] of [[1920, 1080], [1366, 768]] as const)
    for (const theme of ["cooptimize-light", "cooptimize-dark"]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((t) => void (document.documentElement.dataset.theme = t), theme);
      await page.waitForTimeout(150);
      await keep.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/${name}-${w}-${theme.replace("cooptimize-", "")}.png` });
    }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
  await page.waitForTimeout(150);
  await keep.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${name}-larger.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
  await page.waitForTimeout(250);
  await keep.scrollIntoViewIfNeeded();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${name}: the page is wider than the phone`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png` });
  await page.evaluate(() => void (document.documentElement.style.fontSize = ""));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(150);
}

describe.skipIf(!CHROMIUM)("Create DevOps item and Link to item, CV-5", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("a conversation In discussion and a promise without an item: create, link with a comment, In progress, Item closed", async () => {
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: HOME, name: "Sam Tester", email: "me@contoso.example" } } });
    dv.add(437, { "System.WorkItemType": "Feature", "System.Title": "Sales view performance", "System.State": "Active", "System.AssignedTo": { uniqueName: "me@contoso.example", displayName: "Sam Tester" } });
    dv.add(438, { "System.WorkItemType": "User Story", "System.Title": "Date format cleanup", "System.State": "Active", "System.AssignedTo": { uniqueName: "me@contoso.example", displayName: "Sam Tester" } }, 437);
    const pats = new Map([["Adatum", WRITE_PAT]]);
    const ctx = await liveContext({
      extra: {
        devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
        writePats: { get: async (k) => new Pat(pats.get(k) ?? ""), set: async (k, v) => void pats.set(k, v), clear: async (k) => void pats.delete(k) },
      },
    });
    // The central store as Link to item and the live state read it: the fake DevOps' items (all in scope here).
    const category = (s: string) => (s === "Closed" ? "Completed" : s === "New" ? "Proposed" : "InProgress");
    const field = (f: Record<string, unknown>, k: string) => String(f[k] ?? "");
    const ahead = (): AheadItem[] => [...dv.items.values()].map((i) => ({
      id: i.id, rev: 1, title: field(i.fields, "System.Title"), type: field(i.fields, "System.WorkItemType"), state: field(i.fields, "System.State"), stateCategory: category(field(i.fields, "System.State")),
      level: field(i.fields, "System.WorkItemType") === "Feature" ? "parent" : "child", rung: null, parentId: null, assignee: { name: "Sam Tester", email: "me@contoso.example" }, start: null, target: null, size: null,
      url: `https://dev.azure.com/contoso/_workitems/edit/${i.id}`, changedAt: "2026-11-02T14:00:00Z", inScope: true, order: null,
    }));
    const work = (ids: readonly number[]): WorkItem[] => ahead().filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, title: i.title, type: i.type, state: i.state, stateCategory: i.stateCategory, level: "story", order: null, parentId: null, changedAt: i.changedAt, url: i.url, assignedTo: i.assignee?.name ?? null }));
    const makeDevOps = ctx.makeDevOps;
    ctx.makeDevOps = (cfg, tz) => ({ ...makeDevOps(cfg, tz), searchItems: async (_ref, q) => ahead().filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase())), linkedItems: async (_ref, ids) => work(ids) });

    const clock = () => Temporal.Instant.from(ctx.now());
    const conn = sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") }));
    const teams = createTeamsStore(conn, clock);
    const convs = createConversationStore(conn, clock, teams);
    const members = [
      { userId: ME, displayName: "Sam Tester", email: "sam@contoso.example", tenantId: HOME },
      { userId: BLAKE, displayName: "Blake Novak", email: null, tenantId: CLIENT },
    ];
    await teams.addChat({ chatId: CHAT, clientKey: "Adatum", kind: "customer", displayName: "Adatum Analytics Alliance", webUrl: "https://teams.microsoft.com/l/chat/x", members, by: ME });
    const msg = (id: string, from: string, at: string, text: string) => ({ chatId: CHAT, messageId: id, clientKey: "Adatum", senderId: from, senderName: from === ME ? "Sam Tester" : "Blake Novak", senderTenant: from === ME ? HOME : CLIENT, createdAt: at, modifiedAt: at, html: `<p>${text}</p>`, text, hasImage: false, hasFile: false, replyToId: null, mentions: [], fetchedAt: at });
    await teams.saveMessages([
      msg("1730000000001", BLAKE, "2026-11-02T14:31:00Z", "The sales view takes 20 seconds to open. Can you reprofile it so it loads in under 5?"),
      msg("1730000000002", ME, "2026-11-02T14:33:00Z", "Looking at the query plan now."),
      msg("1730000000003", ME, "2026-11-02T14:40:00Z", "Separately, I'll sort out the date formats this week."),
    ]);
    const c = await convs.addConversation({ chatId: CHAT, clientKey: "Adatum", title: "Reprofile the sales view", summary: "Blake says the sales view takes 20 seconds to open.\nSam is looking at the query plan.", participants: [{ id: BLAKE, name: "Blake Novak", external: true }, { id: ME, name: "Sam Tester", external: false }], firstAt: "2026-11-02T14:31:00Z", lastAt: "2026-11-02T14:33:00Z", lastWorkAt: "2026-11-02T14:33:00Z" });
    await convs.place([
      { chatId: CHAT, messageId: "1730000000001", conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: "2026-11-02T14:31:00Z" },
      { chatId: CHAT, messageId: "1730000000002", conversationId: c.id, role: "work", reason: null, placedBy: "ai", at: "2026-11-02T14:33:00Z" },
    ]);
    await convs.updateConversation(c.id, { status: "discussion", ownerId: ME });
    const k = await convs.addCommitment({ conversationId: null, chatId: CHAT, clientKey: "Adatum", whoId: ME, whoName: "Sam Tester", toId: BLAKE, toName: "Blake Novak", what: "Sort out the date formats this week", dueAt: null, dueDate: null, impliesItem: false, messageIds: ["1730000000003"], reason: "test" });
    ctx.requests = { teams, conversations: convs, users: async () => [{ id: ME, name: "Sam Tester", deleted: false }], refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) };
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: HOME, name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      // The old address still opens the Inbox (IB-1: Needs you).
      await page.goto(`${app.url}#/inbox/conversations`);
      await page.locator(".topbar").waitFor();
      await page.getByRole("main", { name: "Inbox" }).waitFor();

      // Before: In discussion, Create DevOps item is the main button (it was Resolve, with Create under ⋯).
      const card = await openInboxItem(page, "Reprofile the sales view");
      await card.locator(".ib-act.primary", { hasText: /^Create DevOps item/ }).waitFor();
      await shots(page, "cv5-conversation-before", card);

      // The form, empty without AI; I fill it in; the preview says who will see it; confirm creates it once.
      await card.getByRole("button", { name: /^Create DevOps item/ }).first().click();
      const draft = card.getByRole("form", { name: "Create DevOps item" });
      await draft.getByText(/Not drafted by AI/).waitFor();
      expect(await draft.getByRole("textbox", { name: /^Title/ }).inputValue()).toBe("");
      await draft.getByRole("textbox", { name: /^Title/ }).fill("Reprofile the sales view to load under 5 seconds");
      await draft.getByRole("textbox", { name: /^Acceptance criteria/ }).fill("- The sales view opens in under 5 seconds");
      await shots(page, "cv5-create-form", draft);
      await draft.getByRole("button", { name: "Preview in DevOps" }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      await preview.getByText("Who can see it:").waitFor();
      await preview.getByText(/Blake Novak · 2026-11-02 \d\d:31: The sales view takes 20 seconds/).first().waitFor();
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await preview.waitFor({ state: "detached" });
      const made = [...dv.items.values()].at(-1)!;
      expect(made.fields["System.Title"]).toBe("Reprofile the sales view to load under 5 seconds");
      expect(dv.writes().filter((w) => w.method === "POST" && w.url.includes("workitems/$"))).toHaveLength(1);

      // After: In progress, with the item's live state.
      await openInboxView(page, "in-progress");
      const progress = await openInboxItem(page, "Reprofile the sales view");
      await progress.getByText(new RegExp(`#${made.id} Reprofile the sales view to load under 5 seconds`)).waitFor();
      await progress.getByText(/· Sam Tester · changed/).waitFor();
      await shots(page, "cv5-conversation-after", progress);

      // A promise that implied no item: Create DevOps item leads (it had no Create before).
      await openInboxView(page, "promises");
      const promise = await openInboxItem(page, "Sort out the date formats this week");
      await promise.locator(".ib-act.primary", { hasText: /^Create DevOps item/ }).waitFor();
      await promise.getByRole("button", { name: /^Add to Today/ }).waitFor();
      await shots(page, "cv5-promise-before", promise);

      // Link to item, with "Also add a comment": the link is FocusTime's; the comment has its own preview.
      await promise.getByRole("button", { name: /^More for / }).click();
      await promise.getByRole("menuitem", { name: "Link to item" }).click();
      await promise.getByRole("textbox", { name: /^Link to one of/ }).fill("date");
      await promise.getByRole("checkbox", { name: /Also add a comment on the item/ }).check();
      await promise.getByRole("button", { name: /#438 Date format cleanup/ }).click();
      const comment = page.getByRole("dialog", { name: /comment/i });
      await comment.getByText(/Linked to a promise in Teams: Sort out the date formats this week/).waitFor();
      await comment.getByRole("button", { name: "Add comment in DevOps" }).click();
      await comment.waitFor({ state: "detached" });
      expect(dv.writes().filter((w) => w.method === "POST" && /comments/.test(w.url))).toHaveLength(1);
      expect((await convs.commitment(k.id))!).toMatchObject({ state: "open", itemId: 438 });
      await promise.getByText(/Linked to/).waitFor();
      await promise.getByText(/· Active · Sam Tester/).waitFor();
      await promise.getByRole("button", { name: /^Add to Today/ }).waitFor();
      await shots(page, "cv5-promise-after", promise);

      // The item closes in DevOps: Item closed, Mark done; the promise stays open until I say so.
      dv.items.get(438)!.fields["System.State"] = "Closed";
      await page.reload();
      await page.locator(".topbar").waitFor();
      await promise.locator(".ib4-row-title", { hasText: "Sort out the date formats this week" }).waitFor();
      await promise.getByText("Item closed").first().waitFor();
      await promise.locator(".ib-act.primary", { hasText: /^Mark done/ }).waitFor();
      expect((await convs.commitment(k.id))!.state).toBe("open");
      await shots(page, "cv5-promise-item-closed", promise);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
