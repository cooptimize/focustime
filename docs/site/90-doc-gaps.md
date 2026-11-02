# 90. Doc gaps

Where the existing docs or code comments disagree with the code, what I could not confirm, and questions for the author. The code wins in every page of this site; this list is where the disagreements are recorded instead of being resolved silently.

## Mismatches between docs or comments and code

| # | Where it says | What it says | What the code does |
|---|---|---|---|
| 1 | [CLAUDE.md](../../CLAUDE.md#hard-rules), DevOps hard rule | DevOps writes "never deletes" | Work items are never deleted, but undoing a comment (or a state change that carried a comment) deletes the comment Coopilot added ([actions/devops-write-actions.ts](../../actions/devops-write-actions.ts) header and `undo_comment`; [sources/devops/write.ts](../../sources/devops/write.ts) `deleteComment`). The header comment in the actions file states this correctly |
| 2 | [config/schema.ts](../../config/schema.ts), comment on `timebox` | "Put on Outlook" on by default | `DEFAULT_TIMEBOX.outlookDefault` is `false`, matching decision D215 |
| 3 | [ui/keys.ts](../../ui/keys.ts), the N key text | "sort it into a follow-up, a draft story or a note" | Notes were removed in step 13.5 (D230); captures sort into follow-up, draft story or draft feature ([plan/capture.ts](../../plan/capture.ts) `CaptureKind`). This text shows in the key legend |
| 4 | [docs/spec.md](../../docs/spec.md) sections 7 and 8 | Dataverse credential: certificate preferred | Client secret from the keyring ([sources/dataverse/source.ts](../../sources/dataverse/source.ts) `getToken`) |
| 5 | [docs/spec.md](../../docs/spec.md) section 11 | Dependencies include zod, MSAL, a Google auth library and a keyring binding | None of these are used: validation is hand-written, OAuth is hand-written (D48), the keyring is the `secret-tool` command ([package.json](../../package.json), [secrets/keyring.ts](../../secrets/keyring.ts)) |
| 6 | [docs/spec.md](../../docs/spec.md) section 6 | Four risk rules; "events marked free are ignored" | Six rule ids (out of office and all-day busy were added in step 3, D54); working-elsewhere events are also ignored, and missing show-as counts as busy ([week/risks.ts](../../week/risks.ts)) |
| 7 | [CLAUDE.md](../../CLAUDE.md#architecture-map) architecture map | Folder list | Does not list `scripts/`, `assets/` or `docs/`, nor `sources/sample.ts` and `sources/when.ts` |
| 8 | [CLAUDE.md](../../CLAUDE.md#glossary-use-these-words-in-code-ui-and-chat), "Source" | Dataverse, Outlook or Google | The status bar also reports PTO as its own source, and DevOps reports per client ([ui/status.ts](../../ui/status.ts) `SOURCE_NAMES`) |
| 9 | [docs/decisions.md](../../docs/decisions.md) D79 | Autostart runs `scripts/open-window.ts` | [system/coopilot.desktop](../../system/coopilot.desktop) runs `coopilot-open` (later decisions D85 to D88 changed this; D79 was not updated) |
| 10 | [CLAUDE.md](../../CLAUDE.md#hard-rules) | "Do not touch Hyprland" | Step 5.5 appended a key binding line to the user's Hyprland `bindings.lua`, with a backup, as authorized at the time ([docs/spec.md](../../docs/spec.md) section 20). Not a code mismatch, but the rule and the install steps read differently |
| 11 | [docs/demo.md](../../docs/demo.md) | Roadmap: "Plan ahead (coming next)" | Plan ahead was built in step 17 ([ui/PlanAhead.tsx](../../ui/PlanAhead.tsx)) |
| 12 | [docs/roadmap.md](../../docs/roadmap.md#rhythm-and-naming-agreed-oct-31-built) | "the top-bar Plan button (3) opens whichever of these fits" | Replaced by the mode switch and four tabs in step 16.2 (D324); key 3 is Roadmap ([ui/nav.ts](../../ui/nav.ts)) |
| 13 | [docs/spec.md](../../docs/spec.md) section 38 (step 15.3) | No separate "Add a follow-up" | `followup.add` is still in the registry and used by the follow-up form and Plan ahead's "ask owner" ([ui/FollowUps.tsx](../../ui/FollowUps.tsx), [ui/PlanAhead.tsx](../../ui/PlanAhead.tsx)). Probably fine: the form is reached from capture, not a separate entry point. Not verified which entry points the UI shows |
| 14 | [server/guard.ts](../../server/guard.ts), comment on `/api/reopen` | "takes no input and returns nothing" | It returns `{opened}` with status 202, or 503 when no window could be opened ([server/app.ts](../../server/app.ts)). Nothing sensitive, but the comment is out of date |

## Not verified

Claims in these pages that I could not confirm from code alone:

- The Dataverse role's exact table list (configured in Dataverse, not in the repo), in particular read on the PTO tables ([03](03-sources-and-auth.md#dataverse)).
- Whether the Azure `user_impersonation` scope needs admin consent in the Cooptimize tenant ([03](03-sources-and-auth.md#microsoft-graph-outlook-teams-presence-photos)).
- The Hyprland key bindings (Super + Alt + C and N); the binding file is outside the repo.
- How much of the step 17.5 brand work reaches the UI; the main checkout is still changing.
- That `recorded-*` DevOps fixtures contain no real names or titles; I did not open them.
- That nothing else prunes `plan.db.bak-*` files; the code doesn't.
- Disk encryption on the laptop (data at rest relies on it).
- That no CI runs the tests elsewhere; there is no CI config in the repo.
- An update procedure beyond "pull and restart".
- That every animation respects reduced motion; only two CSS rules handle it.
- The full contents of each Settings section; the list in [08](08-ui.md#settings-sections) comes from CLAUDE.md and the config sections.
- What the window shows for an unknown `#/` address.
- The worked example numbers in [05](05-planning-model.md#worked-example-demo-week) were calculated by hand from the rules, not read from the running demo.
- How views keep clients apart beyond the store and write paths ([07](07-security-and-privacy.md#client-isolation)).
- Test counts are from counting `it(` and `test(` lines, not from a test run; the tests were not run.

## Diagrams

All 8 Mermaid diagrams in this site (3 in 02, 2 in 03, 2 in 04, 1 in 06) were rendered with Mermaid CLI (`mmdc`) using the system Chromium, from a scratch folder outside the repo. None failed. At natural size the largest is about 1530 by 960 px; renderers scale them to the page width.

## Questions for the author

1. Item 1 above: should the CLAUDE.md DevOps rule say "never deletes work items; undo deletes only a comment Coopilot added", or should undo of a comment soft-hide it some other way?
2. Items 2 and 3: fix the comment and the key legend text in a code step, or leave them?
3. Should the CLAUDE.md map and glossary be updated for items 7 and 8 (scripts, assets, docs; PTO and DevOps as sources)?
4. Is it fine to name the Dataverse app user and role ("Coopilot Dataverse Reader", "Coopilot Reader") and the "Coopilot Desktop" registration in docs shown to colleagues? They are names, not IDs.
5. For the hosting question in the FAQ: is there a preferred answer on cost, or should it stay "not estimated yet"?
6. Should these docs be published somewhere (for example a private GitHub Pages site or a Claude artifact), or kept in the repo only?
