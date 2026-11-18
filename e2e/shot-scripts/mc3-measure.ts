// MC-3 STEP 0.7 and 0.8: measures, prints, asserts nothing. Only when MC3_MEASURE names a file to write the numbers
// to. The top bar at 1280, 1366, 1440 and 1920 at each text size, with and without the Dev mark, with the tabs it has
// (six or seven); on main's build a seventh tab is a copy of the Inbox's named Calls, put before Code, so the width it
// needs is measured before it exists. And a call's page in a narrower box: the narrowest width at which a proposal's
// row, the filter row and the Transcript view lose nothing and clip nothing. Demo data only.
import { afterAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "../harness.ts";

const OUT = process.env.MC3_MEASURE ?? null;
const T = 900_000;
const lines: string[] = [];
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** How much the top bar overflows its one row (px), and what is cut. */
const barFit = (page: Page, fake7: boolean) =>
  page.evaluate((fake) => {
    const bar = document.querySelector<HTMLElement>(".app > .topbar")!;
    const views = bar.querySelector<HTMLElement>(".views")!;
    // With seven tabs already (this branch), "fake" is a person without Code: Code's tab goes, and the bar is told so.
    if (fake && views.querySelectorAll(".view-tab").length === 7) {
      [...views.querySelectorAll<HTMLElement>(".view-tab")].find((b) => /Code/.test(b.textContent ?? ""))?.remove();
      bar.classList.remove("seven-tabs");
    }
    if (fake && !views.querySelector("[data-fake-calls]") && views.querySelectorAll(".view-tab").length < 6) {
      const inbox = [...views.querySelectorAll<HTMLElement>(".view-tab")].find((b) => /Inbox/.test(b.textContent ?? ""))!;
      const copy = inbox.cloneNode(true) as HTMLElement;
      copy.setAttribute("data-fake-calls", "");
      copy.removeAttribute("aria-current");
      const t = [...copy.childNodes].find((n) => n.nodeType === 3 && /Inbox/.test(n.textContent ?? ""));
      if (t) t.textContent = "Calls";
      if (!copy.querySelector(".count")) {
        const c = document.createElement("span");
        c.className = "count";
        c.textContent = "2";
        copy.appendChild(c);
      } else copy.querySelector(".count")!.textContent = "2";
      inbox.after(copy);
    }
    const kids = [...bar.children].filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().width > 0);
    const mids = kids.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2));
    const cut = [...bar.querySelectorAll<HTMLElement>(".view-tab, .top-btn, .vm-chip, .brand")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className.split(" ")[0]);
    const r = bar.getBoundingClientRect();
    const rightmost = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
    // How much room is short: what sticks out past the bar's padding box, or wraps to a second row.
    const over = Math.round(Math.max(0, bar.scrollWidth - bar.clientWidth, rightmost - (r.right - parseFloat(getComputedStyle(bar).paddingRight))));
    const actions = bar.querySelector<HTMLElement>(".top-actions")!.getBoundingClientRect();
    const v = views.getBoundingClientRect();
    return { over, wraps: Math.max(...mids) - Math.min(...mids) > 4, height: Math.round(r.height), cut, gap: Math.round(actions.left - v.right), tabs: views.querySelectorAll(".view-tab").length, vmWords: !!bar.querySelector(".vm-word:not([hidden])") && getComputedStyle(bar.querySelector(".vm-word")!).display !== "none" };
  }, fake7);

describe.skipIf(!CHROMIUM || !OUT)("MC-3 measures", () => {
  const started: Harness[] = [];
  afterAll(async () => {
    (await import("node:fs")).writeFileSync(OUT!, lines.join("\n") + "\n");
    for (const h of started) await h.stop();
  });

  for (const env of [{ FOCUSTIME_ENV: "prod" }, { FOCUSTIME_ENV: "dev" }] as const) {
    it(`the top bar ${env.FOCUSTIME_ENV === "dev" ? "with the Dev mark" : "without the Dev mark"}`, async () => {
      const h = await startDemo("chromium", env, "2026-11-05T10:00:00-05:00");
      started.push(h);
      for (const width of (process.env.MC3_WIDTHS ?? "1280,1366,1440,1920").split(",").map(Number)) {
        const { page } = await freshPage(h, { width, height: 900 });
        await page.evaluate(() => (location.hash = "#/week"));
        await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        for (const size of [null, "large", "larger"] as const) {
          await page.reload();
          await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
          await page.waitForTimeout(1200);
          await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
          await page.waitForTimeout(200);
          for (const fake of [false, true]) {
            const m = await barFit(page, fake);
            lines.push(`bar ${env.FOCUSTIME_ENV} ${width} ${size ?? "default"} tabs=${m.tabs} over=${m.over} wraps=${m.wraps} height=${m.height} gap=${m.gap} cut=${m.cut.join(",") || "-"} vmWords=${m.vmWords}`);
          }
          await page.evaluate(() => document.querySelector("[data-fake-calls]")?.remove());
        }
        await page.close();
      }
    }, T);
  }

  it("a call's page in a narrower box", async () => {
    const h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
    started.push(h);
    const { page } = await freshPage(h, { width: 1920, height: 1000 });
    await page.evaluate(() => (location.hash = "#/week"));
    await page.locator(".topbar .view-tab").first().waitFor({ timeout: 30_000 });
    const mine = (await call(page, "meeting.mine", {})).data;
    const id = mine.occurrences[0].id as number;
    for (const size of [null, "large", "larger"] as const) {
      for (const view of ["", "/transcript"]) {
        await page.evaluate((x) => (location.hash = x), `#/meetings/${id}${view}`);
        await page.locator(".mtg-view h2").first().waitFor({ timeout: 30_000 });
        if (view) await page.locator(".mtg-lines li").first().waitFor({ timeout: 30_000 });
        else await page.locator(".mtg-prop").first().waitFor({ timeout: 30_000 }).catch(() => undefined);
        await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
        let ok = 0;
        for (let w = 1200; w >= 360; w -= 20) {
          const bad = await page.evaluate((px) => {
            const v = document.querySelector<HTMLElement>(".mtg-view")!;
            v.style.maxWidth = `${px}px`;
            v.style.width = `${px}px`;
            v.style.flex = "none";
            const scope = [...v.querySelectorAll<HTMLElement>(".mtg-filter-row, .mtg-filter-row *, .mtg-prop, .mtg-prop *, .mtg-lines, .mtg-lines li, .mtg-tr-bar, .mtg-tr-bar *, .mtg-sticky *")];
            const out: string[] = [];
            const box = v.getBoundingClientRect();
            for (const e of scope) {
              const r = e.getBoundingClientRect();
              if (!r.width) continue;
              const cs = getComputedStyle(e);
              const clips = cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
              if ((clips && e.scrollWidth > e.clientWidth + 1 && !/^(TEXTAREA|INPUT|SELECT)$/.test(e.tagName)) || r.right > box.right + 1) out.push(`${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]}`);
            }
            return out.slice(0, 4);
          }, w);
          if (bad.length) {
            lines.push(`call ${view || "/proposals"} ${size ?? "default"} first clip at ${w}: ${bad.join(" ")}`);
            break;
          }
          ok = w;
        }
        lines.push(`call ${view || "/proposals"} ${size ?? "default"} narrowest whole=${ok}`);
        await page.evaluate(() => {
          const v = document.querySelector<HTMLElement>(".mtg-view");
          if (v) v.removeAttribute("style");
        });
      }
    }
  }, T);
});
