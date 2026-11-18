// EV-1: the dev site says so. On dev and in the developer loop (local) the page and the manifest are rewritten once,
// when the server starts: the tab's title starts with "Dev · " (or "Local · "), the installed app is named
// "FocusTime Dev" (name, short name and iOS's home screen title), and the page carries `data-site="test"`, which tells
// the app to ask /version for the top bar's mark. Production (and the demo label, and a build with no label given)
// gets the files exactly as built: not a byte changes and the app asks nothing new there.
import type { BuildEnv } from "./buildinfo.ts";

export type MarkedEnv = "dev" | "local";
/** The word each marked environment shows (the top bar's mark, the title, the installed name). */
export const SITE_WORD: Record<MarkedEnv, string> = { dev: "Dev", local: "Local" };

/** The environment that gets a mark, or null (production, the demo label, none given). */
export function markedEnv(env: BuildEnv | string | null | undefined): MarkedEnv | null {
  return env === "dev" || env === "local" ? env : null;
}

/** The page for this environment: unchanged unless marked. Each rewrite must find its target, or the page is left as built. */
export function sitePage(html: string, env: BuildEnv | string | null | undefined): string {
  const m = markedEnv(env);
  if (!m) return html;
  const word = SITE_WORD[m];
  const swaps: [RegExp, string][] = [
    [/<html lang="en">/, `<html lang="en" data-site="test">`],
    [/<title>FocusTime<\/title>/, `<title>${word} · FocusTime</title>`],
    [/<meta name="apple-mobile-web-app-title" content="FocusTime" \/>/, `<meta name="apple-mobile-web-app-title" content="FocusTime ${word}" />`],
  ];
  let out = html;
  for (const [from, to] of swaps) {
    if (!from.test(out)) return html;
    out = out.replace(from, to);
  }
  return out;
}

/** The manifest for this environment: name and short name "FocusTime Dev" when marked; everything else (the id, the icons) as built. */
export function siteManifest(json: string, env: BuildEnv | string | null | undefined): string {
  const m = markedEnv(env);
  if (!m) return json;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const name = `FocusTime ${SITE_WORD[m]}`;
    return `${JSON.stringify({ ...parsed, name, short_name: name }, null, 2)}\n`;
  } catch {
    return json;
  }
}
