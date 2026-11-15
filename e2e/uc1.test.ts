// UC-1 (browser, demo mode): the Inbox starts on the same left edge as Day at every width and text size, with a
// width limit and everything in it on that one edge; the client chips carry the tab's numbers; a Deployment saves
// with an empty box and gets its title from its client and date. Fictional data only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 300_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const go = async (page: Page, hash: string, wait: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.locator(wait).first().waitFor({ timeout: 30_000 });
};
/** The left edge of each match that is on screen, and the widest one. */
const edges = (page: Page, sel: string) =>
  page.evaluate((s) => [...document.querySelectorAll<HTMLElement>(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => ({ left: Math.round(r.left * 10) / 10, width: r.width, right: r.right })), sel);
const pickDate = async (page: Page, box: Locator, label: string, d: string) => {
  await box.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.locator(".dp-pop input.dp-box").fill(d);
  await page.locator(".dp-pop input.dp-box").press("Enter");
  await page.locator(".dp-pop").waitFor({ state: "detached" });
  // The picker hands focus back to its button a frame after it closes.
  await expect.poll(() => box.getByRole("button", { name: new RegExp(`^${label}:`) }).evaluate((b) => b === document.activeElement)).toBe(true);
};
const pickTime = async (page: Page, box: Locator, label: string, t: string) => {
  await box.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.locator(".tp-pop input").fill(t);
  await page.locator(".tp-pop input").press("Enter");
  await page.locator(".tp-pop").waitFor({ state: "detached" });
  // The picker hands focus back to its button a frame after it closes.
  await expect.poll(() => box.getByRole("button", { name: new RegExp(`^${label}:`) }).evaluate((b) => b === document.activeElement)).toBe(true);
};
const chooseClient = async (box: Locator, name: string) => {
  await box.locator(".cap-client").click();
  await box.locator(".cap-choose").getByRole("button", { name, exact: true }).click();
};
const kindChip = (box: Locator, kind: string) => box.locator(`.cap-box-kinds [data-kind="${kind}"]`);
const words = (box: Locator) => box.locator("textarea[aria-label='Quick capture']");
/** Every planned deployment on the demo's week (its weekend too), by walking what Week loads. */
type Dep = { id: number; title: string; date: string; clientKey: string };
const deployments = async (page: Page): Promise<Dep[]> => {
  const r = await call(page, "week.load", { weekend: true });
  const seen = new Map<number, Dep>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.todoKind === "deployment" && o.status === "planned" && typeof o.id === "number") seen.set(o.id, o as unknown as Dep);
    Object.values(o).forEach(walk);
  };
  walk(r.data);
  return [...seen.values()].sort((x, y) => x.id - y.id);
};

describe.skipIf(!CHROMIUM)("UC-1: the Inbox on the left, a deployment titles itself (browser, demo mode)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("the Inbox's heading, chips, capture box and lists share Day's left edge at every width and text size, and no row is wider than the limit", async () => {
    for (const size of ["default", "large", "larger"] as const) {
      for (const width of [1280, 1440, 1920]) {
        const { page, errors } = await freshPage(h, { width, height: 900 });
        expect((await call(page, "ui.set_text_size", { size })).ok).toBe(true);
        expect((await call(page, "ui.set_inbox", { clients: [] })).ok).toBe(true);
        await page.reload();
        const where = `${width} wide, ${size}`;
        await go(page, "#/day", "main.today-view .today-head");
        const day = (await edges(page, "main.today-view .today-head"))[0]!.left;
        const scale = Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-scale"))) || 1;
        const limit = 920 * scale;
        for (const list of ["chats", "promises", "captures"]) {
          await go(page, `#/inbox/${list}`, "main.ib4 .ib4-title");
          await page.locator(list === "captures" ? ".ib4-capture .cap-input" : ".ib4-row").first().waitFor({ timeout: 30_000 });
          const parts = [".ib4-title", ".ib4-chips", ".ib4-chips .ib4-chip:first-child", ".ib4-list", ".ib4-group-head", ".ib4-row", ".ib4-section", ".ib4-capture", ".ib4-capture .cap-input", ".ib4-capture .cap-box-kinds", ".ib4-foot", ".ib4-keys", ".ib4-empty"];
          for (const sel of parts) for (const e of await edges(page, sel)) expect(e.left, `${where}, ${list}: ${sel} starts at ${e.left}, Day at ${day}`).toBe(day);
          // The switch sits on the heading's line, right after it: the head starts on the edge.
          expect((await edges(page, ".ib4-head"))[0]!.left, `${where}, ${list}: the heading's line`).toBe(day);
          for (const sel of [".ib4-row", ".ib4-capture", ".ib4-chips", ".ib4-foot"]) for (const e of await edges(page, sel)) {
            expect(e.width, `${where}, ${list}: ${sel} is ${e.width} wide, the limit is ${limit}`).toBeLessThanOrEqual(limit + 0.5);
            expect(e.right, `${where}, ${list}: ${sel} runs off the window`).toBeLessThanOrEqual(width);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}, ${list}: no sideways scroll`).toBe(true);
        }
        // A row opened keeps the edge and the limit.
        await go(page, "#/inbox/chats", ".ib4-row");
        await page.locator(".ib4-row-head").first().click();
        await page.locator(".ib4-row.open").waitFor();
        const open = (await edges(page, ".ib4-row.open"))[0]!;
        expect(open.left, `${where}: the open row`).toBe(day);
        expect(open.width, `${where}: the open row`).toBeLessThanOrEqual(limit + 0.5);
        expect(errors).toEqual([]);
        await page.close();
      }
    }
    const { page } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_text_size", { size: "default" });
    await page.close();
  }, 900_000);

  it("the chips' numbers add up to the tab's number, for one client chosen and for several; a chip with nothing shows none", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await call(page, "ui.set_inbox", { clients: [] });
    await page.reload();
    await go(page, "#/inbox/chats", ".ib4-chips .ib4-chip");
    const tab = Number(await page.locator("[aria-label$='need you'], [aria-label$='needs you']").first().textContent());
    expect(tab).toBeGreaterThan(1);
    const read = () =>
      page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".ib4-chips .ib4-chip")].map((c) => ({ name: c.getAttribute("aria-label") ?? "", n: c.querySelector(".ib4-count")?.textContent ?? null })));
    const check = async (when: string) => {
      const chips = await read();
      const [all, ...rest] = chips;
      expect(all!.n, `${when}: All clients shows the tab's number`).toBe(String(tab));
      expect(all!.name).toBe(`All clients, ${tab} need you`);
      expect(rest.reduce((a, c) => a + Number(c.n ?? 0), 0), `${when}: the chips add up to the tab's number`).toBe(tab);
      expect(rest.filter((c) => c.n !== null).length).toBeGreaterThan(1);
      const none = rest.filter((c) => c.n === null);
      expect(none.length, `${when}: a client with nothing has no number`).toBeGreaterThan(0);
      for (const c of none) expect(c.name).not.toMatch(/need/);
      for (const c of rest.filter((x) => x.n !== null)) expect(c.name).toMatch(new RegExp(`, ${c.n} needs? you$`));
      return rest;
    };
    const rest = await check("All clients");
    const withSome = rest.filter((c) => c.n !== null);
    await page.locator(".ib4-chips .ib4-chip", { hasText: withSome[0]!.name.split(",")[0]! }).click();
    await check("one client chosen");
    await page.locator(".ib4-chips .ib4-chip", { hasText: withSome[1]!.name.split(",")[0]! }).click();
    await check("two clients chosen");
    await page.locator(".ib4-chips .ib4-chip").first().click();
    // An empty list's line starts on the edge too (it sat centered).
    const none = rest.find((c) => c.n === null)!;
    await page.locator(".ib4-chips .ib4-chip", { hasText: none.name }).click();
    await page.locator(".ib4-empty").waitFor();
    expect((await edges(page, ".ib4-empty"))[0]!.left).toBe((await edges(page, ".ib4-title"))[0]!.left);
    expect(await page.locator(".ib4-empty").evaluate((el) => getComputedStyle(el).textAlign)).toMatch(/left|start/);
    await page.locator(".ib4-chips .ib4-chip").first().click();
    expect(errors).toEqual([]);
    await page.close();
    // The phone's chips are as they were: names only.
    const phone = await freshPage(h, { width: 390, height: 844 });
    await go(phone.page, "#/inbox/chats", ".ib4-chips .ib4-chip");
    expect(await phone.page.locator(".ib4-chips .ib4-count").count()).toBe(0);
    expect(await phone.page.locator(".ib4-chips .ib4-chip").first().getAttribute("aria-label")).toBe("All clients");
    expect(await phone.page.locator("main.ib4").evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("16px");
    await phone.page.close();
  }, T);

  it("Quick capture: a Deployment saves with an empty box and titles itself; the hint follows the client and the date; typed text is the title; the other kinds still need text", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/week", "main.grid");
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    const box = page.locator(".cap-dialog .cap-box");
    const captures = async () => ((await call(page, "capture.load", {})).data.inbox as unknown[]).length;
    const before = await captures();
    // The other kinds refuse an empty box: nothing to press, and Enter saves nothing.
    for (const kind of ["later", "follow_up", "draft", "draft_feature"]) {
      await kindChip(box, kind).click();
      expect(await box.locator(".cap-send").isDisabled(), `${kind}: Save with an empty box`).toBe(true);
      await words(box).press("Enter");
      await words(box).press("Control+Enter");
    }
    await page.waitForTimeout(400);
    expect(await box.locator(".cap-toast").count()).toBe(0);
    expect(await captures()).toBe(before);
    // Deployment with no client: its details show, and it is blocked as before.
    await kindChip(box, "deployment").click();
    await box.getByRole("group", { name: "Deployment details" }).waitFor();
    if ((await box.locator(".cap-client").textContent())?.trim() !== "No client") {
      await box.locator(".cap-client").click();
      await box.locator(".cap-choose").getByRole("button", { name: "No client", exact: true }).click();
    }
    expect(await box.locator(".cap-send").isDisabled()).toBe(true);
    expect(await words(box).getAttribute("placeholder")).toBe("Capture anything…");
    await words(box).press("Enter");
    await expect.poll(() => box.innerText()).toContain("A deployment needs a client");
    // The hint is the title it will get, and follows the client and the date.
    await chooseClient(box, "Northwind");
    await expect.poll(() => words(box).getAttribute("placeholder")).toBe("Deployment - Northwind - Sat, Nov 7");
    const hint = async () => page.evaluate((id) => document.getElementById(id ?? "")?.textContent ?? "", await words(box).getAttribute("aria-describedby"));
    expect(await hint()).toContain('Enter saves it as "Deployment - Northwind - Sat, Nov 7"');
    await chooseClient(box, "Harbor");
    await expect.poll(() => words(box).getAttribute("placeholder")).toBe("Deployment - Harbor - Sat, Nov 7");
    await pickDate(page, box, "Deployment date", "2026-11-06");
    await expect.poll(() => words(box).getAttribute("placeholder")).toBe("Deployment - Harbor - Fri, Nov 6");
    expect(await hint()).toContain('"Deployment - Harbor - Fri, Nov 6"');
    // A bad window still blocks it.
    await pickTime(page, box, "Ends at", "18:00");
    await words(box).press("Enter");
    await expect.poll(() => box.innerText()).toMatch(/end must be after/i);
    expect((await deployments(page)).length).toBe(0);
    await pickTime(page, box, "Ends at", "21:00");
    // Enter in the empty box saves it.
    await words(box).focus();
    await words(box).press("Enter");
    await box.locator(".cap-toast", { hasText: "Saved to Harbor as a deployment · Fri, Nov 6" }).waitFor();
    await expect.poll(async () => (await deployments(page)).map((d) => d.title)).toEqual(["Deployment - Harbor - Fri, Nov 6"]);
    // Undo takes it off again and leaves the box empty.
    await box.locator(".cap-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await deployments(page)).length).toBe(0);
    expect(await words(box).inputValue()).toBe("");
    // The save button, with the box empty.
    await kindChip(box, "deployment").click();
    await box.locator(".cap-send").click();
    await box.locator(".cap-toast", { hasText: "as a deployment" }).waitFor();
    // The keyboard path from the details: down into them, Enter in the Note.
    await kindChip(box, "deployment").click();
    await words(box).press("ArrowDown");
    await box.getByRole("textbox", { name: "Note" }).focus();
    await box.getByRole("textbox", { name: "Note" }).press("Enter");
    await expect.poll(async () => (await deployments(page)).length).toBe(2);
    // Typed text is the title.
    await kindChip(box, "deployment").click();
    await words(box).fill("Release 4.2 to production");
    await words(box).press("Enter");
    await expect.poll(async () => (await deployments(page)).map((d) => d.title).sort()).toEqual(["Deployment - Harbor - Fri, Nov 6", "Deployment - Harbor - Fri, Nov 6", "Release 4.2 to production"]);
    // Moving one with a made title changes the title's date; the typed one keeps its words.
    const all = await deployments(page);
    const made = all.find((d) => d.title.startsWith("Deployment - "))!;
    const typed = all.find((d) => d.title === "Release 4.2 to production")!;
    expect((await call(page, "pick.move", { id: made.id, date: "2026-11-08", half: "AM" })).data.pick.title).toBe("Deployment - Harbor - Sun, Nov 8");
    expect((await call(page, "pick.move", { id: typed.id, date: "2026-11-08", half: "AM" })).data.pick.title).toBe("Release 4.2 to production");
    // Week shows the same title.
    await page.keyboard.press("Escape");
    await page.reload();
    await go(page, "#/week", "main.grid");
    await page.locator("main.grid .pick-row, main.grid .pr-title", { hasText: "Deployment - Harbor - Sun, Nov 8" }).first().waitFor({ timeout: 30_000 });
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("the Inbox's capture box does the same", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    await go(page, "#/inbox/captures", ".ib4-capture .cap-input");
    const box = page.locator(".ib4-capture .cap-box");
    const n = (await deployments(page)).length;
    // From the keyboard, the box empty: the kinds are one Tab stop, the arrows move between them, Enter returns to the box.
    await chooseClient(box, "Atlas");
    await box.locator('.cap-box-kinds [role="radio"][aria-checked="true"]').focus();
    for (const k of ["follow_up", "draft", "draft_feature", "deployment"]) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-kind"))).toBe(k);
    }
    expect(await box.locator(".cap-box-kinds [role=radio][tabindex='0']").count()).toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => words(box).evaluate((el) => el === document.activeElement)).toBe(true);
    await expect.poll(() => words(box).getAttribute("placeholder")).toBe("Deployment - Atlas - Sat, Nov 7");
    await words(box).press("Enter");
    await box.locator(".cap-toast", { hasText: "Saved to Atlas as a deployment" }).waitFor();
    await expect.poll(async () => (await deployments(page)).filter((d) => d.title === "Deployment - Atlas - Sat, Nov 7").length).toBe(1);
    expect((await deployments(page)).length).toBe(n + 1);
    // A kind that needs text still does here.
    await kindChip(box, "draft").click();
    expect(await box.locator(".cap-send").isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
