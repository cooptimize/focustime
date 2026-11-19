// SA-5: Settings and Admin on the phone, measured the way SA-0 part 8 and SA-4 measured them, on every page: controls
// under 44 px, two controls closer than 8 px, help lines over two lines, anything wider than the screen or clipped, a
// table wider than the screen, a section read-only on the phone, and how many screens long it is. At 390 by 844 with
// iPhone's 17 px root font, at the Default Text size and at the largest (Larger). Folds are opened ("Fine tuning",
// "Each kind of notice"); what sits behind More about this isn't a help line and isn't counted.
//
//   node scripts/settings-phone-audit.ts <out.json>
//
// Demo data only ("Try the demo"); the demo person is an admin.
import { writeFileSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";
import { SECTIONS } from "../ui/settings/registry.ts";

const ADMIN_PAGES = ["clients", ...["overview", "chats", "calls", "ai", "code", "deployments", "backlog"].map((t) => `clients/Northwind/${t}`), "people/people", "people/setup", "people/logins", "people/levels", "people/admins", "defaults/ai", "defaults/chats", "defaults/planning", "defaults/standards", "health", "audit/changes", "audit/code"];

export type PageMeasure = { small: string[]; close: string[]; helpOverTwo: string[]; wide: string[]; clipped: string[]; tablesWide: string[]; readOnly: boolean; screens: number; controls: number };

/** One page as it stands. Pure DOM reads; nothing is changed but the folds, opened. */
export async function measurePhonePage(page: Page): Promise<PageMeasure> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".ps-body")!;
    for (const d of body.querySelectorAll<HTMLDetailsElement>("details.sp-fold, details.ps-fold, details:not(.sp-more)")) d.open = true;
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[hidden], details:not([open]) > :not(summary)");
    };
    const name = (e: Element) => `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 32)}"`;
    // A control's target: its label when it has one (a switch's, a checkbox's), else itself.
    const controls = [...body.querySelectorAll<HTMLElement>("button, select, input, textarea, a[href], summary, [role=tab], [role=switch], [role=radio]")]
      .filter((e) => vis(e) && e.getAttribute("type") !== "hidden" && !e.closest("datalist"))
      // SA-5: a switch's or a select's whole row takes the press on a phone (.sp-press).
      .map((e) => {
        const box = (e.matches("[role=switch], select") ? e.closest(".sp-press, label") : e.closest("label")) ?? e;
        return { e, r: box.getBoundingClientRect(), box };
      });
    const seen = new Set<Element>();
    const targets = controls.filter((c) => (seen.has(c.box) ? false : (seen.add(c.box), true)));
    const small = targets.filter((c) => c.r.height < 43.5).map((c) => `${name(c.e)} ${Math.round(c.r.height)}px`);
    // Two targets closer than 8 px, side by side or one over the other; the rows of one list, one radio group or one
    // tab list touch by design (their dividers part them) and aren't counted.
    const group = (e: Element) => e.closest("[role=radiogroup], [role=tablist], ul, ol, .seg, table") ?? null;
    const close: string[] = [];
    for (let i = 0; i < targets.length; i++)
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i]!, b = targets[j]!;
        if (a.box.contains(b.box) || b.box.contains(a.box)) continue;
        const ga = group(a.box), gb = group(b.box);
        if (ga && ga === gb) continue;
        const dx = Math.max(a.r.left - b.r.right, b.r.left - a.r.right);
        const dy = Math.max(a.r.top - b.r.bottom, b.r.top - a.r.bottom);
        // Overlapping on one axis and nearer than 8 px on the other.
        if ((dy < 0 && dx >= 0 && dx < 7.5) || (dx < 0 && dy >= 0 && dy < 7.5)) close.push(`${name(a.e)} · ${name(b.e)} ${Math.round(Math.max(dx, dy))}px`);
      }
    const helps = [...body.querySelectorAll<HTMLElement>(".sp-help, .sp-intro, .sp-note, .sp-result, .set-hint, .set-intro, p.muted, span.muted, .sp-faint.sp-block")]
      // A problem says all of what is wrong where it stands (role=alert); it isn't help.
      // What sits behind a fold that explains (More about this, Where do I find the link?) is already behind a press;
      // a fold of settings (Fine tuning, Each kind of notice) is measured like the rest.
      .filter((e) => vis(e) && !e.closest(".sp-more-text, .sp-more, td, th, .sp-status-detail, [role=alert], .problem") && !e.closest("details:not(.sp-fold):not(.ps-fold)"))
      // A line of words, not a strip of chips or a row of things that happens to be muted.
      .filter((e) => [...e.children].every((c) => /^(A|EM|STRONG|CODE|KBD|BR|SPAN)$/.test(c.tagName) && !c.matches(".chip, [class*=chip], [class*=pill], .badge, .state")) && !e.matches(".state"))
      .filter((e) => {
        const cs = getComputedStyle(e);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        return Math.round(e.getBoundingClientRect().height / lh) > 2;
      })
      .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70));
    const scroller = (e: Element) => {
      for (let p = e.parentElement; p && p !== body; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      return false;
    };
    const W = document.documentElement.clientWidth;
    const wide = [...body.querySelectorAll<HTMLElement>("*")].filter((e) => vis(e) && !scroller(e) && (e.getBoundingClientRect().right > W + 1 || e.getBoundingClientRect().left < -1)).slice(0, 12).map(name);
    if (document.documentElement.scrollWidth > W + 1) wide.unshift(`the page scrolls sideways by ${document.documentElement.scrollWidth - W}px`);
    const clipped = [...body.querySelectorAll<HTMLElement>("*")]
      .filter((e) => {
        // Screen-reader-only words are cut on purpose; a field's own value scrolls inside it.
        if (!vis(e) || e.matches("input, textarea, select") || e.closest(".sr-only, .visually-hidden") || (e.children.length > 0 && !(e.textContent ?? "").trim())) return false;
        const cs = getComputedStyle(e);
        const cuts = cs.textOverflow === "ellipsis" || /(hidden|clip)/.test(cs.overflowX);
        return cuts && e.scrollWidth > e.clientWidth + 1 && !/(auto|scroll)/.test(cs.overflowX);
      })
      .slice(0, 12)
      .map(name);
    const tablesWide = [...body.querySelectorAll("table")].filter((t) => vis(t) && t.getBoundingClientRect().width > W + 1).map((t) => `${t.getAttribute("aria-label") ?? "table"} ${Math.round(t.getBoundingClientRect().width)}px`);
    const screens = Math.round(((body.getBoundingClientRect().top + window.scrollY + body.scrollHeight) / innerHeight) * 10) / 10;
    return { small, close, helpOverTwo: helps, wide, clipped, tablesWide, readOnly: !!body.querySelector(".phone-ro"), screens, controls: targets.length };
  });
}

async function run(out: string) {
  const h = await startDemo("chromium");
  const result: Record<string, PageMeasure> = {};
  try {
    for (const size of ["phone", "larger"] as const) {
      const ctx = await h.browser.newContext({ ...devices["iPhone 15"], viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce", bypassCSP: true });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        localStorage.setItem("focustime.hint.picktime", "1");
      });
      await page.goto(h.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      const base = h.url.split("#")[0]!;
      if (size === "larger") {
        await page.goto(`${base}#/settings/display`);
        await page.locator('[data-setting="text-size"]').getByRole("radio", { name: "Larger" }).click();
        await page.waitForTimeout(600);
      }
      const ids = [...SECTIONS.filter((s) => !s.parent).flatMap((s) => (s.id === "clients" ? [`settings/${s.id}`, "settings/client/Northwind"] : [`settings/${s.id}`])), ...ADMIN_PAGES.map((p) => `admin/${p}`)];
      for (const id of ids) {
        await page.goto(`${base}#/${id}`);
        await page.reload();
        await page.addStyleTag({ content: "html{font-size:17px}" });
        await page.locator(".ps-body").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1200);
        result[`${size}|${id}`] = await measurePhonePage(page);
        process.stdout.write(`${size} ${id}\n`);
      }
      await ctx.close();
    }
  } finally {
    await h.stop();
  }
  const sum = (size: string, part: "settings" | "admin", k: "small" | "close" | "helpOverTwo" | "wide" | "clipped" | "tablesWide") =>
    Object.entries(result).filter(([key]) => key.startsWith(`${size}|${part}/`)).reduce((n, [, m]) => n + m[k].length, 0);
  const totals = Object.fromEntries(
    (["phone", "larger"] as const).flatMap((size) =>
      (["settings", "admin"] as const).map((part) => [
        `${size}|${part}`,
        {
          small: sum(size, part, "small"), close: sum(size, part, "close"), helpOverTwo: sum(size, part, "helpOverTwo"), wide: sum(size, part, "wide"), clipped: sum(size, part, "clipped"), tablesWide: sum(size, part, "tablesWide"),
          readOnly: Object.entries(result).filter(([key, m]) => key.startsWith(`${size}|${part}/`) && m.readOnly).map(([key]) => key.split("|")[1]),
          controls: Object.entries(result).filter(([key]) => key.startsWith(`${size}|${part}/`)).reduce((n, [, m]) => n + m.controls, 0),
        },
      ]),
    ),
  );
  writeFileSync(out, JSON.stringify({ totals, pages: result }, null, 1));
  console.log(JSON.stringify(totals, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await run(process.argv[2] ?? "settings-phone-audit.json");
