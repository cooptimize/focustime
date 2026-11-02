// Step 17.5: the brand marks' geometry and the unroll, as numbers (no DOM). The same measurements as
// assets/brand/tools/gen.py: a ring of four bands opening right, AM above PM, and the unrolled week of four columns.
// The unroll is drawn per segment as a band: a centre line of some curvature, a half width and a corner radius.

/** The ring (mark-bent): centre, and each band's mid radius and width, inner to outer. */
export const RING = { cx: 118, cy: 118, radii: [51, 69, 84.5, 100], widths: [16, 11.5, 11.7, 11.7], cut: 4.5, open: 45 } as const;
/** The week (mark-week, 200 x 90): column x, bar width, AM and PM rows, corner radius. */
export const WEEK = { cols: [8, 56, 104, 152], bw: 40, am: { y: 8, h: 26 }, pm: { y: 50, h: 32 }, rx: 6, w: 200, h: 90 } as const;
/** Lumen (30 x 30 in the marks): body corner, light bar on its left edge. */
export const LUMEN = { size: 30, rx: 6, bar: { x: 0, y: 8.25, w: 4.5, h: 13.5, rx: 1.5 } } as const;

/** Where the week lands on the unroll stage (viewBox -10 0 300 236): 1.2x, centred on the ring's cut line. */
export const STAGE = { viewBox: "-10 0 300 236", scale: 1.2, ox: 0, oy: 64 } as const;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 before a, 1 after b, linear between. */
export const span = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
/** Ease in-out (cubic). */
export const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Shortest turn from angle a to b (radians). */
const mixAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

/** A band: centre line through (x, y) with tangent angle `angle`, curvature k (1/radius, bending to the tangent's right
 *  in screen terms), length, half width, and a corner radius drawn by a round-joined stroke of twice that width. */
export type Band = { x: number; y: number; angle: number; k: number; len: number; half: number; corner: number };

/** The outline of a band as an SVG path: two offset arcs (or lines) joined at the ends. */
export function bandPath(b: Band): string {
  const tx = Math.cos(b.angle), ty = Math.sin(b.angle);
  const nx = -ty, ny = tx; // the side the centre line bends towards
  const h = b.len / 2;
  const f = (n: number) => n.toFixed(2);
  if (Math.abs(b.k) < 1e-5) {
    const p = (u: number, s: number) => `${f(b.x + tx * u + nx * s)} ${f(b.y + ty * u + ny * s)}`;
    return `M${p(-h, -b.half)} L${p(h, -b.half)} L${p(h, b.half)} L${p(-h, b.half)} Z`;
  }
  // About the centre of curvature, the centre line runs at angle a0 + u*k; the side at offset s along the normal
  // has radius |r| - sign(k)*s. Going from -h to +h the angle grows when k > 0 (SVG sweep 1).
  const r = 1 / b.k, sign = Math.sign(b.k);
  const cx = b.x + nx * r, cy = b.y + ny * r;
  const a0 = Math.atan2(b.y - cy, b.x - cx);
  const at = (u: number, rr: number) => [cx + Math.cos(a0 + u * b.k) * rr, cy + Math.sin(a0 + u * b.k) * rr] as const;
  const r1 = Math.abs(r) + sign * b.half, r2 = Math.max(0.01, Math.abs(r) - sign * b.half);
  const p0 = at(-h, r1), p1 = at(h, r1), q1 = at(h, r2), q0 = at(-h, r2);
  const large = Math.abs(b.k * b.len) > Math.PI ? 1 : 0;
  const sweep = b.k > 0 ? 1 : 0;
  return `M${f(p0[0])} ${f(p0[1])} A${f(r1)} ${f(r1)} 0 ${large} ${sweep} ${f(p1[0])} ${f(p1[1])} L${f(q1[0])} ${f(q1[1])} A${f(r2)} ${f(r2)} 0 ${large} ${1 - sweep} ${f(q0[0])} ${f(q0[1])} Z`;
}

export type Segment = {
  ring: number; // 0 inner .. 3 outer
  half: "am" | "pm";
  /** The inner AM band: dashed in the ring, the hollow Mon AM in the week. */
  ghost: boolean;
  from: Band;
  /** Beat 1: straight where the ring was. */
  straight: Band;
  /** Beat 2: its bar in the week. */
  to: Band;
};

/** The eight segments, inner to outer, AM then PM, with their three key states. */
export const SEGMENTS: readonly Segment[] = RING.radii.flatMap((r, i) =>
  (["am", "pm"] as const).map((half): Segment => {
    const gap = (RING.cut / 2 / r) * (180 / Math.PI);
    const [a0, a1] = half === "am" ? [180 + gap, 360 - RING.open] : [RING.open, 180 - gap];
    const mid = rad((a0 + a1) / 2);
    const ghost = i === 0 && half === "am";
    const from: Band = {
      x: RING.cx + r * Math.cos(mid),
      y: RING.cy + r * Math.sin(mid),
      angle: mid + Math.PI / 2, // clockwise along the ring
      k: 1 / r,
      len: r * rad(a1 - a0),
      half: ghost ? 0 : RING.widths[i]! / 2,
      corner: 0,
    };
    const row = half === "am" ? WEEK.am : WEEK.pm;
    const s = STAGE.scale;
    const side = half === "am" ? -1 : 1;
    const straight: Band = { ...from, x: RING.cx + 10, y: RING.cy + side * 0.93 * r, angle: half === "am" ? 0 : Math.PI, k: 0, len: from.len * 0.7 };
    const to: Band = {
      x: STAGE.ox + (WEEK.cols[i]! + WEEK.bw / 2) * s,
      y: STAGE.oy + (row.y + row.h / 2) * s,
      angle: straight.angle,
      k: 0,
      len: ghost ? WEEK.bw * s - 3 : (WEEK.bw - 2 * WEEK.rx) * s,
      half: ghost ? (row.h * s) / 2 - 1.5 : (row.h / 2 - WEEK.rx) * s,
      corner: ghost ? 0 : WEEK.rx * s,
    };
    return { ring: i, half, ghost, from, straight, to };
  }),
);

/** The unroll's timing (ms): the week takes shape, then Lumen hops home into Mon AM. */
export const UNROLL = { grid: 1000, home: 500 } as const;
export const UNROLL_TOTAL = UNROLL.grid + UNROLL.home;

/** One segment at grid progress g (0..1): beat 1 straightens it in place (outer ring first), beat 2 shrinks it and
 *  slides it into its day, horizontal leading vertical. `settled` is how far it is into its final look. */
export function segmentAt(s: Segment, g: number): Band & { settled: number } {
  const lead = (3 - s.ring) * 0.05;
  const b1 = inOut(span(g, lead, lead + 0.48));
  const g2 = span(g, 0.36 + lead, 0.84 + lead);
  const ex = inOut(span(g2, 0, 0.75)), ey = inOut(span(g2, 0.2, 1));
  const eLen = inOut(span(g2, 0, 0.7)), eThick = inOut(span(g2, 0.2, 1));
  const { from: a, straight: m, to: z } = s;
  return {
    x: mix(mix(a.x, m.x, b1), z.x, ex),
    y: mix(mix(a.y, m.y, b1), z.y, ey),
    angle: mixAngle(a.angle, m.angle, b1),
    k: a.k * (1 - b1) ** 1.6,
    len: mix(mix(a.len, m.len, b1), z.len, eLen),
    half: mix(a.half, z.half, eThick),
    corner: z.corner * eThick,
    settled: eThick,
  };
}

/** The crossfade into the exact mark-week at the end of the grid. */
export const finalFade = (g: number) => inOut(span(g, 0.88, 1));

export type LumenPose = { x: number; y: number; scale: number; beam: number; opacity: number };
/** Lumen beside the opening (mark-bent), beside the week, and home in Mon AM (scaled to fit it). */
const BENT = { x: 206, y: 103 };
const BESIDE = { x: 258, y: 103 };
const MON_AM = SEGMENTS[0]!.to;
const HOME = { x: MON_AM.x - 10, y: MON_AM.y - 10, scale: 20 / 30 };

/** Lumen at time t (ms) of the unroll: it steps aside as the week widens, then hops in an arc into the hollow
 *  Mon AM while its beam fades ("Back into Mon AM"). */
export function lumenAt(t: number): LumenPose {
  const g = span(t, 0, UNROLL.grid), u = span(t, UNROLL.grid, UNROLL_TOTAL);
  const e = inOut(span(g, 0.25, 1));
  const eu = inOut(u);
  const x = mix(mix(BENT.x, BESIDE.x, e), HOME.x, eu);
  const y = mix(BENT.y - 5 * Math.sin(Math.PI * e), HOME.y, eu) - 34 * Math.sin(Math.PI * eu);
  return { x, y, scale: mix(1, HOME.scale, eu), beam: mix(mix(1, 0.7, e), 0, span(u, 0, 0.35)), opacity: 1 };
}

/** The week's box on the stage (the bars' outer edges), for the FLIP into the top bar's mark. */
export const WEEK_BOX = { x: STAGE.ox + WEEK.cols[0]! * STAGE.scale, y: STAGE.oy + WEEK.am.y * STAGE.scale, w: (WEEK.w - 2 * WEEK.cols[0]!) * STAGE.scale, h: (WEEK.h - 2 * WEEK.am.y) * STAGE.scale } as const;
