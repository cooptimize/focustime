// ST-1: Status's pictures, before and after. Only when ST1_SHOTS names a folder; nothing runs otherwise. Demo data only.
// ST1_PHASE=before takes main's screens; after takes this step's. Dark at 1440 by 900 and 390 by 844 (the iPhone's
// 17 px root font); ST1_LIGHT=1 adds the two light ones. Clock: the demo's (Thu Nov 5, 2026 10:00 AM ET).
import { afterAll, describe, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const DIR = process.env.ST1_SHOTS ?? null;
const PHASE = process.env.ST1_PHASE === "before" ? "before" : "after";
const T = 900_000;
const CLOCK = "2026-11-05T10:00:00-05:00";
const missed: string[] = [];
const notes: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data?: unknown }>;

async function shot(page: Page, name: string, run: () => Promise<void>, full = false) {
  try {
    await run();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
}
/** STEP 0.5: words on the page's main (visible text), and the distance from a line to the button that pushes it. */
async function measure(page: Page, label: string, line: Locator | null, push: Locator | null) {
  const words = await page.evaluate(() => (document.querySelector("main.status-view") as HTMLElement | null)?.innerText.split(/\s+/).filter(Boolean).length ?? 0);
  const none = await page.evaluate(() => [...document.querySelectorAll("main.status-view *")].filter((e) => e.children.length === 0 && /^(No update yet|nothing yet|Nothing yet)$/i.test((e.textContent ?? "").trim())).length);
  let dist = "n/a";
  if (line && push && (await line.count()) && (await push.count())) {
    await line.last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const a = await line.last().boundingBox();
    const b = await push.first().boundingBox();
    if (a && b) dist = String(Math.round(Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))));
  }
  notes.push(`${label}: words=${words} no-update=${none} line-to-push=${dist}`);
}

describe.skipIf(!CHROMIUM || !DIR)("ST-1 screenshots", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    const fs = await import("node:fs");
    fs.writeFileSync(`${DIR}/notes-${PHASE}.txt`, [...notes, ...missed.map((m) => `missed: ${m}`)].join("\n"));
    for (const h of started) await h.stop();
  });
  const go = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.waitForTimeout(2500);
  };
  const start = async (w: number, hgt: number, theme = "cooptimize-dark", phone = false) => {
    const h = await startDemo("chromium", {}, CLOCK);
    started.push(h);
    let page: Page;
    if (phone) {
      page = await h.browser.newPage({ viewport: { width: w, height: hgt }, isMobile: true, hasTouch: true, bypassCSP: true });
      await page.addInitScript(() => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = "html{font-size:17px}";
          document.head.append(st);
        });
      });
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    } else page = (await freshPage(h, { width: w, height: hgt })).page;
    await page.locator(".topbar").first().waitFor({ timeout: 60_000 });
    await call(page, "ui.set_theme", { theme });
    if (phone) await page.waitForTimeout(1500);
    else await page.reload();
    await page.waitForTimeout(1500);
    await go(page, "#/week/status");
    await page.locator("main.status-view").waitFor({ timeout: 60_000 });
    await page.getByRole("article").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    return page;
  };
  const art = (page: Page, name: string) => page.getByRole("article", { name });

  it("before: main's Status", async () => {
    if (PHASE !== "before") return;
    const page = await start(1440, 900);
    const load = (await call(page, "status.load", {})).data as { clients: { clientName: string; ai: string; canWrite: boolean; features: { title: string; needsYou?: boolean }[] }[] };
    notes.push(`clients: ${load.clients.map((c) => `${c.clientName} ai=${c.ai} write=${c.canWrite} features=${c.features.map((f) => `${f.title}${f.needsYou ? "*" : ""}`).join("|")}`).join(" ; ")}`);
    await shot(page, "01-before-opens-1440", async () => undefined);
    await measure(page, "opens", null, null);
    await shot(page, "01b-before-opens-full", async () => undefined, true);
    // One suggestion used, one line typed, one Draft.
    await shot(page, "02-before-used-typed-draft", async () => {
      const h = art(page, "Patient intake form");
      await h.getByRole("button", { name: "Use", exact: true }).click();
      const s = art(page, "Supplier onboarding");
      await s.getByRole("button", { name: "Add a line" }).click();
      await s.getByRole("textbox").last().fill("Sign-up form designed; purchasing reviews it Friday.");
      await s.getByRole("textbox").last().press("Escape");
      const d = page.locator("article").filter({ has: page.getByRole("button", { name: "Draft", exact: true }) }).first();
      notes.push(`draft on: ${await d.getAttribute("aria-label")}`);
      await d.getByRole("button", { name: "Draft", exact: true }).click();
      await page.waitForTimeout(2500);
      await d.scrollIntoViewIfNeeded();
    });
    await measure(page, "with lines", page.locator(".st-pending-line"), page.getByRole("button", { name: "Push all" }));
    await shot(page, "02b-before-used-typed-draft-full", async () => undefined, true);
    await shot(page, "03-before-preview", async () => {
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.waitForTimeout(800);
    }, true);
    await measure(page, "preview", null, null);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await shot(page, "05-before-pushed-undo", async () => {
      await page.getByRole("button", { name: "Push all" }).click();
      const d = page.getByRole("dialog").last();
      for (let i = 0; i < 4; i++) {
        const b = d.locator("button.commit");
        if (!(await b.count())) break;
        await b.click();
        await page.waitForTimeout(1500);
      }
      await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 30_000 });
      await page.locator(".st-pushed").scrollIntoViewIfNeeded();
    });
    await shot(page, "06-before-feature-nothing", async () => {
      const e = page.locator("article.st-empty").first();
      await e.scrollIntoViewIfNeeded();
    });
    await shot(page, "07-before-ai-off", async () => {
      notes.push(`ai off: ${JSON.stringify(await call(page, "admin.set", { scope: "client:Atlas", key: "allow_ai", value: false }))}`);
      await page.reload();
      await page.locator("main.status-view").waitFor({ timeout: 60_000 });
      await page.getByRole("article").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2500);
      await page.getByRole("region", { name: "Atlas" }).scrollIntoViewIfNeeded();
    });
    await shot(page, "04-before-client-report", async () => {
      await page.getByRole("combobox", { name: "Client report" }).selectOption({ index: 1 });
      await page.locator(".st-report").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
    });
    const phone = await start(390, 844, "cooptimize-dark", true);
    await shot(phone, "08-before-phone-390", async () => undefined);
    await shot(phone, "08b-before-phone-390-full", async () => undefined, true);
  }, T);
  it("after: ST-1's Status", async () => {
    if (PHASE !== "after") return;
    const dark = async (w: number, hgt: number) => start(w, hgt);
    const page = await dark(1440, 900);
    await shot(page, "01-after-opens-1440", async () => undefined);
    await measure(page, "opens", null, null);
    await shot(page, "01b-after-opens-full", async () => undefined, true);
    // All three states under one feature: a comment on the report, a line I wrote, a suggestion.
    await shot(page, "02-after-three-states", async () => {
      await page.locator("[data-show=all]").click();
      const h = art(page, "Patient intake form");
      await h.getByRole("button", { name: "Write a line" }).click();
      await h.getByRole("textbox").last().fill("Validate date of birth is in review; the size check is next.");
      await h.getByRole("textbox").last().press("Escape");
      await page.waitForTimeout(600);
      await h.scrollIntoViewIfNeeded();
    });
    await shot(page, "03-after-suggestion-basis", async () => {
      const a = art(page, "Shipment tracking dashboard");
      await a.locator(".st-basis").click();
      await a.scrollIntoViewIfNeeded();
    });
    // One suggestion added, one line typed, one Suggest a line.
    await shot(page, "04-after-foot-bar", async () => {
      const i = art(page, "Internal reporting refresh");
      await i.getByRole("button", { name: "Add", exact: true }).click();
      const s = art(page, "Supplier onboarding");
      await s.getByRole("button", { name: "Write a line" }).click();
      await s.getByRole("textbox").last().fill("Sign-up form designed; purchasing reviews it Friday.");
      await s.getByRole("textbox").last().press("Escape");
      const o = art(page, "Order history export");
      await o.getByRole("button", { name: "Suggest a line" }).click();
      await o.locator(".st-sugg").waitFor({ timeout: 30_000 });
      await o.scrollIntoViewIfNeeded();
    });
    await measure(page, "with lines", page.locator(".st-pending-line"), page.getByRole("button", { name: "Push to DevOps" }));
    await shot(page, "04b-after-foot-bar-full", async () => undefined, true);
    await shot(page, "05-after-push-preview", async () => {
      await page.getByRole("button", { name: "Push to DevOps" }).click();
      await page.getByRole("dialog").last().waitFor();
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await shot(page, "06-after-preview", async () => {
      await page.getByRole("button", { name: "Preview", exact: true }).click();
    }, true);
    await measure(page, "preview", null, null);
    await shot(page, "07-after-preview-show-them", async () => {
      await page.getByRole("button", { name: "Show them" }).click();
    }, true);
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await shot(page, "08-after-pushed-undo", async () => {
      await page.locator("[data-foot-bar]").getByRole("button", { name: "Push to DevOps" }).click();
      for (let i = 0; i < 4; i++) {
        const b = page.getByRole("dialog").last().locator("button.commit");
        if (!(await b.count())) break;
        await b.click();
        await page.waitForTimeout(1500);
      }
      await page.locator(".st-pushed").getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 30_000 });
      await page.locator(".st-pushed").scrollIntoViewIfNeeded();
    });
    await shot(page, "09-after-ai-off", async () => {
      await call(page, "admin.set", { scope: "client:Atlas", key: "allow_ai", value: false });
      await page.reload();
      await page.locator("main.status-view").waitFor({ timeout: 60_000 });
      await page.getByRole("article").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2500);
      await page.getByRole("region", { name: "Atlas" }).scrollIntoViewIfNeeded();
    });
    await shot(page, "10-after-client-report", async () => {
      await page.getByRole("combobox", { name: "Client report" }).selectOption({ index: 1 });
      await page.locator(".st-report").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
    });
    const small = await dark(1280, 720);
    await shot(small, "11-after-1280", async () => {
      const h = art(small, "Patient intake form");
      await h.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForTimeout(300);
    });
    const phone = await start(390, 844, "cooptimize-dark", true);
    await shot(phone, "12-after-phone-390", async () => undefined);
    await shot(phone, "12b-after-phone-390-full", async () => {
      const h = art(phone, "Patient intake form");
      await h.getByRole("button", { name: "Add", exact: true }).click();
    }, true);
    await shot(phone, "12c-after-phone-foot", async () => {
      await art(phone, "Patient intake form").scrollIntoViewIfNeeded();
    });
    if (process.env.ST1_LIGHT) {
      const light = await start(1440, 900, "cooptimize-light");
      await shot(light, "13-after-light-opens", async () => undefined);
      await shot(light, "14-after-light-three-states", async () => {
        const h = art(light, "Patient intake form");
        await h.getByRole("button", { name: "Write a line" }).click();
        await h.getByRole("textbox").last().fill("Validate date of birth is in review; the size check is next.");
        await h.getByRole("textbox").last().press("Escape");
        await h.scrollIntoViewIfNeeded();
      });
    }
  }, T);
});
