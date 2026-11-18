// EV-1: the dev site says Dev (and the developer loop Local) in the top bar on a computer and a phone, in the tab's
// title and in the installed app's name; About says the site in a word and its address. Production shows nothing new
// and asks nothing new. Each environment is its own demo server (FOCUSTIME_ENV), so each has its own describe.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 180_000;
const SAY_DEV = "This is FocusTime's dev site, not production.";

/** The phone's top bar on one line, nothing wider than its box, the mark, the date and Ask whole. */
async function phoneBarWhole(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".topbar") as HTMLElement;
    const box = bar.getBoundingClientRect();
    const whole = (s: string) => {
      const e = document.querySelector(s) as HTMLElement | null;
      if (!e) return `${s}: missing`;
      const r = e.getBoundingClientRect();
      const inside = r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      return e.scrollWidth <= e.clientWidth + 1 && inside ? "whole" : `${s}: cut (${e.scrollWidth} in ${e.clientWidth}, ${Math.round(r.left)} to ${Math.round(r.right)} in ${Math.round(box.right)})`;
    };
    return { page: document.documentElement.scrollWidth <= innerWidth, bar: bar.scrollWidth <= bar.clientWidth, parts: [".ph1-date", ".site-tag", ".ph-ask"].map(whole), vm: whole(".topbar .vm-chip") };
  });
}

describe.skipIf(!CHROMIUM)("EV-1 on dev", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "dev" });
  }, T);
  afterAll(async () => h?.stop());

  it("a computer: Dev beside the name, read aloud as what it means, not a control; the tab's title and the installed name say Dev", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    const tag = page.locator(".topbar .brand .site-tag");
    await tag.waitFor();
    await expect(tag.locator('[aria-hidden="true"]').innerText()).resolves.toBe("Dev");
    await expect(tag.getAttribute("title")).resolves.toBe(SAY_DEV);
    // The word is hidden from a screen reader, which reads the sentence instead.
    await expect(tag.locator(".sr-only").textContent()).resolves.toBe(SAY_DEV);
    await expect(tag.locator('[aria-hidden="true"]').textContent()).resolves.toBe("Dev");
    // Beside the name: right after it, on the line the demo's own mark sits on.
    const [name, mark, demo] = await Promise.all([page.locator(".brand .name").boundingBox(), tag.boundingBox(), page.locator(".topbar .demo-tag").boundingBox()]);
    expect(mark!.x).toBeGreaterThan(name!.x + name!.width);
    expect(mark!.x - (name!.x + name!.width)).toBeLessThan(40);
    expect(Math.abs(mark!.y + mark!.height / 2 - (demo!.y + demo!.height / 2))).toBeLessThan(2);
    // Not a control: no role, no tabindex, and Tab never lands in it.
    await expect(tag.evaluate((e) => [e.tagName, e.getAttribute("role"), e.getAttribute("tabindex"), e.querySelector("a, button, input, [tabindex]")])).resolves.toEqual(["SPAN", null, null, null]);
    await page.locator("body").click({ position: { x: 700, y: 600 } }).catch(() => {});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest(".site-tag"))).toBe(false);
    }
    await expect(page.title()).resolves.toBe("Dev · FocusTime");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content")).resolves.toBe("FocusTime Dev");
    const manifest = (await (await page.request.get(new URL("/manifest.webmanifest", page.url()).href)).json()) as { name: string; short_name: string; id: string };
    expect([manifest.name, manifest.short_name, manifest.id]).toEqual(["FocusTime Dev", "FocusTime Dev", "/"]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const width of [390, 360]) {
    it(`a phone at ${width}: Dev beside the date, the bar on one line with nothing cut; as a person (no Demo tag) the VM's two words fit too`, async () => {
      const { page, errors } = await freshPage(h, { width, height: 844 });
      const tag = page.locator(".topbar .site-tag");
      await tag.waitFor();
      await expect(tag.locator('[aria-hidden="true"]').innerText()).resolves.toBe("Dev");
      const [date, mark] = await Promise.all([page.locator(".ph1-date").boundingBox(), tag.boundingBox()]);
      expect(mark!.x).toBeGreaterThan(date!.x + date!.width);
      expect(mark!.x - (date!.x + date!.width)).toBeLessThan(20);
      const demo = await phoneBarWhole(page);
      expect([demo.page, demo.bar, demo.parts]).toEqual([true, true, ["whole", "whole", "whole"]]);
      // A person on dev has no Demo tag; without it the VM's "VM Stopped" is whole beside the mark at 360 as well.
      await page.evaluate(() => document.querySelector(".demo-tag")?.remove());
      await page.waitForTimeout(100);
      const person = await phoneBarWhole(page);
      expect([person.page, person.bar, person.parts, person.vm]).toEqual([true, true, ["whole", "whole", "whole"], "whole"]);
      expect(errors).toEqual([]);
      await page.close();
    }, T);
  }

  it("no mark while /version hasn't answered, and none when it fails; the title is the page's own, so it never flashes", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let fail = false;
    const { page } = await freshPage(h, { width: 1440, height: 900 }, {
      before: (p) =>
        p.route("**/version", async (route) => {
          if (fail) return route.abort();
          await held;
          return route.continue();
        }),
    });
    await page.waitForTimeout(500);
    await expect(page.locator(".site-tag").count()).resolves.toBe(0);
    await expect(page.title()).resolves.toBe("Dev · FocusTime");
    release();
    await page.locator(".site-tag").waitFor();
    // A fresh load whose /version fails: no mark, ever.
    fail = true;
    await page.reload();
    await page.locator(".topbar").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(".site-tag").count()).resolves.toBe(0);
    await page.close();
  }, T);

  it("About says the site in a word and its address, in the dialog and in Settings on a phone", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    const host = new URL(page.url()).host;
    await page.locator(".topbar .top-more").first().click();
    await page.getByRole("menuitem", { name: "About" }).click();
    const about = page.getByRole("dialog", { name: "About FocusTime" });
    await expect(about.locator(".about-site").textContent()).resolves.toBe(`Site: Dev · ${host}`);
    await page.close();
    const phone = (await freshPage(h, { width: 390, height: 844 })).page;
    await phone.evaluate(() => (location.hash = "#/settings/about"));
    await expect(phone.locator("[data-site-line]").textContent({ timeout: 30_000 })).resolves.toBe(`Site: Dev · ${host}`);
    await phone.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("EV-1 in the developer loop", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "local" });
  }, T);
  afterAll(async () => h?.stop());

  it("Local in the top bar, the title and the installed name", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await expect(page.locator('.topbar .site-tag [aria-hidden="true"]').innerText({ timeout: 30_000 })).resolves.toBe("Local");
    await expect(page.title()).resolves.toBe("Local · FocusTime");
    const manifest = (await (await page.request.get(new URL("/manifest.webmanifest", page.url()).href)).json()) as { name: string };
    expect(manifest.name).toBe("FocusTime Local");
    await page.close();
  }, T);
});

describe.skipIf(!CHROMIUM)("EV-1 on production", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", { FOCUSTIME_ENV: "prod" });
  }, T);
  afterAll(async () => h?.stop());

  for (const width of [1440, 390]) {
    it(`at ${width}: no mark, the title and the installed name as before, and /version isn't asked at start`, async () => {
      const asked: string[] = [];
      const { page } = await freshPage(h, { width, height: width < 600 ? 844 : 900 }, { before: async (p) => p.on("request", (r) => new URL(r.url()).pathname === "/version" && asked.push(r.url())) });
      await page.waitForTimeout(1500);
      await expect(page.locator(".site-tag").count()).resolves.toBe(0);
      await expect(page.evaluate(() => document.documentElement.dataset.site ?? null)).resolves.toBe(null);
      await expect(page.title()).resolves.toBe("FocusTime");
      await expect(page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content")).resolves.toBe("FocusTime");
      // The brand holds what it held before: the name (on a computer) and the demo's own mark.
      await expect(page.locator(".topbar .brand > *").evaluateAll((es) => es.map((e) => e.className))).resolves.toEqual(width < 600 ? ["demo-tag"] : ["brand-home", "demo-tag"]);
      expect(asked).toEqual([]);
      const manifest = (await (await page.request.get(new URL("/manifest.webmanifest", page.url()).href)).json()) as { name: string; short_name: string };
      expect([manifest.name, manifest.short_name]).toEqual(["FocusTime", "FocusTime"]);
      await page.close();
    }, T);
  }
});
