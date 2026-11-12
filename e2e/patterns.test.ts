// WP-1, WP-2: DevOps patterns, the main path, in real (not demo) sessions on fake sources (the page reads every client's
// DevOps through the app-level reader, which the demo doesn't have; open-questions.md says so). Two admins share one
// team: Sam is on Adatum, Kim on Fabrikam. With the switch off the address opens Today, the command menu has no entry
// and the server answers 404; Sam turns it on for Sam in Admin › People, and Kim still doesn't get it. Sam runs the
// inventory, which stops for Fabrikam (two areas, no scope) until Sam chooses its area on the page; a rerun shows the
// change, a "restart" mid-run shows Stopped and Resume doesn't read finished clients again,
// a kind changed on the page shows in Coverage at once, the estimate skips a client without Allow AI, the classification shows shapes, Check by hand offers only Sam's
// client (the server refuses the other), and the downloads carry no title, person or another client's area name. Fictional data only. Screenshots
// at 1440×900, light and dark, when FOCUSTIME_SHOTS is set.
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { createPatternsRunner } from "../actions/patterns-run.ts";
import type { PatternsPort } from "../actions/patterns.ts";
import { stubProvider } from "../ai/stub.ts";
import { createPatternsStore } from "../store/patterns-store.ts";
import { anAiApp } from "../test/builders/index.ts";
import { aRawItem, aSmallProject, fakePatternsReader, patternsAnswer, type RawItem } from "../test/builders/patterns.ts";
import { sqliteDb } from "../test/db.ts";
import { CHROMIUM } from "./harness.ts";
import { appReady, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser, type LiveTeam } from "./live.ts";
import { SHOTS } from "./shots.ts";

const KIM = "e2e00000-0000-4000-8000-0000000000bb";
const HOME = "11111111-1111-4111-8111-111111111111";
const TITLES = /Sales reporting|Margin report|Map the source columns|Load the table|Why is the total off|Add the orders fact|Ask Kim Person|Run the pay export/;

/** 1440×900, light then dark, the section in view. */
async function shot(page: Page, name: string, section?: string | import("playwright-core").Locator) {
  if (!SHOTS) return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), scheme === "light" ? "cooptimize-light" : "cooptimize-dark");
    if (typeof section === "string") await page.getByRole("region", { name: section }).scrollIntoViewIfNeeded();
    // A locator goes to the top of the view (under the top bar), so what follows it shows too.
    else if (section) await section.evaluate((e) => (e.scrollIntoView({ block: "start" }), window.scrollBy(0, -72)));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/${name.startsWith("wp3-") ? name : `wp2-${name}`}-${scheme}.png` });
  }
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  if (size) await page.setViewportSize(size);
}

/** An action straight to the server, as the page sends it (its CSRF cookie). */
const post = (page: Page, action: string, input: unknown) =>
  page.evaluate(
    async ([a, i]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action: a, input: i }) });
      return r.status;
    },
    [action, input] as const,
  );

describe.skipIf(!CHROMIUM)("DevOps patterns (WP-1, WP-2, WP-3)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("off by default; on for one person; inventory, rerun, restart and Resume, classification, Check by hand, downloads", async () => {
    const team: LiveTeam = liveTeam();
    await team.store.replaceDirectory(
      [
        { personId: ME, systemUserId: "10000000-0000-4000-8000-000000000001", name: "Sam Tester", email: "sam@contoso.example", level: "lead", positionName: "Lead Consultant" },
        { personId: KIM, systemUserId: "10000000-0000-4000-8000-000000000002", name: "Kim Person", email: "kim@contoso.example", level: "consultant", positionName: "Consultant" },
      ],
      [],
      [{ personId: ME, clientKey: "Adatum" }, { personId: KIM, clientKey: "Fabrikam" }],
    );
    team.org.invalidate();
    await team.set("org", "ai.on", true);
    await team.set("client:Adatum", "allow_ai", true);

    // The fake DevOps: two fictional projects, and a hook to "stop the server" at one request.
    const projects: Record<string, RawItem[]> = {
      Adatum: [...aSmallProject(100), aRawItem({ id: 120, type: "Step", title: "Ask Kim Person about totals", created: "2026-05-01T10:00:00Z", desc: "<p>Text that is never kept.</p>" })],
      // WP-2: Fabrikam's project has two areas; only Analytics is Cooptimize's work.
      Fabrikam: [
        ...aSmallProject(300).map((i) => ({ ...i, fields: { ...i.fields, "System.AreaPath": "Fabrikam\\Analytics" } })),
        aRawItem({ id: 350, type: "Step", title: "Run the pay export", created: "2026-04-01T10:00:00Z", area: "Fabrikam\\Payroll", desc: "<p>Outside text.</p>" }),
        aRawItem({ id: 351, type: "Step", title: "Run the pay export again", created: "2026-04-02T10:00:00Z", area: "Fabrikam\\Payroll" }),
      ],
    };
    const reader = fakePatternsReader(projects);
    const db = sqliteDb();
    const store = createPatternsStore(db.conn, () => Temporal.Now.instant());
    const allowed = async (id: string) => (await team.org.rules()).devopsPatterns.includes(id.toLowerCase());
    const runnerFor = (owner: string) => createPatternsRunner({ store, reader, now: () => Temporal.Now.instant(), log: () => {}, owner, allowed, gapMs: 20, waitMs: 200, staleMs: 1_500, prices: () => ({ inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 }) });
    const portFor = (owner: string): PatternsPort => ({ store, runner: runnerFor(owner), clients: async () => ["Adatum", "Fabrikam"], itemUrl: async (k, id) => `https://dev.azure.com/contoso/${k}/_workitems/edit/${id}` });

    const person = async (id: string, name: string, email: string, port: PatternsPort): Promise<ActionContext> => {
      const ctx = await liveContext({
        team,
        userId: id,
        extra: {
          patterns: port,
          ai: { app: anAiApp({ provider: "openai", model: "gpt-6-luna", prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 } }), provider: async () => stubProvider({ respond: patternsAnswer({ other: (r) => r === "i1" || r === "i3", otherName: "housekeeping", otherMeaning: "Tidying folders and names" }) }), appSpend: { get: async () => 0, add: async () => {} } },
        },
      });
      await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: id, tid: HOME, name, username: email, email, signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
      return ctx;
    };
    const breakGlass = [ME, KIM];
    const { liveAdminOps } = await import("./live.ts");
    const ops = await liveAdminOps(team, { admins: breakGlass });

    // ---- Off: the address opens Today, no command, the server says there's no such page ----
    let port = portFor("proc-1");
    let sam = await lb.start({ ...(await person(ME, "Sam Tester", "sam@contoso.example", port)), adminOps: ops });
    let page = await sam.page();
    page.setDefaultTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.goto(`${sam.url}#/patterns`);
    await appReady(page);
    await expect.poll(() => page.evaluate(() => location.hash)).not.toBe("#/patterns");
    expect(await page.getByRole("heading", { name: "DevOps patterns" }).count()).toBe(0);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("DevOps patterns");
    expect(await page.getByRole("option", { name: /DevOps patterns/ }).count()).toBe(0);
    while (await page.locator(".command-backdrop").count()) await page.keyboard.press("Escape");
    expect(await post(page, "patterns.status", {})).toBe(404);
    expect(await post(page, "patterns.run_inventory", {})).toBe(404);
    expect(reader.calls).toEqual([]);

    // ---- Admin › People: Sam turns it on for Sam ----
    await page.getByRole("button", { name: /^More/ }).first().click();
    await page.getByRole("menuitem", { name: "Admin" }).click();
    const body = page.locator(".ps-body");
    await page.locator('.ps-rail [data-settings-section="admin-people"]').click();
    const swSam = body.getByRole("switch", { name: "Sam Tester: DevOps patterns (preview)" });
    expect(await swSam.isChecked()).toBe(false);
    expect(await body.getByRole("switch", { name: "Kim Person: DevOps patterns (preview)" }).isChecked()).toBe(false);
    await swSam.click();
    await expect.poll(async () => (await team.org.rules()).devopsPatterns).toEqual([ME]);
    await page.getByText(/saved\./).waitFor();
    await page.waitForTimeout(6_000);
    await shot(page, "admin-people", swSam);

    // ---- Kim, also an admin, doesn't get it ----
    const kim = await lb.start({ ...(await person(KIM, "Kim Person", "kim@contoso.example", port)), adminOps: ops });
    try {
      const kp = await kim.page();
      await kp.goto(`${kim.url}#/patterns`);
      await appReady(kp);
      await expect.poll(() => kp.evaluate(() => location.hash)).not.toBe("#/patterns");
      expect(await post(kp, "patterns.status", {})).toBe(404);
    } finally {
      await kim.close();
    }

    // ---- Sam: the page, from the command menu ----
    await page.goto(sam.url);
    await appReady(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("DevOps patterns");
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "DevOps patterns" }).waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/patterns");
    await page.getByText("No inventory yet.").waitFor();

    // Run inventory: Adatum (one area) reads whole; Fabrikam has two areas and no scope, so the run stops for it.
    await page.getByRole("button", { name: "Run inventory" }).click();
    await page.getByText(/need(s)? a scope: choose it below/).first().waitFor();
    const scopeRegion = page.getByRole("region", { name: "Scope" });
    await scopeRegion.locator("tr", { hasText: "Fabrikam" }).getByText(/choose the part that is Cooptimize's BI and analytics work/).waitFor();
    // Out-of-scope items were never read in full: only the layout's fields.
    expect(reader.calls.filter((c) => c.client === "Fabrikam" && c.op === "updates")).toEqual([]);
    await scopeRegion.getByRole("button", { name: /Fabrikam/ }).click();
    await scopeRegion.getByRole("checkbox", { name: "Fabrikam: area Fabrikam\\Analytics" }).check();
    await shot(page, "scope", "Scope");
    await scopeRegion.getByRole("button", { name: "Save scope for this page" }).click();
    await page.getByText(/^Saved for this page only\. Admin › Clients is unchanged\./).waitFor();
    expect((await team.org.rules()).clients.Fabrikam?.devopsScope ?? null).toBeNull();
    await page.getByRole("region", { name: "Runs" }).getByRole("button", { name: "Resume inventory" }).click();
    const inventory = page.getByRole("region", { name: "Build work" });
    await page.getByText(/^Inventory: done/).waitFor();
    expect(await inventory.locator("tr", { hasText: "Adatum" }).locator("td").nth(3).textContent()).toBe("7");
    // Six items in scope: every share on them is marked rather than shown.
    expect(await inventory.locator("tr", { hasText: "Fabrikam" }).locator("td").nth(3).textContent()).toBe("6");
    expect(await inventory.locator("tr", { hasText: "Fabrikam" }).locator("td").nth(4).textContent()).toBe("too few to read (6)");
    // Coverage adds up: Fabrikam read 8, 2 outside scope, 6 in scope.
    const coverage = page.getByRole("region", { name: "Coverage" });
    const fab = coverage.locator("tr", { hasText: "Fabrikam" }).locator("td");
    expect([await fab.nth(1).textContent(), await fab.nth(2).textContent(), await fab.nth(3).textContent()]).toEqual(["8", "2", "6"]);
    expect(reader.read.get("Fabrikam")?.filter((id) => id >= 350).length ?? 0).toBeGreaterThan(0);
    await inventory.getByRole("button", { name: /Adatum/ }).click();
    await inventory.getByRole("heading", { name: "Breakdown" }).waitFor();
    await shot(page, "build-work", "Build work");
    await inventory.getByRole("button", { name: /Adatum/ }).click();

    // A rerun shows the change: two more items in Adatum.
    projects.Adatum!.push(aRawItem({ id: 130, type: "Step", title: "Add the region filter", created: "2026-10-01T10:00:00Z" }), aRawItem({ id: 131, type: "Step", title: "Check the totals", created: "2026-10-02T10:00:00Z" }));
    await page.getByRole("button", { name: "Run inventory" }).click();
    await inventory.locator("tr", { hasText: "Adatum" }).getByText("+2").waitFor();

    // ---- A restart mid-run: Stopped, then Resume without reading the finished client again ----
    let stopAt = true;
    reader.before = (op, client) => {
      if (stopAt && client === "Fabrikam" && op === "batch") {
        stopAt = false;
        port.runner.halt();
      }
    };
    await page.getByRole("button", { name: "Run inventory" }).click();
    await expect.poll(() => port.runner.activeLoop()).toBeNull();
    await page.getByRole("region", { name: "Runs" }).getByText("Reading").first().waitFor();
    await shot(page, "run-in-progress", "Runs");
    await sam.close();
    await new Promise((r) => setTimeout(r, 1_700));
    port = portFor("proc-2");
    sam = await lb.start({ ...(await person(ME, "Sam Tester", "sam@contoso.example", port)), adminOps: ops });
    page = await sam.page();
    page.setDefaultTimeout(60_000);
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.goto(`${sam.url}#/patterns`);
    await appReady(page);
    // A new person's store: the first-launch welcome plays once; it goes on any key.
    await page.getByText("Click or press any key").waitFor({ timeout: 5_000 }).then(() => page.keyboard.press("Shift"), () => {});
    await page.getByText("Click or press any key").waitFor({ state: "detached" });
    const runs = page.getByRole("region", { name: "Runs" });
    await runs.getByText(/the server restarted or scaled down/).first().waitFor();
    await shot(page, "run-stopped", "Runs");
    const before = reader.calls.length;
    await runs.getByRole("button", { name: "Resume inventory" }).click();
    await page.getByText(/^Inventory: done/).waitFor();
    const after = reader.calls.slice(before);
    expect(after.some((c) => c.client === "Fabrikam")).toBe(true);
    expect(after.some((c) => c.client === "Adatum")).toBe(false);

    // ---- Kinds: Leave out a type, Coverage follows at once; then back to the guess ----
    const kinds = page.getByRole("region", { name: "Kinds of work" });
    await kinds.getByRole("button", { name: /Adatum/ }).click();
    await kinds.getByRole("combobox", { name: "Adatum: Step kind" }).selectOption("leave_out");
    const ada = page.getByRole("region", { name: "Coverage" }).locator("tr", { hasText: "Adatum" }).locator("td");
    await expect.poll(() => ada.nth(4).textContent()).toBe("6");
    await shot(page, "kinds", "Kinds of work");
    await kinds.getByRole("button", { name: "Use the guess" }).click();
    await expect.poll(() => ada.nth(4).textContent()).toBe("0");

    // ---- Estimate, then classification: Fabrikam (no Allow AI) skipped ----
    await runs.getByRole("button", { name: "Estimate" }).click();
    const estimate = runs.locator(".pat-estimate");
    await estimate.locator("tr", { hasText: "Fabrikam" }).getByText(/Allow AI/).waitFor();
    await runs.getByRole("button", { name: /^Run classification \(\d+ items, about / }).click();
    const classification = page.getByRole("region", { name: "Classification" });
    await classification.getByRole("heading", { name: "Common feature shapes" }).waitFor();
    await page.getByText(/^Classification: done/).waitFor();
    await shot(page, "classification", "Classification");
    // WP-3: agreement comes first, with the sample as it is; then a table per fact with a column per client.
    await classification.getByRole("heading", { name: "Agreement: which findings to trust" }).waitFor();
    await classification.getByText(/^Agreement sample, across every client and kind: \d+ of \d+/).waitFor();
    await shot(page, "wp3-agreement", classification.getByRole("heading", { name: "Agreement: which findings to trust" }));
    const byClient = classification.getByRole("table", { name: "Request type" });
    expect(await byClient.locator("thead th").allTextContents()).toContain("All clients");
    await shot(page, "wp3-per-client", classification.getByRole("heading", { name: "By client" }));

    // ---- WP-3: the request types list a person owns ----
    const typesRegion = page.getByRole("region", { name: "Request types" });
    await typesRegion.getByText(/^Version 1, in use/).waitFor();
    const suggested = typesRegion.locator(".pat-suggest tr", { hasText: "housekeeping" });
    await suggested.waitFor();
    await shot(page, "wp3-request-types", typesRegion.getByRole("heading", { name: 'Suggested for "other"' }));
    // A rename: its cost first (nothing), then Save as a new version with one line of why.
    await typesRegion.getByRole("button", { name: "Rename: small change" }).click();
    const form = typesRegion.getByRole("group", { name: "Rename" });
    await form.getByRole("textbox", { name: "New name" }).fill("minor change");
    await form.getByRole("textbox", { name: "Why" }).fill("Clearer for the team");
    await form.getByRole("button", { name: "What it costs" }).click();
    await form.getByRole("status").getByText(/A rename costs nothing/).waitFor();
    await shot(page, "wp3-rename-cost", form);
    await form.getByRole("button", { name: "Save as a new version" }).click();
    await typesRegion.getByText(/^Version 2, in use/).waitFor();
    await typesRegion.locator(".pat-versions li", { hasText: "renamed small change to minor change" }).waitFor();
    // Ignore a suggestion: it goes from the list, and Show again brings it back.
    await suggested.getByRole("button", { name: "Ignore: housekeeping" }).click();
    await typesRegion.getByText("1 ignored.").waitFor();
    expect(await typesRegion.locator(".pat-suggest tr", { hasText: "housekeeping" }).count()).toBe(0);
    await shot(page, "coverage", "Coverage");
    expect((await page.getByRole("region", { name: "Build work" }).textContent()) ?? "").not.toMatch(TITLES);
    // Fabrikam's labels never came: its coverage says why.
    expect(await page.getByRole("region", { name: "Coverage" }).locator("tr", { hasText: "Fabrikam" }).locator("td").nth(7).textContent()).toBe("6");

    // ---- Check by hand: only Sam's client; the server refuses the other ----
    const check = page.getByRole("region", { name: "Check by hand" });
    const options = await check.getByRole("combobox", { name: "Client to check" }).locator("option").allTextContents();
    expect(options).toEqual(["Adatum"]);
    await check.getByRole("button", { name: "Show 30 items" }).click();
    await check.locator(".pat-check tbody tr").first().waitFor();
    expect(await check.getByRole("link", { name: /^#\d+$/ }).count()).toBeGreaterThan(0);
    await shot(page, "check-by-hand", "Check by hand");
    expect(await post(page, "patterns.check", { clientKey: "Fabrikam" })).toBe(403);

    // ---- Downloads: no titles, item text, ids or people ----
    for (const name of ["Download summary", "Download request types"]) {
      const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
      const text = readFileSync((await d.path())!, "utf8");
      expect(text.length).toBeGreaterThan(50);
      expect(text).not.toMatch(TITLES);
      expect(text).not.toMatch(/Kim Person|Sam Tester|never kept|Outside text|#\d/);
      // Fabrikam is not Sam's client: its area names stay on the page.
      expect(text).not.toMatch(/Analytics|Payroll/);
    }

    // Nothing ever went to DevOps but reads, and every AI request was about Adatum only.
    expect(errors).toEqual([]);
    await sam.close();
  }, 300_000);
});
