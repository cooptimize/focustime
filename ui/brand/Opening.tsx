// Step 17.5: the app open (loader, unroll, "Back into Mon AM", into the top bar), the Close out reverse, and the
// fun moments. Lumen appears only here, on sign-in and connect screens, in About, in the Guide's footer and in three empty states;
// never in Week, Plan the week, Today, Plan the day, Check-in, Roadmap or on a card. Lumen never carries information.
import { useCallback, useEffect, useRef, useState } from "react";
import { Lumen, Unroll } from "./Brand.tsx";
import { bootReady, bootWaiting } from "./boot.ts";
import { WEEK_BOX, STAGE } from "./geometry.ts";
import { useReducedMotion } from "./motion.ts";
import { waitingLine, type SourceLine } from "./opening.ts";

const STAGE_H = 220;
const FLY_MS = 450;
const [VB_X, VB_Y, VB_W] = STAGE.viewBox.split(" ").map(Number) as [number, number, number];

/** The top bar's mark, the start of Close out's flight. */
const topMark = () => document.querySelector<SVGSVGElement>(".brand-home .week-mark");

/** The transform that puts the stage's week exactly over the top bar's mark (FLIP: first, last, invert, play). */
function flipToMark(svg: SVGSVGElement): string | null {
  const mark = topMark()?.getBoundingClientRect();
  const box = svg.getBoundingClientRect();
  if (!mark || !box.width) return null;
  const unit = box.width / VB_W; // px per stage unit
  const week = { x: box.left + (WEEK_BOX.x - VB_X) * unit, y: box.top + (WEEK_BOX.y - VB_Y) * unit, w: WEEK_BOX.w * unit };
  // The mark's own viewBox is 200 x 90 with the bars from 8 to 192, the same box the stage's week measures.
  const target = { x: mark.left + (mark.width * 8) / 200, y: mark.top + (mark.height * 8) / 90, w: (mark.width * 184) / 200 };
  const k = target.w / week.w;
  return `translate(${target.x - box.left - (week.x - box.left) * k}px, ${target.y - box.top - (week.y - box.top) * k}px) scale(${k})`;
}

/**
 * BR-1: the app open. The loader is index.html's own week mark (ui/brand/boot.ts); this only tells it what the
 * opening is still waiting on (its line after 8 seconds) and when the first load is done (or failed: a failed source
 * never holds it back). `onFinished` runs once the app shows.
 */
export function Opening({ ready, lines, onFinished }: { ready: boolean; lines: SourceLine[]; onFinished?: () => void }) {
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const line = ready ? null : waitingLine(lines);
  useEffect(() => bootWaiting(line), [line]);
  useEffect(() => {
    if (ready) bootReady(() => finished.current?.());
  }, [ready]);
  return null;
}

/** Click or any key skips an overlay; the key goes no further (no shortcut runs underneath). */
function useSkip(onSkip: () => void, on: boolean) {
  const skip = useRef(onSkip);
  skip.current = onSkip;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      skip.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [on]);
}

/**
 * After Close out's Done: the opening played backwards over the app (the week grows out of the top bar's mark,
 * Lumen hops out of Mon AM and the week rolls back into the ring), then back to Today. With all of today's to-dos
 * done, a fun moment follows: Lumen settles and bobs, "All done. See you tomorrow." Click or any key skips.
 * Reduced motion: no animation; the moment shows still.
 */
export function CloseReverse({ allDone: done, onDone }: { allDone: boolean; onDone: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"in" | "unroll" | "moment" | "out">(reduced ? (done ? "moment" : "out") : "in");
  const svg = useRef<SVGSVGElement | null>(null);
  const ended = useRef(false);
  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    onDone();
  }, [onDone]);
  useSkip(end, true);

  // In: the stage's week starts on the top bar's mark and grows to the centre.
  useEffect(() => {
    if (phase !== "in") return;
    const el = svg.current;
    const from = el ? flipToMark(el) : null;
    if (el && from) {
      el.style.transform = from;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.classList.add("flying");
        el.style.transform = "";
      }));
    }
    const id = setTimeout(() => setPhase("unroll"), from ? FLY_MS + 60 : 200);
    return () => clearTimeout(id);
  }, [phase]);
  useEffect(() => {
    if (phase === "out") {
      const id = setTimeout(end, reduced ? 0 : 320);
      return () => clearTimeout(id);
    }
    if (phase === "moment") {
      const id = setTimeout(() => setPhase("out"), 2600);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [phase, end, reduced]);

  return (
    <div className="brand-stage blocking" role="status" aria-live="polite" data-close={phase} onClick={end}>
      <div className={`brand-stage-bg${phase === "out" ? " gone" : ""}`} />
      <div className={`brand-stage-body${phase === "out" ? " gone" : ""}`}>
        {(
          <Unroll direction="close" paused={phase === "in"} pose={phase === "moment" ? "bob" : undefined} height={STAGE_H} svgRef={(el) => void (svg.current = el)} onDone={phase === "unroll" ? () => setPhase(done ? "moment" : "out") : undefined} />
        )}
        {done && <p className={`brand-moment-line${phase === "moment" ? "" : " gone"}`}>All done. See you tomorrow.</p>}
      </div>
    </div>
  );
}

/** A fun moment over the app (first launch): Lumen settles and bobs, one line. Click or any key skips. */
export function MomentOverlay({ line, onDone }: { line: string; onDone: () => void }) {
  const [out, setOut] = useState(false);
  const ended = useRef(false);
  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    setOut(true);
    setTimeout(onDone, 320);
  }, [onDone]);
  useSkip(end, true);
  useEffect(() => {
    const id = setTimeout(end, 3200);
    return () => clearTimeout(id);
  }, [end]);
  return (
    <div className="brand-stage blocking" role="status" aria-live="polite" data-moment="first" onClick={end}>
      <div className={`brand-stage-bg${out ? " gone" : ""}`} />
      <div className={`brand-stage-body${out ? " gone" : ""}`}>
        <Lumen pose="bob" size={64} />
        <p className="brand-moment-line">{line}</p>
        <p className="brand-skip">Click or press any key</p>
      </div>
    </div>
  );
}

/** An inline moment (a successful reconnect in Settings > Connections): Lumen settles and bobs beside one line. */
export function InlineMoment({ line }: { line: string }) {
  return (
    <div className="brand-empty" role="status">
      <Lumen pose="bob" size={26} />
      <p>{line}</p>
    </div>
  );
}
