// SA-5: the command menu's Settings results: the same search as Settings' box (ui/settings/search.ts), in the same
// order, as menu rows. A setting opens at its place; a client's page asks which client; Admin's (admins only) open in
// Admin; something that isn't a setting says where it is. What is typed stays in this browser.
import type { MenuItem, MenuStep } from "../menu.ts";
import { landOn } from "./landing.ts";
import { search, type SearchOpts, type SearchResult } from "./search.ts";

export type SettingsMenuEnv = { openSettings: (section?: string, setting?: string) => void; clients: readonly { key: string; name: string }[]; go: (href: string) => void };

export function settingsResults(q: string, opts: SearchOpts, env: SettingsMenuEnv): MenuItem[] {
  return search(q, opts).map((r) => item(r, env));
}

function item(r: SearchResult, env: SettingsMenuEnv): MenuItem {
  const base = { id: `settings.${r.id}`, group: "Settings", label: r.kind === "admin" ? `${r.label} (Admin)` : r.label, hint: r.kind === "answer" ? (r.answer ?? "") : r.where };
  if (r.kind === "client") {
    const which = (c: { key: string; name: string }) => () => (landOn(r.setting ?? null), env.openSettings("client", c.key));
    if (env.clients.length === 1) return { ...base, hint: `${env.clients[0]!.name}'s page`, run: which(env.clients[0]!) };
    const step: MenuStep = { title: `${r.label}: which client?`, items: env.clients.map((c) => ({ id: `settings.client.${c.key}`, label: c.name, run: which(c) })) };
    return env.clients.length ? { ...base, hint: "A client's page", next: () => step } : { ...base, disabled: "No clients yet" };
  }
  if (r.kind === "admin" && r.href) {
    const path = r.href.replace(/^#\/admin\/?/, "");
    return { ...base, run: () => env.openSettings("admin", path || undefined) };
  }
  if (r.section) return { ...base, run: () => env.openSettings(r.section, r.setting ?? undefined) };
  if (r.href) return { ...base, run: () => env.go(r.href!) };
  return { ...base, disabled: r.answer ?? "Not in Settings" };
}
