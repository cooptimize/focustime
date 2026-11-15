// Step 17.5: the week mark's geometry, as numbers (no DOM): the same measurements as assets/brand/tools/gen.py's
// mark-week (BR-1: the only mark).

/** The week (mark-week, 200 x 90): column x, bar width, AM and PM rows, corner radius. */
export const WEEK = { cols: [8, 56, 104, 152], bw: 40, am: { y: 8, h: 26 }, pm: { y: 50, h: 32 }, rx: 6, w: 200, h: 90 } as const;
