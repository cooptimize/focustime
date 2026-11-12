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

/**
 * PS-2: lines of text shown in part. Every line of text in `scope` (a text node's client rects, one per line) is cut by
 * the elements around it that clip (overflow hidden or clip, or a line clamp; each at its padding edge, inside the
 * border). What shows of a line is the part inside all of them; it must be all of the line or none of it: never a
 * sliver of the next line under a title. Scroll containers are left out (a line at a scroll edge is a scroll, not a
 * cut). A line counts as cut when at least 1px of it shows and more than a fifth of it (3px at least) is hidden, so a
 * glyph's box reaching a pixel or two past a tight line height isn't one. Text that isn't drawn (no box, visibility
 * hidden, opacity 0 hover controls, screen reader only text, inside an inert part) is skipped.
 */
export function clippedLines(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    const drawn = new Map<Element, boolean>();
    const isDrawn = (el: Element): boolean => {
      const known = drawn.get(el);
      if (known !== undefined) return known;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      const self = cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0 && !(b.width < 2 && b.height < 2 && cs.position === "absolute");
      const v = self && !el.matches("[inert], [aria-hidden='true']") && (!el.parentElement || isDrawn(el.parentElement));
      drawn.set(el, v);
      return v;
    };
    const clips = new Map<Element, { top: number; bottom: number } | null>();
    const clipOf = (el: Element) => {
      if (clips.has(el)) return clips.get(el)!;
      const cs = getComputedStyle(el);
      const hides = (v: string) => v === "hidden" || v === "clip";
      const clamp = cs.getPropertyValue("-webkit-line-clamp");
      const scrolls = cs.overflowY === "auto" || cs.overflowY === "scroll";
      let c: { top: number; bottom: number } | null = null;
      if (!scrolls && (hides(cs.overflowY) || (clamp && clamp !== "none" && hides(cs.overflowX)))) {
        const b = el.getBoundingClientRect();
        c = { top: b.top + parseFloat(cs.borderTopWidth), bottom: b.bottom - parseFloat(cs.borderBottomWidth) };
      }
      clips.set(el, c);
      return c;
    };
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 3).join(".")}`;
    const seen = new Set<Node>();
    for (const root of document.querySelectorAll(scope)) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (seen.has(n)) continue;
        seen.add(n);
        const parent = n.parentElement;
        if (!n.textContent?.trim() || !parent || !isDrawn(parent)) continue;
        // The clipping elements around this text, innermost first.
        const around: { el: Element; top: number; bottom: number }[] = [];
        for (let e: Element | null = parent; e && e !== document.body && !e.matches(".app"); e = e.parentElement) {
          const c = clipOf(e);
          if (c) around.push({ el: e, ...c });
        }
        if (!around.length) continue;
        const top = Math.max(...around.map((c) => c.top));
        const bottom = Math.min(...around.map((c) => c.bottom));
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.height < 4 || r.width < 1) continue;
          const visible = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top));
          const hidden = r.height - visible;
          if (visible >= 1 && hidden > Math.max(3, r.height / 5)) {
            const by = around.find((c) => r.top < c.top || r.bottom > c.bottom)?.el ?? around[0]!.el;
            out.push(`${name(by)}: "${n.textContent.trim().slice(0, 40)}" ${Math.round(visible)}px of ${Math.round(r.height)}px shown`);
          }
        }
      }
    }
    return [...new Set(out)];
  }, scope);
}

/**
 * PS-2: title links whose focus ring is cut. Each title link in `scope` is focused from the keyboard's side (focus()
 * with focus-visible) and its outline's box (the border box grown by outline-offset and outline-width) must fit inside
 * every element around it that clips. Links scrolled out of view are skipped.
 */
export async function cutFocusRings(page: Page, scope: string, links = "a[data-card], .aw-row-title > a, .pf-title-link, .draft-title"): Promise<string[]> {
  return page.evaluate(
    ([scope, links]) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(`:is(${scope}) :is(${links})`)) {
        const b0 = el.getBoundingClientRect();
        if (!b0.width || !b0.height || b0.top < 0 || b0.bottom > innerHeight) continue;
        el.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
        if (document.activeElement !== el) continue;
        const cs = getComputedStyle(el);
        if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) === 0) {
          el.blur();
          continue;
        }
        const grow = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
        const b = el.getBoundingClientRect();
        const ring = { top: b.top - grow, bottom: b.bottom + grow, left: b.left - grow, right: b.right + grow };
        // The page's frame (.app) cuts only at the window's edge, a scroll: not counted.
        for (let e = el.parentElement; e && e !== document.body && !e.matches(".app"); e = e.parentElement) {
          const ps = getComputedStyle(e);
          const hides = (v: string) => v === "hidden" || v === "clip";
          if (!hides(ps.overflowX) && !hides(ps.overflowY)) continue;
          const p = e.getBoundingClientRect();
          const inner = { top: p.top + parseFloat(ps.borderTopWidth), bottom: p.bottom - parseFloat(ps.borderBottomWidth), left: p.left + parseFloat(ps.borderLeftWidth), right: p.right - parseFloat(ps.borderRightWidth) };
          const cutY = hides(ps.overflowY) && (ring.top < inner.top - 0.5 || ring.bottom > inner.bottom + 0.5);
          const cutX = hides(ps.overflowX) && (ring.left < inner.left - 0.5 || ring.right > inner.right + 0.5);
          if (cutY || cutX) {
            out.push(`"${(el.textContent ?? "").trim().slice(0, 40)}" cut by ${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).slice(0, 3).join(".")}`);
            break;
          }
        }
        el.blur();
      }
      return [...new Set(out)];
    },
    [scope, links] as const,
  );
}
