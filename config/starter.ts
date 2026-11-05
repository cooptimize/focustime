// Commented starter config, written to ~/.config/focustime/config.toml when it is missing.
// Not secret, but keep it out of public repos.
import type { NewPersonDefaults } from "./org.ts";
import { WEEKDAY_KEYS } from "../week/hours.ts";

/** The starter config, its working hours in the given zone (the host clock's for a new person). */
export function starterToml(timeZone: string, team?: NewPersonDefaults): string {
  let t = STARTER.replace("@TIME_ZONE@", timeZone);
  if (!team) return t;
  // ADM-1: the team's working week, day shape and risk thresholds for new people (Admin › Organization), which the
  // first-run Setup then shows prefilled; theirs to change.
  const list = (xs: readonly string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  t = t.replace(/^lunch = .*$/m, `lunch = ${JSON.stringify(team.lunch)}`);
  for (const d of WEEKDAY_KEYS) t = t.replace(new RegExp(`^${d} = .*$`, "m"), `${d} = ${list(team.weekdays[d])}`);
  t = t.replace(/^meeting_watch_minutes = .*$/m, `meeting_watch_minutes = ${team.risk.watch}`);
  t = t.replace(/^meeting_at_risk_minutes = .*$/m, `meeting_at_risk_minutes = ${team.risk.atRisk}`);
  t = t.replace(/^min_focus_window_minutes = .*$/m, `min_focus_window_minutes = ${team.risk.minWindow}`);
  return t;
}

const STARTER = `# FocusTime configuration.
# Not secret, but don't commit it publicly. Secrets never go in this file:
# the Dataverse client secret lives in the OS keyring
# (service "focustime", account "dataverse-client-secret").

[dataverse]
# Environment root URL, Web API v9.2 is used under it.
environment_url = "https://cooptimize.crm.dynamics.com"
# Entra tenant and the "Coopilot Dataverse Reader" app registration.
tenant_id = "abf29d42-2ea9-422b-b0af-ed7cb5595b7e"
client_id = "bf36f621-3e9f-43f9-ab47-89fb89fe7f4a"
# Your work email. Used once to look up your Dataverse user id.
my_email = ""
# Filled in automatically from my_email on first run. Never matched by name.
my_systemuserid = ""

# Outlook (Microsoft Graph), read-only, signed in as you. Client ID of the
# "Coopilot Desktop" public app registration. Leave client_id empty to skip Outlook.
[outlook]
tenant_id = "abf29d42-2ea9-422b-b0af-ed7cb5595b7e"
client_id = ""

# Google Calendar, read-only, signed in as you. Client ID of the Desktop OAuth client.
# Its client secret goes in the keyring (service "focustime", account "google-client-secret").
# calendars: "primary" is your main calendar; add other calendar IDs
# (Google Calendar > Settings > the calendar > Integrate calendar > Calendar ID).
[google]
client_id = ""
calendars = ["primary"]

# Working hours (step 6b). Used for capacity, risks, planning and the view range.
[hours]
time_zone = "@TIME_ZONE@"
# The lunch is where the morning ends and the afternoon starts. "" for none (the day splits in the middle).
lunch = "12:00-12:00"
# Working spans per weekday; [] is a day off. A second span (e.g. an evening) forms its own slot.
mon = ["09:00-17:00"]
tue = ["09:00-17:00"]
wed = ["09:00-17:00"]
thu = ["09:00-17:00"]
fri = ["09:00-17:00"]
sat = []
sun = []

# Risk thresholds in minutes (docs/spec.md section 6).
[risk]
meeting_watch_minutes = 90
meeting_at_risk_minutes = 150
min_focus_window_minutes = 90

# Standing blocks from FocusTime config. A Dataverse block for a different client
# in the same half-day wins and the half-day is flagged double-booked.
# client is the account's reporting nickname (Cooptimize is the internal account). None by default, for example:
# [[standing_blocks]]
# day = "Mon"
# half = "AM"
# client = "Cooptimize"

# Client colors, keyed by the account's reporting nickname
# (or the account name when it has no nickname). Your clients come from
# Dataverse; Settings > Clients sets these. None by default, for example:
# [clients]
# Cooptimize = "#4a7fd4"

# Plan the day. Epics, features and other portfolio types can't be picked,
# except the types listed here (matched without regard to case).
[plan]
pickable_portfolio_types = ["Recurring"]

# Display. Theme: "cooptimize-dark" (default), "cooptimize-light" or "neutral". Settings changes it too.
[ui]
theme = "cooptimize-dark"
`;
