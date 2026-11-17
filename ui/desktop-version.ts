// PH-1: the Desktop version on a phone. One tap in the phone's More lays the whole app out as on a computer about
// 1280 px wide, which the phone shows zoomed out and lets the person pinch; "Phone version" brings the phone's own
// screens back. The choice is kept on that phone only, in the browser's storage (`focustime.desktopVersion`), and
// public/prefs.js reads it before the first paint. Nothing is sent to the server or stored there.
//
// How it switches: with storage, the choice is saved and the page reloads, so the viewport is set before anything is
// drawn (the documented way: the viewport tag as the page loads). With storage refused, the viewport tag is changed in
// place, which browsers follow but their documentation doesn't promise (docs/open-questions.md), and it isn't
// remembered.
import { useSyncExternalStore } from "react";

export const DESKTOP_KEY = "focustime.desktopVersion";
export const DESKTOP_WIDTH = 1280;
const PHONE_VIEWPORT = "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content";
/** The Desktop version's viewport: 1280 wide, starting zoomed out to fit the screen; the same as public/prefs.js writes. */
export const desktopViewport = (screenWidth: number) => `width=${DESKTOP_WIDTH}, initial-scale=${Math.min(1, Math.round(((screenWidth || 390) / DESKTOP_WIDTH) * 10000) / 10000)}, viewport-fit=cover`;
const ATTR = "data-desktop-version";

const listeners = new Set<() => void>();
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
const isOn = () => document.documentElement.hasAttribute(ATTR);

/** Whether the Desktop version is showing (prefs.js set it at load, or it was switched on in place). */
export function useDesktopVersion(): boolean {
  return useSyncExternalStore(subscribe, isOn, () => false);
}

/** The page and its storage; replaced in tests. */
export type DesktopPage = { save: (on: boolean) => boolean; reload: () => void; viewport: (content: string) => void; mark: (on: boolean) => void };
const realPage: DesktopPage = {
  save: (on) => {
    try {
      if (on) localStorage.setItem(DESKTOP_KEY, "1");
      else localStorage.removeItem(DESKTOP_KEY);
      return (localStorage.getItem(DESKTOP_KEY) === "1") === on;
    } catch {
      return false;
    }
  },
  reload: () => location.reload(),
  viewport: (content) => document.querySelector('meta[name="viewport"]')?.setAttribute("content", content),
  mark: (on) => (on ? document.documentElement.setAttribute(ATTR, "") : document.documentElement.removeAttribute(ATTR)),
};

/** Switch to the Desktop version (on) or back to the phone's (off). */
export function setDesktopVersion(on: boolean, page: DesktopPage = realPage, screen: { width: number } = globalThis.screen): "reload" | "in_place" {
  if (page.save(on)) {
    page.reload();
    return "reload";
  }
  page.viewport(on ? desktopViewport(screen.width) : PHONE_VIEWPORT);
  page.mark(on);
  listeners.forEach((f) => f());
  return "in_place";
}

/** The way back's words (docs/design/wording.md, PH-1); here, not in plan/phone-now.ts, so a computer never loads the phone's words. */
export const PHONE_VERSION_TEXT = { button: "Phone version", label: "Back to the phone version" } as const;
