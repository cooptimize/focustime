// SA-4 (browser, demo mode; the demo's person is the admin of their own demo): Admin as its own place. Addresses land
// and survive a reload; the clients list shows marks from each client's own values and changes nothing; a client's
// tabs save the same keys and audit rows as before; a chat that would be refused says why before any press; Audit
// names settings by their labels; Admins shows the signed-in admin; Health and Audit carry no "Changes save" line;
// tabs and the rail work by keyboard; on the phone every control is at least 44 px. Fictional data only.
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
let h: Harness;
type Res = { ok: boolean; data: any; error?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<Res>;
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.locator(".ps-head h2").first().waitFor();
};
/** The newest audit row for a setting, as the server stores it. */
const lastAudit = async (page: Page, setting: string) => {
  const e = ((await call(page, "admin.load", { section: "audit" })).data.entries as { setting: string; newValue: unknown }[]).find((x) => x.setting === setting);
  if (!e) return e;
  // Stored as JSON text.
  let v = e.newValue;
  try {
    if (typeof v === "string") v = JSON.parse(v);
  } catch {
    /* plain text */
  }
  return { ...e, newValue: v };
};

describe.skipIf(!CHROMIUM)("SA-4: Admin as its own place", () => {
  beforeAll(async () => void (h = await startDemo()), T);
  afterAll(async () => h?.stop());

  it("every address opens and survives a reload; old ones land on the new place", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const places: [string, string, string][] = [
      ["#/admin", "Clients", "clients"],
      ["#/admin/clients/Atlas/chats", "Atlas", "client:Atlas"],
      ["#/admin/people/logins", "People", "people"],
      ["#/admin/defaults/planning", "Team defaults", "defaults"],
      ["#/admin/health", "Health", "health"],
      ["#/admin/audit/code", "Audit", "audit"],
    ];
    for (const [hash, title, rail] of places) {
      await go(page, hash);
      await page.reload();
      await page.locator(".ps-head h2", { hasText: title }).waitFor({ timeout: 30_000 });
      expect(await page.evaluate(() => location.hash)).toBe(hash);
      await page.locator(`.ps-rail [data-settings-section="${rail}"][aria-current="page"]`).waitFor();
    }
    await page.getByRole("tab", { name: "Code views", selected: true }).waitFor();
    const landing: [string, string][] = [["#/settings/admin-ai", "#/admin/defaults/ai"], ["#/settings/admin-organization", "#/admin/defaults/planning"], ["#/settings/admin-people/whos-set-up", "#/admin/people/setup"]];
    for (const [old, now] of landing) {
      await page.evaluate((x) => (location.hash = x), old);
      await page.waitForFunction((n) => location.hash === n, now);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the clients list: marks from each client's values, the filter and the box, nothing saved from it", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/admin/clients");
    const list = page.getByRole("list", { name: "Clients" });
    const row = (k: string) => list.locator(`.adm-client-row[data-client="${k}"]`);
    await row("Atlas").waitFor({ timeout: 30_000 });
    // Marks follow the stored value: Tailspin's Allow AI on, then off again.
    const before = await row("Tailspin").textContent();
    expect(before).toContain("AI off");
    expect((await call(page, "admin.set", { scope: "client:Tailspin", key: "allow_ai", value: true })).ok).toBe(true);
    await page.reload();
    await expect.poll(() => row("Tailspin").textContent(), { timeout: 30_000 }).toContain("AI allowed");
    expect((await call(page, "admin.set", { scope: "client:Tailspin", key: "allow_ai", value: false })).ok).toBe(true);
    // No control on the list: every row is one link.
    expect(await list.locator("input, select, button, textarea").count()).toBe(0);
    // The box finds by name or other name.
    await page.getByLabel("Find a client by name or other name").fill("harb");
    await expect.poll(() => list.locator(".adm-client-row").count()).toBe(1);
    await page.getByLabel("Find a client by name or other name").fill("");
    // All accounts shows more than Customers.
    const customers = await list.locator(".adm-client-row").count();
    await page.getByRole("radio", { name: /^All accounts/ }).click();
    await page.getByRole("switch", { name: /^Treat .* as a client$/ }).first().waitFor();
    // Every account, client or not, links to its own page (its AI switches are there).
    const accounts = page.locator(".adm-accounts tbody th a");
    await expect.poll(() => accounts.count()).toBeGreaterThan(customers);
    await page.getByRole("radio", { name: /^Customers/ }).click();
    await expect.poll(() => list.locator(".adm-client-row").count()).toBe(customers);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a client's tabs save the same keys and audit rows; Allow AI on its AI tab turns AI for it on and off", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/admin/clients/Tailspin/ai");
    const allow = page.getByRole("switch", { name: "Allow AI for Tailspin" });
    await allow.check();
    await expect.poll(async () => (await lastAudit(page, "client:Tailspin/allow_ai"))?.newValue).toBe(true);
    const ai = (await call(page, "admin.load", { section: "ai", filter: "all" })).data as { clients: { key: string; allowAi: boolean }[] };
    expect(ai.clients.find((c) => c.key === "Tailspin")?.allowAi).toBe(true);
    await allow.uncheck();
    await expect.poll(async () => (await lastAudit(page, "client:Tailspin/allow_ai"))?.newValue).toBe(false);
    // Overview: Match only as written; Chats: Send attachments to AI; Backlog rules: States treated as open.
    await page.getByRole("tab", { name: "Overview" }).click();
    // The rail's swatch follows a new team color at once.
    const swatch = page.locator('.ps-rail [data-settings-section="client:Tailspin"] .adm-rail-swatch');
    const before = await swatch.evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.getByRole("radiogroup", { name: "Tailspin: team color" }).getByRole("radio", { name: "violet" }).check();
    await expect.poll(() => swatch.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(before);
    await page.getByRole("switch", { name: "Tailspin: match only as written" }).click();
    await expect.poll(async () => (await lastAudit(page, "client:Tailspin/exact_case"))?.setting).toBe("client:Tailspin/exact_case");
    await page.getByRole("tab", { name: "Chats" }).click();
    // A chat's notice stays with its own client: Refresh on Northwind, then Tailspin shows none.
    await page.waitForFunction(() => location.hash === "#/admin/clients/Tailspin/chats");
    await go(page, "#/admin/clients/Northwind/chats");
    const nw = page.locator(".adm-client-page").getByRole("group", { name: /^Client chats for Northwind/ });
    await nw.getByRole("region").first().waitFor({ timeout: 30_000 });
    await nw.locator(".dchat-head button").click();
    await page.getByText("Members read again").waitFor();
    await page.locator('.ps-rail [data-settings-section="client:Tailspin"]').click();
    await page.getByRole("group", { name: /^Client chats for Tailspin/ }).waitFor();
    expect(await page.getByText("Members read again").count()).toBe(0);
    await page.getByRole("switch", { name: "Send attachments to AI for Tailspin" }).check();
    await expect.poll(async () => (await lastAudit(page, "client:Tailspin/attachments_ai"))?.newValue).toBe(true);
    await page.getByRole("switch", { name: "Send attachments to AI for Tailspin" }).uncheck();
    await page.getByRole("tab", { name: "Backlog rules" }).click();
    await page.getByLabel("Tailspin: states treated as open").fill("Resolved");
    await page.getByLabel("Tailspin: states treated as open").press("Enter");
    await expect.poll(async () => (await lastAudit(page, "client:Tailspin/open_states"))?.newValue).toEqual(["Resolved"]);
    // Team defaults and People save theirs the same way.
    await go(page, "#/admin/defaults/chats");
    await page.getByLabel("AI requests per chat per day").fill("150");
    await page.getByLabel("AI requests per chat per day").press("Enter");
    await expect.poll(async () => (await lastAudit(page, "org/conv.chat_ai_daily_cap"))?.newValue).toBe(150);
    // See changes: Audit filtered to this client, by label.
    await go(page, "#/admin/clients/Tailspin");
    await page.getByRole("link", { name: "See changes" }).click();
    await page.waitForFunction(() => location.hash === "#/admin/audit/changes");
    await expect.poll(() => page.getByLabel("Filter").inputValue()).toBe("Tailspin");
    const audit = page.locator(".adm-audit");
    await audit.locator("tr", { hasText: "Allow AI" }).first().waitFor();
    await audit.locator("tr", { hasText: "States treated as open" }).first().waitFor();
    // Never a stored key or an id.
    expect(await audit.textContent()).not.toMatch(/client:|allow_ai|open_states|org\/|person:|ai\.on|ai\.person_cap_usd/);
    // Unfiltered too: the demo's seeded team rows say Everyone, never their key.
    await page.getByLabel("Filter").fill("");
    await audit.locator("tr", { hasText: "AI for FocusTime" }).first().waitFor();
    const named = (await audit.locator('td[data-label="For"], td[data-label="Setting"]').allTextContents()).join(" | ");
    expect(named).not.toMatch(/client:|org\/|person:|\b[a-z]+\.[a-z_]+\b|_|[0-9a-f]{8}-/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a chat that would be refused under a client says why on its row and can't be picked", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // Fabrikam isn't one of the demo person's clients: chats.add would refuse it.
    await go(page, "#/admin/clients/Fabrikam/chats");
    const group = page.getByRole("group", { name: /^Client chats for Fabrikam/ });
    await group.locator(".dchat-refusal").waitFor({ timeout: 30_000 });
    await group.getByRole("button", { name: "Add a chat" }).click();
    const opts = group.getByRole("listbox", { name: "Your Teams group chats" }).getByRole("option");
    await opts.first().waitFor();
    expect(await opts.first().getAttribute("aria-disabled")).toBe("true");
    await expect(opts.first().textContent()).resolves.toContain("Can't be added here:");
    const n = (await call(page, "chats.registered", {})).data;
    await opts.first().dispatchEvent("mousedown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    expect((await call(page, "chats.registered", {})).data).toEqual(n);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Admins shows the signed-in admin; Health and Audit carry no Changes save line; tabs work by keyboard", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/admin/people/admins");
    const admins = page.locator(".adm-admins");
    await admins.locator("li").first().waitFor({ timeout: 30_000 });
    expect(await admins.textContent()).not.toContain("Nobody seen yet");
    for (const hash of ["#/admin/health", "#/admin/audit"]) {
      await go(page, hash);
      expect(await page.locator(".ps-head").textContent(), hash).not.toMatch(/Changes save/);
    }
    await go(page, "#/admin/defaults");
    expect(await page.locator(".ps-head").textContent()).toMatch(/Changes save/);
    // A part longer than the window scrolls inside the panel; the panel never runs past the window.
    await page.locator(".adm-ai-tiers").waitFor({ timeout: 30_000 });
    expect(await page.evaluate(() => {
      const b = document.querySelector(".ps-body")!;
      return [b.scrollHeight > b.clientHeight, document.querySelector(".panel-shell")!.getBoundingClientRect().bottom <= innerHeight];
    })).toEqual([true, true]);
    // Arrow keys move between tabs and open them; each says selected.
    const tabs = page.getByRole("tablist", { name: "Team defaults tabs" });
    await tabs.getByRole("tab", { name: "AI", selected: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => location.hash === "#/admin/defaults/chats");
    expect(await tabs.getByRole("tab", { name: "Client chats" }).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("End");
    await page.waitForFunction(() => location.hash === "#/admin/defaults/standards");
    await page.keyboard.press("Home");
    await page.waitForFunction(() => location.hash === "#/admin/defaults/ai");
    // The rail by keyboard: Enter on a client opens its page, marked as the current one.
    const harbor = page.locator('.ps-rail [data-settings-section="client:Harbor"]');
    await harbor.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.hash.startsWith("#/admin/clients/Harbor"));
    expect(await harbor.getAttribute("aria-current")).toBe("page");
    // Search Admin finds a setting and goes to its tab.
    await page.getByLabel("Search Admin").fill("model");
    await page.locator('#admin-search-results [data-hit="setting"]').first().click();
    await page.waitForFunction(() => location.hash === "#/admin/defaults/ai");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("on the phone: parts, a client's page and each tab reachable; every control at least 44 px; nothing wider than the screen", async () => {
    const page = await h.browser.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("focustime.hint.flow", "dismissed");
      localStorage.setItem("focustime.hint.picktime", "1");
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    // The largest Text size, and iPhone's larger root font.
    await page.keyboard.press("Control+Equal");
    await page.keyboard.press("Control+Equal");
    await page.addStyleTag({ content: "html { font-size: 17px; }" });
    await page.evaluate(() => (location.hash = "#/admin"));
    await page.locator('.ps-rail [data-settings-section="clients"]').waitFor();
    const small = () =>
      page.evaluate(() =>
        // A control's target is its label when it has one (a checkbox's or a switch's), else itself.
        [...document.querySelectorAll<HTMLElement>(".ps-body :is(button, select, input, textarea, a, [role=tab], [role=switch], [role=radio])")]
          .filter((e) => (e.offsetParent !== null || e.getClientRects().length > 0) && e.getAttribute("type") !== "hidden")
          .map((e) => [e, (e.closest("label") ?? e).getBoundingClientRect()] as const)
          .filter(([, r]) => r.height > 0 && r.height < 43.5)
          .map(([e, r]) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.height)}px`),
      );
    const all = ["clients", "clients/Atlas", ...["overview", "chats", "calls", "ai", "code", "deployments", "backlog"].map((t) => `clients/Atlas/${t}`), "clients/Northwind/deployments", "people/people", "people/setup", "people/logins", "people/levels", "people/admins", "defaults/ai", "defaults/chats", "defaults/planning", "defaults/standards", "health", "audit/changes", "audit/code"];
    for (const at of all) {
      await page.evaluate((x) => (location.hash = `#/admin/${x}`), at);
      await page.locator(".ps-head h2").waitFor();
      await page.waitForTimeout(900);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), at).toBeLessThanOrEqual(0);
      // No table wider than the screen: drawn as rows.
      expect(await page.evaluate(() => [...document.querySelectorAll(".ps-body table")].filter((t) => t.getBoundingClientRect().width > innerWidth + 1).length), at).toBe(0);
      expect(await small(), at).toEqual([]);
    }
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
