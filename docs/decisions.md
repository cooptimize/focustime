# Decision log

Earlier decisions (D01–D20) live in Discovery Brief v0.3 in the claude.ai Project. Add new decisions here as they are made.

| ID | Status | Entry |
|---|---|---|
| D19 | Re-scoped | AI provider choice does not block Milestones 1–2 |
| D21 | Partly done | Dataverse via a read-only application user (done). Outlook via delegated `Calendars.ReadBasic` and Google via desktop OAuth `calendar.events.readonly` (proposed, set up in step 3) |
| D22 | Accepted | Stack option A: local TypeScript app opened as a Chromium app window, host layer thin enough to move to Tauri later |
| D23 | Proposed | Cache last good snapshot per source as files; SQLite arrives with the plan layer in Milestone 3 |
| D24 | Deferred | PAT column security not a priority now (read-only tokens). Coopilot never requests the PAT column before Milestone 6 |
| D25 | Done | Application user "Coopilot Dataverse Reader", role Coopilot Reader: Read (Org) on Focus Time, Account, User, Account Worker. Verified Oct 31 |
| D26 | Confirmed | Workweek is Mon–Thu; Friday is an optional overflow/catch-up day shown separately |
| D27 | Confirmed | Focus Time rows are recurring weekly patterns expanded per week; blank end date means ongoing |
| D28 | Confirmed | Unassigned Mon–Thu half-days show as "Open" (client or internal) |
| D29 | Confirmed | Half-days are soft commitment units; the day shape in config is for placement and capacity only |
| D30 | Proposed | Monday AM is a standing Internal block from Coopilot config; a Dataverse client block in the same slot wins and raises a double-booked flag |
| D31 | Done | Application user sits in its own business unit with no team roles; Contacts refused. Verified Oct 31 |
| D32 | Confirmed | Person and client come from the Account Worker link (`coop_user`, `coop_account`), falling back to Focus Time's own columns. Tanner is identified by `systemuserid`, never by name |
| D33 | Proposed | Blocks for the same client in one half-day merge into one (Dataverse copy kept) and are not double-booked. Only different clients raise the double-booked flag. So a Dataverse Internal block on Monday AM silently satisfies the standing Internal block |
| D34 | Proposed | Event placement buckets per day: early (midnight to 09:00), AM [09:00, 12:30), PM [12:30, 17:00), evening (17:00 to midnight). Boundaries are half-open, so a meeting ending at 12:30 is AM only. An event crossing a boundary appears in each bucket, clipped, and only the clipped minutes count |
| D35 | Proposed | Risk rule details: rules run only on half-days with a focus block (Open half-days and Friday get no risk flags); overlapping meetings count once; missing showAs counts as busy; personal events count as busy time for the focus-window rule but not as meeting minutes; one personal-conflict risk per personal event |
| D36 | Proposed | On Saturday and Sunday the app opens on, and `t` jumps to, the coming week's Monday AM |
| D37 | Done | Step 1 stack: TypeScript 7.0.2 (strict), Vite 8.3.5 + React 19.3.1, Vitest 5.0.5, playwright-core 1.64.1 driving /usr/bin/chromium. No date library: Temporal is built into Node 26 and Chromium 155. Exact pins, local installs only |
| D38 | Done | Code layout uses the top-level folders from the architecture map (`week/`, `ui/`, `sources/`, `config/`, `actions/`) plus `fixtures/`. Sample data reaches the UI through `sources/sample.ts` and `actions/week-load.ts`, the same path real sources will use. Config is compiled-in defaults until the TOML loader exists |
| D39 | Done | Dev server binds 127.0.0.1:5317 with Vite's Host check (a foreign Host header gets 403). It serves only static UI, no data API, so the per-launch token and Origin check arrive with the first local API in a later step |
| D40 | Done | Dataverse token via a plain client-credentials POST to Entra with built-in fetch (no MSAL). Access token in memory only, renewed 5 minutes before expiry. Only the OAuth `error` code is read from failures, never `error_description` |
| D41 | Done | Keyring through the system `secret-tool` (Secret Service), no native binding. The secret comes back on stdout, never in argv; only the `dataverse-client-secret` account under service `coopilot` can be read |
| D42 | Done | Local host: `node:http` on 127.0.0.1:5317. A 256-bit per-launch token travels in the launch URL, which is written to `$XDG_RUNTIME_DIR/coopilot/launch.json` (0600) and never printed. The first request swaps it for an HttpOnly SameSite=Strict cookie, and every request must carry it. Host allowlist (DNS rebinding), Origin and Sec-Fetch-Site checks, a POST-only API that needs a same-origin Origin, and a strict CSP for the built UI. `npm start` opens `chromium --app=<launch URL>`, so the token is visible in the local process list (same user only) while the window is open |
| D43 | Done | Client key and label = account `coop_reportingnickname`, falling back to `name`. The full name shows in details. Real nicknames: Cooptimize (internal), W&C, Quiddity, CSC. The standing block and colors use these keys, so the standing Monday AM block is `client = "Cooptimize"` and merges with the real Cooptimize pattern (D33) |
| D44 | Proposed | An invalid config shows no focus blocks at all (no sample patterns, no standing blocks) plus a banner naming each bad field. Sample meetings stay, labeled "sample", until step 3 |
| D45 | Done | The query filters by person on the server (`_coop_systemuser_value` or `coop_AccountWorker/_coop_user_value` equals my systemuserid), so teammates' rows are never fetched. Normalization re-applies "Account Worker wins" exactly |
| D46 | Done | Results stay in memory for 5 minutes per week; the Refresh button forces a fetch. The snapshot is per week and is written only after a complete, successful fetch, so a failed or partial fetch never overwrites it. Config is re-read on every request |
| D47 | Done | Entra issues tokens for any `*.dynamics.com` resource, so a wrong `environment_url` fails at DNS. ENOTFOUND on the Dataverse host after a successful token is reported as "Dataverse environment not found: check environment_url in config", not as offline |
