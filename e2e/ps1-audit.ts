// PS-1: the measurements the browser checks share (e2e/ps1.test.ts): every clickable thing on Day, Week and the panel
// at least the minimum target, chips clear of ⋯, nothing under the phone's capture button, and the card's first lines.
import type { Page } from "playwright-core";

export type Small = { what: string; w: number; h: number };

/**
 * Clickable things in view that are smaller than `min` (28 on a computer, 44 on the phone). A checkbox or radio inside
 * a label counts as its label's box (the label is the target). Hidden ones (no box, visibility hidden, inside a closed
 * menu) are skipped.
 */
export function smallTargets(page: Page, scope: string, min: number): Promise<Small[]> {
  return page.evaluate(
    ([scope, min]) => {
      const out: { what: string; w: number; h: number }[] = [];
      const roots = [...document.querySelectorAll(scope)];
      const seen = new Set<Element>();
      for (const root of roots)
        for (const el of root.querySelectorAll<HTMLElement>('button, a[href], input[type="checkbox"], input[type="radio"], [role="button"], [role="switch"], select, summary')) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (el.closest("[inert], [aria-hidden='true']")) continue;
          // Drawn by time on a rail or timeline (their height is their length): exempt, docs/open-questions.md.
          if (el.closest(".now-line:not(.now-row), .tbox, .r-ev, .r-promise")) continue;
          const target = (el instanceof HTMLInputElement && el.closest("label")) || el;
          const b = target.getBoundingClientRect();
          // A pseudo-element that widens the hit area (an absolutely placed ::after with negative insets) counts.
          const after = getComputedStyle(target, "::after");
          const grow = (v: string) => (after.content !== "none" && after.position === "absolute" && v.endsWith("px") ? Math.max(0, -parseFloat(v)) : 0);
          const r = { width: b.width + grow(after.left) + grow(after.right), height: b.height + grow(after.top) + grow(after.bottom), top: b.top, bottom: b.bottom, left: b.left, right: b.right };
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0 && !el.matches(":focus")) {
            // Shown on hover or focus: measured as it is when shown (its box is the same).
          }
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          if (r.width + 0.5 < min || r.height + 0.5 < min) {
            const name = (el.getAttribute("aria-label") || el.textContent || el.className || el.tagName).toString().trim().slice(0, 50);
            out.push({ what: `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} "${name}"`, w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
      return out;
    },
    [scope, min] as const,
  );
}

/** Pairs of a status chip and its card's ⋯ that touch (or overlap). */
export function chipTouchesMore(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const head of document.querySelectorAll(".card-head")) {
      const more = head.querySelector(".card-more");
      if (!more) continue;
      const m = more.getBoundingClientRect();
      for (const chip of head.querySelectorAll(".status-pill, .late-chip, .now-mark")) {
        const c = chip.getBoundingClientRect();
        if (!c.width || !m.width) continue;
        const apart = c.right <= m.left - 1 || c.left >= m.right + 1 || c.bottom <= m.top - 1 || c.top >= m.bottom + 1;
        if (!apart) bad.push(`${(head.querySelector(".card-client")?.textContent ?? "").trim()}: ${(chip.textContent ?? "").trim()}`);
      }
    }
    return bad;
  });
}

/** Rows of cards (by their grid row) whose first lines (the client's name) don't share a top. */
export function headTops(page: Page, scope: string): Promise<number[][]> {
  return page.evaluate((scope) => {
    const rows = new Map<number, number[]>();
    for (const card of document.querySelectorAll(`${scope} .half.card:not(.whole)`)) {
      const head = card.querySelector(".card-client");
      if (!head) continue;
      const top = Math.round(card.getBoundingClientRect().top);
      const key = [...rows.keys()].find((k) => Math.abs(k - top) <= 2) ?? top;
      rows.set(key, [...(rows.get(key) ?? []), Math.round(head.getBoundingClientRect().top)]);
    }
    return [...rows.values()].filter((r) => r.length > 1);
  }, scope);
}

/** Clickable things under the phone's round capture button, with the page scrolled to its end. */
export function underCapture(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cap = document.querySelector(".bb-capture");
    if (!cap) return [];
    const c = cap.getBoundingClientRect();
    const hit: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("main button, main a[href], main input, main [role='button']")) {
      if (el.closest(".bottom-bar, .bb-capture")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom) hit.push((el.getAttribute("aria-label") || el.textContent || el.className).trim().slice(0, 40));
    }
    return hit;
  });
}
