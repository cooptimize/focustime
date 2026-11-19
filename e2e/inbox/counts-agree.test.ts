// UC-3 item 4 (browser, demo mode): the Inbox's client chips, the group headings under them and the tab's number all
// count what needs me. For every client in the demo, the chip's number is the sum of what its headings say needs me
// across From chats and Promises; All clients is the tab's number. A heading adds its rows when they differ
// ("1 needs you · 3"). On the phone the chips have no numbers (UC-1), and the headings add up to the tab's number.
// Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const T = 300_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Each heading as client, what needs me and rows: "Harbor 1 needs you · 3" → { Harbor, 1, 3 }. */
const heads = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".ib4-group-head")].map((h) => {
      const n = h.querySelector(".muted")?.textContent ?? "";
      const name = (h.textContent ?? "").slice(0, (h.textContent ?? "").length - n.length).trim();
      const m = /^(none|\d+) needs? you(?: · (\d+))?$/.exec(n);
      return { name, text: n, need: m ? (m[1] === "none" ? 0 : Number(m[1])) : null, rows: m ? (m[2] ? Number(m[2]) : Number(m[1])) : Number(n) };
    }),
  );
const chips = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ib4-chips .ib4-chip")].map((c) => ({ name: (c.childNodes.length ? [...c.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join("") : c.textContent ?? "").trim(), n: Number(c.querySelector(".ib4-count")?.textContent ?? 0), none: c.dataset.chip === "no-client" })));

async function openList(page: Page, list: "chats" | "promises") {
  await page.evaluate((l) => (location.hash = `#/inbox/${l}`), list);
  await page.locator(".ib4-list").waitFor({ timeout: 30_000 });
  await expect.poll(() => page.locator(".ib4-list .muted.ib4-empty, .ib4-list .ib4-group, .ib4-list .ib4-empty").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
}

/** What the headings say needs me, per client, over both lists that count. */
async function headNeeds(page: Page): Promise<{ per: Map<string, number>; all: number; seen: { name: string; text: string; need: number | null; rows: number }[] }> {
  const per = new Map<string, number>();
  const seen: { name: string; text: string; need: number | null; rows: number }[] = [];
  for (const l of ["chats", "promises"] as const) {
    await openList(page, l);
    for (const h of await heads(page)) {
      seen.push(h);
      expect(h.need, `"${h.name} ${h.text}" says what needs me`).not.toBeNull();
      per.set(h.name, (per.get(h.name) ?? 0) + (h.need ?? 0));
    }
  }
  return { per, all: [...per.values()].reduce((a, b) => a + b, 0), seen };
}

describe.skipIf(!CHROMIUM)("UC-3: the Inbox's chips, headings and tab count the same thing (browser, demo mode)", () => {
  let h: Harness;
  let page: Page;
  beforeAll(async () => {
    h = await startDemo();
    ({ page } = await freshPage(h, { width: 1440, height: 900 }));
    await call(page, "ui.set_inbox", { clients: [] });
    // A promise with no client, so No client has something to count too.
    expect((await call(page, "followup.add", { what: "Send the cutover checklist", due: "2026-11-01" })).ok).toBe(true);
    await page.reload();
  }, T);
  afterAll(async () => h?.stop());

  it("on the computer: each client's chip is what its headings say needs me; All clients is the tab's number", async () => {
    const { per, all, seen } = await headNeeds(page);
    const got = await chips(page);
    const server = (await call(page, "inbox.today", {})).data.needsYou as number;
    const tab = Number(await page.locator(".view-tab", { hasText: "Inbox" }).locator(".count").textContent());
    expect(tab, "the tab's number").toBe(server);
    expect(got[0]!.n, "All clients").toBe(server);
    expect(all, "the headings add up to the tab's number").toBe(server);
    for (const c of got.slice(1)) expect(c.n, `${c.name}'s chip against its headings`).toBe(per.get(c.name) ?? 0);
    // A heading whose rows don't all need me says both; one where they all do says one number.
    expect(seen.some((x) => x.rows !== x.need && x.text.includes(" · "))).toBe(true);
    for (const x of seen) if (x.rows === x.need) expect(x.text).not.toContain(" · ");
  }, T);

  it("on the phone: the headings add up to the tab's number", async () => {
    const phone = await freshPage(h, { width: 390, height: 844 });
    const { all, seen } = await headNeeds(phone.page);
    expect(seen.length).toBeGreaterThan(0);
    expect(all).toBe((await call(phone.page, "inbox.today", {})).data.needsYou);
    await phone.page.close();
  }, T);
});
