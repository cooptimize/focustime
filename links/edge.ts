// Opening work item links in the client's Edge profile (step 5.5). Pure apart from detectEdge's file reads.
// Edge's Local State is read for profile directory and display name only, never anything else.
import type { EdgeConfig } from "../config/schema.ts";

export type EdgeInstall = { install: "native" | "flatpak"; command: string[]; profilesDir: string; desktopFile: string };
export type EdgeProfile = { directory: string; name: string };

/** Profile directory names Edge uses ("Default", "Profile 3"), plus plain custom names. Never a flag. */
export const PROFILE_DIR = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

const DESKTOP_FILES = ["microsoft-edge.desktop", "com.microsoft.Edge.desktop"];

/** The launch command and profile location for the Edge install a .desktop Exec line points at. */
export function installFromDesktop(execLine: string, home: string, desktopFile: string): EdgeInstall | null {
  const words = execLine.trim().split(/\s+/).filter((w) => !/^%[a-zA-Z]$/.test(w));
  if (!words.length) return null;
  const flatpak = words[0]!.endsWith("flatpak") ? words.indexOf("com.microsoft.Edge") : -1;
  if (flatpak > 0) {
    // Keep the flatpak run options (e.g. --branch), drop Edge's own flags from the entry.
    const cmd = words.slice(0, flatpak + 1).filter((w, i) => i === 0 || w === "run" || w.startsWith("--branch") || w.startsWith("--arch") || w === "com.microsoft.Edge");
    return { install: "flatpak", command: cmd, profilesDir: `${home}/.var/app/com.microsoft.Edge/config/microsoft-edge`, desktopFile };
  }
  if (/microsoft-edge(-stable|-beta|-dev)?$/.test(words[0]!)) {
    const channel = words[0]!.match(/microsoft-edge(-beta|-dev)?/)![1] ?? "";
    return { install: "native", command: [words[0]!], profilesDir: `${home}/.config/microsoft-edge${channel}`, desktopFile };
  }
  return null;
}

/** Find Edge from its .desktop entry: user entries first, then Flatpak exports, then system ones. */
export function detectEdge(readText: (path: string) => string | null, home: string): EdgeInstall | null {
  const dirs = [`${home}/.local/share/applications`, `${home}/.local/share/flatpak/exports/share/applications`, "/var/lib/flatpak/exports/share/applications", "/usr/share/applications"];
  for (const dir of dirs)
    for (const f of DESKTOP_FILES) {
      const path = `${dir}/${f}`;
      const text = readText(path);
      const exec = text?.match(/^Exec=(.*)$/m)?.[1];
      const found = exec ? installFromDesktop(exec, home, path) : null;
      if (found) return found;
    }
  return null;
}

/** Profile directory and display name from Local State. Every other field is ignored. */
export function profilesFromLocalState(text: string): EdgeProfile[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const cache = (raw as { profile?: { info_cache?: unknown } })?.profile?.info_cache;
  if (typeof cache !== "object" || cache === null) return [];
  return Object.entries(cache as Record<string, unknown>)
    .map(([directory, v]) => ({ directory, name: typeof (v as { name?: unknown })?.name === "string" ? ((v as { name: string }).name) : directory }))
    .filter((p) => PROFILE_DIR.test(p.directory))
    .sort((a, b) => a.directory.localeCompare(b.directory, "en", { numeric: true }));
}

/** A work item link must be on the client's own DevOps organization. Returns the normalized URL or why not. */
export function checkDevOpsUrl(url: unknown, org: string | null): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof url !== "string" || url.length > 2000) return { ok: false, error: "url must be text" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: "Not a valid link" };
  }
  if (u.protocol !== "https:" || u.hostname !== "dev.azure.com" || u.port || u.username || u.password) return { ok: false, error: "Only Azure DevOps links (https://dev.azure.com/...) can be opened" };
  if (!org) return { ok: false, error: "This client's DevOps organization is not known yet. Refresh and try again" };
  const first = decodeURIComponent(u.pathname.split("/")[1] ?? "");
  if (first.toLowerCase() !== org.toLowerCase()) return { ok: false, error: "That link is not in this client's DevOps organization" };
  return { ok: true, url: u.href };
}

export type LaunchPlan = { argv: string[]; profile: string | null; notice: string | null };

/** The argument array to run: Edge with the client's profile, or the default browser with a notice. */
export function launchPlan(edge: EdgeConfig, clientKey: string, clientName: string, url: string): LaunchPlan {
  const profile = Object.hasOwn(edge.profiles, clientKey) ? edge.profiles[clientKey]! : null;
  if (profile && edge.command.length) return { argv: [...edge.command, `--profile-directory=${profile}`, url], profile, notice: null };
  return { argv: [...edge.fallbackCommand, url], profile: null, notice: `No Edge profile set for ${clientName}` };
}
