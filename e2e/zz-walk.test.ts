import { afterAll, beforeAll, it } from "vitest";
import { writeFileSync } from "node:fs";
import { freshPage, startDemo, type Harness } from "/home/tanner/Code/focustime-wt/pk4-pocket-mine/e2e/harness.ts";
import { phonePage } from "/home/tanner/Code/focustime-wt/pk4-pocket-mine/e2e/mb1-helpers.ts";
const D = "/tmp/claude-1000/-home-tanner-Code-focustime/a6d98f88-aa4e-4fad-b68d-57aaee55602b/scratchpad/pk4-walk";
let h: Harness;
const log: string[] = [];
const L = (s: string) => log.push(s);
const focus = (page: any) => page.evaluate(() => { const a = document.activeElement as HTMLElement; return a ? `${a.tagName} ${(a.textContent ?? "").slice(0, 60)}` : "none"; });
async function connect(page: any) {
  await page.evaluate(() => (location.hash = "#/settings/connections/pocket"));
  await page.waitForTimeout(2500);
  const sec = page.locator('section.sp-group[aria-label="Pocket recorder"]');
  await sec.locator("input").fill("pk_demo_shared");
  await sec.getByRole("button", { name: "Check and save" }).click();
  await page.waitForTimeout(2000);
  await page.evaluate(() => (location.hash = "#/calls"));
  await page.waitForTimeout(3000);
}
async function setAddr(page: any) {
  await page.getByRole("button", { name: "Set my Pocket address" }).click();
  const form = page.locator("[data-pocket-address]");
  await form.locator("input").fill("alex.rivera@personal.example");
  await form.getByRole("button", { name: /Use this address/ }).click();
  await page.waitForTimeout(2500);
}
beforeAll(async () => { h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00"); }, 120000);
afterAll(async () => { writeFileSync(`${D}/walk4.log`, log.join("\n\n")); await h?.stop(); });
it("desktop", async () => {
  const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
  await connect(page); await setAddr(page);
  const row = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Harbor sprint planning" }) }).first();
  await row.getByRole("button", { name: "Review" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${D}/07-harbor-setup.png` });
  const right = page.locator("main").first();
  const t = await right.innerText();
  L("=== harbor setup\n" + t.slice(t.indexOf("Client calls (1)") > 0 ? 0 : 0));
  writeFileSync(`${D}/07.html`, await right.innerHTML());
  const opt = page.getByText("Use my Pocket recording").first();
  L("use-my count: " + await page.getByText("Use my Pocket recording").count());
  if (await opt.count()) { await opt.click(); await page.waitForTimeout(800); L("focus after choose: " + await focus(page)); await page.screenshot({ path: `${D}/08-harbor-use-pocket.png` }); }
  // Carrier
  const car = page.locator("[data-calls-list] li").filter({ has: page.locator(".calls-name", { hasText: "Call with the carrier" }) }).first();
  await car.getByRole("button", { name: "Review" }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${D}/09-carrier.png` });
  const t2 = await page.locator("main").first().innerText();
  L("=== carrier\n" + t2);
  // Settings after
  await page.evaluate(() => (location.hash = "#/settings/connections/pocket"));
  await page.waitForTimeout(2500);
  const sec = page.locator('section.sp-group[aria-label="Pocket recorder"]');
  await sec.scrollIntoViewIfNeeded();
  await sec.screenshot({ path: `${D}/10-settings-after.png` });
  L("=== settings after\n" + await sec.innerText());
  L("errors: " + JSON.stringify(errors));
}, 240000);
it("phone", async () => {
  const page = await phonePage(h, 390);
  await page.setViewportSize({ width: 390, height: 844 });
  await connect(page);
  await page.screenshot({ path: `${D}/11-phone-calls.png` });
  const line = page.locator("[data-pocket-line]");
  if (await line.count()) { await line.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${D}/12-phone-line.png` }); }
  for (const sel of ["[data-pocket-get]", "[data-pocket-set-address]"]) L(sel + " box " + JSON.stringify(await page.locator(sel).boundingBox()));
  await page.locator("[data-pocket-set-address]").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${D}/13-phone-form.png` });
  const form = page.locator("[data-pocket-address]");
  for (const el of [form.locator("input"), ...(await form.locator("button").all())]) L("form el " + (await el.textContent()) + " " + JSON.stringify(await el.boundingBox()));
  L("phone focus: " + await focus(page));
  L("overflow: " + await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${innerWidth}`));
  // small controls in left list area near line
  const small = await page.evaluate(() => [...document.querySelectorAll("button, a, input, select, summary, [role=button]")].map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { t: ((e as HTMLElement).innerText || (e as HTMLInputElement).value || e.getAttribute("aria-label") || "").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width), vis: r.width > 0 && r.height > 0 }; }).filter((x) => x.vis && x.h < 44));
  L("small controls: " + JSON.stringify(small));
  await form.locator("input").fill("sam.taylor@example.com");
  await form.getByRole("button", { name: /Use this address/ }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${D}/14-phone-colleague.png` });
  L("after colleague addr: line=" + await line.innerText().catch(() => "-") + " | alert=" + await form.locator('[role="alert"]').innerText().catch(() => "-"));
}, 240000);
