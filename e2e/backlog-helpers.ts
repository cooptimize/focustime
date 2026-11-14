// BL-1: Backlog's toolbar in browser tests. Levels moved into Filter; these open it, pick, and close it again.
import type { Page } from "playwright-core";

/** Open the Filter popover (once), returning it. */
export async function openFilter(page: Page) {
  const pop = page.locator(".ah-filter-pop");
  if (!(await pop.count())) await page.locator(".ah-toolbar").getByRole("button", { name: /^Filter/ }).click();
  await pop.waitFor();
  return pop;
}

/** Filter › Levels: show down to Epics, Features or Stories (by the process's own names), then close the popover. */
export async function pickLevel(page: Page, name: string) {
  const pop = await openFilter(page);
  await pop.getByRole("group", { name: "Levels" }).getByRole("button", { name, exact: true }).click();
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "detached" });
}

/** The Levels buttons, inside an open Filter popover. */
export const levelButtons = (page: Page) => page.locator(".ah-filter-pop").getByRole("group", { name: "Levels" }).getByRole("button");

/** Whether Filter › Levels › <name> is the level shown ("true" or "false"), reading it with the popover open. */
export async function levelPressed(page: Page, name: string) {
  const pop = await openFilter(page);
  const v = await pop.getByRole("group", { name: "Levels" }).getByRole("button", { name, exact: true }).getAttribute("aria-pressed");
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "detached" });
  return v;
}

/** ⋯ (More: rows and view), then one of its items. */
export async function moreItem(page: Page, name: string | RegExp) {
  await page.locator(".ah-toolbar").getByRole("button", { name: "More: rows and view" }).click();
  const item = page.getByRole("menuitem", { name }).or(page.getByRole("menuitemcheckbox", { name }));
  await item.first().click();
}

/** Whether ⋯'s Callouts item is on ("true" or "false"); the menu closes again. */
export async function calloutsOn(page: Page) {
  await page.locator(".ah-toolbar").getByRole("button", { name: "More: rows and view" }).click();
  const v = await page.getByRole("menuitemcheckbox", { name: /Callouts/ }).getAttribute("aria-checked");
  await page.keyboard.press("Escape");
  return v;
}

/**
 * BL-2: Backlog lists one level (Features by default), each row opening to what's under it. Tests written for the
 * tree BL-1 showed by default (every level, every row open) start from Epics with everything opened, which is that
 * same tree: call before Backlog opens (it reads the level once, as it mounts).
 */
export async function oldTree(page: Page) {
  await page.evaluate(() => localStorage.setItem("focustime.ahead.view.fold", JSON.stringify({ level: "epic", rows: {}, all: true })));
}
