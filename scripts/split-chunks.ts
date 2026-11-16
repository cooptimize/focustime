// PF-1: how the build groups the UI's modules into files (vite.config.ts uses it).
// - `boot`: Vite's own import() helper, a few hundred bytes the page's entry and every other file use.
// - `main`: every module ui/main.tsx reaches through static imports. That is the first download's script: Day, Week,
//   the top bar and what they need, in one file.
// - a file per screen that loads when first opened (each import() in ui/screens.ts), holding what only it uses.
//   A screen another screen uses (Quick capture's box inside the Inbox) stays its own file, and that screen imports it.
// - `guide-text`: the Guide's words and frame, which the Guide, its tours and the Technical docs share and nothing
//   else needs.
// - `shared`: what two or more of those screens use and `main` doesn't hold (form controls mostly), in one file
//   loaded once.
// The set for `main` is read from the module graph when the build has loaded every module (buildEnd), before the
// files are cut, so it follows the imports as they are and needs no list kept by hand.
import type { Plugin } from "vite";

const START = "/ui/main.tsx";
/**
 * What must stay out of both groups: the Temporal polyfill (its own file, fetched only where the browser has no
 * Temporal) and Vite's import() helper, which the page's entry (ui/boot.ts) uses before the app's code may run. In
 * `main`, the entry would import `main` to reach it, and the whole app would run before the polyfill is in (D445).
 */
const early = (id: string) => id.includes("temporal-polyfill") || id.includes("vite/preload-helper") || id.includes("vite/modulepreload-polyfill");

export function firstDownload(): { plugin: Plugin; groups: { name: string; test: (id: string) => boolean; priority: number; minShareCount?: number }[] } {
  const first = new Set<string>();
  /** The modules import() names: each screen's own file. */
  const screens = new Set<string>();
  const plugin: Plugin = {
    name: "focustime-first-download-chunks",
    apply: "build",
    buildStart() {
      first.clear();
      screens.clear();
    },
    buildEnd() {
      for (const id of this.getModuleIds()) if (this.getModuleInfo(id)?.dynamicImporters.length) screens.add(id);
      const start = [...this.getModuleIds()].find((id) => id.endsWith(START));
      if (!start) return;
      const queue = [start];
      while (queue.length) {
        const id = queue.pop()!;
        if (first.has(id)) continue;
        first.add(id);
        queue.push(...(this.getModuleInfo(id)?.importedIds ?? []));
      }
    },
    // The page names `main` and its styles so the browser fetches them alongside the entry instead of after it has
    // run (one round trip sooner on a slow connection). A preload only fetches: nothing of `main` runs until the
    // entry imports it, after the Temporal check. Link tags only, no inline script (the content security policy).
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const files = Object.values(ctx.bundle ?? {});
        const main = files.find((f) => f.type === "chunk" && f.name === "main");
        if (!main || main.type !== "chunk") return [];
        const css = [...((main as unknown as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? [])];
        return [
          ...[...main.imports.filter((f) => f.endsWith(".js") && !html.includes(f)), main.fileName].map((f) => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `/${f}` }, injectTo: "head" as const })),
          ...css.map((f) => ({ tag: "link", attrs: { rel: "preload", as: "style", crossorigin: true, href: `/${f}` }, injectTo: "head" as const })),
        ];
      },
    },
  };
  return {
    plugin,
    groups: [
      { name: "boot", test: (id) => early(id) && !id.includes("temporal-polyfill"), priority: 30 },
      { name: "main", test: (id) => first.has(id) && !early(id), priority: 20 },
      { name: "guide-text", test: (id) => id.includes("/ui/guide/") && !first.has(id) && !screens.has(id), priority: 15, minShareCount: 2 },
      { name: "shared", test: (id) => !first.has(id) && !screens.has(id) && !early(id), priority: 10, minShareCount: 2 },
    ],
  };
}
