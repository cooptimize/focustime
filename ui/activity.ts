// HK-3: real use of FocusTime, as the page sees it. The page counts as in use while it is visible and someone gave it
// input (a key, a click, a touch, the wheel, a mouse move) in the last N minutes (the team's Rule `org.idle_minutes`,
// 10 by default). Calls made then say so in the X-FocusTime-Use header; calls from timers (notices, presence, the
// week's quiet refresh) always say "background", so an open tab left alone never keeps the server awake. While in
// use, input also reports itself at most once a minute (POST /api/activity), so reading without clicking still counts.
// Pure apart from the listeners: the clock and visibility are injected so tests can drive them.

export type Use = "active" | "background";
export const USE_HEADER = "x-focustime-use";
export const IDLE_MINUTES_DEFAULT = 10;
export const IDLE_MINUTES_MIN = 5;
export const IDLE_MINUTES_MAX = 60;
/** Input reports itself at most this often. */
export const PING_GAP_MS = 60_000;

export const clampIdleMinutes = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(IDLE_MINUTES_MAX, Math.max(IDLE_MINUTES_MIN, Math.round(n))) : IDLE_MINUTES_DEFAULT;

export type ActivityOptions = {
  now?: () => number;
  visible?: () => boolean;
  /** Reports use to the server; answers with the Rule's minutes when it knows them. */
  ping?: () => Promise<number | null>;
};

export function createActivity(o: ActivityOptions = {}) {
  const now = o.now ?? (() => Date.now());
  const visible = o.visible ?? (() => true);
  let lastInput = Number.NEGATIVE_INFINITY;
  let lastPing = Number.NEGATIVE_INFINITY;
  let idleMinutes = IDLE_MINUTES_DEFAULT;
  const active = () => visible() && now() - lastInput < idleMinutes * 60_000;
  return {
    /** Visible, with input in the last N minutes. */
    active,
    /** What a call says about itself: a background call never counts. */
    use: (background = false): Use => (!background && active() ? "active" : "background"),
    /** Someone touched the page. Reports use when the last report is a minute old. */
    input() {
      lastInput = now();
      if (!o.ping || !visible() || now() - lastPing < PING_GAP_MS) return;
      lastPing = now();
      void o.ping().then(
        (m) => void (m !== null && (idleMinutes = clampIdleMinutes(m))),
        () => undefined,
      );
    },
    setIdleMinutes: (m: unknown) => void (idleMinutes = clampIdleMinutes(m)),
    idleMinutes: () => idleMinutes,
  };
}

const INPUTS = ["keydown", "pointerdown", "wheel", "touchstart", "mousemove"] as const;

/** The page's one tracker, listening on the window. */
let page: ReturnType<typeof createActivity> | null = null;
export function pageActivity(ping: () => Promise<number | null>): ReturnType<typeof createActivity> {
  if (page) return page;
  page = createActivity({ visible: () => typeof document === "undefined" || document.visibilityState === "visible", ping });
  if (typeof window !== "undefined") {
    const on = () => page!.input();
    for (const t of INPUTS) window.addEventListener(t, on, { passive: true, capture: true });
    // Opening (or reloading) the page in view is use.
    if (document.visibilityState === "visible") page.input();
  }
  return page;
}
