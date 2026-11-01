// Host adapter for browsers (step 12, Q63): finding Edge and Chromium and their profiles, and the argument array that
// opens a client's work item link. Machine-specific, so it lives here and reaches actions/ only as ActionContext.host.
import type { AppConfig } from "../config/schema.ts";
import { detectChromium, detectEdge, launchPlan, profilesFromLocalState } from "../links/edge.ts";
import type { HostBrowsers } from "../actions/types.ts";

export function createHostBrowsers(o: { readText: (path: string) => string | null; home: string }): HostBrowsers {
  const profiles = (dir: string | undefined) => (dir ? profilesFromLocalState(o.readText(`${dir}/Local State`) ?? "") : []);
  return {
    detect: () => {
      const edge = detectEdge(o.readText, o.home);
      const chromium = detectChromium(o.readText, o.home);
      return { edge: { found: !!edge, profiles: profiles(edge?.profilesDir) }, chromium: { found: !!chromium, profiles: profiles(chromium?.profilesDir), command: chromium?.command ?? null } };
    },
    linkCommand: (cfg: AppConfig, clientKey: string, url: string) => {
      const setting = cfg.clientSettings[clientKey];
      const p = launchPlan(cfg.edge, clientKey, setting?.name ?? clientKey, url, { setting, chromium: cfg.chromium.command });
      return { argv: p.argv, profile: p.profile, notice: p.notice, browser: p.profile ? (setting?.browser === "chromium" ? "chromium" : "edge") : "default" };
    },
  };
}
