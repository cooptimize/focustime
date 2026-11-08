// UI-10: how much of the window the on-screen keyboard covers, as `--kb-inset` on the root (0px with no keyboard), so a
// phone sheet with a text box can sit above it. iOS Safari keeps the layout viewport when the keyboard opens and only
// shrinks the visual viewport; Chrome on Android resizes with interactive-widget=resizes-content (index.html), where
// this stays 0. Nothing else reads the keyboard.

export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number } | null): number {
  if (!vv) return 0;
  const covered = Math.round(innerHeight - vv.height - vv.offsetTop);
  // Under 80 px is the browser's own bars moving, not a keyboard.
  return covered >= 80 ? covered : 0;
}

export function startKeyboardInset(): void {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => root.style.setProperty("--kb-inset", `${keyboardInset(window.innerHeight, vv)}px`);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
