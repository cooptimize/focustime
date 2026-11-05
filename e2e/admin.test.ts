// ADM-1: the admin console, the main path, in real (not demo) sessions on fake sources. Two people share one team:
// the admin (break-glass list) registers a client chat in Admin › Clients, sets the client's team color, turns AI on
// and allows it for the client, and adds a lead override in Admin › People; Admin › Audit lists each change. Then
// someone who isn't an admin sees no Admin, sees the chat, the AI line and the open states read-only ("Set by your
// FocusTime admin"), and picks their own color for the client, with Reset to team color. Screenshots of every Admin
// section, the read-only Settings and the color override, at 1920 and Text size Larger, when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { createChatsClient } from "../sources/graph/chats.ts";
import { openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { CHROMIUM, openSettings } from "./harness.ts";
import { liveAdminOps, liveBrowser, liveContext, liveTeam, ME, NOW, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";
import { createDevOpsPoller, createLimiter, devopsStatusSource, NO_SNAPSHOTS } from "../actions/devops-poll.ts";
import { createStatusRegistry } from "../actions/status-rows.ts";
import { legacyHours } from "../config/schema.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { aFakeItem, fakeLiveDevOps } from "../sources/devops/poll-fakes.ts";
import { target } from "../sources/devops/test-fakes.ts";
import { createDevOpsStore } from "../store/devops-store.ts";
import type { TargetsResult } from "../sources/devops/types.ts";

/** DV-1: the central DevOps poller over a fake dev.azure.com, its rows in Admin › Status. */
function devopsStatus() {
  const clock = () => Temporal.Now.instant();
  const fake = fakeLiveDevOps(
    {
      Adatum: { project: "Delivery", items: [aFakeItem({ id: 1, type: "Feature" }), aFakeItem({ id: 2, parent: 1 })], headers: { "X-RateLimit-Resource": "Core", "X-RateLimit-Limit": "200", "X-RateLimit-Remaining": "196", "X-RateLimit-Cost": "0.3" } },
      Fabrikam: { project: "Ops", items: [], status: 401 },
    },
    clock,
  );
  const limiter = createLimiter(clock);
  const keys = ["Adatum", "Fabrikam"];
  const targets = async (ks: string[]): Promise<TargetsResult> => ({ ok: true, targets: ks.filter((k) => keys.includes(k)).map((k) => target(k, k, { email: null, project: k === "Adatum" ? "Delivery" : "Ops", projectName: k === "Adatum" ? "Delivery" : "Ops" })) });
  const app = createDevOpsSource({ fetch: fake.fetch, log: () => {}, snapshots: NO_SNAPSHOTS, timeZone: "America/New_York", targets, limiter, now: clock, retryDelayMs: 0 });
  const poller = createDevOpsPoller({
    store: createDevOpsStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") })), clock),
    source: () => app.internal,
    limiter,
    accounts: async () => keys,
    targets,
    hours: async () => [legacyHours({ start: "00:00", split: "12:00", end: "23:59", timeZone: "America/New_York" })],
    ruleMinutes: async () => 1,
    active: () => true,
    now: clock,
    log: () => {},
  });
  const registry = createStatusRegistry();
  registry.register(devopsStatusSource(poller));
  return { registry, fake };
}

const HOME = "11111111-1111-4111-8111-111111111111";
const KIM = "e2e00000-0000-4000-8000-0000000000bb";
const CHAT = "19:adatum-team@thread.v2";
const member = (userId: string, displayName: string) => ({ "@odata.type": "#microsoft.graph.aadUserConversationMember", id: `m-${userId}`, roles: [], displayName, userId, email: `${displayName.split(" ")[0]!.toLowerCase()}@contoso.example`, tenantId: HOME });
const MEMBERS = [member(ME, "Sam Tester"), member(KIM, "Kim Person")];

/** A fake Graph with one group chat (names and members only). */
const graphFetch = (async (input: string | URL) => {
  const path = decodeURIComponent(new URL(String(input)).pathname);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (path === "/v1.0/me/chats") return json({ value: [{ id: CHAT, chatType: "group", topic: "Adatum Delivery Team", webUrl: "https://teams.microsoft.com/l/chat/x", lastUpdatedDateTime: "2026-11-02T14:00:00Z", members: MEMBERS }] });
  if (path === `/v1.0/chats/${CHAT}/members`) return json({ value: MEMBERS });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

describe.skipIf(!CHROMIUM)("Admin", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("an admin registers a chat, sets a color, allows AI and adds a lead; someone else sees them read-only and picks their own color", async () => {
    const team = liveTeam();
    const clock = () => Temporal.Instant.from(NOW);
    const teams = createTeamsStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => clock().toZonedDateTimeISO("UTC") })), clock);
    const admins = [ME];
    await team.store.replaceDirectory(
      [
        { personId: ME, systemUserId: "10000000-0000-4000-8000-000000000001", name: "Sam Tester", email: "me@contoso.example", level: "lead", positionName: "Lead Consultant" },
        { personId: KIM, systemUserId: "10000000-0000-4000-8000-000000000002", name: "Kim Person", email: "kim@contoso.example", level: "consultant", positionName: "Consultant" },
      ],
      [{ clientKey: "Adatum", personId: ME, source: "owner" }],
      [{ personId: ME, clientKey: "Adatum" }, { personId: KIM, clientKey: "Adatum" }],
    );
    const devops = devopsStatus();
    const ops = await liveAdminOps(team, { admins, chats: () => teams.chats(), statusRows: devops.registry });
    const chats = createChatsClient({ fetch: graphFetch, token: async () => "fake-graph-token", invalidate: () => {}, log: () => {} });
    const person = async (id: string, name: string, email: string): Promise<ActionContext> => {
      const ctx = await liveContext({
        team,
        userId: id,
        extra: {
          account: () =>
            ({
              identity: async () => ({ oid: id, tid: HOME, name, username: email, email }),
              writeAccess: async () => ({ status: "not_connected", message: "Not connected" }),
              armToken: async () => {
                throw new Error("no Azure here");
              },
              signIn: async () => ({ status: "failed", message: "not here" }),
              chats,
              chatMessages: chats,
              probe: async (kind: string) => ({ kind, state: "granted", granted: [] }),
            }) as never,
          requests: { teams, refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) },
          adminOps: ops,
        },
      });
      await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: id, tid: HOME, name, username: email, email, signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
      return ctx;
    };

    // ---- The admin ----
    const sam = await lb.start(await person(ME, "Sam Tester", "me@contoso.example"));
    try {
      const page = await sam.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(sam.url);
      await page.locator(".topbar").waitFor();

      // ⋯ shows Admin for an admin.
      await page.getByRole("button", { name: /^More/ }).first().click();
      await page.getByRole("menuitem", { name: "Admin" }).click();
      const body = page.locator(".set-body");
      await body.getByRole("heading", { name: "Admin › Clients" }).waitFor();
      const adatum = page.locator(".adm-client").filter({ has: page.getByRole("heading", { name: "Adatum" }) });
      await adatum.waitFor();

      // Register the chat.
      const group = adatum.getByRole("group", { name: /^Delivery chats for Adatum/ });
      await group.getByRole("button", { name: "Add a chat" }).click();
      await group.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option").first().waitFor();
      await page.keyboard.type("adatum");
      await page.keyboard.press("Enter");
      await group.getByRole("region", { name: "Adatum Delivery Team" }).waitFor();

      // The team color: violet.
      await adatum.getByRole("radiogroup", { name: "Adatum: team color" }).getByRole("radio", { name: "violet" }).check();
      await adatum.getByText("Saved").first().waitFor();
      await page.locator(".set-undo-box").getByText("Adatum: team color saved.").waitFor();
      await expect.poll(async () => (await team.org.rules()).clients.Adatum?.color).toBe("violet");
      // States treated as open (a Rule).
      await adatum.getByLabel("Adatum: states treated as open").fill("Resolved");
      await adatum.getByLabel("Adatum: states treated as open").press("Enter");
      await expect.poll(async () => (await team.org.rules()).clients.Adatum?.openStates).toEqual(["Resolved"]);
      // WT-1's process, one row per type: Feature no longer needs breakdown, Bug is background (both Rules).
      await adatum.getByRole("switch", { name: "Adatum: Feature needs breakdown" }).uncheck();
      await expect.poll(async () => (await team.org.rules()).clients.Adatum?.noBreakdown).toEqual(["Feature"]);
      await adatum.getByRole("switch", { name: "Adatum: Bug is background" }).check();
      await expect.poll(async () => (await team.org.rules()).clients.Adatum?.background).toEqual(["Bug"]);
      await adatum.getByRole("row", { name: /Bug/ }).getByText("No hours").waitFor();
      await shotBoth(page, "admin-clients", adatum);

      // Admin › AI: on for FocusTime, allowed for Adatum.
      await page.locator(".set-admin-nav").getByRole("button", { name: "AI" }).click();
      await body.getByRole("heading", { name: "Admin › AI" }).waitFor();
      await body.getByRole("switch", { name: "AI on" }).check();
      await body.getByRole("switch", { name: "Allow AI for Adatum" }).check();
      await expect.poll(async () => (await team.org.rules()).ai).toMatchObject({ on: true, allowedClients: ["Adatum"] });
      await shotBoth(page, "admin-ai", body);
      // Turning AI off for everyone asks first; Cancel keeps it on.
      await body.getByRole("switch", { name: "AI on" }).click();
      await body.getByRole("alertdialog", { name: "Turn AI off for everyone" }).getByRole("button", { name: "Cancel" }).click();
      expect((await team.org.rules()).ai.on).toBe(true);

      // Admin › Conversations.
      await page.locator(".set-admin-nav").getByRole("button", { name: "Conversations" }).click();
      await body.getByLabel("Request phrases").waitFor();
      await shotBoth(page, "admin-conversations", body);

      // Admin › People: Kim becomes a lead of Adatum (an override, marked).
      await page.locator(".set-admin-nav").getByRole("button", { name: "People" }).click();
      const kim = body.locator("tr", { has: page.getByRole("rowheader", { name: /Kim Person/ }) });
      await kim.getByRole("combobox", { name: "Kim Person: add as lead of" }).selectOption("Adatum");
      await kim.getByRole("button", { name: "Add" }).click();
      await kim.getByText("Added by an admin").waitFor();
      await kim.locator(".adm-mark", { hasText: "Override" }).first().waitFor();
      expect(await team.org.isClientLead(KIM, "Adatum")).toBe(true);
      await shotBoth(page, "admin-people", body);

      // Admin › Organization, Status and Audit.
      await page.locator(".set-admin-nav").getByRole("button", { name: "Organization" }).click();
      await body.getByLabel("Help invites go only to").waitFor();
      await shotBoth(page, "admin-organization", body);
      await page.locator(".set-admin-nav").getByRole("button", { name: "Status" }).click();
      await body.getByText("Adatum Delivery Team").waitFor();
      // DV-1: one row per client; Check now reads DevOps once for it, and a refused token says so in plain words.
      const adatumRow = body.locator(".adm-status-group tr", { hasText: "Adatum" });
      await adatumRow.getByRole("button", { name: "Check now" }).click();
      await adatumRow.getByText(/every minute/).waitFor();
      await body.locator(".adm-status-group tr", { hasText: "Fabrikam" }).getByRole("button", { name: "Check now" }).click();
      await body.locator(".adm-status-group tr", { hasText: "Fabrikam" }).getByText("Token not valid").waitFor();
      expect(devops.fake.calls.filter((c) => c.org === "Adatum" && c.op === "wiql").length).toBeGreaterThan(0);
      await shotBoth(page, "admin-status", body);
      await page.locator(".set-admin-nav").getByRole("button", { name: "Audit" }).click();
      const audit = body.locator(".adm-audit");
      await audit.locator("tr", { hasText: "client:Adatum/color" }).filter({ hasText: "violet" }).filter({ hasNotText: "suggested" }).waitFor();
      await audit.getByText("client:Adatum/allow_ai").waitFor();
      await audit.getByText("Kim Person").first().waitFor();
      await body.getByLabel("Filter").fill("allow_ai");
      await expect.poll(() => audit.locator("tbody tr").count()).toBe(1);
      await shotBoth(page, "admin-audit", body);
      expect(errors).toEqual([]);
    } finally {
      await sam.close();
    }

    // ---- Someone who isn't an admin ----
    const kimApp = await lb.start(await person(KIM, "Kim Person", "kim@contoso.example"));
    try {
      const page = await kimApp.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(kimApp.url);
      await page.locator(".topbar").waitFor();
      await openSettings(page);
      await page.locator(".set-nav").getByRole("button", { name: "Clients" }).click();
      expect(await page.locator(".set-admin-nav").count()).toBe(0);
      const card = page.locator(".set-client-wrap").filter({ has: page.getByRole("heading", { name: "Adatum" }) });
      await card.waitFor();
      // Read-only: the chat (no Add or Remove), AI allowed, the open states, all "Set by your FocusTime admin".
      const group = card.getByRole("group", { name: /^Delivery chats for Adatum/ });
      await group.getByRole("region", { name: "Adatum Delivery Team" }).waitFor();
      expect(await group.getByRole("button", { name: "Add a chat" }).count()).toBe(0);
      await card.getByText("Allowed for Adatum").waitFor();
      await card.locator(".set-field", { hasText: "States treated as open" }).getByText("Resolved").waitFor();
      await card.getByText("Set by your FocusTime admin").first().waitFor();
      // Kim's color from before the team had one stays hers (custom), with Reset to team color.
      await card.getByText("Your own color.").waitFor();
      await card.getByRole("button", { name: "Reset to team color" }).click();
      await card.getByText(/^The team color, set by your FocusTime admin\./).waitFor();
      await expect(card.getByRole("radio", { name: "violet" }).isChecked()).resolves.toBe(true);
      await shotBoth(page, "settings-clients-read-only", card);
      // The server refuses an admin action from Kim.
      const refused = await page.evaluate(async () => {
        const csrf = document.cookie.match(/(?:^|; )[^=]*csrf[^=]*=([^;]+)/i)?.[1] ?? "";
        const r = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json", "x-csrf": decodeURIComponent(csrf) }, body: JSON.stringify({ action: "admin.set", input: { scope: "org", key: "ai.on", value: false } }) });
        return r.status;
      });
      expect(refused).toBe(403);
      expect((await team.org.rules()).ai.on).toBe(true);

      // Kim's own color for Adatum, then back to the team's.
      await card.getByRole("radio", { name: "rose" }).check();
      await card.getByRole("button", { name: "Reset to team color" }).waitFor();
      await shotBoth(page, "settings-color-override", card);
      await card.getByRole("button", { name: "Reset to team color" }).click();
      await card.getByText(/^The team color, set by your FocusTime admin\./).waitFor();
      await expect(card.getByRole("radio", { name: "violet" }).isChecked()).resolves.toBe(true);

      // Settings › AI: read-only, AI on, allowed for Adatum.
      await page.locator(".set-nav").getByRole("button", { name: "AI", exact: true }).click();
      await page.locator(".set-ai .set-field", { hasText: "AI for FocusTime" }).getByText("On", { exact: true }).waitFor();
      await shotBoth(page, "settings-ai-read-only", page.locator(".set-ai"));
      expect(errors).toEqual([]);
    } finally {
      await kimApp.close();
    }
  }, T * 2);
});
