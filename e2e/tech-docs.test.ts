// DOC-1: the Technical docs in a browser, on the demo. They open from ⋯, the command menu and the Guide's footer link;
// a deep link lands on its page and heading; × and Esc close and give focus back; search finds a heading; the security
// page's diagram is drawn with its extracted styles (the CSP allows no inline style); an automation account gets "not
// available"; a script in the Markdown never runs (the unit tests render it; here: no page errors and no <script> in the
// body); no sideways scroll at 390 and 360.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { DOC_PAGES, DOCS_TEXT } from "../ui/docs/pages.ts";
import { TECH_DOCS_LINK } from "../ui/guide/content.ts";

let h: Harness;
const T = 150_000;

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const b = document.querySelector(".tech-docs .ps-body") as HTMLElement | null;
    const wide = [...document.querySelectorAll(".tech-docs .ps-body *")]
      // Inside a table, code box or diagram that scrolls by itself is fine: the box is what must fit.
      .filter((e) => !e.closest(".td-scroll, .td-code, .td-diagram, .sr-only") && e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => `${e.tagName}.${e.className}`)
      .slice(0, 5);
    return { page: document.documentElement.scrollWidth <= innerWidth, body: !b || b.scrollWidth <= b.clientWidth + 1, wide };
  });

const docs = (page: Page) => page.locator("main.tech-docs");
const body = (page: Page, id: string) => page.locator(`main.tech-docs .td-body[data-doc-page='${id}']`);

describe.skipIf(!CHROMIUM)("the Technical docs (DOC-1)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("opens from ⋯ on the Overview with every page in the rail; × closes and focus goes back to ⋯", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    const more = page.locator(".top-more");
    await more.click();
    await page.getByRole("menuitem", { name: /^Technical docs/ }).first().click();
    await body(page, "overview").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("#/docs");
    expect(await docs(page).locator(".ps-rail .ps-item").allTextContents()).toEqual(DOC_PAGES.map((p) => p.label));
    await expect.poll(() => docs(page).locator(".td-footer [data-build]").textContent()).toMatch(/^This build: \S+/);
    const edit = docs(page).locator(".td-footer a", { hasText: DOCS_TEXT.edit });
    expect(await edit.getAttribute("href")).toMatch(/\/edit\/main\/docs\/technical\/README\.md$/);
    expect(await body(page, "overview").locator("script").count()).toBe(0);

    // A relative link to another page opens it in the panel.
    await body(page, "overview").locator("a[data-doc='security']").first().click();
    await body(page, "security").waitFor();
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/docs\/security/);

    await docs(page).locator(".x-close").click();
    await docs(page).waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("top-more"))).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the command menu opens a page by name, and Esc closes", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("technical docs security");
    await page.getByRole("menuitem", { name: /Technical docs: Security/ }).first().click();
    await body(page, "security").waitFor();
    await page.keyboard.press("Escape");
    await docs(page).waitFor({ state: "detached" });

    await page.keyboard.press("Control+k");
    await page.keyboard.type("architecture");
    await page.getByRole("menuitem", { name: /Technical docs: Architecture/ }).first().click();
    await body(page, "architecture").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("the Guide's footer link opens them", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("?");
    await page.locator("main.guide").waitFor();
    await page.getByRole("link", { name: TECH_DOCS_LINK.label }).click();
    await body(page, "overview").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("a heading deep link opens its page and focuses the heading; the diagram has its styles", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/docs/security/secrets"));
    await body(page, "security").waitFor();
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.anchor)).toBe("secrets");
    const svg = body(page, "security").locator("figure.td-diagram svg").first();
    await svg.waitFor();
    expect(await svg.locator("[style]").count()).toBe(0);
    // A drawn node's shape has a fill from the extracted stylesheet, not the browser's black default.
    const fill = await svg.evaluate((s) => {
      const r = s.querySelector(".node rect, .node polygon, rect.actor, rect") as SVGElement | null;
      return r ? getComputedStyle(r).fill : null;
    });
    expect(fill).not.toBeNull();
    expect(fill).not.toBe("rgb(0, 0, 0)");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("search finds a heading and opens it", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/docs"));
    await body(page, "overview").waitFor();
    await docs(page).getByRole("searchbox", { name: DOCS_TEXT.search }).fill("rollback");
    const hit = docs(page).locator(".gsr-hit").first();
    await hit.waitFor();
    expect(await hit.locator(".gsr-in").textContent()).toBe("in Operations");
    await hit.click();
    await body(page, "operations").waitFor();
    expect(errors).toEqual([]);
    await page.close();
  });

  it("an automation account gets not available, with no pages", { timeout: T }, async () => {
    const { page, errors } = await freshPage(h);
    await page.route("**/api/action", async (route) => {
      const b = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
      if (b.action !== "docs.access") return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { allowed: false, why: "automation" } }) });
    });
    await page.evaluate(() => (location.hash = "#/docs/security"));
    const note = docs(page).locator(".td-note[data-docs-refused='automation']");
    await note.waitFor();
    expect(await note.textContent()).toBe(DOCS_TEXT.automation);
    expect(await docs(page).locator(".td-body").count()).toBe(0);
    expect(await docs(page).locator(".ps-rail .ps-item").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  });

  for (const width of [390, 360])
    it(`at ${width} px every page fits with no sideways scroll, and the contents list has Back`, { timeout: T }, async () => {
      const { page, errors } = await freshPage(h, { width, height: 844 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "17px"));
      await page.evaluate(() => (location.hash = "#/docs/contents"));
      await expect.poll(() => docs(page).locator(".ps-rail .ps-item").count()).toBe(DOC_PAGES.length);
      await docs(page).locator(".ps-rail .ps-item").nth(4).click();
      await body(page, "security").waitFor();
      await docs(page).locator(".ps-back").click();
      await expect.poll(() => docs(page).locator(".ps-rail .ps-item").count()).toBe(DOC_PAGES.length);
      for (const p of DOC_PAGES) {
        await page.evaluate((id) => (location.hash = `#/docs/${id}`), p.id);
        await body(page, p.id).waitFor();
        expect(await noSidewaysScroll(page), p.id).toEqual({ page: true, body: true, wide: [] });
      }
      // A heading deep link lands below the sticky top bar, not under it.
      await page.evaluate(() => (location.hash = "#/docs/security/secrets"));
      await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.anchor)).toBe("secrets");
      const gap = await page.evaluate(() => document.querySelector("[data-anchor='secrets']")!.getBoundingClientRect().top - (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0));
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(errors).toEqual([]);
      await page.close();
    });
});
