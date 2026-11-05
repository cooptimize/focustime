// ADM-1: a person's settings with the team's applied. Pure. Rules replace the person's value; Defaults and Defaults by
// level apply where the person set nothing of their own; Personal settings are untouched. What this person sees as
// "Set by your FocusTime admin" comes from the OrgView it leaves on the config.
import type { AppConfig } from "./schema.ts";
import { colorCss } from "./schema.ts";
import { clientRules, guidanceFor, LEVEL_NAMES, teamColors, withMine, type ClientRules, type Guidance, type Level, type OrgRules } from "./org.ts";
import type { LevelSource } from "../plan/levels.ts";

export type { Guidance } from "./org.ts";

/** What Settings shows as the team's, and what the rest of FocusTime reads instead of the person's own value. */
export type OrgView = {
  level: Level | null;
  levelName: string | null;
  levelSource: LevelSource | null;
  /** The person's guidance, resolved (their choice, else their level's default, else the built-in one). */
  guidance: Guidance;
  /** Their level's defaults (what "Reset to team default" goes back to). */
  levelGuidance: Guidance;
  /** Each client's team color (a palette slot or a hex). */
  teamColors: Record<string, string>;
  phrases: { team: { request: string[]; ack: string[]; promise: string[] }; mine: { request: string[]; ack: string[]; promise: string[] } };
  rules: {
    aiOn: boolean;
    allowedClients: string[];
    personCapUsd: number;
    inviteDomains: string[];
    neverSuggest: string[];
    pollMinutes: number;
    retentionDays: number;
    chatAiDailyCap: number;
    retentionYears: number;
  };
  clients: Record<string, ClientRules>;
};

export type PersonOrg = { level: Level | null; levelSource: LevelSource | null };

const uniq = (xs: readonly string[]) => [...new Set(xs)];

export function applyOrg(cfg: AppConfig, rules: OrgRules, who: PersonOrg): AppConfig {
  const team = teamColors(rules);
  const colorKeys = uniq([...Object.keys(team), ...Object.keys(cfg.clientSettings)]);
  const clients: Record<string, string> = {};
  for (const k of colorKeys) {
    const c = cfg.clientSettings[k]?.color ?? team[k] ?? null;
    if (c) clients[k] = colorCss(c);
  }
  const clientSettings = Object.fromEntries(Object.entries(cfg.clientSettings).map(([k, v]) => [k, { ...v, openStates: [...clientRules(rules, k).openStates] }]));
  const conv = rules.conversations;
  const mine = { request: cfg.mine.requestPhrases ?? [], ack: cfg.mine.ackPhrases ?? [], promise: cfg.mine.promisePhrases ?? [] };
  const guidance = guidanceFor(rules, who.level, cfg.guidance);
  const levelGuidance = guidanceFor(rules, who.level, {});
  const org: OrgView = {
    level: who.level,
    levelName: who.level ? LEVEL_NAMES[who.level] : null,
    levelSource: who.levelSource,
    guidance,
    levelGuidance,
    teamColors: team,
    phrases: { team: { request: conv.requestPhrases, ack: conv.ackPhrases, promise: conv.promisePhrases }, mine },
    rules: {
      aiOn: rules.ai.on,
      allowedClients: rules.ai.allowedClients,
      personCapUsd: rules.ai.personCapUsd,
      inviteDomains: rules.organization.inviteDomains,
      neverSuggest: rules.organization.neverSuggest,
      pollMinutes: conv.pollMinutes,
      retentionDays: conv.retentionDays,
      chatAiDailyCap: conv.chatAiDailyCap,
      retentionYears: rules.organization.retentionYears,
    },
    clients: rules.clients,
  };
  return {
    ...cfg,
    clients,
    clientSettings,
    aiRules: { on: rules.ai.on, allowedClients: rules.ai.allowedClients, personCapUsd: rules.ai.personCapUsd, appCapUsd: rules.ai.appCapUsd, model: rules.ai.model },
    asks: {
      ...cfg.asks,
      pollMinutes: conv.pollMinutes,
      requestPhrases: withMine(conv.requestPhrases, mine.request),
      ackPhrases: withMine(conv.ackPhrases, mine.ack),
      promisePhrases: withMine(conv.promisePhrases, mine.promise),
    },
    collab: {
      ...cfg.collab,
      domains: rules.organization.inviteDomains.length ? [...rules.organization.inviteDomains] : cfg.collab.domains,
      exclude: uniq([...rules.organization.neverSuggest, ...(cfg.mine.exclude ?? [])]),
    },
    org,
  };
}

/** The DevOps states a client's items count as open although DevOps files them as done (a Rule). */
export const openStatesOf = (cfg: AppConfig, clientKey: string): string[] => cfg.org?.clients[clientKey]?.openStates ?? cfg.clientSettings[clientKey]?.openStates ?? [];
