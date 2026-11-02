# 07. Security and privacy

Coopilot is a single-user desktop app. Its security model is: keep the server unreachable from anything but the person's own window, keep secrets in the OS keyring, read as little as possible, and make every outside write explicit and reversible.

## Local-only server

From [server/guard.ts](../../server/guard.ts) and [server/app.ts](../../server/app.ts):

- **Bind.** The server listens on `127.0.0.1` only (default port 5317). Vite's dev server is also pinned to `127.0.0.1` ([server/main.ts](../../server/main.ts) `server.listen`, [vite.config.ts](../../vite.config.ts)).
- **Host check.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS-rebinding pages.
- **Origin check.** If an `Origin` header is present it must be `http://127.0.0.1:<port>` or `http://localhost:<port>`. Every `/api/` call must carry a same-origin `Origin`. `Sec-Fetch-Site` must be `same-origin` or `none`.
- **Per-launch token.** 32 random bytes, new every server start. It arrives once as `?token=` on the launch URL, is compared in constant time, and is swapped for an `HttpOnly; SameSite=Strict` cookie named per port. Requests without the right cookie get 401 and a page asking to reopen Coopilot.
- **Launch link.** The URL with the token is written to `$XDG_RUNTIME_DIR/coopilot/launch.json` (0600), never printed. `coopilot-open` reads it and hands it straight to the browser without `eval` ([system/coopilot-open](../../system/coopilot-open)).
- **Response headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and for the built UI a Content Security Policy of `default-src 'self'` with no frames, no forms and no base URI.
- **Request limits.** `/api/action` takes POST with `application/json` only, bodies up to 64 KB. Static file paths are normalized and kept inside the build folder.
- **Reopen endpoint.** `POST /api/reopen` passes Host and Origin checks but not the token, takes no input and returns only whether a window was opened (`{opened}`, 202 or 503); it is rate limited to once every 5 seconds.

The OAuth loopback listener is separate: a random port on `127.0.0.1`, open only during a sign-in, accepting one GET with the matching `state` and a loopback Host, closed after 5 minutes ([sources/oauth/oauth.ts](../../sources/oauth/oauth.ts) `waitForCode`).

## Secrets

All in the OS keyring (Secret Service), service `coopilot`, through the `secret-tool` command. Values go in through stdin, never argv, and are never logged, cached or put in an error ([secrets/keyring.ts](../../secrets/keyring.ts)).

| Keyring account | Holds | Written by |
|---|---|---|
| `dataverse-client-secret` | Dataverse app secret | Settings (masked entry) |
| `google-client-secret` | Google desktop client secret | Settings (masked entry) |
| `outlook-refresh-token` | The one Microsoft sign-in's refresh token | Sign-in; deleted on sign-out |
| `google-refresh-token` | Google refresh token | Google connect; deleted on disconnect |
| `devops-write-pat:<client-slug>-<hash>` | My personal DevOps write PAT for one client | Settings > Clients, after an identity check |

- **Access tokens** live in memory only, one per scope set, renewed 5 minutes before expiry ([sources/oauth/oauth.ts](../../sources/oauth/oauth.ts)).
- **The ID token** is read for who signed in and not stored; only name, address, object id and tenant id are kept, in `account_state`. It is read but not signature-validated, because it is used for display and to find "me", never to authorize (decision D305).
- **DevOps PATs** are wrapped in a `Pat` class that prints as `[PAT]` under `String()`, `JSON.stringify` and `util.inspect`. Only the HTTP client calls `basicAuth()` at the request ([sources/devops/pat.ts](../../sources/devops/pat.ts)). The company read PAT is read from Dataverse per fetch and not kept.
- Coopilot reads and writes only its own named accounts; each setter accepts only its own account type (refresh tokens, the two app secrets, write PATs), so other keyring entries are never read or changed ([secrets/keyring.ts](../../secrets/keyring.ts) `ACCOUNTS`, `WRITABLE`).

## What is never logged

The logger has a closed set of fields: source, op, status, duration, count, kind. There is no field for headers, bodies, tokens, URLs or free objects, so they can't be logged by accident ([log/logger.ts](../../log/logger.ts)). Logs go to stderr (the systemd journal under the service).

Never logged, cached, exported or returned to the UI: tokens, secrets, PATs, Authorization headers, raw HTTP bodies, provider error descriptions (only error codes are read) and Azure error messages. Teammates' presence is shown on screen but never logged or stored. Profile photos are never logged; they are cached 7 days under hashed names and cleared on sign-out ([CLAUDE.md](../../CLAUDE.md#hard-rules); headers of [sources/oauth/oauth.ts](../../sources/oauth/oauth.ts), [sources/azure/client.ts](../../sources/azure/client.ts), [actions/photo-actions.ts](../../actions/photo-actions.ts)). Tests pass a fake token through code paths and assert it never appears in logs or errors ([server/app.test.ts](../../server/app.test.ts), [actions/dispatch.test.ts](../../actions/dispatch.test.ts), [sources/dataverse/source.test.ts](../../sources/dataverse/source.test.ts)); PAT masking is tested in [secrets/keyring.test.ts](../../secrets/keyring.test.ts) and [sources/devops/source.test.ts](../../sources/devops/source.test.ts).

## Client isolation

- Every client-scoped row (picks, week items, drafts, timeboxes, flex sessions, resume notes, borrowed time, invites, DevOps write log) carries a `client_key`; on follow-ups and captures it is optional. Day-level tables such as `day_plans` and `unavailable` have none ([store/plan-store.ts](../../store/plan-store.ts)).
- DevOps reads and writes go to one client's org with that client's PAT per call; a write for one client can't target another client's org, and a draft for one client can't be created under another client's parent ([actions/devops-write-actions.ts](../../actions/devops-write-actions.ts) refusals "That draft belongs to another client", "That write belongs to another client").
- Two Dataverse accounts with the same client key are both refused ([sources/dataverse/source.ts](../../sources/dataverse/source.ts) `devopsTargets`).
- Who suggestions show only people whose email is in that client's domain ([sources/graph/people.ts](../../sources/graph/people.ts)).
- Help invites go only to allowed domains (Cooptimize by default) ([plan/collab.ts](../../plan/collab.ts) `domainAllowed`).
- Work item links open in that client's Edge profile ([links/edge.ts](../../links/edge.ts)).
- Coop briefs contain DevOps fields of one feature only ([actions/registry.ts](../../actions/registry.ts) `feature.brief`).

How views and drafts keep each client's items apart in the UI was not checked line by line (Not verified beyond the store and write paths).

## What data leaves the machine, and to whom

| To | What is sent | Why |
|---|---|---|
| Entra ID (`login.microsoftonline.com`) | Client id, scopes, PKCE values, refresh token; for Dataverse the app secret | Tokens |
| Dataverse | OData queries naming my user id, my email (resolve once), account ids | Reads only |
| Microsoft Graph | Calendar queries; event bodies for Coopilot's own events (title "<client>: <item>", DevOps link); invite bodies to Cooptimize attendees; RSVP notes; teammates' emails for free/busy; object ids for presence and photos | Reads and the writes in [06](06-write-framework.md) |
| Google | Calendar ids, time range, refresh token, client secret | Reads only |
| Azure DevOps (each client's org) | WIQL with my DevOps email, item ids; for writes, the patch fields | Reads and named writes |
| Azure Resource Manager | Owner tag query, my VM's id, power and schedule requests | My VM only |
| Desktop notification daemon (local) | Notification text | Reminders |

No telemetry, analytics or crash reporting. No AI provider is called today; there is no AI code in the repo.

## Threat model

| We protect | From | How |
|---|---|---|
| The local API | Web pages in any browser on the same machine (CSRF, DNS rebinding) | Loopback bind, Host and Origin checks, `Sec-Fetch-Site`, per-launch token in a SameSite=Strict HttpOnly cookie |
| Refresh tokens, app secrets, write PATs | Logs, cache files, screenshots, chat, git | Keyring only; closed-field logger; `Pat` wrapper; tests with fake tokens; `.gitignore` for local stores |
| Client DevOps data | Mixing clients, writing with the wrong identity | Per-client PAT and org; identity check; refuse duplicate client keys |
| Other people's calendars | Over-reading | Free/busy and working hours only; subjects and locations never kept; presence never stored |
| Meetings others organize | Accidental edits | Calendar editing tiers; RSVP endpoints only; no PATCH or DELETE on meetings |
| DevOps work items | Accidental loss | No delete; undo sets Removed; `test /rev`; read back |
| Azure resources | Acting on the wrong VM or resource | One confirmed VM from the store; strict resource id parsing; delegated RBAC |
| The plan | Bad migrations | Backup before migrating; refuse newer schemas; foreign key check on rebuilds |

## Known gaps

- **Dataverse PAT column is not secured.** Column security on the DevOps token column is off, so any identity with read on Accounts can read every client's company PAT (open question Q16). This is a Dataverse setting, not Coopilot code.
- **App-only Dataverse read.** Dataverse is read with an app identity that has org-wide read on its tables, not the person's own permissions. A hosted version should read Dataverse delegated per user (Q89).
- **Global PATs retire on December 1, 2026.** Any client PAT created as global stops working; recreate as organization-scoped (Q17).
- **Same-user processes.** Anything running as the same Linux user with an unlocked keyring can read the keyring entries, the launch link and the plan store. This is the normal desktop trust boundary; Coopilot does not try to defend against it.
- **Data at rest.** `plan.db`, exports, backups and cache files are 0600 but not encrypted by Coopilot. Disk encryption is assumed (Not verified).
- **CSP in dev mode.** The Content Security Policy is sent only when serving the built UI, not in `--dev` mode ([server/app.ts](../../server/app.ts) `baseHeaders(res, !!opts.distDir)`).
- **Google in Testing status.** Sign-in lasts 7 days (Q12).
- **Undocumented DevOps endpoint.** `_apis/connectionData` is used for the identity check but is not on Microsoft Learn (Q80, D258).
