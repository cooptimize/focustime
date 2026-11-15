// BR-1: the loader. index.html draws the week mark from the first paint (#boot, ui/brand/boot.css): nothing for 400 ms,
// then the mark with its blocks lighting in turn, and after 8 seconds one line saying what is still waited on. This
// module takes it from there, once, for whichever screen comes first (the app, the sign-in screen, a signed-out or
// failed screen, /styleguide): a load under 400 ms removes it before it shows; otherwise it stays at least 600 ms,
// the mark finishes its pass (every block lit), then moves and shrinks into the top bar's mark while the app fades in
// (with no top bar mark it fades where it is). Reduced motion: the mark is still and the app appears with no movement.
// A click or a key while it finishes goes straight to the app (the key does nothing else). Screen readers hear
// "Loading FocusTime", then "FocusTime is ready". Moves are Web Animations and class changes: no inline style (CSP).
import { reducedMotion } from "./motion.ts";
import { FLY_MS, LOADER_DELAY_MS, openingAt, passWait } from "./opening.ts";

type State = "loading" | "finishing" | "done";
let state: State = "loading";
let onDone: (() => void) | null = null;
let timer = 0;

const boot = () => (typeof document === "undefined" ? null : document.getElementById("boot"));
const stage = () => boot()?.querySelector<HTMLElement>(".brand-stage") ?? null;

/** Ms since the mark's CSS started (its appear animation), the clock the drawing keeps; else since navigation. */
function markClock(): number {
  const now = Number(document.timeline?.currentTime ?? performance.now());
  const show = stage()
    ?.getAnimations?.()
    .find((a) => (a as CSSAnimation).animationName === "boot-show");
  return typeof show?.startTime === "number" ? now - show.startTime : now;
}

/** The loader's one line (shown only after 8 seconds by its CSS): what it is still waiting on. */
export function bootWaiting(line: string | null): void {
  const el = stage()?.querySelector(".boot-wait");
  if (el && line && state === "loading") el.textContent = line;
}

/** The first screen is ready: finish the loader (once; a later call only replaces what runs when it is done). */
export function bootReady(done?: () => void): void {
  onDone = done ?? null;
  if (state !== "loading") {
    if (state === "done") run();
    return;
  }
  state = "finishing";
  const t = markClock();
  const o = openingAt(t, t);
  // Under 400 ms the mark never showed: the app appears.
  if (!o.loader && t <= LOADER_DELAY_MS) return finish();
  window.addEventListener("keydown", skipKey, true);
  stage()?.addEventListener("pointerdown", finish);
  // At least 600 ms on screen, then (with motion) the end of the pass, then the move.
  timer = window.setTimeout(() => {
    if (reducedMotion()) return finish();
    timer = window.setTimeout(move, passWait(markClock()));
  }, Math.max(0, (o.revealAt ?? t) - t));
}

function skipKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopImmediatePropagation();
  finish();
}

/** The mark lights every block from where it is, and moves onto the top bar's mark (or fades) as the page shows. */
function move(): void {
  const st = stage();
  const svg = st?.querySelector<SVGSVGElement>(".week-loader");
  if (!st || !svg) return finish();
  st.querySelector(".boot-wait")?.replaceChildren();
  const blocks = [...svg.querySelectorAll<SVGElement>(".wl")].map((el) => [el, getComputedStyle(el).opacity] as const);
  svg.classList.add("lit");
  for (const [el, from] of blocks) el.animate?.([{ opacity: from }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  const box = svg.getBoundingClientRect();
  const mark = document.querySelector(".brand-home .week-mark")?.getBoundingClientRect();
  const fly = { duration: FLY_MS, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" } as const;
  if (mark && mark.width > 0 && box.width > 0)
    svg.animate?.([{ transform: "none" }, { transform: `translate(${mark.left - box.left}px, ${mark.top - box.top}px) scale(${mark.width / box.width})` }], fly);
  else svg.animate?.([{ opacity: 1 }, { opacity: 0 }], fly);
  st.querySelector(".boot-bg")?.animate?.([{ opacity: 1 }, { opacity: 0 }], fly);
  timer = window.setTimeout(finish, FLY_MS + 20);
}

function finish(): void {
  if (state === "done") return;
  state = "done";
  window.clearTimeout(timer);
  window.removeEventListener("keydown", skipKey, true);
  stage()?.remove();
  const say = boot()?.querySelector(".boot-say");
  if (say) say.textContent = "FocusTime is ready";
  // The live line stays a moment so it is heard, then the last of the loader goes.
  window.setTimeout(() => boot()?.remove(), 5000);
  run();
}

function run(): void {
  const f = onDone;
  onDone = null;
  f?.();
}
