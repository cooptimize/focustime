// UI-B: the "now" line on today (plan/nowline.ts says where): a thin accent line with a dot and the time at its left end,
// on a block's hour rail (with the past part of the rail dimmed), at the edge before or after the day, thinner on a PTO
// or catch-up day, and as a row in an agenda. It moves with the app's clock; reduced motion means it jumps, no slide.
// Clicking the time scrolls today into view (narrow windows and the phone). HK-3: on a compact rail the time moves off
// an hour mark's label (just above or below it, or to the rail's right end); the line stays where it is.
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { pillSpot, type Box, type PillSpot } from "../plan/nowline.ts";

const pct = (f: number) => `${(Math.min(1, Math.max(0, f)) * 100).toFixed(3)}%`;

/** Brings today's column into view and hands the click on (the Board selects today). */
function toToday(e: ReactMouseEvent, then?: () => void) {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).closest(".day, .today-view, .pd2")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  then?.();
}

function Time({ label, onClick, spot, line, inset = 0 }: { label: string; onClick?: (() => void) | undefined; spot?: PillSpot | null; line?: number | undefined; inset?: number }) {
  // `inset`: how far the pill sits below its button's top (the button is a little taller than the pill).
  const style: CSSProperties | undefined =
    !spot || spot.spot === "center" ? undefined : spot.spot === "end" ? { left: "auto", right: 2 } : { top: spot.top - (line ?? 0) - inset, transform: "none" };
  return (
    <button type="button" className={`nl-time${spot && spot.spot !== "center" ? ` nl-${spot.spot}` : ""}`} style={style} onClick={(e) => toToday(e, onClick)} title={`Now, ${label}`} aria-label={`Now, ${label}. Show today`}>
      <span className="nl-pill">{label}</span>
    </button>
  );
}

const rel = (r: DOMRect, to: DOMRect): Box => ({ top: r.top - to.top, bottom: r.bottom - to.top, left: r.left - to.left, right: r.right - to.left });

/**
 * HK-3: where the time goes on a compact rail, measured: the rail, its hour labels (`labels`, a selector inside it) and
 * the pill, again when any of them changes size (the window, Text size) or the line moves.
 */
function usePillSpot(avoid: string | undefined, at: number, label: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ spot: PillSpot; line: number; inset: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const rail = el?.parentElement;
    const pill = el?.querySelector(".nl-pill");
    if (!avoid || !el || !rail || !pill) return setSpot(null);
    const place = () => {
      const r = rail.getBoundingClientRect();
      const p = pill.getBoundingClientRect();
      // The line's middle, and where its children are placed from (below its top border).
      const top = el.getBoundingClientRect().top - r.top;
      const line = top + el.clientTop / 2;
      const origin = top + el.clientTop;
      const labels = [...rail.querySelectorAll(avoid)].map((l) => rel(l.getBoundingClientRect(), r));
      // The pill's left on the line (its button sits at the line's left plus its own offset).
      const btn = el.querySelector(".nl-time")!;
      const left = parseFloat(getComputedStyle(btn).left) || 0;
      const inset = p.top - btn.getBoundingClientRect().top;
      const next = pillSpot({ line, pill: { width: p.width, height: p.height }, left, rail: { width: r.width, height: r.height }, labels });
      setSpot((s) => (s && s.spot.spot === next.spot && Math.abs(s.spot.top - next.top) < 0.5 && Math.abs(s.line - origin) < 0.5 && Math.abs(s.inset - inset) < 0.5 ? s : { spot: next, line: origin, inset }));
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(rail);
    ro?.observe(pill);
    return () => ro?.disconnect();
  }, [avoid, at, label]);
  return { ref, spot };
}

/** On a rail or a whole-day cell, at a fraction of its height. `avoid` names the rail's hour labels to keep clear of. */
export function NowLine({ at, label, thin = false, onClick, avoid }: { at: number; label: string; thin?: boolean; onClick?: () => void; avoid?: string }) {
  const { ref, spot } = usePillSpot(avoid, at, label);
  return (
    <div ref={ref} className={`now-line${thin ? " thin" : ""}`} style={{ top: pct(at) } as CSSProperties} role="presentation" data-pill={spot?.spot.spot}>
      <span className="nl-dot" aria-hidden="true" />
      <Time label={label} onClick={onClick} spot={spot?.spot ?? null} line={spot?.line} inset={spot?.inset ?? 0} />
    </div>
  );
}

/** The past part of a rail on today, dimmed (1 for a block that has ended). */
export function NowPast({ at }: { at: number }) {
  return at > 0 ? <div className="now-past" style={{ height: pct(at) }} aria-hidden="true" /> : null;
}

/** Before or after the day's blocks (or on the phone, at the top of the block under way): a line in its own row. */
export function NowEdge({ label, thin = false, onClick }: { label: string; thin?: boolean; onClick?: () => void }) {
  return (
    <div className={`now-line now-edge${thin ? " thin" : ""}`}>
      <span className="nl-dot" aria-hidden="true" />
      <Time label={label} onClick={onClick} />
    </div>
  );
}

/** A row in a time-ordered agenda list. */
export function NowRow({ label }: { label: string }) {
  return (
    <li className="now-line now-row" aria-label={`Now, ${label}`}>
      <span className="nl-dot" aria-hidden="true" />
      <span className="nl-pill">{label}</span>
    </li>
  );
}

/**
 * WK-1: on the day strip (the strip and mini tiers), a short upright tick at a fraction of the block's hours with the
 * time beside it, kept inside the strip.
 */
export function NowTick({ at, label, onClick }: { at: number; label: string; onClick?: () => void }) {
  return (
    <div className="now-line now-tick" style={{ "--at": pct(at) } as CSSProperties} role="presentation">
      <span className="nt-mark" aria-hidden="true" />
      <Time label={label} onClick={onClick} />
    </div>
  );
}
