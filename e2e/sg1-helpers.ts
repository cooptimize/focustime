// SG-1: suggestions show only on empty blocks, so browser tests that look at them empty the demo's blocks first.
import type { Page } from "playwright-core";

/** One action through the page's own session (its CSRF cookie). */
export const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: Record<string, unknown> }>;

/** Every planned to-do from `from` on (or only on `only`'s blocks, "date:half") comes off, then the page reloads. */
export async function emptyFrom(page: Page, from: string, only?: readonly string[]) {
  const w = (await call(page, "week.load", {})).data as { plan?: Record<string, { picks: { id: number; status: string; half: string }[] }> };
  for (const [date, d] of Object.entries(w.plan ?? {}))
    if (date >= from) for (const p of d.picks) if (p.status === "planned" && (!only || only.includes(`${date}:${p.half}`))) await call(page, "pick.remove", { id: p.id });
  await page.reload();
  await page.waitForSelector(".topbar", { timeout: 60_000 });
}
