// SA-2: repeats SA-0's counts for the person's Settings (docs/ux/sa0/findings.md parts 1 and 4), so a step can say
// what it changed: the kinds of row, help line, button, table and button row, how many lines each help line takes, the
// hit boxes under 44 px on the phone, and the order of every setting on its page with the group it sits in. SA-0's own
// script was never committed; this is the smallest one that measures the same things the same way: a "kind" is one
// combination of tag, classes, font size and weight, margins and colour, read from the page.
//
//   node scripts/settings-audit.ts <out.json>
//
// Demo data only ("Try the demo"). Admin is left out: SA-2 doesn't touch it.
import { writeFileSync } from "node:fs";
import { devices, type Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";
import { SECTIONS } from "../ui/settings/registry.ts";

const SIZES = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } },
} as const;

/** Old and new class names for each pattern, so one run reads main and the branch alike. */
const PICK = {
  row: ".set-field, .set-row, .set-list > li, .set-notify-row, .set-client-row, .source, .push-devices li, tr, .sp-row, .sp-list > li",
  help: ".set-hint, .set-intro, p.muted, span.muted, .set-fix, .sp-help, .sp-intro, .sp-more-text, .sp-result",
  buttonRow: ".set-inline, .set-save, .set-actions-row, .row-actions, .set-teams-controls, [class*='actions'], .sp-buttons",
  table: "table",
};

async function measure(page: Page) {
  return page.evaluate((PICK) => {
    const root = document.querySelector<HTMLElement>(".ps-body")!;
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden]");
    };
    const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const cls = (el: Element) => (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).sort().join(".");
    const sig = (el: Element) => {
      const cs = getComputedStyle(el);
      return `${el.tagName.toLowerCase()}.${cls(el)}|${cs.fontSize}/${cs.fontWeight}|mt${cs.marginTop} mb${cs.marginBottom}|${cs.color}`;
    };
    const kinds = (sel: string) => {
      const all = [...root.querySelectorAll(sel)].filter(vis);
      return { count: all.length, kinds: [...new Set(all.map(sig))] };
    };
    const buttons = [...root.querySelectorAll("button, a.mini, a.primary, a.sp-btn")].filter(vis).map((el) => {
      const cs = getComputedStyle(el);
      return `${cls(el) || "(none)"}|h${Math.round(el.getBoundingClientRect().height)}|${cs.backgroundColor}|${cs.borderTopWidth} ${cs.borderTopColor}|${cs.fontWeight}|${cs.color}`;
    });
    const helps = [...root.querySelectorAll(PICK.help)].filter(vis).map((el) => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      return { text: txt(el).slice(0, 80), lines: Math.round(el.getBoundingClientRect().height / lh) };
    });
    // The hit box of a checkbox, radio or switch is its label when it has one.
    const small = [...root.querySelectorAll("input, select, textarea, button, a[href], summary")].filter(vis).filter((el) => {
      const i = el as HTMLInputElement;
      const lab = (i.type === "checkbox" || i.type === "radio") && el.closest("label");
      const r = (lab || el).getBoundingClientRect();
      return r.height < 43.5;
    }).length;
    const order = [...root.querySelectorAll("[data-setting]")].filter(vis).map((el) => ({
      id: el.getAttribute("data-setting")!,
      group: el.parentElement?.closest("section[aria-label]")?.getAttribute("aria-label") ?? "",
    }));
    const pageWide = document.documentElement.scrollWidth > innerWidth + 1;
    return {
      row: kinds(PICK.row), help: kinds(PICK.help), buttonRow: kinds(PICK.buttonRow), table: kinds(PICK.table),
      button: { count: buttons.length, kinds: [...new Set(buttons)] },
      helps, small, order, pageWide,
    };
  }, PICK);
}

const out = process.argv[2] ?? "settings-audit.json";
const h = await startDemo("chromium");
const result: Record<string, unknown> = {};
try {
  for (const size of ["desk", "phone"] as const) {
    const ctx = await h.browser.newContext({ ...SIZES[size], colorScheme: "dark", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(h.url);
    await page.getByText(/Try the demo/).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 60_000 });
    const base = h.url.split("#")[0]!;
    const load = await page.evaluate(() =>
      fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": decodeURIComponent(document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "") }, body: JSON.stringify({ action: "settings.load", input: {} }) }).then((r) => r.json()),
    );
    const client = (load.data.clients as { key: string; follow: { active: boolean } | null }[]).find((c) => c.follow?.active !== false && c.key !== "Cooptimize")!.key;
    const ids = SECTIONS.filter((s) => !s.parent).flatMap((s) => (s.id === "clients" ? [s.id, `client/${client}`] : [s.id]));
    for (const id of ids) {
      await page.goto(`${base}#/settings/${id}`);
      await page.reload();
      if (size === "phone") await page.addStyleTag({ content: "html{font-size:17px}" });
      await page.locator(".ps-body").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1200);
      result[`${size}|${id.startsWith("client/") ? "client" : id}`] = await measure(page);
      process.stdout.write(`${size} ${id}\n`);
    }
    await ctx.close();
  }
} finally {
  await h.stop();
}

// The totals SA-0 reported: distinct kinds over every section at 1440, help lines over two lines at 390.
type M = { row: { kinds: string[]; count: number }; help: { kinds: string[]; count: number }; buttonRow: { kinds: string[]; count: number }; table: { kinds: string[]; count: number }; button: { kinds: string[]; count: number }; helps: { lines: number }[]; small: number };
const of = (size: string) => Object.entries(result).filter(([k]) => k.startsWith(`${size}|`)).map(([, v]) => v as M);
const union = (ms: M[], k: "row" | "help" | "buttonRow" | "table" | "button") => new Set(ms.flatMap((m) => m[k].kinds)).size;
const desk = of("desk");
const phone = of("phone");
const totals = {
  rowKinds: union(desk, "row"),
  helpKinds: union(desk, "help"),
  buttonKinds: union(desk, "button"),
  buttonHeights: [...new Set(desk.flatMap((m) => m.button.kinds.map((k) => k.split("|")[1])))].sort(),
  tableKinds: union(desk, "table"),
  buttonRowKinds: union(desk, "buttonRow"),
  helpLines: desk.reduce((n, m) => n + m.helps.length, 0),
  helpOverTwoAt1440: desk.reduce((n, m) => n + m.helps.filter((x) => x.lines > 2).length, 0),
  helpOverOneAt1440: desk.reduce((n, m) => n + m.helps.filter((x) => x.lines > 1).length, 0),
  helpOverTwoAt390: phone.reduce((n, m) => n + m.helps.filter((x) => x.lines > 2).length, 0),
  under44At390: phone.reduce((n, m) => n + m.small, 0),
};
writeFileSync(out, JSON.stringify({ totals, sections: result }, null, 1));
console.log(JSON.stringify(totals, null, 1));
