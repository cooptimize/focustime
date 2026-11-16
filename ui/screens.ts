// PF-1: the screens that load when first opened. The first download holds Day, Week, the top bar and the loader; each
// screen here is its own file (LOADERS is the one list), fetched when it is first asked for, on a tab's hover or
// focus, or in the background once the first screen is usable (prefetchScreens). Nothing here draws: App asks for a
// screen with useScreen (or screen() once it is known to be ready) and keeps the place it was on until the file is in
// (drawnLoc), so there is no blank page and no spinner; ScreenLine (ui/ScreenLine.tsx) says "Loading…" past 300 ms and
// the failed line with Retry.
//
// A file that doesn't arrive (failedLoad):
// - offline: the line says the screen needs a connection, with Retry. Nothing reloads (a page reload offline in a
//   browser tab would lose the app).
// - online: a release may have replaced the file (the server then answers with the page, which isn't a script). The
//   app reloads once, at the place that was asked for, to pick the release up. If the file still can't be loaded
//   after that reload, the line says so with Retry. The one reload is remembered in sessionStorage, by the screen's
//   name, until that screen loads again, so it can never loop. Retry tries the file again and, if it still can't be had, reloads once more
//   (one reload per press).
// - an error thrown by the screen's own code is not a missing file: it is thrown on, as an error in any other part of
//   the app is, with no reload and no line.
import { useEffect, useSyncExternalStore } from "react";
import { SCREENS, type ScreenName } from "./screen-names.ts";


const LOADERS = {
  ahead: () => import("./ahead/Ahead.tsx"),
  status: () => import("./Status.tsx"),
  inbox: () => import("./inbox/InboxPage.tsx"),
  code: () => import("./code/Code.tsx"),
  card: () => import("./StoryCard.tsx"),
  capture: () => import("./Capture.tsx"),
  assistant: () => import("./Assistant.tsx"),
  checkin: () => import("./Checkin.tsx"),
  closeout: () => import("./CloseOut.tsx"),
  focus: () => import("./FocusScreen.tsx"),
  newItem: () => import("./NewItem.tsx"),
  draft: () => import("./DraftEditor.tsx"),
  settings: () => import("./Settings.tsx"),
  guide: () => import("./guide/Guide.tsx"),
  tour: () => import("./guide/tour/Tour.tsx"),
  docs: () => import("./docs/TechDocs.tsx"),
} as const satisfies Record<ScreenName, () => Promise<unknown>>;

export type { ScreenName };
export { SCREENS };
export type ScreenModule<K extends ScreenName> = Awaited<ReturnType<(typeof LOADERS)[K]>>;

/** Fetched in the background once the first screen is usable, in this order: the tabs as the top bar lists them, then what a key opens from any of them. The Guide and the Technical docs wait until they are opened. */
export const BACKGROUND: readonly ScreenName[] = ["ahead", "status", "inbox", "code", "capture", "card", "assistant", "checkin", "closeout", "focus", "newItem", "draft", "settings"];

/** Why a screen's file didn't load: no connection, or it can't be had from the server (after the one reload). */
export type Failed = "offline" | "missing";
type Entry = { status: "idle" | "loading" | "ready" | "failed"; mod?: unknown; why?: Failed; promise?: Promise<void>; wanted: number; since: number; /** This try was asked for with Retry. */ retry?: boolean; /** Its own code threw while loading. */ threw?: boolean; /** Stylesheets that failed to load for it, to fetch again before its next try. */ styles?: string[] };

const entries = new Map<ScreenName, Entry>(SCREENS.map((n) => [n, { status: "idle", wanted: 0, since: 0 }]));
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
/**
 * A screen's state changed: the app draws again only if that screen is asked for on screen now. A file fetched ahead
 * in the background arrives silently, so the app isn't drawn again a dozen times in its first seconds; when the
 * screen is asked for later, asking draws it.
 */
const seen = (en: { wanted: number }) => void (en.wanted > 0 && changed());

/** Stands in for the loaders in tests (ui/screens.test.ts): a screen's file arriving, failing or throwing. */
let loaderOf: (name: ScreenName) => Promise<unknown> = (name) => LOADERS[name]();
/** The page: its connection, its one-reload note and the reload itself; replaced in tests. */
export type Page = { online: () => boolean; reach: () => Promise<boolean>; note: { get: () => string | null; set: (v: string | null) => void }; reload: () => void; rethrow: (e: unknown) => void; restyle: (hrefs: readonly string[]) => Promise<void> };
const RELOADED_KEY = "focustime.screen.reloaded";
let reloadAt: () => string | null = () => null;
const realPage: Page = {
  online: () => typeof navigator === "undefined" || navigator.onLine,
  // The server answers at all (the page itself, never from a cache: /index.html isn't on the service worker's list).
  reach: () => fetch("/index.html", { cache: "no-store", credentials: "omit" }).then((r) => r.ok, () => false),
  note: {
    get: () => {
      try {
        return sessionStorage.getItem(RELOADED_KEY);
      } catch {
        // No session storage (a private window): treated as already reloaded, so there is never a loop.
        return "1";
      }
    },
    set: (v) => {
      try {
        if (v === null) sessionStorage.removeItem(RELOADED_KEY);
        else sessionStorage.setItem(RELOADED_KEY, v);
      } catch {
        /* see get */
      }
    },
  },
  reload: () => {
    const at = reloadAt();
    if (at && location.hash !== at) history.replaceState(history.state, "", at);
    location.reload();
  },
  // Vite's import helper asks for a file's stylesheet once per page: after a failed try it never asks again, and the
  // screen would draw unstyled. So a stylesheet that failed is fetched here before the screen is tried again.
  restyle: (hrefs) =>
    Promise.all(
      hrefs.map(
        (href) =>
          new Promise<void>((ok, fail) => {
            for (const l of [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]) if (l.href === href) l.remove();
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.crossOrigin = "";
            link.href = href;
            link.addEventListener("load", () => ok());
            link.addEventListener("error", () => (link.remove(), fail(new Error(`Unable to preload CSS for ${href}`))));
            document.head.appendChild(link);
          }),
      ),
    ).then(() => undefined),
  // Out of the promise chain, so it reaches the page as an uncaught error like any other.
  rethrow: (e) => void setTimeout(() => {
    throw e;
  }),
};
let page: Page = realPage;

/** For tests: other loaders and another page; returns to the real ones with no arguments. Forgets every screen. */
export function screensForTest(loader?: (name: ScreenName) => Promise<unknown>, p?: Partial<Page>): void {
  loaderOf = loader ?? ((name) => LOADERS[name]());
  page = { ...realPage, ...p };
  for (const n of SCREENS) entries.set(n, { status: "idle", wanted: 0, since: 0 });
  changed();
}

/** App says where a reload should land: the address of the place that was asked for. */
export function setReloadAddress(f: () => string | null): void {
  reloadAt = f;
}

/**
 * What a browser says when a module's file (or the styles that travel with it) can't be fetched or isn't a script:
 * Chromium "Failed to fetch dynamically imported module", Firefox "error loading dynamically imported module", Safari
 * "Importing a module script failed" or "… is not a valid JavaScript MIME type", Vite "Unable to preload CSS for …".
 * Anything else a loader rejects with was thrown by the screen's own code.
 */
export function isLoadError(e: unknown): boolean {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /dynamically imported module|importing a module script failed|module script|MIME type|preload CSS/i.test(text);
}

/** The screens this page has already reloaded for. */
const noted = (): string[] => (page.note.get() ?? "").split(",").filter(Boolean);

async function failedLoad(name: ScreenName, e: unknown): Promise<void> {
  const en = entries.get(name)!;
  const fail = (why: Failed) => {
    Object.assign(en, { status: "failed", why });
    delete en.promise;
    seen(en);
  };
  if (!isLoadError(e)) {
    // The screen's own code threw: not a missing file. Asked again, it is tried again.
    Object.assign(en, { status: "idle", threw: true });
    delete en.promise;
    seen(en);
    return page.rethrow(e);
  }
  const css = /Unable to preload CSS for (\S+)/.exec(e instanceof Error ? e.message : "")?.[1];
  if (css) en.styles = [...new Set([...(en.styles ?? []), css])];
  if (!page.online() || !(await page.reach())) return fail("offline");
  // Wanted on screen now (not only fetched ahead): one reload picks up a release. Fetched ahead, it waits to be asked.
  // Retry pressed and the file still can't be had: a browser may remember a failed file for as long as the page
  // lives, so Retry reloads too, once per press.
  if (en.wanted > 0 && (en.retry || !noted().includes(name))) {
    page.note.set([...new Set([...noted(), name])].join(","));
    // The note couldn't be written (storage full): no reload, or nothing would stop the next one.
    if (noted().includes(name)) return page.reload();
  }
  fail("missing");
}

/** Starts fetching a screen (once) and resolves when it is ready or has failed. */
export function loadScreen(name: ScreenName, retry = false): Promise<void> {
  const en = entries.get(name)!;
  if (en.status === "ready") return Promise.resolve();
  if (en.promise) return en.promise;
  Object.assign(en, { status: "loading", since: Date.now(), retry });
  delete en.why;
  delete en.threw;
  en.promise = (en.styles?.length ? page.restyle(en.styles).then(() => loaderOf(name)) : loaderOf(name)).then(
    (mod) => {
      Object.assign(en, { status: "ready", mod });
      delete en.styles;
      // This screen loaded: if it fails in a later release, the app may reload once for it again.
      const rest = noted().filter((n) => n !== name);
      if (rest.length !== noted().length) page.note.set(rest.length ? rest.join(",") : null);
      seen(en);
    },
    (e) => failedLoad(name, e),
  );
  seen(en);
  return en.promise;
}

/** Fetches a screen ahead of its being asked for (a tab's hover or focus). Never a new try of one that failed: that is Retry's, or asking for it. */
export function fetchAhead(name: ScreenName): void {
  if (entries.get(name)!.status === "idle") void loadScreen(name);
}
/** Asked for again (its tab clicked, its key pressed) after it failed: one more try, with no reload beyond the usual one. */
export function tryAgain(names: readonly ScreenName[]): void {
  for (const n of names) if (entries.get(n)!.status === "failed") void loadScreen(n);
}
/** Its file is on its way (asked for and not yet in or failed). */
export const screenArriving = (name: ScreenName) => entries.get(name)!.status === "loading";

/** A screen's module once it has loaded, else null. Asking doesn't fetch it. */
export function screen<K extends ScreenName>(name: K): ScreenModule<K> | null {
  const en = entries.get(name)!;
  return en.status === "ready" ? (en.mod as ScreenModule<K>) : null;
}
export const screenReady = (name: ScreenName) => entries.get(name)!.status === "ready";
export const screensReady = (names: readonly ScreenName[]) => names.every(screenReady);

/** Marks screens as asked for on screen now (so the line can say Loading or failed for them) and fetches them. Returns the undo. */
export function wantScreens(names: readonly ScreenName[]): () => void {
  for (const n of names) {
    const en = entries.get(n)!;
    en.wanted++;
    // Failed while only fetched ahead, or failed before: asking is a new try.
    if (en.status === "idle" || (en.status === "failed" && en.wanted === 1)) void loadScreen(n);
  }
  if (names.length) changed();
  return () => {
    for (const n of names) entries.get(n)!.wanted--;
    if (names.length) changed();
  };
}

export type Waiting = { /** Asked for and still arriving: when the first of them was asked. */ since: number | null; failed: Failed | null };
let lastWaiting: Waiting = { since: null, failed: null };
/** What is asked for on screen and not there yet. */
export function waiting(): Waiting {
  let since: number | null = null;
  let failed: Failed | null = null;
  for (const en of entries.values()) {
    if (en.wanted <= 0) continue;
    if (en.status === "loading") since = since === null ? en.since : Math.min(since, en.since);
    else if (en.status === "failed") failed = failed === "offline" ? failed : (en.why ?? "missing");
  }
  if (since !== lastWaiting.since || failed !== lastWaiting.failed) lastWaiting = { since, failed };
  return lastWaiting;
}

/** Retry on the line: every asked-for screen that failed is fetched again. */
export function retryScreens(): void {
  for (const [n, en] of entries) if (en.wanted > 0 && en.status === "failed") void loadScreen(n, true);
}

/**
 * A screen that opens over the place (a dialog or a panel): asked for while `wanted`, its module once the file is in,
 * null until then. The caller draws nothing for it meanwhile, so the place under it stays as it is.
 */
export function useScreen<K extends ScreenName>(name: K, wanted: boolean): ScreenModule<K> | null {
  useScreens();
  useEffect(() => (wanted ? wantScreens([name]) : undefined), [name, wanted]);
  return wanted ? screen(name) : null;
}

/** Rerenders when any screen's state changes. */
export const useScreens = (): number => useSyncExternalStore(subscribe, () => version, () => 0);
export const useWaiting = (): Waiting => useSyncExternalStore(subscribe, waiting, () => lastWaiting);

/**
 * The place to draw: the place asked for once its screens are in, until then the place drawn before (the screen the
 * person was on stays). With nothing drawn yet (the app opening at an address) it is the asked place, whose screen
 * area is empty under the loader; if its file then fails, `home`.
 */
export function drawnLoc<L>(asked: L, needs: (l: L) => readonly ScreenName[], last: L | null, home: L): L {
  const names = needs(asked);
  if (screensReady(names)) return asked;
  if (last !== null) return last;
  return names.some((n) => entries.get(n)!.status === "failed" || entries.get(n)!.threw) ? home : asked;
}

type Connection = { saveData?: boolean; effectiveType?: string };
/** The browser reports a slow connection or one where data is being saved: nothing is fetched ahead in the background. */
export function slowOrMetered(c: Connection | undefined = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connection }).connection): boolean {
  return !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g");
}

let prefetching = false;
/**
 * Once the first screen is usable: the other screens' files, one at a time while the page is idle, in BACKGROUND's
 * order, so a tab's key or click shows it at once. Not on a slow or metered connection (then a tab's file is fetched
 * on hover, focus or its key), and not offline. A file that fails here says nothing: it is tried again when asked for.
 *
 * `html[data-screens]` says where this stands, for the browser tests and the timing script, which press keys the
 * moment the app opens: "in" once the background fetching is done, "asked" when there is none on this connection.
 */
export function prefetchScreens(names: readonly ScreenName[] = BACKGROUND, idle: (f: () => void) => void = whenIdle): void {
  const mark = (v: string) => typeof document !== "undefined" && (document.documentElement.dataset.screens = v);
  if (prefetching) return;
  if (slowOrMetered() || !page.online()) return void mark("asked");
  prefetching = true;
  const rest = [...names];
  const next = () => {
    const n = rest.shift();
    if (!n) return void ((prefetching = false), mark("in"));
    if (screenReady(n)) return next();
    idle(() => void loadScreen(n).then(next));
  };
  next();
}

function whenIdle(f: () => void): void {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  // At most a second's wait per file, so on a page that is never idle the files are still in within a quarter of a minute.
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 1000 });
  else setTimeout(f, 200);
}
