// HK-7 (Q-DOC1-7): signing in raises no Content Security Policy violation. The built UI runs under the app's CSP
// (style-src 'self', no inline styles); a style attribute set from a string, an inline <style> or a script the policy
// refuses shows as a securitypolicyviolation event, collected from before the first page loads.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemo, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await startDemo();
}, 120_000);
afterAll(async () => {
  await h?.stop();
});

describe("sign-in under the CSP", () => {
  it("the sign-in page, Try the demo and the opening raise no CSP violation", async () => {
    const page = await h.browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const console: string[] = [];
    page.on("console", (m) => /Content Security Policy|violates/i.test(m.text()) && console.push(`${page.url()} ${JSON.stringify(m.location())} ${m.text().slice(0, 80)}`));
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${e.sample}`));
    });
    await page.goto(h.url);
    await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 30_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.waitForTimeout(500);
    const seen = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect({ seen, console }).toEqual({ seen: [], console: [] });
  }, 120_000);
});
