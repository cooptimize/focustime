// AH-1: Ahead (Grid · Gantt · Fix next) in demo mode: the shared model, my change set (three pending from the demo,
// one a conflict), inline edits that survive a reload, the review, the Gantt's half-day drag with the drag bug's fix
// under a slow reload, Fix next, the notice link, and the phone's read-only view. Nothing is written to DevOps in the
// demo (it has no write PAT): Commit says how to enable writes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, sameSession, startDemo, type Harness } from "./harness.ts";
import { shotBoth, SHOTS } from "./shots.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("Ahead (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const open = async (hash: string, viewport?: { width: number; height: number }) => {
    const { page, errors } = await freshPage(h, viewport);
    await page.evaluate((x) => (location.hash = x), hash);
    // MB-1: on the phone Ahead opens with its notice first; Open anyway shows it.
    if (viewport && viewport.width < 600) await page.getByRole("button", { name: "Open anyway" }).click({ timeout: 30_000 });
    await page.locator(".ahead").waitFor({ timeout: 30_000 });
    await page.locator(".ah-pending").waitFor({ timeout: 30_000 });
    return { page, errors };
  };
  const row = (page: Page, title: string) => page.locator(".ah-row", { has: page.getByRole("link", { name: title, exact: true }) });
  const bar = (page: Page, title: string) => page.locator(".pa-item", { has: page.getByRole("link", { name: title, exact: true }) });

  it("Grid: every level grouped by client, gaps only as quiet chips, missing fields a dash that says what's missing, my changes to save; items I can't change say who can", async () => {
    const { page, errors } = await open("#/ahead");
    await expect(page.locator(".ah-pending").textContent()).resolves.toContain("3 changes to save");
    await expect(page.locator(".ah-client-head").allTextContents()).resolves.toEqual(expect.arrayContaining([expect.stringContaining("Northwind Foods"), expect.stringContaining("Harbor Health")]));
    // Pending values show in place: Store locator starts Nov 16 PM (AH-3: the weekday in the tooltip).
    await expect(row(page, "Store locator").locator(".ah-col-start").textContent()).resolves.toContain("Nov 16 PM");
    await expect(row(page, "Store locator").locator(".ah-col-start [title]").first().getAttribute("title")).resolves.toContain("Monday, November 16");
    await expect(row(page, "Store locator").locator(".ah-col-start").getAttribute("class")).resolves.toContain("ah-pend");
    await expect(row(page, "Loyalty points").locator(".ah-col-target").getAttribute("class")).resolves.toContain("ah-conf");
    // A story's size in its process's own field on one line (AH-3: "3 SP"), the field's name and FocusTime's size in
    // its tooltip; a feature has none in this process.
    await expect(row(page, "Export orders to CSV").locator(".ah-col-size").textContent()).resolves.toMatch(/^3\s*SP$/);
    await expect(row(page, "Export orders to CSV").locator(".ah-col-size .ah-size").getAttribute("title")).resolves.toMatch(/3 Story Points\s+FocusTime: L, about 4h/);
    // AH-2: a field the type doesn't have, and a missing value, are a muted dash; the tooltip says which.
    await expect(row(page, "Order history export").locator(".ah-col-size .ah-none").getAttribute("title")).resolves.toBe("Not in Portal's process");
    await expect(row(page, "Supplier onboarding").locator(".ah-col-start .ah-none").getAttribute("title")).resolves.toBe("No start date");
    // Gaps only in Readiness, as chips: two, then +N with the rest in its tooltip. No cell is filled for a gap.
    const ready = row(page, "Supplier onboarding").locator(".ah-col-ready");
    await expect(ready.locator(".ah-chip:not(.ah-more)").allTextContents()).resolves.toEqual(["Not scoped", "Needs stories"]);
    await expect(ready.locator(".ah-more").textContent()).resolves.toBe("+1");
    await expect(ready.locator(".ah-more").getAttribute("title")).resolves.toBe("No target date");
    const fills = await page.locator(".ah-cell:not(.ah-pend)").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).backgroundColor))]);
    expect(fills).toEqual(["rgba(0, 0, 0, 0)"]);
    // No orange text: every cell's text is the normal or a muted color, never the amber.
    const amber = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--watch").trim());
    const colors = await page.locator(".ah-cell, .ah-cell *").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]);
    const probe = await page.evaluate((c) => {
      const d = document.createElement("span");
      d.style.color = c;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, amber);
    expect(colors).not.toContain(probe);
    // Harbor: I'm not a lead there; All shows a teammate's story, read only with the note.
    await page.getByRole("button", { name: "Harbor Health", exact: true }).click();
    await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "All" }).click();
    const theirs = page.locator(".ah-row.ro:not(.context)").first();
    await theirs.waitFor();
    await expect(theirs.getAttribute("title")).resolves.toBe("Only Harbor Health's leads and the owner can change this.");
    await theirs.locator(".ah-col-target").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".cell-pop").count()).resolves.toBe(0);
    await shotBoth(page, "ahead-readonly", theirs);
    // Filters are remembered for me: reopening keeps them.
    const ctx2 = await sameSession(h, page);
    const again = await ctx2.newPage();
    await again.goto(`${h.url}/#/ahead`);
    await again.locator(".ah-client-head").first().waitFor({ timeout: 30_000 });
    await expect(again.locator(".ah-client-head").allTextContents()).resolves.toEqual([expect.stringContaining("Harbor Health")]);
    await again.getByRole("button", { name: "Clear filters" }).click();
    await ctx2.close();
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("cell edits (AH-5 popovers): Enter opens, Enter saves, Esc cancels, arrows move; the change is pending and survives a reload", async () => {
    const { page } = await open("#/ahead");
    await page.getByRole("button", { name: "Northwind Foods", exact: true }).click();
    const size = row(page, "Export button on the order page").locator(".ah-col-size");
    await size.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Story Points" }).fill("5");
    await page.keyboard.press("Escape");
    await expect(size.getAttribute("class")).resolves.not.toContain("ah-pend");
    await size.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Story Points" }).fill("5");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".ah-pending").textContent()).toContain("4 changes to save");
    await expect(size.textContent()).resolves.toContain("5");
    await shotBoth(page, "ahead-grid", page.locator(".ah-client").first());
    // Arrows: left from Size is Assigned to.
    await size.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.evaluate(() => document.activeElement?.className ?? "")).resolves.toContain("ah-col-assignee");
    await page.reload();
    await page.locator(".ah-pending").waitFor({ timeout: 30_000 });
    await expect(page.locator(".ah-pending").textContent()).resolves.toContain("4 changes to save");
    // Back to what DevOps has: no change.
    await row(page, "Export button on the order page").locator(".ah-col-size").focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => page.locator(".ah-pending").textContent()).toContain("3 changes to save");
    await page.close();
  }, T);

  it("QF-1: one click opens each picker (start, target, assigned to, size) and stages a change; hover marks the cells I can change", async () => {
    const { page } = await open("#/ahead");
    await page.getByRole("button", { name: "Northwind Foods", exact: true }).click();
    const story = row(page, "Export button on the order page");
    const staged = (cell: ReturnType<Page["locator"]>) => expect.poll(() => cell.getAttribute("class"), { timeout: 10_000 }).toContain("ah-pend");
    // Size: a click, a number, Save.
    const size = story.locator(".ah-col-size");
    await expect(size.getAttribute("class")).resolves.toContain("ah-edit");
    await size.click();
    await page.getByRole("textbox", { name: "Story Points" }).fill("8");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await staged(size);
    // Assigned to: a click opens the people dropdown; a mouse pick lands.
    // HK-5: the demo already has a pending assignee change on this story (Priya Shah, DevOps' value, to me), so the
    // cell is pending before the pick. Sam Ortiz is a real change; the name shows only once the pick lands.
    const who = story.locator(".ah-col-assignee");
    await who.click();
    await page.getByRole("option", { name: /Sam Ortiz/ }).click();
    await expect.poll(() => who.getAttribute("aria-label"), { timeout: 10_000 }).toContain("Sam Ortiz");
    await staged(who);
    // Target, then start on a feature that has one: a typed date, Save.
    const target = story.locator(".ah-col-target");
    await target.click();
    await page.getByRole("textbox", { name: "Target date" }).fill("2026-11-20");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await staged(target);
    const title = await page.locator(".ah-row.tier-feature:not(.ro)", { has: page.locator(".ah-col-start.ah-edit") }).first().locator(".ah-title a").first().textContent();
    const feature = row(page, title!.trim());
    const start = feature.locator(".ah-col-start");
    await start.click();
    await page.getByRole("textbox", { name: "Start date" }).fill("nov 9");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await staged(start);
    await expect.poll(() => page.locator(".ah-pending").textContent()).toMatch(/\d+ changes to save/);
    // AH-5: State is a picker too.
    await expect(story.locator(".ah-col-state").getAttribute("class")).resolves.toContain("ah-edit");
    await page.close();
  }, T);

  it("AH-5: each editor is a popover anchored to its cell and on screen; keyboard; dates; state from the process; assignees from the client's project; nothing written before Save to DevOps", async () => {
    const { page, errors } = await open("#/ahead", { width: 1440, height: 900 });
    // Nothing goes to DevOps while editing: no preview or confirm call until "Save N items to DevOps".
    const writes: string[] = [];
    page.on("request", (r) => {
      const b = r.postData() ?? "";
      if (/"action":"devops\.(preview|confirm)"/.test(b)) writes.push(b);
    });
    await page.getByRole("button", { name: "Northwind Foods", exact: true }).click();
    const inView = async (cellLoc: ReturnType<Page["locator"]>) => {
      const pop = page.locator(".cell-pop");
      await pop.waitFor();
      const [p, c] = [(await pop.boundingBox())!, (await cellLoc.boundingBox())!];
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(1440);
      expect(p.y + p.height).toBeLessThanOrEqual(900);
      // Anchored: it touches the cell's column or sits just above or below it.
      expect(Math.abs(p.x - c.x) < 330 && (Math.abs(p.y - (c.y + c.height)) < 12 || Math.abs(p.y + p.height - c.y) < 12 || (p.y <= c.y && p.y + p.height >= c.y))).toBe(true);
      return pop;
    };
    const story = row(page, "Export button on the order page");
    // Keyboard: Enter opens, Esc cancels with focus back on the cell.
    const target = story.locator(".ah-col-target");
    await target.focus();
    await page.keyboard.press("Enter");
    let pop = await inView(target);
    await expect(pop.getByText("Target date", { exact: true })).toBeTruthy();
    await expect(pop.locator(".cell-pop-head").textContent()).resolves.toContain("#1113 Export button on the order page");
    await page.keyboard.press("Escape");
    await expect(page.locator(".cell-pop").count()).resolves.toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-target");
    // Quick picks: Next Monday (Nov 9 from Fri Nov 6), PM, then Tab saves and moves on to the next editable cell.
    await page.keyboard.press("Enter");
    pop = await inView(target);
    await pop.getByRole("button", { name: "Next Monday" }).click();
    await pop.getByRole("radio", { name: "AM" }).click();
    await page.keyboard.press("Tab");
    await expect.poll(() => target.textContent()).toContain("Nov 9 AM");
    await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("ah-col-assignee");
    // Clear takes it back to DevOps's (none): no change.
    await target.click();
    pop = await inView(target);
    await pop.getByRole("button", { name: "Clear" }).click();
    await pop.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => target.getAttribute("class")).not.toContain("ah-pend");
    // A feature: Target before Start shows a warning and doesn't save.
    const feat = row(page, "Store locator");
    const fTarget = feat.locator(".ah-col-target");
    await fTarget.click();
    pop = await inView(fTarget);
    await pop.getByRole("textbox", { name: "Target date" }).fill("11/10");
    await expect(pop.getByRole("alert").textContent()).resolves.toContain("The target is before the start");
    await expect(pop.getByRole("button", { name: "Save" }).isDisabled()).resolves.toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator(".cell-pop").count()).resolves.toBe(1);
    await page.keyboard.press("Escape");
    // State: the type's states from the process model, the current one checked, filtered by typing.
    const st = story.locator(".ah-col-state");
    await st.click();
    pop = await inView(st);
    await expect(pop.getByRole("option").allTextContents()).resolves.toEqual(expect.arrayContaining([expect.stringContaining("New"), expect.stringContaining("Active"), expect.stringContaining("Closed")]));
    await expect(pop.getByRole("option", { selected: true }).textContent()).resolves.toContain("New");
    await page.keyboard.type("act");
    await expect(pop.getByRole("option").count()).resolves.toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => st.textContent()).toContain("Active");
    await expect.poll(() => st.getAttribute("class")).toContain("ah-pend");
    // Assigned to: Northwind's project only (Morgan Lee, outside Cooptimize), never Atlas's (Casey Ward); me first; search.
    const who = story.locator(".ah-col-assignee");
    await who.click();
    pop = await inView(who);
    await pop.getByRole("option").first().waitFor();
    const names = await pop.locator(".fl-label").allTextContents();
    expect(names[0]).toMatch(/\(me\)$/);
    expect(names).toContain("Unassigned");
    expect(names).toContain("Morgan Lee");
    expect(names).not.toContain("Casey Ward");
    await expect(pop.getByRole("option", { name: /Morgan Lee/ }).textContent()).resolves.toContain("Outside Cooptimize");
    await page.keyboard.type("morgan");
    await expect(pop.getByRole("option").count()).resolves.toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => who.getAttribute("aria-label")).toBe("Assigned to: Morgan Lee");
    await expect(who.textContent()).resolves.toContain("Morgan L.");
    // Unassigned.
    await who.click();
    pop = await inView(who);
    await pop.getByRole("option", { name: "Unassigned" }).click();
    await expect.poll(() => who.getAttribute("aria-label")).toBe("Assigned to: nobody");
    // Size, near the right edge; and a row at the bottom of the window: the popover flips above and stays on screen.
    const sz = story.locator(".ah-col-size");
    await sz.click();
    pop = await inView(sz);
    await expect(pop.getByRole("radiogroup", { name: /Common Story Points values/ }).getByRole("radio").allTextContents()).resolves.toEqual(["1", "2", "3", "5", "8", "13"]);
    await page.keyboard.press("Escape");
    const low = page.locator(".ah-row:not(.ro) .ah-col-size.ah-edit").last();
    await low.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 2000));
    const lb = (await low.boundingBox())!;
    if (lb.y > 600) {
      await low.click();
      const p = await inView(low);
      expect(await p.getAttribute("data-above")).not.toBeNull();
      await page.keyboard.press("Escape");
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("AH-5: no native select or date input anywhere in Ahead; no horizontal scroll at 1280 and 1440; readiness chips stay in their cells", async () => {
    for (const width of [1280, 1440]) {
      const { page } = await open("#/ahead", { width, height: 900 });
      await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "All" }).first().click();
      for (const hash of ["#/ahead", "#/ahead/gantt", "#/ahead/fix", "#/ahead/backlog"]) {
        await page.evaluate((x) => (location.hash = x), hash);
        await page.waitForTimeout(400);
        await expect(page.locator(".ahead select, .ahead input[type=date], .ahead input[type=datetime-local], .ahead input[type=month]").count(), hash).resolves.toBe(0);
      }
      await page.evaluate(() => (location.hash = "#/ahead"));
      await page.locator(".ah-grid").first().waitFor();
      await expect(page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).resolves.toBeLessThanOrEqual(0);
      const spill = await page.locator(".ah-col-ready").evaluateAll((cells) =>
        cells.flatMap((c) => {
          const box = c.getBoundingClientRect();
          return [...c.querySelectorAll(".ah-chip, .ah-gapdot")].filter((x) => x.getBoundingClientRect().right > box.right + 0.5).map((x) => x.textContent);
        }),
      );
      expect(spill, `width ${width}`).toEqual([]);
      // Column headers line up with their cells.
      const off = await page.locator(".ah-grid").first().evaluate((t) => {
        const th = [...t.querySelectorAll("thead th")].map((x) => Math.round(x.getBoundingClientRect().left));
        const td = [...(t.querySelector("tbody tr")?.children ?? [])].map((x) => Math.round(x.getBoundingClientRect().left));
        return th.map((x, i) => Math.abs(x - (td[i] ?? x)));
      });
      expect(Math.max(...off)).toBeLessThanOrEqual(1);
      await page.close();
    }
  }, T);

  it("the review: grouped by item, before → after, a conflict with Keep mine or Take theirs, Remove, Discard all with a confirm", async () => {
    const { page, errors } = await sameSessionFresh();
    // A second change on one item (its size, beside the conflicting target), so a card holds two rows.
    const loyal = row(page, "Loyalty points").locator(".ah-col-start");
    await loyal.waitFor({ timeout: 30_000 });
    await loyal.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Start date" }).fill("2026-11-30");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.locator(".ah-pending").textContent()).toContain("4 changes to save");
    await page.getByRole("button", { name: "Review" }).click();
    const panel = page.getByRole("dialog", { name: "Review changes" });
    await panel.waitFor();
    await expect(panel.locator(".ah-review-item").count()).resolves.toBe(3);
    const conflict = panel.locator(".ah-review-item.conflict");
    await expect(conflict.textContent()).resolves.toMatch(/Loyalty points.*Target.*Fri, Dec 4.*Wed, Dec 23 PM.*DevOps has Fri, Dec 11 now/);
    // AH-2: one summary, the conflict at the top of its card, and one grid across the cards: every arrow at the same x.
    await expect(panel.locator(".ah-review-sum").textContent()).resolves.toMatch(/^4 changes on 3 items\. Each item is written to DevOps as one change, only if nobody changed those fields since you started editing\.$/);
    await expect(conflict.locator(":scope > *").nth(1).getAttribute("class")).resolves.toContain("ah-rv-conflict");
    const arrows = await panel.locator(".ah-rv-arrow").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(arrows.length).toBe(4);
    expect(new Set(arrows).size).toBe(1);
    const afters = await panel.locator(".ah-rv-after").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(afters).size).toBe(1);
    await expect(panel.getByRole("button", { name: /^Save (\d items? )?to DevOps$/ }).count()).resolves.toBe(1);
    await expect(panel.getByText("Nothing is written until you save.").count()).resolves.toBe(1);
    // DM-1: the demo's DevOps writes are on (simulated in memory), so there is nothing to enable.
    await expect(panel.getByText("Northwind Foods: DevOps writes aren't on for you.").count()).resolves.toBe(0);
    await shotBoth(page, "ahead-review-conflict", panel);
    // Take theirs drops my conflicting change.
    await conflict.getByRole("button", { name: "Take theirs" }).click();
    await expect.poll(() => panel.locator(".ah-review-item.conflict").count()).toBe(0);
    await panel.getByRole("button", { name: /Remove the start change on #1140/ }).click();
    await expect.poll(() => panel.locator(".ah-review-item").count()).toBe(2);
    await panel.getByRole("button", { name: /Remove the start change on #1150/ }).click();
    await expect.poll(() => panel.locator(".ah-review-item").count()).toBe(1);
    await panel.getByRole("button", { name: "Discard all" }).click();
    await panel.getByRole("button", { name: "Keep them" }).click();
    await expect(panel.locator(".ah-review-item").count()).resolves.toBe(1);
    await panel.getByRole("button", { name: "Discard all" }).click();
    await panel.getByRole("button", { name: "Discard all" }).click();
    await expect.poll(() => page.locator(".ah-pending").count()).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("AH-2: Cooptimize's scope: the client's own area left out with a note, Show the whole project brings it back marked, Fix next never has it, and an admin's scope applies", async () => {
    const { page, errors } = await open("#/ahead");
    await page.getByRole("button", { name: "Northwind Foods", exact: true }).click();
    await page.getByRole("group", { name: "Owner" }).getByRole("button", { name: "All" }).click();
    await expect(page.locator(".ah-scope-note").textContent()).resolves.toContain("Showing Cooptimize's work (automatic) for Northwind Foods. Set the scope in Admin › Clients.");
    await expect(row(page, "Finance close automation").count()).resolves.toBe(0);
    await expect(row(page, "Order history export").count()).resolves.toBe(1);
    const whole = page.getByRole("button", { name: "Show the whole project" });
    await expect(whole.getAttribute("title")).resolves.toBe("Northwind Foods: 13 of 18 open items are Cooptimize's work");
    await whole.click();
    await row(page, "Finance close automation").waitFor();
    await expect(row(page, "Month-end journal import").locator(".ah-ro").allTextContents()).resolves.toContain("Outside scope");
    // Fix next never offers the client's own work (Journal approval step is unassigned and unsized).
    const fix = await call(page, "#/ahead/fix");
    await expect(fix.locator(".ah-fx-row:not(.ctx)").count()).resolves.toBeGreaterThan(0);
    await expect(fix.getByText("Journal approval step").count()).resolves.toBe(0);
    // Remembered: still on after a reload.
    await page.evaluate(() => (location.hash = "#/ahead"));
    await page.reload();
    await row(page, "Finance close automation").waitFor({ timeout: 30_000 });
    await whole.click();
    await expect.poll(() => row(page, "Finance close automation").count()).toBe(0);
    // An admin sets By area path to Finance only: Northwind shows only that (and my own items).
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    const card = page.locator(".adm-client", { has: page.getByRole("heading", { name: "Northwind" }) });
    const scope = card.locator(".adm-scope");
    await scope.waitFor({ timeout: 30_000 });
    await expect(scope.textContent()).resolves.toContain("Automatic: 13 of 18 open items.");
    await scope.getByRole("radio", { name: /By area path/ }).check();
    await scope.getByRole("row", { name: /Finance/ }).getByRole("checkbox").first().check();
    await expect(scope.textContent()).resolves.toContain("Shows 5 of 18 open items");
    await shotBoth(page, "admin-scope", scope);
    await scope.getByRole("button", { name: "Save scope" }).click();
    await expect.poll(() => scope.textContent()).toContain("Now: Area Portal\\Finance and sub-areas.");
    await page.evaluate(() => (location.hash = "#/ahead"));
    await row(page, "Finance close automation").waitFor({ timeout: 30_000 });
    // Priya's story under my feature is in Web, so out; my own items stay wherever they are.
    await expect(row(page, "Export button on the order page").count()).resolves.toBe(0);
    await expect(row(page, "Supplier onboarding").count()).resolves.toBe(1);
    await expect(page.locator(".ah-scope-note").count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
  const call = async (page: Page, hash: string) => {
    await page.evaluate((x) => (location.hash = x), hash);
    await page.locator(".ah-fix-mode, .ah-fix-empty").first().waitFor({ timeout: 30_000 });
    return page.locator(".ah-fix-mode, .ah-fix-empty").first();
  };

  /** A new person each time (the demo seeds three pending changes per session). */
  const sameSessionFresh = () => open("#/ahead");

  it("Gantt: bars grouped client › epic › feature, a dashed edge where a date is missing, an item with no dates on its own row, one callout marker per bar", async () => {
    const { page, errors } = await open("#/ahead/gantt");
    await bar(page, "Store locator").waitFor({ timeout: 30_000 });
    // Store locator: a pending start (solid), its target from DevOps.
    await expect(bar(page, "Store locator").locator(".pa-bar").getAttribute("class")).resolves.toContain(" changed");
    // Loyalty points has a target and no start: a dashed start edge.
    await expect(bar(page, "Loyalty points").locator(".pa-bar").getAttribute("class")).resolves.toContain("dash-start");
    await expect(bar(page, "Loyalty points").locator(".pa-diamond").count()).resolves.toBe(1);
    // AH-6: Supplier onboarding has no dates: its own row, no bar, Set dates in its marker's popover.
    await expect(bar(page, "Supplier onboarding").count()).resolves.toBe(1);
    await expect(bar(page, "Supplier onboarding").locator(".pa-bar").count()).resolves.toBe(0);
    await bar(page, "Supplier onboarding").locator(".pa-marker").focus();
    await page.locator(".pa-pop").getByRole("button", { name: "Set dates" }).waitFor({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator(".pa-marker").count()).resolves.toBeGreaterThan(0);
    // Stories are folded away at the default level (Features).
    await expect(page.getByRole("link", { name: "Export orders to CSV", exact: true }).count()).resolves.toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the drag bug: with a slow reload, a second drag right after a drop keeps its row under the pointer; drops snap to half-days", async () => {
    const { page } = await open("#/ahead/gantt");
    const target = bar(page, "Knowledge base search");
    await target.waitFor({ timeout: 30_000 });
    // Every reload and stage answers 1.2 s late, as on a slow link.
    await page.route("**/api/**", async (route) => {
      const body = route.request().postData() ?? "";
      if (/ahead\.(stage|load)|roadmap\.(load|ahead)/.test(body)) await new Promise((ok) => setTimeout(ok, 1200));
      await route.continue();
    });
    const drag = async (dx: number, check?: () => Promise<void>) => {
      const b = (await target.locator(".pa-bar").boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 4 });
      await check?.();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 4 });
      await page.mouse.up();
    };
    await drag(90, async () => {
      // The dates show live while dragging, in half-days.
      await expect(page.locator(".ah-live").textContent()).resolves.toMatch(/^\w{3}, \w{3} \d+ (AM|PM) → \w{3}, \w{3} \d+ (AM|PM)$/);
      await shotBoth(page, "ahead-gantt-drag", target);
    });
    // Right away a second drag: the reload of the first lands mid-drag and must not move the row.
    const y0 = (await target.boundingBox())!.y;
    const b = (await target.locator(".pa-bar").boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(b.x + b.width / 2 + i * 6, b.y + b.height / 2);
      await page.waitForTimeout(200);
      expect(Math.abs((await target.boundingBox())!.y - y0)).toBeLessThan(2);
    }
    await page.mouse.up();
    await expect.poll(() => page.locator(".ah-pending").textContent(), { timeout: 15_000 }).toMatch(/[45] changes to save/);
    await page.unroute("**/api/**");
    await page.close();
  }, T);

  it("a click on a bar opens Break down's side panel, whose action list has Send to… (SW-1's dialog)", async () => {
    const { page } = await open("#/ahead/gantt");
    const b = bar(page, "Supplier onboarding").or(bar(page, "Order history export")).first();
    await b.waitFor({ timeout: 30_000 });
    await b.locator(".pa-bar").click();
    const panel = page.locator(".bd-panel");
    await panel.waitFor({ timeout: 10_000 });
    await shotBoth(page, "ahead-panel-send", panel);
    await panel.locator(".bd-item-acts button", { hasText: "Send to…" }).click();
    const dlg = page.getByRole("dialog", { name: /^Send to… / });
    await dlg.waitFor({ timeout: 10_000 });
    await page.mouse.click(4, 4);
    await dlg.waitFor({ state: "hidden" });
    await page.close();
  }, T);

  it("AH-3: Fix next ranked by each client's backlog, grouped client › epic › feature, one row per item with its gaps and one action; Size goes into the change set; a project with no backlog order says so; an admin turns a gap off", async () => {
    const { page, errors } = await open("#/ahead/fix");
    const sections = page.locator(".ah-fx-client");
    await sections.first().waitFor();
    // The count is in the mode switch and the header, the same number.
    const head = await page.locator(".follow-ups-head h2").textContent();
    const n = Number(/(\d+) things? to fix/.exec(head ?? "")?.[1]);
    expect(n).toBeGreaterThan(0);
    await expect(page.getByRole("navigation", { name: "Ahead modes" }).getByRole("button", { name: /Readiness/ }).textContent()).resolves.toBe(`Readiness · ${n}`);
    // One row per item (AH-1 listed an item once per gap).
    const ids = await page.locator(".ah-fx-row:not(.ctx) .ah-id").allTextContents();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(n);
    // Grouped: a story sits under its feature, shown as a header when the feature itself has nothing to fix.
    const nw = sections.filter({ has: page.getByRole("heading", { name: /Northwind Foods/ }) });
    const depths = await nw.locator(".ah-fx-row").evaluateAll((els) => els.map((e) => Number((e as HTMLElement).style.getPropertyValue("--ah-depth"))));
    expect(depths[0]).toBe(0);
    expect(Math.max(...depths)).toBeGreaterThan(0);
    // Harbor Health's demo project has no backlog order field.
    const harbor = sections.filter({ has: page.getByRole("heading", { name: /Harbor Health/ }) });
    await expect(harbor.locator(".ah-fx-note").textContent()).resolves.toContain("has no backlog order, so these are ranked by target date.");
    await expect(nw.locator(".ah-fx-note").count()).resolves.toBe(0);
    await shotBoth(page, "ahead-fix-next", sections.first());
    // Size one: it goes into the change set and leaves the list.
    const title = await nw.locator(".ah-fx-row", { has: page.getByRole("button", { name: "Size", exact: true }) }).first().locator(".ah-title a").textContent();
    const sizeRow = nw.locator(".ah-fx-row", { has: page.getByRole("link", { name: title ?? "", exact: true }) });
    await sizeRow.getByRole("button", { name: "Size", exact: true }).click();
    await page.locator(".cell-pop").getByRole("textbox").first().fill("2");
    await page.locator(".cell-pop").getByRole("button", { name: "Save" }).click();
    await expect.poll(() => page.locator(".ah-pending").textContent()).toContain("4 changes to save");
    await expect.poll(() => page.locator(".ah-fx-row:not(.ctx)", { hasText: title ?? "" }).count()).toBe(0);
    // Skip puts one aside for the session.
    const before = await page.locator(".ah-fx-row:not(.ctx)").count();
    await page.locator(".ah-fx-row:not(.ctx)").first().getByRole("button", { name: /^Skip/ }).click();
    await expect.poll(() => page.locator(".ah-fx-row:not(.ctx)").count()).toBe(before - 1);
    // An admin turns Needs stories off for Northwind: its rows lose it; Atlas's keep it.
    const unsized = () => nw.locator(".ah-chip", { hasText: "Needs stories" }).count();
    expect(await unsized()).toBeGreaterThan(0);
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    const card = page.locator(".adm-client", { has: page.getByRole("heading", { name: "Northwind" }) });
    const sw = card.getByRole("switch", { name: "Northwind: count Needs stories" });
    await sw.waitFor({ timeout: 30_000 });
    await sw.uncheck();
    await expect.poll(() => card.locator(".adm-fixgaps").textContent()).toMatch(/Saved/);
    await page.evaluate(() => (location.hash = "#/ahead/fix"));
    await nw.waitFor({ timeout: 30_000 });
    await expect.poll(unsized).toBe(0);
    await expect(sections.filter({ has: page.getByRole("heading", { name: /Atlas Freight/ }) }).locator(".ah-chip", { hasText: "Needs stories" }).count()).resolves.toBeGreaterThan(0);
    // Back on, for the tests after this one.
    await page.evaluate(() => (location.hash = "#/settings/admin-clients"));
    await sw.waitFor({ timeout: 30_000 });
    await sw.check();
    await expect.poll(() => card.locator(".adm-fixgaps").textContent()).toMatch(/Saved/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("AH-3: the Grid at every window size: Item never under its minimum, no page scroll; Dates under 1400, dots under 1200, cards under 900 and on the phone", async () => {
    const sizes = [[1920, "wide"], [1600, "wide"], [1366, "dates"], [1200, "dates"], [1199, "dots"], [900, "dots"], [899, "cards"], [390, "cards"]] as const;
    for (const [w, lay] of sizes) {
      const { page, errors } = await open("#/ahead", { width: w, height: w < 500 ? 844 : 900 });
      // As on an iPhone: a 17px root font (the app's own sizes don't follow it, but the page must still fit).
      if (w < 500) await page.evaluate(() => (document.documentElement.style.fontSize = "17px"));
      await page.locator(".ah-row").first().waitFor();
      for (const size of ["default", "larger"] as const) {
        if (size === "larger") await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
        await page.waitForTimeout(150);
        const m = await page.evaluate(() => ({
          lay: document.querySelector(".ah-grid-box")?.className ?? "",
          item: Math.min(...[...document.querySelectorAll(".ah-cell.ah-col-item")].map((e) => e.getBoundingClientRect().width)),
          scroll: document.documentElement.scrollWidth - window.innerWidth,
          heads: [...(document.querySelector(".ah-grid")?.querySelectorAll("thead th") ?? [])].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent),
        }));
        expect(m.scroll, `${w} ${size}: no page scroll`).toBeLessThanOrEqual(1);
        if (size === "default") {
          expect(m.lay, `${w}`).toContain(`lay-${lay}`);
          expect(m.item, `${w}: the Item column`).toBeGreaterThanOrEqual(lay === "cards" ? 300 : 320);
        } else expect(m.item, `${w} larger: the Item column`).toBeGreaterThanOrEqual(lay === "cards" || m.lay.includes("cards") ? 300 : 320);
        if (size === "default" && lay === "wide") expect(m.heads).toEqual(["Item", "State", "Start", "Target", "Assigned to", "Size", "Readiness"]);
        if (size === "default" && (lay === "dates" || lay === "dots")) expect(m.heads).toEqual(["Item", "State", "Dates", "Assigned to", "Size", "Readiness"]);
        if (size === "default" && lay === "cards") expect(m.heads).toEqual([]);
      }
      // The merged Dates column reads "Oct 19 → Nov 13"; dots carry their words for screen readers.
      if (lay === "dates") await expect(row(page, "Order history export").locator(".ah-col-dates").textContent()).resolves.toMatch(/Oct 19\s*→\s*Nov 13/);
      if (lay === "dots") await expect(row(page, "Supplier onboarding").locator(".ah-col-ready .sr-only").textContent()).resolves.toContain("Needs stories");
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 240_000);

  it("a notice's link opens the item in the Grid, focused", async () => {
    const { page } = await open("#/ahead/item/1113");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tr")?.className ?? "")).toContain("highlighted");
    await page.close();
  }, T);

  it("phone and 1366: read only on a phone (D476); the pane folds under at 1366", async () => {
    const { page, errors } = await open("#/ahead", { width: 390, height: 844 });
    await expect(page.locator(".ah-ro-note").textContent()).resolves.toContain("Read only on a phone");
    await expect(page.getByRole("button", { name: "Review" }).isDisabled()).resolves.toBe(true);
    await expect(page.locator(".ah-pane").count()).resolves.toBe(0);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ahead-phone.png`, fullPage: false });
    await page.close();
    const wide = await open("#/ahead/gantt", { width: 1366, height: 768 });
    await wide.page.locator(".pa-item").first().waitFor({ timeout: 30_000 });
    if (SHOTS) await wide.page.screenshot({ path: `${SHOTS}/ahead-gantt-1366.png` });
    await wide.page.close();
    expect(errors).toEqual([]);
  }, T);
});
