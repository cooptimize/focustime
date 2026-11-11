// MB-1: e2e helpers for the phone: a phone page signed in to the demo with the iPhone's 17 px root font, an action
// call, and Monday planned.
import type { Page } from "playwright-core";
import type { Harness } from "./harness.ts";

const MON = "2026-11-02";

export const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean }>;

/** A phone page signed in to the demo, with the iPhone's larger root font. */
export async function phonePage(h: Harness, width: number): Promise<Page> {
  const page = await h.browser.newPage({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, bypassCSP: true });
  await page.addInitScript(() => {
    localStorage.setItem("focustime.hint.flow", "dismissed");
    localStorage.setItem("focustime.hint.picktime", "1");
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "html{font-size:17px}";
      document.head.append(st);
    });
  });
  await page.goto(h.url);
  await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
  await page.waitForSelector(".topbar", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
  return page;
}

/** Today planned: two to-dos in the morning (one with a long title), one in the afternoon. */
export async function planMonday(page: Page): Promise<void> {
  for (const p of [
    { half: "AM", clientKey: "Cooptimize", intention: "Write the migration notes for the customer export and share them with the delivery team", size: "M" },
    { half: "AM", clientKey: "Cooptimize", intention: "Review open pull requests", size: "S" },
    { half: "PM", clientKey: "Northwind", intention: "Prepare the data model review", size: "L" },
  ])
    await call(page, "pick.add", { date: MON, ...p });
}

