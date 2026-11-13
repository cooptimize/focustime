// RS-1: the before and after screenshots of the restyle, one script for both so the pairs match. Only when RS1_SHOTS
// names a folder (docs/ux/rs1/before or docs/ux/rs1/after); nothing runs otherwise. Demo data only (e2e/ps1-states.ts,
// the "ordinary" state: a few to-dos a block, a promise due, an at-risk block). Dark and light at 1440x900; Day and
// Week also at the largest Text size; the phone at 390x844. A screen that can't be reached is named in the log and
// skipped, so one missing control never loses the rest.
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { phonePage } from "./mb1-helpers.ts";
import { buildState, PS_CLOCK } from "./ps1-states.ts";

const DIR = process.env.RS1_SHOTS ?? null;
const T = 900_000;
const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];
const missed: string[] = [];

async function themed(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
  await page.waitForTimeout(200);
}
/** <name>-dark.png and <name>-light.png of the page as it stands. */
async function shot(page: Page, name: string) {
  for (const theme of THEMES) {
    await themed(page, theme);
    await page.screenshot({ path: `${DIR}/${name}-${theme}.png` });
  }
  await themed(page, "dark");
}
const go = async (page: Page, hash: string, wait = 1000) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(wait);
};
const esc = async (page: Page, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
};
const closePanel = async (page: Page) => {
  for (let i = 0; i < 2 && (await page.locator("aside.block-panel").count()); i++) await esc(page);
};
async function cardsOrTimeline(page: Page, which: "Cards" | "Timeline") {
  const b = page.locator(".day-switch button", { hasText: which }).first();
  if (await b.count()) await b.click();
  await page.waitForTimeout(700);
}
async function openPanel(page: Page) {
  if (await page.locator("aside.block-panel").count()) return;
  const card = page.locator(".half.focus.today-block, .half.focus").first();
  await card.locator(".card-head").first().click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.locator("aside.block-panel").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(700);
}
/** One screen: set it up, shoot it in both themes, clean up. A failure is logged, never thrown. */
async function screen(page: Page, name: string, setUp: () => Promise<void>, cleanUp: () => Promise<void> = async () => {}) {
  try {
    await setUp();
    await shot(page, name);
  } catch (e) {
    missed.push(`${name}: ${String((e as Error).message).split("\n")[0]}`);
  }
  await cleanUp().catch(() => {});
}
const textSize = async (page: Page, size: "larger" | null) => {
  await page.evaluate((s) => (s ? document.documentElement.setAttribute("data-text-size", s) : document.documentElement.removeAttribute("data-text-size")), size);
  await page.waitForTimeout(500);
};

describe.skipIf(!CHROMIUM || !DIR)("RS-1 screenshots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo("chromium", {}, PS_CLOCK);
  }, T);
  afterAll(async () => {
    if (missed.length) console.log(`RS-1 shots not taken:\n${missed.join("\n")}`);
    await h?.stop();
  });

  it("Day, Week, Backlog, Status and the Inbox at 1440x900", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 }, { dayPanel: "default" });
    await buildState(page, "ordinary");

    await screen(page, "01-day-cards-panel", async () => {
      await go(page, "#/day");
      await cardsOrTimeline(page, "Cards");
      await openPanel(page);
    });
    await screen(page, "02-day-timeline", async () => {
      await closePanel(page);
      await cardsOrTimeline(page, "Timeline");
    }, async () => cardsOrTimeline(page, "Cards"));
    await screen(page, "03-week", async () => {
      await go(page, "#/week");
      await closePanel(page);
      await page.locator(".week-head").first().waitFor();
    });
    await screen(page, "04-week-panel", async () => {
      await openPanel(page);
    }, async () => closePanel(page));
    await screen(page, "05-week-folded", async () => {
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForTimeout(700);
      await openPanel(page);
    }, async () => {
      await closePanel(page);
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await screen(page, "06-backlog-grid", async () => {
      await go(page, "#/backlog", 2500);
    });
    await screen(page, "07-backlog-gantt", async () => {
      await go(page, "#/backlog/gantt", 2500);
    });
    await screen(page, "08-status", async () => {
      await go(page, "#/status", 2500);
    });

    for (const [n, list] of [["09", "chats"], ["10", "promises"], ["11", "captures"]] as const)
      await screen(page, `${n}-inbox-${list}-open`, async () => {
        await go(page, `#/inbox/${list}`, 1500);
        const row = page.locator("li.ib4-row").first();
        await row.waitFor({ timeout: 10_000 });
        await row.locator(".ib4-row-head").click();
        await page.locator("li.ib4-row.open").first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600);
      });

    // Day and Week again at the largest Text size.
    await textSize(page, "larger");
    await screen(page, "30-day-larger", async () => {
      await go(page, "#/day");
      await cardsOrTimeline(page, "Cards");
      await openPanel(page);
    }, async () => closePanel(page));
    await screen(page, "31-week-larger", async () => {
      await go(page, "#/week");
      await closePanel(page);
    });
    await textSize(page, null);
    await page.close();
  }, T);

  it("Code, the story card, the New form, menus, Capture, Settings, Admin and the Focus screen at 1440x900", async () => {
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await buildState(page, "ordinary");

    await screen(page, "12-code-file", async () => {
      await go(page, "#/code/Northwind/a1b2c3d4-0001-4000-8000-00000000a001/%2Fsql%2Fdbo%2FViews%2FvSales.sql", 2500);
      await page.locator(".cv-file, .cv-code").first().waitFor({ timeout: 20_000 });
    }, async () => {
      await go(page, "#/day");
    });

    await screen(page, "13-story-card", async () => {
      await go(page, "#/item/Northwind/1111", 1500);
      await page.getByRole("dialog", { name: /#1111/ }).locator(".sc-facts").waitFor({ timeout: 20_000 });
    });
    await screen(page, "14-story-card-editing", async () => {
      await page.getByRole("dialog", { name: /#1111/ }).getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("textbox", { name: "Title" }).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
    }, async () => {
      await esc(page, 3);
      await go(page, "#/day");
    });

    await screen(page, "15-new-form", async () => {
      await go(page, "#/backlog", 2000);
      await page.locator(".ah-new").click();
      const f = page.locator(".new-form, .nf, [aria-label='New item'], .ps-new").first();
      await page.locator("#nf-title").waitFor({ timeout: 15_000 });
      void f;
      await page.locator("#nf-title").fill("Gross margin percent on the sales report");
      await page.waitForTimeout(500);
    });
    await screen(page, "16-new-form-preview", async () => {
      await page.locator("#nf-title").press("Enter");
      await page.locator(".write-dialog").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
    }, async () => {
      await esc(page, 4);
      const leave = page.getByRole("button", { name: /^(Discard|Leave|Close without saving)/ });
      if (await leave.count()) await leave.first().click().catch(() => {});
      await go(page, "#/day");
    });

    await screen(page, "17-command-menu", async () => {
      await page.keyboard.press("Control+k");
      await page.locator(".command-menu").waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
    }, async () => esc(page));
    await screen(page, "18-more-menu", async () => {
      await page.locator(".top-more").click();
      await page.locator(".popup-menu").waitFor({ timeout: 10_000 });
    }, async () => esc(page, 2));
    await screen(page, "19-block-menu", async () => {
      await go(page, "#/week");
      await closePanel(page);
      const card = page.locator("main .half.focus").first();
      await card.hover();
      await card.locator(".card-more").first().click();
      await page.locator(".popup-menu").waitFor({ timeout: 10_000 });
    }, async () => esc(page, 2));
    await screen(page, "20-capture", async () => {
      await page.locator(".capture-btn").click();
      await page.locator(".cap-box, .capture-dialog, .cap-input").first().waitFor({ timeout: 10_000 });
      await page.keyboard.type("Ask Dana about the export format");
      await page.waitForTimeout(500);
    }, async () => esc(page, 3));

    await screen(page, "21-settings", async () => {
      await go(page, "#/settings/display", 1500);
      await page.locator(".ps-head").first().waitFor({ timeout: 15_000 });
    });
    await screen(page, "22-admin-clients", async () => {
      await go(page, "#/settings/admin-clients", 1500);
      await page.locator(".ps-head").first().waitFor({ timeout: 15_000 });
    }, async () => {
      await esc(page);
      await go(page, "#/day");
    });

    await screen(page, "23-focus-screen", async () => {
      await go(page, "#/day");
      await page.locator(".top-btn.timer-btn").click();
      await page.getByRole("menuitem").first().click();
      await page.waitForTimeout(800);
      await go(page, "#/focus", 1200);
      await page.locator(".focus-screen").waitFor({ timeout: 10_000 });
    }, async () => {
      await esc(page);
    });
    await page.close();
  }, T);

  it("the phone's Day, Inbox and block sheet at 390x844", async () => {
    const page = await phonePage(h, 390);
    await page.setViewportSize({ width: 390, height: 844 });
    await buildState(page, "ordinary");
    await screen(page, "40-phone-day", async () => {
      await go(page, "#/day");
    });
    await screen(page, "41-phone-block-sheet", async () => {
      await page.locator("main .half.focus .card-head").first().click({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(900);
    }, async () => esc(page, 2));
    await screen(page, "42-phone-inbox", async () => {
      await go(page, "#/inbox/promises", 1500);
    });
    await screen(page, "43-phone-week", async () => {
      await go(page, "#/week", 1200);
    });
    await page.close();
  }, T);
});
