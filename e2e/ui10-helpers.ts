// UI-10: opening the three main text boxes (Quick capture, the Assistant's input, Close the loop's message) on the
// computer and the phone, and measuring a text box. Shared by the UI-10 test and its screenshots.
import type { Locator, Page } from "playwright-core";

export type Field = "capture" | "assistant" | "message";
export const FIELDS: Field[] = ["capture", "assistant", "message"];

const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(600);
};

/** Opens the field and returns its text box and the surface around it (for a screenshot). */
export async function openField(page: Page, field: Field, phone: boolean): Promise<{ box: Locator; surface: Locator }> {
  if (field === "capture") {
    if (phone) await page.locator(".bottom-bar").getByRole("button", { name: "Capture" }).click();
    else {
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("n");
    }
    const surface = page.locator(".cap-dialog");
    await surface.waitFor();
    return { box: surface.getByRole("textbox", { name: "Quick capture" }), surface };
  }
  if (field === "assistant") {
    if (phone) await page.locator(".bottom-bar").getByRole("button", { name: "Ask the assistant" }).click();
    else {
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("Control+j");
    }
    const surface = page.getByTestId("assistant-panel");
    await surface.waitFor();
    return { box: surface.getByRole("textbox", { name: "Ask the assistant" }), surface };
  }
  await go(page, "#/inbox/promises");
  await page.locator(".ib-row", { hasText: "Send Marcus the updated export spec" }).first().click();
  const pane = page.locator(phone ? ".ib-sheet.tall" : ".ib-pane");
  await pane.getByRole("button", { name: /^Close the loop/ }).first().click();
  const surface = pane.locator("form.send-loop");
  await surface.getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
  return { box: surface.locator(".close-loop-note textarea").first(), surface };
}

export type Measure = { height: number; width: number; overflowY: string; scrollH: number; clientH: number; scrollbar: number; resize: string; lineHeight: number; rows: number };

export const measure = (box: Locator): Promise<Measure> =>
  box.evaluate((el: HTMLTextAreaElement) => {
    const cs = getComputedStyle(el);
    const borderX = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return {
      height: el.offsetHeight,
      width: el.getBoundingClientRect().width,
      overflowY: cs.overflowY,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      scrollbar: Math.round(el.offsetWidth - el.clientWidth - borderX),
      resize: cs.resize,
      lineHeight: lh,
      rows: el.rows,
    };
  });

export const lines = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the note`).join("\n");

export async function setTheme(page: Page, theme: "light" | "dark", size: "normal" | "large"): Promise<void> {
  await page.evaluate(
    ([t, s]) => {
      document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark");
      if (s === "normal") document.documentElement.removeAttribute("data-text-size");
      else document.documentElement.setAttribute("data-text-size", s);
    },
    [theme, size] as const,
  );
  await page.waitForTimeout(150);
}
