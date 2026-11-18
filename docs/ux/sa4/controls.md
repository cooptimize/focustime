# SA-4: every Admin control, where it was and where it is

Inventory rows 147 to 210 (`docs/ux/sa0/inventory.md`). "Was" is the old Settings address; "Now" is Admin's part and tab. The stored key and the action are the same as on main for every row: this step moved screens. One row leaves the screen (183); none is lost otherwise.

| # | Control | Was | Now | Stored key | Action |
|---|---|---|---|---|---|
| 147 | Customers / All accounts, Treat as a client, Hide from FocusTime | Admin › Clients (and the same filter on Admin › AI) | Clients, above the list (All accounts) | client `treat_as_client`, `hidden` | `admin.set` |
| 148 | Team color | Admin › Clients | a client's page › Overview | client `color` | `admin.set` |
| 149 | Leads (read-only, link to People) | Admin › Clients | a client's page › Overview | Dataverse plus overrides | none (read) |
| 150 | Client chats: Add a chat, kind, Open in Teams, Stop reading, Remove, Delete stored messages | Admin › Clients | a client's page › Chats | app tables (registration) | `chats.add`, `chats.kind`, `chats.reading`, `chats.remove`, `chats.refresh`, `requests.purge` |
| 151 | Meetings: Register a meeting, role, transcript source, reviewers | Admin › Clients | a client's page › Calls | app tables (registry) | `meeting.register`, `meeting.update`, `meeting.remove`, `meeting.check_now` |
| 152 | States treated as open | Admin › Clients | a client's page › Backlog rules | client `open_states` | `admin.set` |
| 153 | Types table: Needs breakdown, Background | Admin › Clients | a client's page › Backlog rules | client `no_breakdown`, `background` | `admin.set` |
| 154 | Cooptimize's work in this project | Admin › Clients | a client's page › Backlog rules | client `devops_scope` | `admin.set` |
| 155 | What Needs attention counts | Admin › Clients | a client's page › Backlog rules | client `fix_gaps` | `admin.set` |
| 156 | Who can read this client's code | Admin › Clients | a client's page › Code | client `code_access` | `admin.set` |
| 157 | Can FocusTime read it? Check | Admin › Clients | a client's page › Code | none | `admin.code_check` |
| 158 | Data platform, Deployment items | Admin › Clients | a client's page › Deployments | client `data_platform`, `deploy_items` | `deploy.config_save` |
| 159 | Source systems | Admin › Clients | a client's page › AI | client `source_systems` | `admin.set` |
| 160 | Other names (aliases) | Admin › Clients | a client's page › Overview | client `aliases` | `admin.set` |
| 161 | Match only as written | Admin › Clients | a client's page › Overview | client `exact_case` | `admin.set` |
| 162 | House style for Break down | Admin › Clients | a client's page › AI | client `house_style` | `admin.set` |
| 163 | AI for FocusTime (off asks first) | Admin › AI | Team defaults › AI | org `ai.on` | `admin.set` |
| 164 | Model | Admin › AI | Team defaults › AI | org `ai.model` | `admin.set` |
| 165 | Monthly cap per person | Admin › AI | Team defaults › AI | org `ai.person_cap_usd` | `admin.set` |
| 166 | Monthly cap for everyone | Admin › AI | Team defaults › AI | org `ai.app_cap_usd` | `admin.set` |
| 167 | Processing tier (Flex switches) | Admin › AI | Team defaults › AI | org `ai.standard_tasks` | `admin.set` |
| 168 | Per client: Allow AI | Admin › AI › Per client | a client's page › AI | client `allow_ai` | `admin.set` |
| 168 | Per client: Group messages without AI, Send attachments to AI | Admin › AI › Per client | a client's page › Chats | client `group_without_ai`, `attachments_ai` | `admin.set` |
| 169 | Asking phrases | Admin › Conversations | Team defaults › Client chats | org `conv.request_phrases` | `admin.set` |
| 170 | Thanks and short replies | Admin › Conversations | Team defaults › Client chats | org `conv.ack_phrases` | `admin.set` |
| 171 | Commitment phrases, now Promise phrases | Admin › Conversations | Team defaults › Client chats | org `conv.promise_phrases` | `admin.set` |
| 172 | Read client chats every (minutes) | Admin › Conversations | Team defaults › Client chats | org `conv.poll_minutes` | `admin.set` |
| 173 | Keep chat messages nothing was found in (days) | Admin › Conversations | Team defaults › Client chats | org `conv.retention_days` | `admin.set` |
| 174 | AI requests per chat per day | Admin › Conversations | Team defaults › Client chats (and read-only on each client's Chats tab) | org `conv.chat_ai_daily_cap` | `admin.set` |
| 175 | Admins | Admin › People | People › Admins | Entra | none (read) |
| 176 | Who's set up, Invite | Admin › People | People › Who's set up | app tables | `admin.invited`, `admin.invite_preview`, `admin.invite_send`, `admin.invite_retry`, `admin.invite_access` |
| 177 | People table: Refresh, Level, Client lead, Automation, Remove | Admin › People | People › People | overrides, person `automation` | `admin.refresh_people`, `admin.override`, `admin.set`, `admin.remove_person` |
| 178 | Not Cooptimizers (fold) | Admin › People | People › People, under the table | as 177 | as 177 |
| 179 | Client DevOps identities | Admin › People | People › Client logins | identity links | `admin.identity` |
| 180 | Positions to levels | Admin › People | People › Levels | org `org.position_levels` | `admin.set` |
| 181 | Help invites go only to | Admin › Organization | Team defaults › Planning and new people | org `org.invite_domains` | `admin.set` |
| 182 | Never suggested as helpers or Who, now Never suggested, for everyone | Admin › Organization | Team defaults › Planning and new people | org `org.never_suggest` | `admin.set` |
| 183 | Keep people's data (years) | Admin › Organization | **leaves the screen**: nothing enforces it; its value is kept and Health's Jobs row still says it isn't enforced | org `org.retention_years` | none |
| 184 | Counts as in use (minutes) | Admin › Organization | Team defaults › Planning and new people | org `org.idle_minutes` | `admin.set` |
| 185 | Needs attention looks at the top N | Admin › Organization | Team defaults › Planning and new people | org `ahead.fix_top_n` | `admin.set` |
| 186–188 | Send feedback: organization, project, parent | Admin › Organization | Team defaults › Planning and new people | org `org.feedback` | `admin.set` |
| 189–198 | New people's starting values (days, lunch, watch, at risk, shortest window) | Admin › Organization | Team defaults › Planning and new people | org `org.new_person` | `admin.set` |
| 199 | By level: Break down offered, Needs attention nudges | Admin › Organization | Team defaults › Planning and new people | level `draft_stories`, `readiness_nudges` | `admin.set` |
| 200 | Standards repo | Admin › Standards | Team defaults › Standards | org `standards.repo_url` | `admin.set` |
| 201 | Standards branch | Admin › Standards | Team defaults › Standards | org `standards.branch` | `admin.set` |
| 202 | Last synced, Sync now, Active articles | Admin › Standards | Team defaults › Standards | standards cache | `admin.standards_sync` |
| 203 | This environment, OpenAI key, Send feedback, people and leads, permissions | Admin › Status | Health | none | `admin.status_action` |
| 204 | Jobs | Admin › Status | Health | none | none (read) |
| 205 | Background passes | Admin › Status | Health | none | none (read) |
| 206 | DevOps per client, Check now | Admin › Status | Health (and the client's row again on its Backlog rules tab) | none | `admin.status_action` |
| 207 | Client chats per chat | Admin › Status | Health | none | none (read) |
| 208 | Conversations | Admin › Status | Health | none | none (read) |
| 209 | Audit: area, filter, table | Admin › Audit | Audit › Settings changes (labels, not stored keys) | admin_audit (unchanged) | `admin.load` |
| 210 | Code views | Admin › Audit | Audit › Code views | code view log | `admin.code_views` |
