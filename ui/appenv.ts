// ST-1: which FocusTime this page runs in, from /version.
import { useEffect, useState } from "react";

/** The app's environment from /version, asked once per page ("prod" when it can't be read). */
let envCache: Promise<string> | null = null;
const askEnv = (): Promise<string> =>
  (envCache ??= fetch("/version", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ env?: string }>) : Promise.reject(new Error(String(r.status)))))
    .then((b) => b.env ?? "prod", () => "prod"));

/** The app's environment from /version ("local" is the developer loop; "dev" and "prod" are hosted), null while asking. */
export function useAppEnv(): string | null {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void askEnv().then((e) => live && setEnv(e));
    return () => void (live = false);
  }, []);
  return env;
}
/** ST-1: developer-loop-only things (the demo switch, the style guide, config wording) show only there. */
export const useDeveloperLoop = () => useAppEnv() === "local";

/**
 * EV-1: the top bar's mark. Only a page the server marked as a test site (`data-site="test"`, server/site-env.ts: dev
 * and local) asks /version; production's page isn't marked, so it asks nothing new. Null while asking, when /version
 * fails, and anywhere but dev and local: no mark is ever guessed.
 */
export type SiteMark = { word: "Dev" | "Local"; say: string };
export const SITE_MARKS: Record<"dev" | "local", SiteMark> = {
  dev: { word: "Dev", say: "This is FocusTime's dev site, not production." },
  local: { word: "Local", say: "This is FocusTime's developer loop on this computer, not production." },
};
export const siteMarkOf = (env: string | null): SiteMark | null => (env === "dev" || env === "local" ? SITE_MARKS[env] : null);
const testSite = () => typeof document !== "undefined" && document.documentElement.dataset.site === "test";
export function useSiteMark(): SiteMark | null {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    if (!testSite()) return;
    let live = true;
    void askEnv().then((e) => live && setEnv(e));
    return () => void (live = false);
  }, []);
  return siteMarkOf(env);
}

/** EV-1: About's line: the environment in a word and the site's address ("Dev · focustime-dev.example.com"). */
export const SITE_WORDS: Record<string, string> = { dev: "Dev", local: "Local", prod: "Production", demo: "Demo" };
export function siteLine(env: string, host: string): string {
  return `${SITE_WORDS[env] ?? env} · ${host}`;
}
