// UI-5: a Show me tour over a real screen. It dims the page, rings one `data-tour` element at a time and explains it in
// a small card (Back, Next, Skip; → ← Esc). It only highlights and explains: the layer over the page takes every click,
// tap and key while it runs, so nothing on the screen can be clicked, typed into or changed through it, and the tour
// itself makes no request. Where the screen has nothing to point at, the card shows an example drawing instead; steps
// that don't apply (on a phone, or with no drawing) are left out. Reduced motion: the ring jumps, nothing slides.
// Loaded lazily (App.tsx), with its styles in ../guide.css.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CloseButton } from "../../CloseButton.tsx";
import { Lumen } from "../../brand/Brand.tsx";
import { useReducedMotion } from "../../brand/motion.ts";
import { TOUR_UI } from "../content.ts";
import type { Tour as TourData, TourStep } from "../tours.ts";
import { Illustration } from "./Illustrations.tsx";
import "../guide.css";

/** How a step shows on this screen: ringing its element, as an example drawing, or not at all. */
export type Shown = { step: TourStep; text: string } & ({ kind: "ring"; el: HTMLElement } | { kind: "example" });

const PAD = 6;
const GUTTER = 16;
/** How long the first step waits for the screen to load before it gives up on its element. */
const READY_MS = 6000;

const target = (id: string): HTMLElement | null => {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
};

/** The tour's steps as this screen can show them (pure on the DOM it's given; exported for the tests). */
export function resolveSteps(steps: readonly TourStep[], phone: boolean, find: (id: string) => HTMLElement | null = target): Shown[] {
  const out: Shown[] = [];
  for (const step of steps) {
    if (phone && step.phone === "skip") continue;
    const text = phone && step.phone && step.phone !== "skip" ? step.phone.text : step.text;
    const el = find(step.target);
    const empty = !!el && !!step.emptyWhen && !el.querySelector(step.emptyWhen);
    if (el && !empty) out.push({ step, text, kind: "ring", el });
    else if (step.example) out.push({ step, text, kind: "example" });
  }
  return out;
}

type Box = { top: number; left: number; width: number; height: number };
const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
};

/** Where the card goes: below the ring if it fits, else above, else beside, else over the bottom of the window. */
function place(ring: Box | null, card: { w: number; h: number }, vw: number, vh: number, phone: boolean): { top: number; left: number } {
  const clampX = (x: number) => Math.max(GUTTER, Math.min(vw - card.w - GUTTER, x));
  const clampY = (y: number) => Math.max(GUTTER, Math.min(vh - card.h - GUTTER, y));
  if (!ring) return { top: clampY((vh - card.h) / 2), left: clampX((vw - card.w) / 2) };
  if (phone) return { top: ring.top + ring.height / 2 > vh / 2 ? GUTTER : vh - card.h - GUTTER, left: GUTTER };
  const gap = 12;
  if (ring.top + ring.height + gap + card.h <= vh - GUTTER) return { top: ring.top + ring.height + gap, left: clampX(ring.left) };
  if (ring.top - gap - card.h >= GUTTER) return { top: ring.top - gap - card.h, left: clampX(ring.left) };
  if (ring.left + ring.width + gap + card.w <= vw - GUTTER) return { top: clampY(ring.top), left: ring.left + ring.width + gap };
  if (ring.left - gap - card.w >= GUTTER) return { top: clampY(ring.top), left: ring.left - gap - card.w };
  return { top: vh - card.h - GUTTER, left: clampX((vw - card.w) / 2) };
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function Tour({ tour, phone, onEnd }: { tour: TourData; phone: boolean; /** `guide`: back to the Guide; otherwise stay on the screen. */ onEnd: (to: "guide" | "screen") => void }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Shown[] | null>(null);
  const [i, setI] = useState(0);
  const [ring, setRing] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  const atEnd = !!shown && i >= shown.length;
  const cur = shown && !atEnd ? shown[i]! : null;

  // Wait for the screen: the first step's element, or the time runs out (then whatever is there).
  useEffect(() => {
    const first = tour.steps.find((s) => !(phone && s.phone === "skip"));
    const started = Date.now();
    let t = 0;
    const check = () => {
      if ((first && target(first.target)) || Date.now() - started > READY_MS) setShown(resolveSteps(tour.steps, phone));
      else t = window.setTimeout(check, 100);
    };
    // A beat for the screen's own loading after the address changed.
    t = window.setTimeout(check, 150);
    return () => clearTimeout(t);
  }, [tour, phone]);

  // The ring follows its element (scrolling, resizing, the screen settling) while the step shows.
  useEffect(() => {
    if (!cur || cur.kind !== "ring") return setRing(null);
    const el = cur.el.isConnected ? cur.el : target(cur.step.target);
    if (!el) return setRing(null);
    const r = el.getBoundingClientRect();
    const tall = r.height > innerHeight - 2 * GUTTER - 220;
    el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    let raf = 0;
    let last = "";
    const tick = () => {
      const b = boxOf(el);
      const k = `${Math.round(b.top)},${Math.round(b.left)},${Math.round(b.width)},${Math.round(b.height)}`;
      if (k !== last) (last = k, setRing(b));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [cur, reduced]);

  // The card beside the ring, measured after it renders.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    setPos(place(cur?.kind === "ring" ? ring : null, { w: c.offsetWidth, h: c.offsetHeight }, innerWidth, innerHeight, phone));
  }, [ring, cur, atEnd, phone, shown]);

  // Focus lands on each step's title, so a screen reader reads it; it goes back where it was when the tour ends.
  useEffect(() => {
    if (shown) head.current?.focus({ preventScroll: true });
  }, [i, shown]);
  useEffect(() => () => void (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true }), []);

  const next = () => shown && setI((n) => Math.min(shown.length, n + 1));
  const back = () => setI((n) => Math.max(0, n - 1));
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    // Every key stops here while the tour runs: the screen's own shortcuts never fire under it.
    e.stopImmediatePropagation();
    if (e.key === "Escape") return e.preventDefault(), onEnd("screen");
    if (e.key === "ArrowRight" && !atEnd) return e.preventDefault(), next();
    if (e.key === "ArrowLeft") return e.preventDefault(), back();
    if (e.key === "Tab") {
      // Focus stays in the card.
      const f = [...(card.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!f.length) return e.preventDefault();
      const at = f.indexOf(document.activeElement as HTMLElement);
      const to = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : at === f.length - 1 ? 0 : at + 1;
      e.preventDefault();
      f[to]!.focus();
    } else if (!card.current?.contains(e.target as Node)) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    // A modal: focus that leaves the card (the screen focusing its own heading as it loads) comes back to it.
    const back = (e: FocusEvent) => {
      if (card.current && !card.current.contains(e.target as Node)) head.current?.focus({ preventScroll: true });
    };
    // Focus that leaves the card for nowhere (the body) comes back too.
    const lost = (e: FocusEvent) => {
      if (!e.relatedTarget && card.current?.contains(e.target as Node)) setTimeout(() => document.activeElement === document.body && head.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", on, true);
    document.addEventListener("focusin", back, true);
    document.addEventListener("focusout", lost, true);
    return () => (window.removeEventListener("keydown", on, true), document.removeEventListener("focusin", back, true), document.removeEventListener("focusout", lost, true));
  }, []);

  const total = shown?.length ?? 0;
  const live = useMemo(() => (atEnd ? `${TOUR_UI.endTitle}. ${tour.end.line}` : cur ? `${TOUR_UI.stepOf(i + 1, total)}. ${cur.step.title}. ${cur.text}` : TOUR_UI.loading), [atEnd, cur, i, total, tour]);
  const titleId = `tour-${tour.id}-title`;

  return (
    <div className={`tour-layer${reduced ? " still" : ""}`} data-tour-layer={tour.id} onPointerDown={(e) => !card.current?.contains(e.target as Node) && e.preventDefault()} onMouseDown={(e) => !card.current?.contains(e.target as Node) && e.preventDefault()} onClick={(e) => e.stopPropagation()}>
      {/* The dim: one ring with a wide shadow, or a plain wash when the step has nothing to ring. */}
      {ring && cur?.kind === "ring" ? <div className="tour-ring" style={ring} aria-hidden="true" /> : <div className="tour-wash" aria-hidden="true" />}
      <div className="sr-only" aria-live="polite">
        {live}
      </div>
      <div ref={card} className={`tour-card${phone ? " phone" : ""}${atEnd ? " end" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} style={pos ?? { visibility: "hidden" }}>
        {!shown ? (
          <h2 ref={head} id={titleId} tabIndex={-1} className="tour-title">
            {TOUR_UI.loading}
          </h2>
        ) : atEnd ? (
          <>
            <div className="tour-end-mark">
              <Lumen pose={reduced ? "still" : "idle"} size={26} />
            </div>
            <h2 ref={head} id={titleId} tabIndex={-1} className="tour-title">
              {TOUR_UI.endTitle}
            </h2>
            <p className="tour-text">{tour.end.line}</p>
            <p className="tour-text muted">{tour.end.tryIt}</p>
            <div className="tour-nav">
              <button type="button" className="quiet" onClick={() => onEnd("guide")}>
                {TOUR_UI.toGuide}
              </button>
              <button type="button" className="primary" onClick={() => onEnd("screen")}>
                {TOUR_UI.done}
              </button>
            </div>
          </>
        ) : (
          cur && (
            <>
              <div className="tour-top">
                <span className="tour-count">
                  {tour.title} · {TOUR_UI.stepOf(i + 1, total)}
                </span>
                <CloseButton onClose={() => onEnd("screen")} title={`${TOUR_UI.skip} (Esc)`} />
              </div>
              <h2 ref={head} id={titleId} tabIndex={-1} className="tour-title">
                {cur.step.title}
              </h2>
              <p className="tour-text">{cur.text}</p>
              {cur.kind === "example" && cur.step.example && <Illustration id={cur.step.example} />}
              <div className="tour-dots" aria-hidden="true">
                {shown.map((_, n) => (
                  <i key={n} className={n === i ? "on" : n < i ? "past" : ""} />
                ))}
              </div>
              <div className="tour-nav">
                <button type="button" className="quiet tour-skip" onClick={() => onEnd("screen")}>
                  {TOUR_UI.skip}
                </button>
                <span className="tour-spacer" />
                <button type="button" className="quiet" onClick={back} disabled={i === 0}>
                  {TOUR_UI.back}
                </button>
                <button type="button" className="primary" onClick={next}>
                  {i === total - 1 ? TOUR_UI.finish : TOUR_UI.next}
                </button>
              </div>
              {!phone && <p className="tour-keys">{TOUR_UI.keys}</p>}
            </>
          )
        )}
      </div>
    </div>
  );
}
