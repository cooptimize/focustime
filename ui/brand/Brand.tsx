// Step 17.5: the brand marks and Lumen as components (docs/design/brand.md). Colors come from the brand tokens;
// mascot-highlight (Lumen's light) is used only here. No animation library: CSS for poses and the sweep,
// requestAnimationFrame for the unroll. Every mark is decorative (aria-hidden); words around it carry the meaning.
import { useEffect, useId, useRef, type CSSProperties } from "react";
import bentRaw from "../../assets/brand/mark-bent.svg?raw";
import lockupRaw from "../../assets/brand/lockup-horizontal.svg?raw";
import { bandPath, finalFade, lumenAt, RING, SEGMENTS, segmentAt, span, STAGE, UNROLL, UNROLL_TOTAL, WEEK, LUMEN } from "./geometry.ts";
import { useReducedMotion } from "./motion.ts";
import "./brand.css";

/**
 * A generated asset inlined: its own :root token block dropped (the page's brand tokens apply through .brand-svg), and
 * every style attribute dropped too (HK-7): the CSP allows no inline style, so the beam's blend comes from brand.css
 * (`.brand-svg path[fill^="url(#beam"]`), and a style attribute here was only a console warning at sign-in.
 */
export function inline(raw: string, uid: string): string {
  return raw
    .replace(/<style>\s*:root\{[^}]*\}\s*<\/style>/, "")
    .replace(/ style="[^"]*"/g, "")
    .replace(/<title>.*?<\/title><desc>.*?<\/desc>/, "")
    .replace(/ width="\d+" height="\d+"/, "")
    .replace(/id="([\w-]+)"/g, `id="$1-${uid}"`)
    .replace(/url\(#([\w-]+)\)/g, `url(#$1-${uid})`);
}

/** The unrolled week: four columns Mon to Thu, AM over PM, Mon AM hollow. The top bar's mark and the icon. */
export function WeekMark({ height = 18, className = "" }: { height?: number; className?: string }) {
  const { cols, bw, am, pm, rx } = WEEK;
  return (
    <svg className={`brand-svg week-mark ${className}`} viewBox={`0 0 ${WEEK.w} ${WEEK.h}`} height={height} width={(height * WEEK.w) / WEEK.h} aria-hidden="true" focusable="false">
      {cols.map((x, i) => (
        <g key={x}>
          {i === 0 ? (
            <rect x={x + 1.5} y={am.y + 1.5} width={bw - 3} height={am.h - 3} rx={rx - 1} fill="none" stroke="var(--brand-accent)" strokeWidth={3} />
          ) : (
            <rect x={x} y={am.y} width={bw} height={am.h} rx={rx} fill="var(--brand-am)" />
          )}
          <rect x={x} y={pm.y} width={bw} height={pm.h} rx={rx} fill="var(--brand-pm)" />
        </g>
      ))}
    </svg>
  );
}

/** The bent week (ring opening right, Lumen outside it, light pointing in). Sign-in and connect screens. */
export function BentMark({ width = 120 }: { width?: number }) {
  const uid = useId().replace(/:/g, "");
  return <span className="brand-svg bent-mark" style={{ width }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: inline(bentRaw, uid) }} />;
}

/** The lockup: bent mark, wordmark and "by Cooptimize" (outlined). About in Settings. */
export function Lockup({ width = 260 }: { width?: number }) {
  const uid = useId().replace(/:/g, "");
  return <span className="brand-svg lockup" style={{ width }} role="img" aria-label="FocusTime by Cooptimize" dangerouslySetInnerHTML={{ __html: inline(lockupRaw, uid) }} />;
}

/** Lumen's parts, drawn at the origin (30 x 30): beam to the left of the light bar, body, bar. */
function LumenBody({ beamId, beam = 1 }: { beamId: string; beam?: number }) {
  const { size, rx, bar } = LUMEN;
  const c = size / 2, far = -size * 2.3;
  return (
    <>
      <defs>
        <linearGradient id={beamId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={far} y2={0}>
          <stop offset="0" stopColor="var(--mascot-highlight)" stopOpacity={0.85} />
          <stop offset="0.55" stopColor="var(--mascot-highlight)" stopOpacity={0.25} />
          <stop offset="1" stopColor="var(--mascot-highlight)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path className="lumen-beam" d={`M0 ${c - bar.h / 2} L${far} ${c - size * 0.9} L${far} ${c + size * 0.9} L0 ${c + bar.h / 2} Z`} fill={`url(#${beamId})`} opacity={beam} />
      <rect width={size} height={size} rx={rx} fill="var(--brand-accent)" />
      <rect className="lumen-bar" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={bar.rx} fill="var(--mascot-highlight)" />
    </>
  );
}

export type LumenPose = "still" | "idle" | "bob";

/** Lumen: no face, it emits. `still` stands; `idle` sways about 1.5 degrees and its light breathes; `bob` settles
 *  in with one bob, then idles. Reduced motion always shows `still`. `size` is the body's width in px. */
export function Lumen({ pose = "still", size = 30, className = "" }: { pose?: LumenPose; size?: number; className?: string }) {
  const reduced = useReducedMotion();
  const beamId = `lumen-beam-${useId().replace(/:/g, "")}`;
  const shown = reduced ? "still" : pose;
  // viewBox: the beam's 2.3x length to the left, its 1.8x height centred on the body.
  const vb = { x: -LUMEN.size * 2.3 - 1, y: LUMEN.size / 2 - LUMEN.size * 0.9 - 1, w: LUMEN.size * 3.3 + 2, h: LUMEN.size * 1.8 + 2 };
  return (
    <svg className={`brand-svg lumen pose-${shown} ${className}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width={(size * vb.w) / LUMEN.size} height={(size * vb.h) / LUMEN.size} aria-hidden="true" focusable="false" data-lumen={shown}>
      <g className="lumen-pose">
        <LumenBody beamId={beamId} />
      </g>
    </svg>
  );
}

/** The ring's bands for the loader (inner AM drawn, not ghosted). */
function RingBands() {
  return (
    <>
      {RING.radii.map((r, i) => {
        const gap = (RING.cut / 2 / r) * (180 / Math.PI);
        const pt = (deg: number) => [RING.cx + r * Math.cos((deg * Math.PI) / 180), RING.cy + r * Math.sin((deg * Math.PI) / 180)].map((n) => n.toFixed(2)).join(" ");
        return (
          <g key={r} fill="none" strokeWidth={RING.widths[i]}>
            <path d={`M${pt(180 + gap)} A${r} ${r} 0 0 1 ${pt(360 - RING.open)}`} stroke="var(--brand-am)" />
            <path d={`M${pt(RING.open)} A${r} ${r} 0 0 1 ${pt(180 - gap)}`} stroke="var(--brand-pm)" />
          </g>
        );
      })}
    </>
  );
}

/** Lumen at the ring's centre with its light sweeping round (2.5 s a turn, a radial fade about 50 degrees wide).
 *  Reduced motion: no sweep, Lumen still. Same viewBox as the unroll stage, so one replaces the other in place. */
export function LumenLoading({ height = 200 }: { height?: number }) {
  const reduced = useReducedMotion();
  const id = `sweep-${useId().replace(/:/g, "")}`;
  const sr = 43, half = (25 * Math.PI) / 180;
  const sx = RING.cx + sr * Math.cos(half), sy = sr * Math.sin(half);
  const [, , w, h] = STAGE.viewBox.split(" ").map(Number);
  return (
    <svg className="brand-svg lumen-loading" viewBox={STAGE.viewBox} height={height} width={(height * w!) / h!} aria-hidden="true" focusable="false">
      <RingBands />
      {!reduced && (
        <>
          <defs>
            <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={RING.cx} cy={RING.cy} r={sr + 1}>
              <stop offset="0" stopColor="var(--mascot-highlight)" stopOpacity={0.85} />
              <stop offset="0.55" stopColor="var(--mascot-highlight)" stopOpacity={0.3} />
              <stop offset="1" stopColor="var(--mascot-highlight)" stopOpacity={0} />
            </radialGradient>
          </defs>
          <g className="loading-sweep" style={{ transformOrigin: `${RING.cx}px ${RING.cy}px` } as CSSProperties}>
            <path className="lumen-beam" d={`M${RING.cx} ${RING.cy} L${sx.toFixed(2)} ${(RING.cy - sy).toFixed(2)} A${sr} ${sr} 0 0 1 ${sx.toFixed(2)} ${(RING.cy + sy).toFixed(2)} Z`} fill={`url(#${id})`} />
          </g>
        </>
      )}
      <g transform={`translate(${RING.cx - LUMEN.size / 2} ${RING.cy - LUMEN.size / 2})`}>
        <rect width={LUMEN.size} height={LUMEN.size} rx={LUMEN.rx} fill="var(--brand-accent)" />
        <rect x={LUMEN.bar.x} y={LUMEN.bar.y} width={LUMEN.bar.w} height={LUMEN.bar.h} rx={LUMEN.bar.rx} fill="var(--mascot-highlight)" />
      </g>
    </svg>
  );
}

/**
 * The unroll (about 1.5 s): beat 1, each ring segment straightens in place, outer ring leading; beat 2, the bars
 * shrink and slide into their day, AM over PM, horizontal leading vertical, the dashed inner AM becoming the hollow
 * Mon AM; a crossfade into the exact mark-week; then Lumen hops in an arc into Mon AM, its beam fading.
 * `close` plays it backwards; `paused` holds its first frame. Reduced motion: no animation, the end state shows and onDone runs at once.
 */
export function Unroll({ direction, height = 200, paused = false, pose, onDone, svgRef }: { direction: "open" | "close"; height?: number; /** Hold the first frame. */ paused?: boolean; /** Lumen's pose where it stands (Close out's moment: bob). */ pose?: "still" | "bob" | undefined; onDone?: (() => void) | undefined; svgRef?: React.Ref<SVGSVGElement> }) {
  const reduced = useReducedMotion();
  const segs = useRef<(SVGPathElement | null)[]>([]);
  const fin = useRef<SVGGElement>(null);
  const lumen = useRef<SVGGElement>(null);
  const beamId = `unroll-beam-${useId().replace(/:/g, "")}`;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const draw = (t: number) => {
      const g = span(t, 0, UNROLL.grid), f = finalFade(g);
      SEGMENTS.forEach((s, i) => {
        const el = segs.current[i];
        if (!el) return;
        const b = segmentAt(s, g);
        el.setAttribute("d", bandPath(b));
        el.setAttribute("opacity", (1 - f).toFixed(3));
        if (s.ghost) {
          el.style.stroke = `color-mix(in srgb, var(--brand-accent) ${Math.round(b.settled * 100)}%, var(--brand-ghost))`;
          el.setAttribute("stroke-dasharray", `6 ${(5 * (1 - b.settled)).toFixed(2)}`);
        } else el.setAttribute("stroke-width", (2 * b.corner).toFixed(2));
      });
      fin.current?.setAttribute("opacity", f.toFixed(3));
      const l = lumenAt(t);
      lumen.current?.setAttribute("transform", `translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) scale(${l.scale.toFixed(3)})`);
      lumen.current?.querySelector(".lumen-beam")?.setAttribute("opacity", l.beam.toFixed(3));
    };
    const end = direction === "open" ? UNROLL_TOTAL : 0;
    if (paused) {
      draw(direction === "open" ? 0 : UNROLL_TOTAL);
      return;
    }
    if (reduced) {
      draw(end);
      done.current?.();
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const e = Math.min(UNROLL_TOTAL, now - start);
      draw(direction === "open" ? e : UNROLL_TOTAL - e);
      if (e < UNROLL_TOTAL) raf = requestAnimationFrame(step);
      else done.current?.();
    };
    draw(direction === "open" ? 0 : UNROLL_TOTAL);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [direction, reduced, paused]);

  const [, , w, h] = STAGE.viewBox.split(" ").map(Number);
  const s = STAGE.scale;
  return (
    <svg ref={svgRef} className="brand-svg unroll" viewBox={STAGE.viewBox} height={height} width={(height * w!) / h!} aria-hidden="true" focusable="false" data-unroll={direction}>
      {SEGMENTS.map((seg, i) => (
        <path
          key={i}
          ref={(el) => void (segs.current[i] = el)}
          strokeLinejoin="round"
          {...(seg.ghost ? { fill: "none", strokeWidth: 3 } : { fill: seg.half === "am" ? "var(--brand-am)" : "var(--brand-pm)", stroke: seg.half === "am" ? "var(--brand-am)" : "var(--brand-pm)" })}
        />
      ))}
      <g ref={fin} opacity={0} transform={`translate(${STAGE.ox} ${STAGE.oy}) scale(${s})`}>
        {WEEK.cols.map((x, i) => (
          <g key={x}>
            {i === 0 ? (
              <rect x={x + 1.5} y={WEEK.am.y + 1.5} width={WEEK.bw - 3} height={WEEK.am.h - 3} rx={WEEK.rx - 1} fill="none" stroke="var(--brand-accent)" strokeWidth={3} />
            ) : (
              <rect x={x} y={WEEK.am.y} width={WEEK.bw} height={WEEK.am.h} rx={WEEK.rx} fill="var(--brand-am)" />
            )}
            <rect x={x} y={WEEK.pm.y} width={WEEK.bw} height={WEEK.pm.h} rx={WEEK.rx} fill="var(--brand-pm)" />
          </g>
        ))}
      </g>
      <g ref={lumen} className="unroll-lumen">
        <g className={`unroll-lumen-pose${pose === "bob" && !reduced ? " pose-bob" : ""}`} {...(pose ? { "data-lumen": reduced ? "still" : pose } : {})}>
          <LumenBody beamId={beamId} />
        </g>
      </g>
    </svg>
  );
}
