// Commented starter config, written to ~/.config/coopilot/config.toml when it is missing.
// Not secret, but keep it out of public repos.
export const STARTER_TOML = `# Coopilot configuration.
# Not secret, but don't commit it publicly. Secrets never go in this file:
# the Dataverse client secret lives in the OS keyring
# (service "coopilot", account "dataverse-client-secret").

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
# Its client secret goes in the keyring (service "coopilot", account "google-client-secret").
# calendars: "primary" is your main calendar; add other calendar IDs
# (Google Calendar > Settings > the calendar > Integrate calendar > Calendar ID).
[google]
client_id = ""
calendars = ["primary"]

# Soft day shape: only used to place events into AM or PM and estimate capacity.
[day_shape]
start = "09:00"
split = "12:30"
end = "17:00"
time_zone = "America/New_York"

# Risk thresholds in minutes (docs/spec.md section 6).
[risk]
meeting_watch_minutes = 90
meeting_at_risk_minutes = 150
min_focus_window_minutes = 90

# Standing blocks from Coopilot config. A Dataverse block for a different client
# in the same half-day wins and the half-day is flagged double-booked.
# client is the account's reporting nickname (Cooptimize is the internal account).
[[standing_blocks]]
day = "Mon"
half = "AM"
client = "Cooptimize"

# Client colors, keyed by the account's reporting nickname
# (or the account name when it has no nickname).
[clients]
"W&C" = "#1f9e8f"
Quiddity = "#7b68ee"
CSC = "#d2892a"
Cooptimize = "#4a7fd4"

# Plan the day. Epics, features and other portfolio types can't be picked,
# except the types listed here (matched without regard to case).
[plan]
pickable_portfolio_types = ["Recurring"]

# Work item links open in the client's Edge profile. See the profiles with:
#   node scripts/edge-profiles.ts
# A client with no profile opens in the default browser.
# [edge]
# command = ["uwsm-app", "--", "/usr/bin/microsoft-edge-stable"]
# [edge.profiles]
# Cooptimize = "Default"
`;
