// SA-4: the one list of Admin's settings: each stored key Admin can write (config/org.ts's ORG_SPECS, CLIENT_SPECS,
// LEVEL_SPECS and PERSON_SPECS, and the audit rows admin-store.ts writes for overrides, logins and invites), with its
// label as the page shows it, and its part and tab. The pages, Search Admin and Audit's labels read it. A key with no
// place (`part: null`) has no control on screen: its value is kept, Audit still names it. A new key with no entry
// fails ui/settings/admin/settings-list.test.ts. Pure: no React.
import type { AdminPart } from "./places.ts";

/** Who a key belongs to: the team ("org"), a client, a level, a person, or an audit row of its own. */
export type SettingScope = "org" | "client" | "level" | "person" | "audit";
/** SA-5: `words` are what people call it, for search (Settings' search for admins, and Search Admin). */
export type AdminSetting = { scope: SettingScope; key: string; label: string; part: AdminPart | null; tab: string | null; words?: readonly string[] };

const org = (key: string, label: string, part: AdminPart | null, tab: string | null, words?: readonly string[]): AdminSetting => ({ scope: "org", key, label, part, tab, ...(words ? { words } : {}) });
const client = (key: string, label: string, tab: string | null, words?: readonly string[]): AdminSetting => ({ scope: "client", key, label, part: tab ? "clients" : null, tab, ...(words ? { words } : {}) });

export const ADMIN_SETTINGS: readonly AdminSetting[] = [
  // Team defaults › AI
  org("ai.on", "AI for FocusTime", "defaults", "ai", ["turn on ai", "openai"]),
  org("ai.model", "Model", "defaults", "ai", ["gpt", "ai model"]),
  org("ai.person_cap_usd", "Monthly cap per person (US dollars)", "defaults", "ai", ["ai budget", "monthly limit", "spend limit"]),
  org("ai.app_cap_usd", "Monthly cap for everyone (US dollars)", "defaults", "ai", ["ai budget", "total spend"]),
  org("ai.standard_tasks", "Processing tier", "defaults", "ai"),
  // Team defaults › Client chats
  org("conv.request_phrases", "Asking phrases", "defaults", "chats"),
  org("conv.ack_phrases", "Thanks and short replies", "defaults", "chats"),
  org("conv.promise_phrases", "Promise phrases", "defaults", "chats"),
  org("conv.poll_minutes", "Read client chats every (minutes)", "defaults", "chats", ["polling", "poll interval"]),
  org("conv.retention_days", "Keep chat messages nothing was found in (days)", "defaults", "chats"),
  org("conv.chat_ai_daily_cap", "AI requests per chat per day", "defaults", "chats"),
  // NM-2: hidden since no list shows closed conversations; kept and still read.
  org("conv.closed_shown_days", "Closed conversations stay shown (days)", null, null),
  // Team defaults › Planning and new people
  org("org.invite_domains", "Help invites go only to", "defaults", "planning", ["invite domains", "domains"]),
  org("org.never_suggest", "Never suggested, for everyone", "defaults", "planning"),
  org("org.idle_minutes", "Counts as in use (minutes)", "defaults", "planning"),
  org("ahead.fix_top_n", "Needs attention looks at the top N of each backlog", "defaults", "planning"),
  org("org.feedback", "Send feedback goes to", "defaults", "planning", ["feedback"]),
  org("org.new_person", "New people's starting values", "defaults", "planning", ["new starter", "defaults for new people", "onboarding"]),
  // SA-4: nothing enforces it, so it left the screen; its value is kept and Health's Jobs row says it isn't enforced.
  org("org.retention_years", "Keep people's data (years)", null, null),
  // No screen sets it (the DevOps check interval comes from the app's settings until one does).
  org("devops.poll_minutes", "DevOps check interval (minutes)", null, null),
  // Team defaults › Standards
  org("standards.repo_url", "Standards repo", "defaults", "standards", ["standards"]),
  org("standards.branch", "Standards branch", "defaults", "standards"),
  // People › Levels
  org("org.position_levels", "Positions to levels", "people", "levels", ["levels", "dataverse position"]),
  // A client's page
  client("color", "Team color", "overview", ["client color", "colour"]),
  client("aliases", "Other names (aliases)", "overview", ["nickname", "other name"]),
  client("exact_case", "Match only as written", "overview"),
  client("group_without_ai", "Group messages without AI", "chats"),
  client("attachments_ai", "Send attachments to AI", "chats"),
  client("allow_ai", "Allow AI", "ai", ["ai for this client"]),
  client("source_systems", "Source systems", "ai"),
  client("house_style", "House style for Break down", "ai"),
  client("code_access", "Who can read this client's code", "code", ["code access", "who can read code"]),
  client("code_branch", "Code opens on", "code", ["opening branch", "branch", "code branch", "default branch"]),
  client("data_platform", "Data platform", "deployments"),
  client("deploy_items", "Deployment items", "deployments", ["deployment", "deploy"]),
  client("open_states", "States treated as open", "backlog"),
  client("no_breakdown", "Needs breakdown", "backlog"),
  client("background", "Background (no hours)", "backlog"),
  client("devops_scope", "Cooptimize's work in this project", "backlog"),
  client("fix_gaps", "What Needs attention counts", "backlog"),
  // Clients › All accounts
  { scope: "client", key: "treat_as_client", label: "Treat as a client", part: "clients", tab: null },
  { scope: "client", key: "hidden", label: "Hide from FocusTime", part: "clients", tab: null, words: ["hide client", "archive client"] },
  // Team defaults › Planning and new people › By level
  { scope: "level", key: "draft_stories", label: "Break down offered", part: "defaults", tab: "planning" },
  { scope: "level", key: "readiness_nudges", label: "Needs attention nudges", part: "defaults", tab: "planning" },
  // SA-3: plan_share and keep_open are no longer settings (RETIRED_KEYS); their labels stay so older Audit rows read in words.
  { scope: "level", key: "plan_share", label: "Plan up to (% of free time)", part: null, tab: null },
  { scope: "level", key: "keep_open", label: "Keep open for walk-ins (% of block hours)", part: null, tab: null },
  // People › People
  { scope: "person", key: "automation", label: "Automation account", part: "people", tab: "people", words: ["service account", "bot account"] },
  { scope: "person", key: "devops_patterns", label: "DevOps patterns (preview)", part: null, tab: null },
  // Audit rows of their own (store/admin-store.ts)
  { scope: "audit", key: "level", label: "Level", part: "people", tab: "people" },
  { scope: "audit", key: "client_lead", label: "Client lead", part: "people", tab: "people" },
  { scope: "audit", key: "devops_identity", label: "Client DevOps identity", part: "people", tab: "logins" },
  { scope: "audit", key: "invite", label: "Invite", part: "people", tab: "setup" },
];

const scopeOf = (scope: string): SettingScope | null => (scope === "org" ? "org" : scope.startsWith("client:") ? "client" : scope.startsWith("level:") ? "level" : scope.startsWith("person:") ? "person" : null);

/** A key's label, by its scope word ("org", "client", "level", "person", "audit"); the key itself when it isn't in the list. */
export function settingLabel(scope: SettingScope, key: string): string {
  return ADMIN_SETTINGS.find((s) => s.scope === scope && s.key === key)?.label ?? key;
}
/** SA-3: keys that were settings once and are gone; only older Audit rows name them. */
export const RETIRED_KEYS: readonly string[] = ["level/plan_share", "level/keep_open"];
export const hasLabel = (scope: SettingScope, key: string) => ADMIN_SETTINGS.some((s) => s.scope === scope && s.key === key);

/**
 * An audit row's setting in words: "client:Atlas/allow_ai" is Allow AI, "person:<id>/automation" Automation account,
 * "org/org.never_suggest" Never suggested, for everyone; an override row ("level", "client_lead") its own label.
 */
export function auditSettingLabel(setting: string): string {
  const slash = setting.lastIndexOf("/");
  if (slash < 0) return ADMIN_SETTINGS.find((s) => s.scope === "audit" && s.key === setting)?.label ?? "A setting";
  const scope = scopeOf(setting.slice(0, slash));
  const key = setting.slice(slash + 1);
  return (scope && ADMIN_SETTINGS.find((s) => s.scope === scope && s.key === key)?.label) || "A setting";
}

/** Settings that are on a page (Search Admin lists these). */
export const SETTINGS_ON_SCREEN = ADMIN_SETTINGS.filter((s) => s.part !== null && s.scope !== "audit");
