# MCP-0: remote connector implementation plan

Status: **proposed, documentation only**. This PR does not implement or enable an
endpoint, OAuth registration, dependency, permission or write. Each implementation
step needs its own authorization and PR under [CLAUDE.md](../CLAUDE.md).

Checked against main `c667e9e1bebd1b2f715cb133af93f4e024b1871a` on Nov 9, 2026.
FocusTime is the hosted app. Coop is the separate coding agent running inside client
Azure VMs. The first target is Coop using a person's authorized FocusTime context.
ChatGPT support is conditional on its actual product surface and export approval.

## Outcome and scope

Build an authenticated remote MCP server over HTTPS Streamable HTTP at a proposed
`/mcp` endpoint. Start with small client-scoped reads. Later offer plan changes and
narrow external-write proposals using the same services as the FocusTime UI.

The first useful path: a person connects Coop with their own Entra identity, chooses
one permitted client, reads that client's plan for today and opens its FocusTime source
link. A revoked connection, forbidden client or disabled export returns no client data.
Connection consent is not permission to write.

Non-goals: a generic action executor, SQL access, HTTP proxy, shell/file execution,
replacement assistant, new source access, app-only impersonation, bulk export,
autonomous writes, or VM/timer/admin/settings controls. No new Graph scopes assumed.
No new writes to Dataverse, Google, Azure resources or Teams messages.

## Existing implementation and integration points

| Existing code | Reuse and boundary |
|---|---|
| `server/app.ts`, `server/guard.ts`, `server/main.ts` | Node HTTP routing and server-built per-person runtime. Browser APIs use same-origin cookies and X-CSRF, not MCP bearer authentication. Add a narrow route; never relax all API guards. |
| `server/auth/entra.ts` | Tenant-pinned OIDC with PKCE, state, nonce and identity validation. Browser sessions, ID tokens and Graph tokens are not MCP resource tokens. |
| `server/assistant.ts` | Builds shared assistant services from a person's server-created context. Its internal person.userId is trusted; never accept it from external tool arguments. |
| `assistant/allowlist.ts`, `assistant/reads.ts`, `assistant/actions.ts`, `assistant/service.ts` | Reuse typed reads and preview/confirm rules. Do not expose all TOOLS, RUNS or PROPOSE_TOOLS; button-only actions stay button-only. |
| `actions/registry.ts`, `actions/dispatch.ts` | Existing validation and business rules. No caller-supplied action dispatch. |
| `actions/devops-write-actions.ts`, `actions/timebox-actions.ts` | Existing permission checks, preview, confirm, concurrency control, read-back, audit and undo. No direct source writes from MCP. |
| `store/scope.ts`, `store/conversation-store.ts` | Person isolation and current viewer rules. Following a client alone never grants chat visibility. |
| `ai/guard.ts`, `ai/` | Existing guard, switches and budgets cover FocusTime's own AI requests, not arbitrary external export. Add an export gate even when no local model runs. |

See [assistant-interface.md](assistant-interface.md), especially TB-3's channel-neutral
results. Keep panel and Teams compatibility. New MCP DTOs must project permitted
fields, not serialize whole UI responses, cards, history or WeekLoadData.

Main also includes Part 0's shared conversation ownership and `conversation_owner`
proposal. Do not inherit these writes from the assistant allowlist. Exposing shared
ownership later requires its own scope review, membership checks and human approval.

## Transport and hosting

- Use the official TypeScript MCP SDK, pinned after explicit dependency approval.
  Do not add a package in this planning PR or hand-roll JSON-RPC framing.
- Record protocol and SDK versions. Implement initialize/version negotiation,
  initialized notification, tools/list, tools/call and cancellation according to that
  version. Advertise only implemented capabilities. No sampling, prompts, roots or
  arbitrary resources in the first slice.
- Prefer stateless Streamable HTTP for reads. Handle POST JSON responses and GET/SSE
  and DELETE explicitly as supported or refused by the selected SDK/protocol.
  If sessions are needed, bind them to person, OAuth application and resource;
  authenticate every request. Session IDs are not authorization credentials.
- Validate public Host, any supplied Origin against an explicit allowlist, protocol
  headers, content types, body/schema sizes and timeouts. An OAuth client may omit
  Origin but must provide a valid bearer token. Reject query-string tokens, cookie-only
  MCP calls and credentialed wildcard CORS.
- Preserve browser cookie/CSRF rules for /api, /auth and review pages. Add only the
  exact MCP and metadata routes needed, not a blanket external-call exception.
- Apply unauthenticated limits and per-person/per-OAuth-client rate limits. Sanitize
  errors. Use the protocol's authentication challenges and transport status codes;
  valid tool calls that cannot complete return structured safe tool errors.
- Test Azure Container Apps ingress buffering, timeouts, dev cold starts and revision
  restarts. Grants and approvals must survive restarts safely. No memory-only consent
  store. Health checks reveal no private data or extra database polling.

## OAuth and identity

Prove the authorization-server arrangement in MCP-1 before exposing data. The preferred
starting point is Entra as authorization server, FocusTime as a distinct protected API,
and registered OAuth applications for the intended clients. If a client's discovery
or registration requirements cannot be met directly, design a reviewed broker as a
separate step. Do not invent token formats or weaken checks to make a client work.

1. Per-user authorization code flow with PKCE S256, exact registered redirect URIs,
   state/nonce where applicable, single-use codes and TLS. Distinguish public and
   confidential clients. No shared service identity, app-only access or PAT shortcut.
2. Implement protected-resource metadata, authorization-server discovery and
   WWW-Authenticate challenges for the pinned MCP authorization version. Bind requests
   and tokens to the canonical MCP resource/audience. Do not advertise unsupported
   dynamic client registration. Any discovery URL fetching needs SSRF controls.
3. Validate signature and algorithm, issuer, audience, tenant, expiry/not-before,
   delegated scopes and authorized OAuth client claim. Reject ID tokens, Graph tokens,
   wrong-resource tokens and application permissions. Resolve validated tenant/object
   identity to an existing eligible FocusTime person. Recheck current guest, automation,
   disabled and deleted-account restrictions; never match by email/display name alone.
4. Proposed scopes: `focustime.read`, `focustime.plan.propose`, and a later approved
   `focustime.devops.propose`. Scopes are ceilings, not permission overrides. Store
   grants bound to person, OAuth application, permitted client keys, data categories
   and expiry/revocation. Tool input cannot select another user.
5. Obtain downstream access through the person's existing server runtime. Never pass
   the MCP token to Graph/DevOps or return any token, PAT, refresh token, secret or auth
   state. New downstream consent stays in FocusTime's existing flows.
6. Disconnect revokes the FocusTime grant immediately and invalidates its sessions and
   unexecuted proposals. Recheck the live grant on every call, including with valid JWTs.
   Integrate provider revocation when supported and document token/key-rotation limits.
   Deleting a browser session is not instant Entra token revocation.

API/client registration, credentials, admin consent and production setup are explicit
IT tasks, not authorized by this document. Follow the operations warning about
`infra/scripts/app-registration.sh`; never run its full grant reset.

## External AI export is a separate boundary

Multi-client cards shown to the person's own FocusTime UI are not automatically safe
to return to an external model. MCP results can enter another provider's prompt and
history. UI visibility and existing Allow AI do not consent to that recipient.

Before serializing any result:

1. Validate person, OAuth application and current grant; intersect scopes, the explicit
   MCP allowlist and enabled rollout stage.
2. Resolve one explicit clientKey against current person access and the grant. Prefer
   a client/project-bound Coop connection. VM location or caller input is not authority.
3. Apply source-specific access: chat membership plus following, meeting reviewers or
   attendees, and ownership of personal rows. Recheck even for cached data.
4. Require AI for FocusTime and that client's Allow AI plus a new explicit external
   connector export policy per recipient/application and data category, default off.
   Disclose the recipient. External retention/training and usage costs are governed
   by that provider; FocusTime cannot enforce its own store:false or budget there.
5. Project a minimal allowlisted DTO, then apply an outbound export guard using
   applicable secret/client checks. Inspect nested fields, titles, descriptions,
   links and errors. Removing a clientKey alone is not protection. Fail closed for
   mixed-client and unsupported content.
6. Return only selected-client plan/work-item metadata in v1. Exclude raw chats,
   transcripts, attachments, personal calendar details, others' private plans,
   presence, VM details, unnecessary emails/identifiers and credentials.

Conversation, promise and status reads need separate category approval and tests.
No cross-client aggregate in v1. A client selector lists only explicitly export-enabled
clients for that grant; use a fixed-client connection or opaque labels where needed.
Authorization failure must not reveal another person's object's existence.

The same gate covers previews, source links, errors, pagination, search/fetch and any
future resources. Bind caches/cursors to person, OAuth application, client, filters and
policy version; recheck policy and membership on every page/cache hit. Audit safe
metadata only: operation, opaque IDs, counts, duration and outcome. Never arguments,
tool results, source text, tokens or Authorization headers.

## Proposed tools

These are proposed names, not existing endpoints. Closed schemas reject unknown fields.
Use ISO dates, server-resolved personal time zone, bounded strings/arrays, schema version,
source links, as-of/fetched-at time and stale/partial status. Never substitute demo data
for a failed real source.

| Stage | Tool | Contract and backing service |
|---|---|---|
| MCP-2 | `focustime_list_clients` | Only grant-bound export-enabled clients; omit on a fixed-client connection. No user identity input. |
| MCP-2 | `focustime_get_day` | clientKey + date; projected day read/lookup.day for that client's own to-dos and permitted block metadata. |
| MCP-2 | `focustime_get_week` | clientKey + Monday weekStart; filtered week.load projection, never the raw response. |
| MCP-2 | `focustime_get_item` | clientKey + itemId; shared items.get checks plus actual item/client ownership validation. |
| MCP-2 | `focustime_list_gaps` | clientKey + bounded filters/limit/cursor; authorized ahead.load item projection. |
| MCP-3 | `focustime_propose_plan_change` | clientKey + discriminated operation, initially a move of one owned to-do. Existing preview/business rules, no immediate write. |
| MCP-3 | `focustime_get_proposal`, `focustime_cancel_proposal` | Opaque owned proposal id; safe status or cancellation, never approval. |
| MCP-4 | `focustime_propose_devops_change` | clientKey + itemId + a separately approved operation, initially comment or state; personal client-specific write PAT and existing framework. |

Use structured tools, not an unrestricted assistant.handle passthrough. Service
extraction must preserve checks and add panel/Teams/MCP parity tests. Deterministic
reads need no second model. Any actual model call still goes through ai/ and its budget.

Proposed starting limits: page size 25, maximum 100, serialized response 64 KiB and
bounded date windows. Paginate or disclose truncation. Use opaque signed or server-held
expiring cursors. Typed safe outcomes include not_connected, not_authorized,
export_disabled, source_unavailable, stale, approval_required, expired, changed and partial.

Never expose assistant.confirm, devops.confirm, run(action,args), history/export/clear,
credential management, button-only tools or arbitrary URL fetch. Discover process
states, never hard-code Done. Existing day/week commits can span clients; do not call
them client-scoped without proving their semantics. Ship single-to-do moves first.

## Human approval that the model cannot manufacture

Client-side confirmations and MCP annotations are UX, not authorization. A tool argument
confirmed:true, a model-visible approval token or possession of a proposal ID must never
authorize a write.

Use a FocusTime-hosted review page:

1. Validate scope/export and store an immutable preview bound to person, OAuth
   application, client, operation, normalized arguments hash, target revision and
   before-values. Reuse the 15-minute proposal expiry convention. Return a safe summary
   and HTTPS review link; proposing has no external side effect.
2. A GET displays the preview only. The person signs into FocusTime and sees exact
   target, before/after, audience/destination, warnings and undo/partial limitations.
   Another person's login cannot approve it.
3. Only the authenticated CSRF-protected human review action records approval and
   executes. Recheck grant/scopes, AI/export policy, membership, allowlist, shared
   permission rules, expiry and a fresh preview immediately before execution.
   An edit or changed target invalidates approval and requires a newly shown preview.
   Do not reuse an existing confirm API's edit-and-write behavior without this review.
4. Atomically claim execution to prevent concurrent/replayed confirms. Reuse the write
   framework, transactions, revision checks, read-back, audit and undo. On uncertain
   external outcomes reconcile by read-back; never blindly retry. Report individual
   parts and undo separately, not distributed atomicity.
5. MCP can poll an export-gated receipt, not approve or execute. Cancellation, expiry,
   disconnect and lost access invalidate unused approvals. Undo needs a fresh reviewed
   proposal where applicable.

This deliberately exceeds some in-app plan buttons' requirements. No autonomous write
mode in scope. Use additive migrations and declared user tables through store/scope.ts.
Define cleanup, export and account-deletion behavior for grants, bindings and receipts.
Proposed terminal connector metadata retention is 30 days, subject to review; do not
duplicate source content in logs.

## Compatibility

**Coop first.** Verify actual remote MCP/OAuth support in a client VM, callback flow,
secure per-user token storage and fixed-client configuration. Never commit tokens to
MCP configuration or share a VM service identity. A stdio-only client needs a separately
reviewed bridge, not an anonymous remote endpoint. This plan does not modify Coop.

**ChatGPT conditional.** Verify the chosen workspace/product surface, remote transport,
OAuth discovery/registration rules, admin restrictions and supported tools against
current documentation. Do not promise every account can attach it. If the intended
retrieval surface requires search/fetch, add narrow adapters over the same DTOs with
stable scoped IDs, citations and identical export checks. They grant no new data access.

Record client/version, transport, login, reads, reconnect, revocation and approval
outcomes in a pass/fail/not-tested matrix. MCP Inspector alone proves neither client.

## Milestones and acceptance gates

One reviewed PR per step; update decisions, questions, technical docs and hard rules
as behavior is actually authorized and implemented.

| Step | Deliverable | Exit gate |
|---|---|---|
| MCP-1 | Verify client requirements; pin SDK/protocol; threat model; transport, OAuth and feature flag, no data tools | Fake-issuer and Inspector tests; wrong audience/tenant/client, ID token, expiry, missing scope, disabled account and Host/Origin refusals; browser guards unchanged; registrations/dependency approved. |
| MCP-2 | Export policy/grants, connection/disconnect UI and minimal read DTOs/tools | Two users, two business clients and two OAuth apps cannot cross-read; switches off leak nothing; source failure, pagination and revocation covered; actual Coop read E2E passes. Read-only rollout remains default. |
| MCP-3 | Single-client plan proposal, hosted human review, durable execution claim/receipt | Unapproved, expired, edited, replayed and concurrent proposals cannot write; access revocation, restart and Undo covered. |
| MCP-4 | One separately approved existing DevOps write at a time | Personal PAT/canEdit, revisions, before-values, read-back, uncertain outcome, partial and undo tests; only explicitly approved live pilot; no assumed downstream permissions. |
| MCP-5 | Conditional ChatGPT adapters, compatibility matrix, pilot/operations runbook | Actual login/read/reconnect tests; same export/approval rules; rate/load/proxy/restart checks; documented disable/revoke rollback. Normal human prod deployment approval remains required. |

### Required test coverage

- Closed input/output schemas, unknown tools, nested secrets, mixed-client content,
  date/time-zone/DST, size caps, stale/partial sources and cursor tampering. Source
  content that tells the agent to change rules is data, never instructions.
- Same item IDs across clients/orgs; guessed plan/proposal IDs; other user/OAuth
  app/session; revoked membership; disabled/deleted account; policy changed between
  pages or after preview; downstream token passthrough rejected.
- Initialize/version negotiation, notifications, unsupported methods, malformed JSON,
  headers, unauthorized GET/SSE/DELETE, cancellation, reconnect, rate limits, proxy
  timeout and browser /api CSRF regression.
- Review GET never writes; model calls cannot record approval; wrong human/CSRF fails;
  edits force re-review; parallel confirms execute at most once; process restart
  recovery; timeout after a landed external write reconciles without a duplicate.
- No data leaks through errors, logs, telemetry, cache, cursor or receipt. No direct
  source writes. Existing host-boundary, store-isolation and demo-leak tests pass.
- Use test/builders, fake providers and test/ports.ts. One demo browser E2E for
  connect/review/disconnect plus remote protocol tests. No real customer data or writes.

Implementation PRs run focused tests, npm run typecheck, npm run guards,
npm run docs:check and npm test with documented Node 26, SQL Server and browser setup.
Record commands/results against the final commit. UI changes need demo screenshots
and keyboard/phone/Cancel/Back/repeated-confirm tests. Infra changes use the existing
infra/ process and approvals, never direct production edits.

## Open implementation decisions

Also tracked in [open-questions.md](open-questions.md#mcp-0):

- Actual Coop client/callback capability and direct Entra versus a reviewed broker.
- Recipient-specific export policy, its approver and exact v1 data fields.
- Whether the chosen ChatGPT surface is supported and approved as an export recipient.
- SDK dependency and Entra API/client-registration authorization.
- Exact first local-plan proposal and later DevOps write, if any, after read-only pilot.
- Retention, logout/revocation semantics and operational limits before rollout.

## References

[Repository rules](../CLAUDE.md), [development](technical/development.md),
[security](technical/security.md), [architecture](technical/architecture.md),
[data](technical/data.md), [integrations](technical/integrations.md),
[operations](technical/operations.md).

- MCP protocol/authorization: https://modelcontextprotocol.io/specification
- Official SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Microsoft identity: https://learn.microsoft.com/entra/identity-platform/
- Verify current OpenAI requirements for the chosen ChatGPT surface before claiming support.
