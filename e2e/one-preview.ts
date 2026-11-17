// OP-1: the app's one DevOps preview (ui/DevOpsWrite.tsx) in browser tests. Every screen that writes to a client's
// DevOps opens it, one client's changes at a time ("Preview 2 of 3"), so the tests drive it the same way everywhere.
import type { Locator, Page } from "playwright-core";

/** The one preview's dialog: the modal with its Where line. */
export const onePreview = (page: Page): Locator => page.locator('[role="dialog"][data-overlay="modal"]').filter({ has: page.locator(".wd-where") });

export type Seen = { title: string; where: string; step: string | null; rows: number };

/**
 * Confirm `n` previews one after another (a series opens the next once one is confirmed), each with its own Confirm
 * button. Returns what each one showed: its title, its Where line, its "Preview i of n" and how many rows it had.
 */
export async function confirmPreviews(page: Page, n = 1, opts: { timeout?: number } = {}): Promise<Seen[]> {
  const timeout = opts.timeout ?? 30_000;
  const seen: Seen[] = [];
  for (let i = 0; i < n; i++) {
    const d = onePreview(page);
    await d.waitFor({ timeout });
    if (n > 1) await d.locator(".dw-step", { hasText: `Preview ${i + 1} of ${n}` }).waitFor({ timeout });
    seen.push({
      title: ((await d.locator(".cap-dialog-head h2").textContent()) ?? "").replace(/ · Preview \d+ of \d+$/, ""),
      where: (await d.locator(".wd-where dd").first().textContent()) ?? "",
      step: (await d.locator(".dw-step").textContent().catch(() => null))?.replace(/^ · /, "") ?? null,
      rows: await d.locator(".dw-row").count(),
    });
    await d.locator("button.commit").click();
    // The next of a series takes its place; the last one closes.
    if (i < n - 1) await onePreview(page).locator(".dw-step", { hasText: `Preview ${i + 2} of ${n}` }).waitFor({ timeout });
    else await onePreview(page).waitFor({ state: "detached", timeout });
  }
  return seen;
}
