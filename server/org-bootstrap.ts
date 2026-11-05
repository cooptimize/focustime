// ADM-1: the one-time move of team settings out of people's own settings, at the first start of this build (marked
// done in org_settings, scope "meta"; it never runs again). Each person's settings and house styles are read through
// their own scoped stores. What it does, each change audited so an admin can review it in Admin › Audit:
//   AI for FocusTime     on if anyone had Use AI on (note "migrated").
//   Allow AI per client  allowed if anyone allowed it (note "migrated").
//   States open          each client's: everyone's together (note "migrated").
//   Team colors          each client's: the color most people chose (note "migrated"); a person whose color is the
//                        team's then follows the team (theirs is cleared); a different one stays as their override.
//   House styles         each client's: the most recently edited style (note "migrated"); everyone else's different
//                        edit is audited as "replaced by team style" with its text, so nothing is lost silently.
//   Phrases              the team's lists are the built-in ones; each person keeps only what they added on top; the
//                        old poll_minutes goes.
//   Process (WT-1)       each person's pickable_portfolio_types and background_types (lists for all their clients) go
//                        into each of their clients' no_breakdown and background Rules, together (note "migrated");
//                        their clients are the ones in their settings or Dataverse's, else every client known. The two
//                        old settings go from people's own settings.
// Use AI, the monthly cap and Allow AI stay in people's rows (never read again; D468: nothing is dropped here).
import { clientScope, onlyMine } from "../config/org.ts";
import { removeValue, setValue } from "../config/edit.ts";
import { settingsEdit } from "../config/settings.ts";
import type { AppConfig } from "../config/schema.ts";
import type { HouseStyle } from "../plan/stories.ts";
import { FOCUSTIME, type AdminStore } from "../store/admin-store.ts";
import { DEFAULT_ACK_PHRASES, DEFAULT_PROMISE_PHRASES, DEFAULT_REQUEST_PHRASES } from "../plan/asks.ts";
import type { Logger } from "../log/logger.ts";

export const BOOTSTRAP_MARK = { scope: "meta", key: "org_bootstrap_v1" } as const;

export type BootstrapPerson = {
  id: string;
  name: string;
  config: AppConfig | null;
  houseStyles: HouseStyle[];
  /** Runs a settings edit on the person's own text (validated; false when it didn't save). */
  write: (edit: (text: string) => string) => Promise<boolean>;
};

export type BootstrapResult = { ran: boolean; people: number; aiOn: boolean; allowed: string[]; colors: number; styles: number; replaced: number; processClients: number };

export async function orgBootstrap(d: { store: AdminStore; people: () => Promise<BootstrapPerson[]>; log?: Logger }): Promise<BootstrapResult> {
  const none: BootstrapResult = { ran: false, people: 0, aiOn: false, allowed: [], colors: 0, styles: 0, replaced: 0, processClients: 0 };
  if (await d.store.orgRow(BOOTSTRAP_MARK.scope, BOOTSTRAP_MARK.key)) return none;
  const people = (await d.people()).filter((p) => p.config);
  const cfgs = people.map((p) => p.config!);
  const set = (scope: string, key: string, value: unknown, area: string, target: string, note = "migrated") => d.store.setOrg({ scope, key, value, actor: FOCUSTIME, area, target, note });

  // AI: on if anyone had it on; a client allowed if anyone allowed it.
  const aiOn = cfgs.some((c) => c.ai.use);
  await set("org", "ai.on", aiOn, "ai", "Everyone");
  const allowed = [...new Set(cfgs.flatMap((c) => c.ai.allowedClients))].sort();
  for (const k of allowed) await set(clientScope(k), "allow_ai", true, "ai", k);

  // States treated as open: everyone's together, per client.
  const open = new Map<string, Set<string>>();
  for (const c of cfgs) for (const [k, v] of Object.entries(c.clientSettings)) for (const s of v.openStates) (open.get(k) ?? open.set(k, new Set()).get(k)!).add(s);
  for (const [k, states] of open) if (states.size) await set(clientScope(k), "open_states", [...states].sort(), "clients", k);

  // Team colors: the most common choice per client (ties: the first in name order).
  const votes = new Map<string, Map<string, number>>();
  for (const c of cfgs) for (const [k, v] of Object.entries(c.clientSettings)) if (v.color) votes.set(k, (votes.get(k) ?? new Map()).set(v.color, ((votes.get(k)?.get(v.color)) ?? 0) + 1));
  const team = new Map<string, string>();
  for (const [k, m] of votes) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    team.set(k, best[0]);
    await set(clientScope(k), "color", best[0], "clients", k);
  }

  // House styles: the newest edit per client wins; the others are kept in the audit.
  const edits = people.flatMap((p) => p.houseStyles.filter((h) => h.edited).map((h) => ({ person: p, h })));
  const byClient = new Map<string, typeof edits>();
  for (const e of edits) byClient.set(e.h.clientKey, [...(byClient.get(e.h.clientKey) ?? []), e]);
  let styles = 0;
  let replaced = 0;
  for (const [k, list] of byClient) {
    const sorted = [...list].sort((a, b) => (b.h.editedAt ?? "").localeCompare(a.h.editedAt ?? "") || a.person.name.localeCompare(b.person.name));
    const win = sorted[0]!;
    await set(clientScope(k), "house_style", win.h.edited, "clients", k, `migrated from ${win.person.name}`);
    styles++;
    for (const other of sorted.slice(1)) {
      if (other.h.edited === win.h.edited) continue;
      await d.store.audit(FOCUSTIME, { area: "clients", target: `${other.person.name} · ${k}`, setting: `client:${k}/house_style`, oldValue: JSON.stringify(other.h.edited), newValue: JSON.stringify(win.h.edited), note: "replaced by team style" });
      replaced++;
    }
  }

  // Process overrides: each person's lists, for each of their clients, together.
  const dirClients = await d.store.peopleClients().catch(() => []);
  const known = [...new Set([...cfgs.flatMap((c) => Object.keys(c.clientSettings)), ...dirClients.map((c) => c.clientKey)])];
  const proc = new Map<string, { noBreakdown: Map<string, string>; background: Map<string, string> }>();
  for (const p of people) {
    const c = p.config!;
    if (!c.plan.pickablePortfolioTypes.length && !c.plan.backgroundTypes.length) continue;
    const mine = [...new Set([...Object.keys(c.clientSettings), ...dirClients.filter((x) => x.personId === p.id.toLowerCase()).map((x) => x.clientKey)])];
    for (const k of mine.length ? mine : known) {
      const e = proc.get(k) ?? proc.set(k, { noBreakdown: new Map(), background: new Map() }).get(k)!;
      for (const t of c.plan.pickablePortfolioTypes) if (!e.noBreakdown.has(t.toLowerCase())) e.noBreakdown.set(t.toLowerCase(), t);
      for (const t of c.plan.backgroundTypes) if (!e.background.has(t.toLowerCase())) e.background.set(t.toLowerCase(), t);
    }
  }
  for (const [k, e] of [...proc].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (e.noBreakdown.size) await set(clientScope(k), "no_breakdown", [...e.noBreakdown.values()].sort(), "clients", k);
    if (e.background.size) await set(clientScope(k), "background", [...e.background.values()].sort(), "clients", k);
  }

  // Each person: phrases to their own additions, no poll_minutes, a color equal to the team's follows the team.
  const teamLists = { request_phrases: DEFAULT_REQUEST_PHRASES, ack_phrases: DEFAULT_ACK_PHRASES, promise_phrases: DEFAULT_PROMISE_PHRASES } as const;
  for (const p of people) {
    const c = p.config!;
    const mine = { request_phrases: c.mine.requestPhrases, ack_phrases: c.mine.ackPhrases, promise_phrases: c.mine.promisePhrases };
    const same = Object.entries(c.clientSettings).filter(([k, v]) => v.color && team.get(k) === v.color);
    const edit = (text: string) => {
      let t = removeValue(text, "asks", "poll_minutes");
      t = removeValue(removeValue(t, "plan", "pickable_portfolio_types"), "plan", "background_types");
      for (const [k, list] of Object.entries(mine) as [keyof typeof teamLists, string[] | null][]) {
        if (list === null) continue;
        const add = onlyMine(teamLists[k], list);
        t = add.length ? setValue(t, "asks", k, add) : removeValue(t, "asks", k);
      }
      for (const [k, v] of same) t = settingsEdit("client", { key: k, color: "", name: v.name, follow: v.follow })(t);
      return t;
    };
    const ok = await p.write(edit).catch(() => false);
    if (!ok) d.log?.({ source: "plan", op: "org_bootstrap", kind: "person_not_rewritten" });
  }

  await d.store.setOrg({ scope: BOOTSTRAP_MARK.scope, key: BOOTSTRAP_MARK.key, value: { at: new Date().toISOString(), people: people.length }, actor: FOCUSTIME, area: "organization", target: "Everyone", note: "team settings moved from people's own settings" });
  d.log?.({ source: "plan", op: "org_bootstrap", kind: "done", count: people.length });
  return { ran: true, people: people.length, aiOn, allowed, colors: team.size, styles, replaced, processClients: proc.size };
}
