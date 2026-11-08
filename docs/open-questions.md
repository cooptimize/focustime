# Open questions

Mirrors section 16 of spec.md. Update both when one is resolved.


Blocking this slice:
- Q1. ~~Dataverse schema~~ Resolved, see 0b. Verified Oct 31 (step 2): all 9 of my rows have an Account Worker with user and account, while only 2 have `coop_systemuser` filled in, so the Account Worker link is the right source.
- Q1b. ~~Open vs Internal~~ Open.
- Q2. ~~Half-day hours~~ Soft day shape, see section 6.
- Q3. ~~Machine inventory~~ Done, see section 0.
- Q4. Agree to D21 auth approach. Dataverse part is done and working (step 2); Outlook and Google are built (step 3, D48) and wait on real sign-in.
- Q5. ~~Stack~~ Option A.

Schema confirmation without installing anything: while signed into the Cooptimize Dynamics environment in Chromium, open
`https://<org>.crm.dynamics.com/api/data/v9.2/EntityDefinitions(LogicalName='<table>')?$select=LogicalName,EntitySetName&$expand=Attributes($select=LogicalName,AttributeType)`
This is a read-only GET using the existing browser session. Alternatively, view the table's columns in the Power Apps maker portal.

Not blocking this slice:
- AI provider choice (needed from Milestone 4).
- Per-client DevOps config location (needed for Milestone 6, but PAT column security should be set now).
- Teammate focus display.
- Client color choices (defaults until chosen).

Raised in step 1 (not blocking):
- Q6. Which client is on which pattern? The sample guesses Mon AM Proseware, Mon PM + Tue PM Adatum, Tue AM Internal, Wed All Day + Thu AM Tailspin & Wingtip. Real data replaces this in step 2.
- Q7. ~~All-day and OOO Outlook events~~ Resolved in step 3 (D54): out of office puts covered half-days at risk; other all-day Outlook events are a watch only if busy.
- Q8. ~~Personal events on Open half-days~~ Resolved in step 3 (D54): shown, never flagged.
- Q9. The kickoff folder and zip (`coopilot-kickoff/`, `coopilot-kickoff.zip`) are still in the repo folder and git-ignored. Their docs were copied to the repo root. Delete them when you're happy.

Raised in step 2 (not blocking):
- Q10. The internal account's nickname is "Cooptimize", and that is what the grid shows. Should it show as "Internal" (the glossary word) instead?
- Q11. ~~Sample meetings over real blocks~~ Resolved in step 3 (D53): sample meetings show only for a calendar with no config section. Sample meetings now sit on top of your real focus blocks, so some risk badges this week come from sample meetings. Keep that until step 3 (as now, labeled sample), or hide sample meetings once Dataverse is live?

Raised in step 3 (not blocking):
- Q12. Google publishing status. Google requires a homepage and privacy policy URL to switch an External app to production, so FocusTime stays in Testing for now. In Testing, Google ends the sign-in after 7 days and the status bar asks to reconnect. Option: two small public pages (for example on GitHub Pages) to unlock production. Decide after living with weekly reconnects.
- Q13. Ranking of double-booked block and all-day event in the single badge (D58) was my placement, not requested. Confirm or reorder.

Raised in step 4 (not blocking):
- Q14. T&W had no DevOps email on my Account Worker row. As of Oct 31 (step 4.5) it is filled in, and T&W now shows "No access to DevOps project Tailspin Wingtip for T&W" (403 or 404): check the T&W PAT scope and the project name in Dataverse.
- Q15. Adatum's `coop_devopsprojectid` in Dataverse does not match the real project ID (the name works, so FocusTime uses names first). T&W and Proseware have no project ID. Correct them in Dataverse if IDs are wanted.
- Q16. PAT column security (D24) matters more now that FocusTime reads PATs: any identity with read on Accounts can read every client's PAT. Consider securing `coop_devopstoken` and granting the FocusTime app user read on it only.
- Q17. Microsoft retires global PATs on December 1, 2026. Any client PAT created as a global PAT stops working then; recreate as organization-scoped PATs before that date.
- Q18. (Still open; not the cause of Proseware's 0, D84. A per-project "treat as open" state list is ready to build when wanted.) Some client processes put Blocked states in the Removed category (Proseware: Task "10-Blocked", User Story "07-Blocked"), so blocked items are hidden, as the metadata says. Keep that, or treat Blocked as open?
- Q19. (Answered in step 5, D75: standing-block clients are always fetched.) Cooptimize items show because the Monday AM standing block is Cooptimize. If that block is removed, Cooptimize work only shows in weeks with a Cooptimize focus block. Always include it?

Raised in step 5 (not blocking):
- Q20. (Answered, D80: Recurring pickable through config, Domain not.) Cooptimize's process puts custom types "Domain" and "Recurring" on its portfolio backlogs, so they can't be picked; they open into children or "Needs breakdown". Recurring work may be better as an intention, or the type could move to the requirement backlog in DevOps. Keep as the metadata says?
- Q21. (Answered, D81: every Account Worker client. Superseded for DevOps and Open half-days by D144: only clients followed by focus time.) Open half-days offered only this week's DevOps clients (focus clients plus Cooptimize). Should they offer every client you're an Account Worker on (HME, Antigua), at the cost of more DevOps calls?
- Q22. (Answered, D82: local until the write step.) Draft stories live only in FocusTime. Creating them in DevOps would be a write, which is out of scope; for now copy them by hand when you break the feature down.
- Q23. (Answered, D83: start to start + 90 minutes.) The reminder fired once between the day start and the usual end, even if the server started late (for example 2 PM). Prefer it only near the start time?
- Q24. ~~Window after a service restart~~ Resolved (D85, D87): `focustime-open` (launcher, key binding, autostart; the developer loop since A1) starts the service if needed and replaces a window left from an earlier server run.
- Q25. (Explained, D84: the Proseware DevOps email in Dataverse ends in @proseware.example, your DevOps identity in @proseware-devops.example; fix it in Dataverse.) Proseware returned 0 open items assigned to you (it had 2 in step 4), and T&W is now readable (3 items). Worth a glance that both match your boards.
- Q26. HM Electronics now shows "DevOps PAT expired or invalid" (fetched since D81). Renew its PAT in Dataverse, or say if HME should be left out.
- Q27. Cooptimize's "Ongoing" type is also on a portfolio backlog and stays unpickable. Add it to `pickable_portfolio_types` too?

Raised in step 6 (not blocking):
- Q28. (Answered, D105: no partial PTO; every PTO day is a whole day off.) Partial PTO has no time of day in Dataverse (only hours), so FocusTime takes it from the afternoon first (D99). If the detail rows or another field ever carry a time, use it; or say if mornings should go first.
- Q29. (Answered, D106: yes, PTO days are skipped.) Should the next workday (D97) skip a full PTO day? Today it doesn't: on Wednesday evening it targets Thursday Nov 5 even though it is PTO, and the panel says nothing can be planned there.
- Q30. (Answered, D107: not for now; revisit when Friday has working hours.) Should Plan the day ever target Friday (the overflow day)? Today only Mon–Thu are targets; Friday can still take picks by moving them there.
- Q31. (Answered, D108: keep the names; a missing table or column is a named error.) The FocusTime app user gets 403 on Dataverse metadata (EntityDefinitions), so the PTO table names were confirmed by reading data, not metadata. Fine as long as the names stay; grant metadata read if schema checks are wanted.
- Q32. (Answered, D109: with detail rows, those dates; with none, every weekday from start to end.) Some trackers have fewer detail rows than their hours (Boston trip 9/2–9/6, 16 h, details only on 9/2 and 9/3), and one detail day is duplicated (3/5). FocusTime trusts detail rows when present and counts a duplicate once. Is that how the tracker is meant to be read?
- Q33. Neutral follows the system light or dark setting (it is the step 6.1 palette, which has both), while the two Cooptimize themes are fixed. Keep that, or make Neutral one fixed dark theme (the style guide's "Neutral Graphite")?

Raised in step 6b (not blocking):
- Q34. ~~Flex overlap~~ Answered: only the part outside working hours counts, the overlap is noted, a session fully inside is refused (D134). Was: A flex session is refused when it overlaps working hours (it would count twice). Should overlapping be allowed and mean "extend the day" instead?
- Q35. The migrated config keeps the old zero-length lunch ("12:30-12:30"), so capacity is unchanged. Set a real lunch (e.g. 12:00-12:30) in Settings when ready; it lowers capacity by that much every day.
- Q36. ~~Planning settings~~ Answered: sizes, carry days and reminder offset are in Settings > Planning (D135). Was: Settings > Planning holds only the pickable portfolio types. Pick sizes (S/M/L minutes), the carry-over rule and the reminder time are still fixed in code. Make them settings?
- Q37. ~~Reset and audit log~~ Answered: Reset local plan with a typed confirmation and a backup first; the audit log waits for the write framework (D136). Was: Settings > Data has export only. The audit log of settings changes and "reset to defaults" from the roadmap are not built; the config backups folder is the history for now. Wanted next?
- Q38. ~~Draft picks in the Now strip~~ Answered: shown dimmed and labeled draft (D137). Was: The Now strip counts and suggests picks for today only, and only once the day is committed. Should it nudge to plan ("Not planned yet, P") on an uncommitted workday?
- Q39. ~~Show focused time~~ Answered: "45m of M" on picks, day totals in Plan the day and the week (D142). Was: Focused time is recorded per pick (D140) but not shown yet. Show it on the pick (e.g. "35m focused") now, or wait for Close out?
- Q40. ~~Fresher warnings~~ Answered: calendars reload every 5 minutes while a timer runs (D143). Was: Timer warnings use meetings known at the last week load (D139). Should the server refresh today's calendar on its own while a timer runs, or is the auto refresh enough?

Raised in step 7 (not blocking):
- Q41. Proseware's blocked states sit in the Removed category (Q18), so those items never come back from the open-items query and the blocker rule can't see them. Treating Blocked as open for Proseware (`open_states` in Settings > Clients) would let it. Do that?
- Q42. ~~Closes on completion or a change by me~~ Answered: closes only on a Completed or Removed state category, or a change after it opened whose System.ChangedBy is my DevOps identity for that client (D156). Was: The DevOps update follow-up also closes when the item changed after the follow-up opened, whoever changed it (a comment or a field edit by someone else counts). Good enough, or should it wait for a state change only?
- Q43. ~~Blockers nudge again~~ Answered: a blocker follow-up closed by hand opens again if the item is still blocked 3 workdays later (D157). Was: A blocker follow-up closed by hand stays closed while the item stays blocked; it opens again only after the block clears and returns. Should a long block nudge again (say, weekly)?
- Q44. The slip rule skips internal clients (Cooptimize, standing blocks) and uncommitted days. Should a slip on an internal block open a follow-up too (for example, to tell a teammate)?
- Q45. ~~Carry-over waits for the session~~ Answered: a pick being made up in an evening or weekend session is not carry-over until that session ends (D158). Was: A pick made up tonight shows as carry-over in Plan the next workday before tonight is over. Hide it until the evening has passed?
- Q46. ~~Note for another client~~ Answered: Close out offers "+ note for another client" for any followed client (D159). Was: Close out lists clients for notes from done picks, focused time, flex sessions and the day's focus blocks. A client worked outside its block with no pick or timer won't be listed. Add "Note for another client…"?

Raised in step 8 (not blocking):
- Q47. ~~Story level missing~~ Answered: a project with no story level gets a clear per-client error, nothing guessed (D169). Was: The feature tier is the lowest portfolio backlog in each project's process configuration, and "above it" relies on Azure DevOps listing portfolio backlogs top-down (Epics, then Features). The docs don't promise that order; the sample and every real project seen so far follow it. A process with a custom level between Epic and Feature would still work, but one listed bottom-up would swap the tiers. Worth a per-client override?
- Q48. ~~Borrowed time in fit~~ Answered: only unpaid borrows paid back in that week or with no payback date (D169). Was: Fit subtracts all of a client's unpaid borrowed time from that week, whatever its payback date. Borrowed time paid back in an evening or on a Friday never really touched a focus block. Subtract only borrows whose payback falls on a focus block that week?
- Q49. ~~Epics above~~ Answered: parent links are followed up to the top portfolio level (D169). Was: Epics are shown only when assigned to me or the parent of a feature I see (a parent of my stories' feature is not read). Should epics two levels up (the epic above a feature I only reach through my stories) be read too? That is one more batch read per client.
- Q50. ~~Skipped nudge~~ Answered: it fires at the start of my next working time (D169). Was: The Thursday nudge is skipped on a PTO day (as the other reminders are) and does not fire later; Friday's then does. On a Thursday-and-Friday PTO, only Monday's nudge (for this week) remains. Fire the skipped one on the next workday instead?
- Q51. ~~Current titles~~ Answered: the current DevOps title always; the stored one only when DevOps is unreachable (D169). Was: Committed features are stored with their title at commit time. A renamed feature keeps its old title in the week cards and in a past week's review until it is committed again. Refresh titles from DevOps on each read of the current or next week?

Raised in step 9 (not blocking):
- Q52. ~~Global capture key~~ Answered (D192): a desktop key binding in the developer loop. Was: The global capture key isn't bound (D178).
- Q53. Draft stories with no feature show only in Plan the day for that client. Should Plan the week list them per client too, so they can be put under a feature later (today that means deleting and capturing again)?
- Q54. Numeric dates are read US style (11/14 is Nov 14). A bare weekday word ("monday standup notes") is read as a date but only makes a follow-up when led by by/due/before/until. Keep both?
- Q55. Notes can be searched and deleted but not edited, and a sorted capture can't be re-sorted. Add edit, or "undo sort" for a few minutes?
- Q56. The Capture view has no tab or key of its own after the top-bar fit (D177); it opens from the dialog, the command menu, Close out and Plan the week. Give it a key (say Shift+N)?

Raised in step 10 (not blocking):
- Q57. Media pause uses playerctl, which isn't installed here. Install the `playerctl` package (official repos) so Settings > Focus can pause and resume music? Nothing was installed.
- Q58. A playlist picked on the focus screen opens at once (`playlist.open`); there is no per-playlist default that opens on every focus start. Add "open this playlist when focus starts" to Settings > Focus?
- Q59. Plan the day now shows candidates for one block at a time. Is that calmer, or do you want every block's candidates at once on very wide screens (3840)?
- Q60. The Plan button opens Plan the day all morning even when today is committed (it doesn't jump to Check-in until the morning ends). Keep, or switch to Check-in once committed?
- Q61. Done and Stop on the focus screen go back to Today. Should Done offer a break first (the F menu still has Break)?

Raised in step 11 (not blocking):
- (Answered Nov 1, D205: Q62 to Q66.)
- Q62. Cooptimize is internal, so dropping one of its committed musts offers no heads-up (as the slip rule). Should internal musts offer one too (to a teammate)?
- Q63. `actions/` imports `links/edge.ts`, a pure but Edge-specific launch argument builder. Move it behind a host adapter now, or when a hosted version is started?
- Q64. Stories on the list are added from my assigned stories and a listed feature's children. Should Add also offer unassigned stories under a client's features that aren't on the list?
- Q65. A must counts as done in DevOps only when its state category is Completed; Resolved (for example "Resolved" or "Ready for test") still counts as open. Count Resolved as done for the week?
- Q66. Q53 is partly met: typed intentions not in DevOps become draft stories with no feature from DevOps health. Draft stories with no feature still aren't listed in Plan the week. List them per client?


Raised in step 12 (not blocking):
- Q67. (Done Nov 1, D216.) Live verification needs you to click "Reconnect Outlook with calendar changes" (Settings > Connections) and consent to Calendars.ReadWrite once. If your tenant blocks user consent for that scope, add the delegated permission to the Coopilot Desktop app registration and grant it. Then I run the create, move and undo check on a free slot next week.
- Q68. Undo is a stack per event (newest change not undone first, so undoing a move and then the create works). Enough, or do you want to undo any entry out of order?
- Q69. (Done Nov 1, D219: rebuilt from the marker with the write token.) If the local record of an event is lost (store replaced, not Reset), reads can't recognize it (no marker without Calendars.Read), so it would show as a meeting. Use the write token to look up marked events in the week when write access exists?
- Q70. (Done Nov 1, D218: two-way sync, conflicts ask.) Timeboxes don't yet sync from Outlook back to FocusTime: an event moved in Outlook keeps its FocusTime time, and the next move puts FocusTime's time back after a preview. Keep (FocusTime is the source), or adopt Outlook's time?


Raised in step 13 (not blocking):
- Q71. (Answered Nov 1, D236: keep them treated like meetings.) Repeating and all-day events I organize alone are not editable (series edits could move every occurrence). Allow moving one occurrence of a series?
- Q72. (Answered Nov 1, D236: tentative stays busy.) Tentative counts as busy for teammates. Treat tentative as free for help sessions?
- Q73. With nobody chosen, FocusTime picks one person per time. Should it invite two from the top tier instead?
- Q74. (Answered Nov 1, D236: DevOps writes first, then RSVP.) RSVP to meetings (accept, tentative, decline with a note) behind preview and confirm is in the backlog. Next after DevOps writes, or before?
- Q75. A custom time zone in someone's working hours uses its standard offset only (no daylight rule). Fine, given Cooptimize uses named zones?

## Step 13.5 (Nov 1)

- Q76. (Answered Nov 1, D239: at most three per card, then "+N more".) Follow-ups show on every block of their client in the week (once a day, on the client's first block). Too much when a client has many open follow-ups? A cap of three per card with "and n more"?
- Q77. (Answered Nov 1, D248: keep the due date and its badge.) A snoozed follow-up comes back on its day. Should a snoozed one with a due date before the snooze day keep its due badge, or should snoozing move the due date too?
- Q78. (Answered Nov 1, D238: Friday never asks; weekends still do.) Moving a pick to a day with no working hours asks every time. Should "Move anyway" be remembered for Friday catch-up (Friday is the overflow day and has no hours by default)?
- Q79. (Answered Nov 1, D248: not until it is in DevOps.) Draft features stay local until added in DevOps by hand. Should Coop briefs also cover a draft feature (asking Coop to propose stories for it) before it exists in DevOps?
- Q80. (Step 14. Answered Nov 1, D258: connectionData only, no Profiles fallback; refuse when it names no identity.) `_apis/connectionData` is the identity check for a write PAT but isn't documented on Learn. It is verified live once; if it ever changes, should the check fall back to the Profiles API (`app.vssps.visualstudio.com/_apis/profile/profiles/me`, needs the Profile read scope)?
- Q81. (Step 14. Answered Nov 1, D257: a parent is required; Create in DevOps asks for one first.) Drafts with no parent can't be created in DevOps (area and iteration come from the parent). Should FocusTime offer a project default area and iteration instead, or keep "put it under a feature first"?
- Q82. (Step 14. Answered Nov 1, D256: yes, a Today line within 14 days, for write PATs and app secrets.) Should FocusTime warn when the write PAT is near its expiry (today: a note under 14 days in Settings) with a Today urgent line as well?
- Q83. (Step 15.2. Answered Nov 2, step 15.3: deleted; pick 6 kept.) Picks 10, 12 and 13 (Mon Nov 2 PM, one work item) are leftover duplicates, all already dropped; only pick 6 is planned. Delete the dropped rows from the plan store, or leave them (they show nowhere)?
- Q84. (Step 15.3. Answered Nov 2, step 15.4, D312: leave Who empty unless the text names someone.) A follow-up captured with no name in it ("I'll send the report by Friday") gets the client's name as Who, from the step 9 rule ("owed to <client>"). Keep that, or leave Who empty unless the text names someone?
- Q85. (Step 15.3. Answered Nov 2, step 15.4, D312: the strip in Plan the day is enough; no add pane in the Week view.) Plan the day and the Week view are never on screen together (D263), so "drag onto Week cards" is a strip of the week's other days that appears while a right-pane row is dragged (D300). Is that enough, or should the Week view also get an add pane to drag from?
- Q86. (Step 15.4. Answered Nov 2, step 15.5, D316: no DevTest Labs VM support for now.) The VM's auto-shutdown schedule name (`shutdown-computevm-<vm>`) and task type (`ComputeVmShutdownTask`) aren't on Microsoft Learn's REST pages; FocusTime reads whatever schedule has that name and changes only its daily time and status. Confirmed on the live VM at verification (see the step 15.4 report). If a VM's auto-shutdown lives elsewhere (a DevTest Labs lab VM), FocusTime shows "No auto-shutdown schedule": support labs later?
- Q87. (Step 15.4. Answered Nov 2, step 15.5, D316: Start in the morning box starts at once, setting "Start my VM without asking", default on.) Start from the morning prompt is one click (the prompt says which VM and that it starts; it's logged like any other start), while Start from the chip shows a preview first. Keep that difference?
- Q88. (Step 15.4. Answered Nov 2, step 15.5, D316: only for demo mode and offline use; real data needs the sign-in.) "Continue without signing in" on the sign-in screen works for that window only (calendars and Azure stay unavailable; Dataverse and the plan work as before). Keep it, or remove it once hosting starts?
- Q89. (Step 15.4.) Hosted direction: Dataverse is still read with the app-only identity (client secret in the keyring). A hosted FocusTime for any Cooptimizer should read Dataverse delegated per user (the signed-in person's own Dataverse permissions). Revisit with the hosting design.
- Q90. (Step 15.5. Decided Nov 2, step 16.2, D322: no further work on buttons; keep "Click to…".) The developer desktop's notification service reports the "actions" capability but its notification card draws no buttons; only a click on the card (the "default" action) works. FocusTime still sends its buttons (Done, +15 min, Next pick, Start, Restore) for desktops that show them, says "Click to…" in each body, and a click opens the view where those buttons are. Revisit if the shell adds action buttons (or ask upstream)?
- Q91. (Step 15.5. Done Nov 2, step 16.2, D323: closed through CloseNotification, which the developer desktop honors.) A held notification checks whether it still matters when focus ends (the day got planned, the follow-up closed). Sent ones aren't withdrawn from the shell when that happens; FocusTime doesn't close notifications it sent. Close them (CloseNotification) when the thing is done?
- Q92. (Step 16.3. Decided Nov 2, step 16.4, D343: accept as is.) Graph can't read a preferred presence apart from the aggregate, so a manual Busy set in Teams during a FocusTime Busy session looks the same as FocusTime's and is cleared at the end. Accept, or offer "Keep my status after focus" in the focus screen?
- Q93. (Step 17.5.) The brand brief's full surface and text palette (backgrounds, panels, text greys) is not applied; only the brand tokens are. Apply it to the Cooptimize themes later, with a contrast check of every view, or keep the current surfaces?
- Q94. (Step 17.5.) A "zero at-risk week" moment (Lumen bobs once when the week has no at-risk blocks) is not built. Suggested place: Week › Plan the week, right after Done when the planned week has no at-risk block, as a moment over the app like Close out's (never in the Week view itself, which stays Lumen-free). Build it?
- Q95. (Step 17.5, brief B08.) Live favicon: the tab and tray icon showing the real week's fills (planned, done) instead of the static mark. Queued as an app feature; it would make the icon carry information, so it needs a rule for when Lumen and the mark may do that.
- Q96. (Step 17.5.) The PNG icons were delivered rendered on a dark rounded tile that isn't in `assets/brand/tools/`. To re-render them (only if mark-week changes), the tile and its render step need adding to the tools first.
- Q97. (R1.) The Dataverse application user "Coopilot Dataverse Reader" and its role "Coopilot Reader" keep their names. Renaming an application user is a Dataverse admin task (Power Platform admin center), and nothing in FocusTime depends on the name. Rename them to "FocusTime Dataverse Reader" and "FocusTime Reader" when convenient? The Entra app registration "Coopilot Desktop" also keeps its display name, which is what Microsoft's consent screen shows. FocusTime can't rename it: its delegated sign-in has no permission to change app registrations (Application.ReadWrite.All), and the Azure CLI isn't installed. Rename it to "FocusTime Desktop" in Entra > App registrations > Branding & properties. The client id, scopes and redirect URIs stay the same, so there's no re-consent.
- Q98. (R1.) Migrate the Outlook marker? Events carry the extended property `CoopilotId` (fixed GUID namespace). A rename would mean reading both names for a while, rewriting each future event's marker, and leaving past events as they are, which is a lot of writes for a name nobody sees. Recommended: never. The property is invisible in Outlook, and CLAUDE.md records it as the historical name.
- Q99. (fix/vm-schedule, D475. Open: decide before anything is built.) A safe "Skip tonight". Checked against Microsoft Learn on Nov 3, 2026: the auto-shutdown article (updated Jun 24, 2026), the DevTest Labs auto-shutdown article (updated Sep 18, 2025) and the Global Schedules REST reference (api 2018-09-15, updated Jun 18, 2026).
  - **What Azure offers.** The schedule's notification can go to an email address and a webhook (`properties.notificationSettings`: status, timeInMinutes, emailRecipient, webhookUrl). The webhook gets an HTTP POST with skipUrl, delayUrl60, delayUrl120, vmName, owner, eventType, minutesUntilShutdown and a few more fields. The docs describe those links as "Skip the autoshutdown this time" and "Delay the autoshutdown for an hour / 2 hours". The email carries the same links, and the person can click them already.
  - **What the docs don't say.** Whether the links need sign-in, how long they stay valid, and whether using one changes the stored schedule or only tonight's run. There is no REST operation to skip or postpone one run. Update (PATCH) changes tags only. Execute "executes a schedule" (runs it, which is the opposite of a skip).
  - **The catch.** webhookUrl lives inside the schedule resource. Adding or changing it is a PUT of the whole schedule (Create Or Update, needing Microsoft.DevTestLab/schedules/write). By D475 that is modifying the user's schedule, and it would also take over a webhook the person may have set themselves. A webhook also needs a public HTTPS endpoint that is up when the notification fires (30 minutes before by default), and a way to tie each call to a person and VM safely.
  - **Options.**
    - (a) Nothing in FocusTime. The person uses the Skip or Delay link in Azure's own email (on by default in the portal, 30 minutes ahead).
    - (b) FocusTime shows "Shutdown at 7:30 PM. Use the link in Azure's email to skip or delay" in the VM menu (read only, no Azure write).
    - (c) The person adds FocusTime's webhook to their own schedule in the portal, by their own choice. FocusTime then receives the skip and delay links and offers them as a button in the evening notice. FocusTime never writes the schedule, but it needs a public endpoint, per-person webhook secrets, and a check of how the links behave.
    - (d) Start the VM again after it shuts down (start is allowed). This doesn't stop the shutdown, so work in progress is lost.
  - **Recommendation:** (a) now, with (b)'s one line if wanted. Consider (c) only after a manual test on one VM shows the skip link affects tonight alone and needs no sign-in, and only as opt-in that the person sets up in the portal.

## T-2 (Nov 3)

- Q-T2-1: Chat.ReadBasic must be granted for the tenant (run `infra/scripts/app-registration.sh` after its dry run) or allowed by each person at sign-in; until then Connections says "Not allowed yet" and the picker says so. Who runs it, and when?
- Q-T2-2: The picker lists at most 500 chats (10 pages of 50, most recently changed first). Enough for Cooptimizers, or add a search that pages further?

## AP-1 (Nov 4)

The scope's open questions (`docs/scope/asks-and-promises-scope-v0.1.md`), with what this step learned:

- Q-AP1-1 (scope 1): One delivery chat per client, or several? AP-1 supports several per client, one client per chat, each with its own Read for asks switch (Part A). AP-2 kept Allow AI per client (D501): a client's chats all share it. Still open: whether anyone needs AI on for one chat of a client and off for another.
- Q-AP1-2 (scope 2): Asks from external people who aren't the client lead? Treated the same, author shown with External. Guests count as external (by tenant, D485). Still open: should a second-tier contact (vendor, contractor from a third tenant) be shown differently?
- Q-AP1-3 (scope 3): Keep unmatched messages 14 days? Yes (D492): Show context needs them. Each person's copy is separate, so a chat read by three people is stored three times; fine at this size, but a shared per-client store would need a different access model. Purging across people has no admin path yet (runbook).
- Q-AP1-4 (scope 4): Polling interval, and pause during focus? Every 5 minutes in working hours, not on PTO days, and it keeps reading during focus; AP-1 sends no notification for asks at all. About 12 Graph calls per chat per hour at the default (one page of up to 50; more only for busier chats, at most 5 pages). AP-2 answered: only asks sorted "now" notify, once each, held during focus unless "Let urgent asks through" is on (D504).
- Q-AP1-5 (new): Chat.Read is per-person incremental consent (D490). If the tenant ever turns off user consent, an admin grant is needed; nobody has tested that path yet.
- Q-AP1-6 (new): Edited messages: a message edited after it was read comes back (the filter is on last modified) and is skipped because it was created before the last read. Should an edit that turns a message into an ask be picked up?
- Q-AP1-7 (new): Replies in a group chat have no thread; "reply to" only exists as a quoted message reference, which AP-1 doesn't treat as an attachment and doesn't follow. AP-2 doesn't follow it: the earlier messages give the AI enough to say what a promise answers (D505). Still open for AP-3's auto-close suggestions.
- Q-AP2-1 (new): Urgent asks found by Refresh show on Today but don't notify (only the scheduler's read does, so one ask never notifies twice). Is that what people expect when they press Refresh during focus?
- Q-AP2-2 (new): The walk-on chip stays on Today while the ask is open, even past its 2-hour "now" window (then it also counts in Check-in). Should it leave Now once the window ends?
- Q-AP2-3 (new): The 50 open items the AI sees are the most recently changed; for a client with hundreds of open items, the matching one may be older. Should the list be narrowed by words from the message first (no AI), or is "Looks like" only a hint?
- Q-AP2-4 (new): Promise phrases are English only and match anywhere in the message, so without AI "let me know" and "see you tomorrow" make promises too (with AI they are usually "not a promise"). How noisy is it with real chats, and should the default list be narrower?
- Q-AP2-5 (new): A promise answered by a later message (the file was sent) stays open until its follow-up or item is done (D506). AP-3 proposes suggesting a close; until then, people close it by hand.

## Shared polling (Nov 4)

- Q-SP-1: Q-AP1-3 and Q-AP1-6 are answered by D516 (one copy per message; an edit replaces the stored text, but never makes a new Request). Should an edit that turns an unmatched message into a request become one? Not in this step (no rule changes).
- Q-SP-2: The token owner's request phrases decide the candidates (D518), so a chat's candidates can change when the token moves to another follower with different phrases. Make the phrases a client setting, or the app's?
- Q-SP-3: "Needs reconnecting" retries every 5 minutes inside working hours with nobody's token working (one cheap check per follower). Back off after a day, or tell the registering person by notification?
- Q-SP-4: Delete stored messages now removes a client's unmatched messages for everyone who sees its chats. Should that need the registering person, or an admin?
- Q-SP-5: The assignee column is in place (D518); who may assign, and does an assigned Request show only to its assignee on Today?
- Q-SP-7: Answered by D523: every chat is registered; reading stays on only where someone had switched it on, the rest wait for an admin.
- Q-SP-8: A catch-up read takes the newest 250 messages per chat (5 pages of 50, as since AP-1) and moves the watermark past them, so a chat with more than that since its last poll (dev after a long scale-to-zero, a very busy night) skips the older ones. Page further for catch-up, or say so on the chat?
- Q-SP-6: The per-person AP-1 tables (`delivery_chats`, `chat_messages`, `asks`) are no longer read. Drop them (with `safe-drop`) in the release after this one is in prod.

## Costs (Nov 4)

- Q-COST-1: Budget alerts per environment (for example $175 prod, $50 dev, at 80% actual and 100% forecast)? A budget needs a contact email or an action group, which the repo doesn't hold (D524). Whose address, and in Bicep (with the address as a parameter outside the repo) or set by hand in Cost Management?
## Draft Stories (DS-1, Nov 4)

What DS-1 learned, and what is still open:

- Q-DS1-1: Are text signals enough? Most of the features with no stories have a short description and few comments, so the house style and the examples carry the draft. DS-2 would add attachments, linked documents and the Requests-origin context (the ask a feature came from). Try it on real features on dev first and note where the drafts miss.
- Q-DS1-2: Sizes stay in FocusTime (D530). Should Publish also write Story Points or Original Estimate when the process has them? It's a new write, so it needs its own authorization.
- Q-DS1-3: Dependencies are written as "After: <title>" lines in the description, not as Predecessor links. Real links need a second write per story (a relation patch after both exist). Worth it?
- Q-DS1-4: The exemplar pool is the 100 most recently changed features in the done or active states. A client with many old, well split features may get poor examples. Should the pool include a person's "use this one" pins?
- Q-DS1-5: Created stories are assigned to the person who publishes. Should the sheet offer unassigned, or the feature's owner?
- Q-DS1-6: Run needs the client's write PAT so nothing is spent on a draft that can't be published (D525). Some people may want to draft and copy the text without writing; a Copy as text button would allow that.
- Q-DS1-7: The house style is per person (each person's own row). Should a client's team share one edited style?

## Conversations (CV-1, Nov 4)

- Q-CV-1: Should a client lead be able to Take it over for a client they don't follow? Today only people who see the chat (members who follow the client) can, leads included. ADM-1's `isClientLead` may change who counts.
- Q-CV-2: Is 200 AI calls per chat per day the right ceiling? Dev's first day will show real numbers (`convs.counts(day).aiCallsToday`).
- Q-CV-3: Should "Not a request" have a short list of reasons (social, already handled elsewhere, wrong chat) instead of free text?
- Q-CV-4: When the AI says a commitment implies an item but the committer is outside FocusTime (no user row), who gets the Create? Today nobody until a lead takes it over.
- Q-CV-5: AP-3 (Teams messages from FocusTime) would need a write scope and a new hard rule; nothing in CV-1 posts to Teams.

## Admin (ADM-1, Nov 4)

- Q-ADM1-1: Plan data retention is shown as a 2-year Rule, but nothing purges yet. A purge job (per person, oldest first, logged as counts) is a later step; which tables it covers and whether people get a notice first is open.
- Q-ADM1-2: Resolved by ADM-2 (D582): the poll job and the purge read the Rules each cycle.
- Q-ADM1-3: Resolved by ADM-2 (D583): Admin › People maps positions to levels.
- Q-ADM1-4: In the demo, Admin › Clients' process switches change the demo's process view but not the demo week's picks; worth wiring if the demo is used to show them.
- Q-PV1-1: Take one's quiet note (`story_taken`, D573) is a notifier kind, on by default, but Settings > Notifications lists its kinds by hand and PV-1 didn't edit Settings. Adding it to the Other group is one line for the step that owns Settings.
- Q-PV1-2: Plan the day doesn't match Week's panel yet: it still offers this week's musts with their stories and Everything else, without grouping my stories under features, Planned elsewhere marks, No stories for you yet or Take one. Matching it means the Add pane using `blockStories` for the block's client, and its rows taking drags onto its blocks with `dropCheck`.

## Navigation (NV-1, Nov 5)

- Q-NV1-1: "Intention" is still the word for a pick that is neither a DevOps item nor a draft. A person reads it in the block menu's "Add an intention" and its dialog "Intention for <day> <half>" (`ui/menu.ts`), a pick's disabled "Open in browser" ("An intention has no link", `ui/menu.ts`), Check-in's walk-on choice "Typed intention" (`ui/Today.tsx`) and the key legend for A (`ui/keys.ts`). Plan today's type box calls the same thing "a plain note, not in DevOps". NV-1 kept the wording. Should there be one word everywhere, and which one?
- Q-NV1-2: Resolved by CV-2 (D620): each urgent strip line opens its own conversation or promise (`#/inbox/conversation/<id>`, `#/inbox/promise/<id>`).
- Q-NV1-3: Ahead keeps "Roadmap" as its first mode's name. Is that the right name inside Ahead, or should it read "Features"?

## DevOps polling (DV-1, Nov 5)

- Q-DV1-1: `pollAccounts()` decides which clients are polled from people_clients and recent asks; it should be ADM-2's `clientAccounts()` once that merges (the TODO in `actions/devops-poll.ts`).
- Q-DV1-2: The Rule "DevOps check interval" isn't in Admin's form; the step that owns Admin's screens adds the field (the spec is in `config/org.ts`).
- Q-DV1-3: The old per-person DevOps snapshot files are no longer written but still on disk. Delete them in a later release, once DV-1 has run on prod a while.
- Q-DV1-4: Is 1 minute right in hours? Dev's Status rows show calls today and each call's TSTU cost; check them after a full working day before prod.
- Q-DV1-5: An item read once by id (a parent outside the scope, an item on demand) stays in the store until the reconcile drops it. Should on-demand reads get their own expiry?

- Q-ADM2-1: `org.retention_years` is shown in Status as "Not enforced yet". Nothing deletes old data; a delete job (which tables, per person, oldest first, a notice first or not) is a later step.
- Q-ADM2-2: Guests are told apart from the ID token's `idp` and the UPN today. The `acct` optional claim (0 member, 1 guest) is the documented signal but must be added to the app registration's optional claims (`infra/scripts/`, an Azure change). Worth adding in the next infra step. Answered (HK-1, D612): `infra/scripts/app-registration.sh --claims-only` adds acct to the ID token; `guestToken` already reads it first.
- Q-ADM2-3: The automation flag isn't prefilled for the known automation account (no migration can read Dataverse, and naming a person in code is ruled out). An admin sets it once in Admin › People after the merge.
- Q-ADM2-4: Resolved by CV-2 (D620): `ui/nav.ts` takes hyphenated section names; a test opens all 7 Admin sections by address.

## Housekeeping (HK-1, Nov 5)

- Q-HK1-1: `infra/scripts/app-registration.sh`'s consent step uses `az ad app permission grant`, which deletes every grant the app has for that API (people's own incremental consents included; azure-cli issue 20974) and recreates one tenant-wide grant of GRAPH_SCOPES, which lacks Chat.Read (granted later for AP-1). A full run today would drop everyone's Chat.Read until they consent again. Until the step merges scopes into the AllPrincipals grant only (through Graph's oauth2PermissionGrants), use `--claims-only` for claim changes. Who owns the fix, and should Chat.Read join GRAPH_SCOPES?
- Q-HK1-2: The names guard's history exceptions (`docs/decisions.md`, `docs/azure/`) mean a real name can still land there. Should the guard cover them too, with an allowlist for the old entries?
- Q-HK1-3: Exception messages are redacted by pattern; an unquoted person's name or a client name FocusTime hasn't seen yet in this process could pass. Should errors that carry values move to typed errors with a fixed message?
- Q-HK1-4: The DevOps checks dominate ingest (about 0.35 GB a month in prod at 1-minute checks). If prod's ingest passes 2 GB a month, sample the `devops_check` job items that changed nothing first.
## Rolling into a new week (PL-1, Nov 5)

- Q-PL1-1 (for PL-2): When does a planning moment happen? The proposal shows whenever there are rows; should Monday morning prompt for it (a moment card on Today, a notification), and should Commit's Done wait for it?
- Q-PL1-2 (for PL-2): Churn: a feature carried over week after week. Should the row say "3rd week", and should a feature carried more than N times suggest Watching or a talk with the lead?
- Q-PL1-3: The amber rule starts on Wednesday. Is that right, or should it depend on the person's working days?
- Q-PL1-4: A removed feature gives no row. Should it say "Removed in DevOps" once, so a must doesn't vanish silently?
- Q-PL1-5: A check-in with nowhere to go this week (the client's blocks have ended, the rest is PTO or catch-up) waits for Add a check-in. Should it offer next week instead?
- Q-PL1-6: Commit's Add pane shows a target date that runs wider than a phone (`.pw-meta`); not PL-1's, seen in its screenshots.

## Conversations fixes (CV-2, Nov 5)

- Q-CV2-1: Resolved by CV-4: chat images are no longer stored at all (read from Teams on view, for the AI, or for a DevOps create), so there is nothing to move to Blob storage. The bytes CV-2 kept were cleared by `20261107T1400_images_no_bytes`; the column is dropped in a later release.
- Q-CV2-2: Resolved by CV-3 (D648): rules-only grouping for clients with AI off, behind the client Rule "Group messages without AI".
- Q-CV2-3: Resolved by CV-3 (D645): Capture's Who is the PersonPicker.
- Q-CV2-4: Resolved by CV-3 (D646): Link existing… suggests likely items with or without a conversation (rules only); Link doesn't start a conversation (Create still does, D628).
- Q-CV2-5: A promise that implies an item shows only Create the DevOps item? (Create, Link existing…, Not needed), as in CV-1: Make it a follow-up, Done and ⋯ come once it's linked. Past its due, should Make it a follow-up or Done be offered there too?
- Q-CV2-6: Resolved by CV-3 (D647): the Board rail shows "was due …" in amber, and carries earlier or untimed overdue promises to now on today's block.

## Sending work (SW-1, Nov 5)

- Q-SW1-1: Answered by AH-1 (D665): Send to… is on Break down's side panel action list in Ahead, for features.
- Q-SW1-2: A sender-side assign ("assign it to them now") could reuse AH-1's assign to someone else once it merges; SW-1 only offers the recipient's Also assign to me in DevOps (D635).
- Q-SW1-3: A send waiting when its week ends becomes Not answered and stays on the lists. Should it offer "Send for next week" to the sender, or drop off after a week?
- Q-SW1-4: Team shows features committed and watched only. Should a person's stories under a committed feature show as a count (never hours), or is the feature enough?
- Q-SW1-5: Ask to look goes to one lead. On a client with several leads, should it go to all of them, first to answer wins?
- Q-AH1-1: The Send to… dialog doesn't take focus when it opens, so Escape reaches what is behind it (over Break down's panel it closes the panel, not the dialog). Should the dialog focus itself on open? Left as SW-1 built it.
- Q-AH1-2: Stories in Grid have no side panel, so Send to… for a story is still from Week (Your stories, Commit). Should Grid rows get a ⋯ with the same list?
- Q-AH1-3: Should a lead's commit for someone else's item ask before notifying, or is the quiet note enough?

## Costs (HK-2, Nov 5)

- Q-HK2-1: Answered (HK-3, D702, D704): yes. A page counts only while visible with input in the last N minutes (the Rule `org.idle_minutes`, 10 by default, 5 to 60); timer calls are background and never move the server's last use. Was: One open tab kept prod "in use" all night on Nov 4 to 5 (about 150 `/api/action` calls an hour), so the idle rule never let the scheduler sleep: the pollers and the container stayed busy, and before HK-2 the database stayed awake. Count someone as active only while a tab is visible and there has been input in the last N minutes? Not HK-2's step (app code).
- Q-HK2-2: The workbook's views (merges, group-by sums, the Yesterday column) are built from gallery-proven settings but couldn't be rendered from the CLI; check dev's copy after the merge against the PR's expected figures before deploying prod. If a view doesn't sum, the fallback is a second query for that view only.
- Q-HK2-3: The budget alerts go to one person's address (FT_BUDGET_EMAIL) and the resource group Owners. A mail-enabled FocusTime Admins group, or an action group, would reach every admin; worth it once there's more than one?
- Q-HK2-4: The Container Apps free grant is per subscription and shared with every other app in "Production Services and Apps", so prod's container cost depends on what else runs there. Track it in the workbook after Nov 7.

## Chat images without storage (CV-4, Nov 5)

- Q-CV4-1: Drop `teams_message_images.bytes` (and the unused `failed` attempts) in a release after CV-4 has been in prod, with a `safe-drop` comment (D468); `store/images-bytes.test.ts` guards it until then.
- Q-CV4-2: An image read for the AI or a create is a second Graph read when someone also views it. Fine at today's volume; revisit if Graph throttles hostedContents.
- Q-CV4-3: gpt-6-luna's image token multiplier isn't in OpenAI's images-vision table as read on Nov 5 (gpt-6-astra and gpt-5.6-luna are 1.2); the cost figures assume 1.2. Check the request log's input tokens after the first week with the switch on.

## Quick fixes (QF-1, Nov 6)

- Q-QF1-1: One customer chat conversation's "<my name> committed" has no promise. The code turns an "I will" reply into my promise in both paths (`actions/promise-reply.test.ts`), so the real commitment row most likely carries a `who_id` other than my sign-in id for the same name. Check with counts only: open commitments in conversations with status committed whose `who_id` isn't any FocusTime user's id, and how many share a `who_name` with one. If confirmed, the fix is mapping a person's other Teams ids to their user (like AH-3's client logins), not matching by name. DX-1: Settings › Data › Diagnostics now gives these counts per person (the promises check); run it signed in as the person who saw it.
- Q-QF1-2: Ahead's State column stays read only: State isn't in AH-1's `fields` write. A State picker in Grid would add State to that write (the hard rule) or use the step 14 `state` write in the change set. Authorize either, or leave it.
- Q-QF1-3: Why the one item slipped past the chatter filter isn't known from the code: rules mark only GIFs, stickers, emoji, empty messages and short acks as chatter; any message with words goes to the AI, whose call it is. Its message place (role, placed by, reason) would say which; counts only. DX-1: Diagnostics' chatter filter check gives these counts per chat (to a conversation by the AI or by rules, chatter by rule, AI or Social chat).

## Backlog health (BH-1, Nov 6)

- Q-BH1-1: ~~Strict settings parsing on rollback~~ Resolved in BH-1: unknown sections and keys are ignored when reading and kept untouched when saving (see the BH-1 decisions). Rollbacks to builds from BH-1 on are safe; rolling back past BH-1 still has the old catch. The question was: a person's settings text is parsed strictly: an older build refuses an unknown section or field ("Unknown section", "Unknown field"). So rolling back after someone saved a setting a newer release added (BH-1's `[ahead] stale_weeks`, PK-1's `[plan] devops_on_done`) leaves that person's settings invalid until the line is removed. Migrations only add (D468) so database rollbacks are safe, but settings rows have no such guard. Should the parser keep unknown keys and ignore them (with a note in Admin › Status) instead of refusing? Not changed in BH-1.
- Q-BH1-2: ~~What counts as a change for Stale~~ Resolved in BH-1: any DevOps edit counts, a reorder included (see the BH-1 decisions). The question was: Stale counts any DevOps edit as a change, including a reorder of the backlog (StackRank changes ChangedDate) or a bulk edit by a client's automation. If that hides stale items in practice, Stale could use only the change log's kinds (state, assignee, dates, comments), which needs the log to cover the stale window (6 weeks against its 30 days).

## Housekeeping (HK-4, Nov 6)

- Q-HK4-1: **Resolved (Nov 6, the product owner):** keep `gpt-6-luna`; skip the live eval and don't copy the OpenAI key down from Key Vault. Was: the comparison's live numbers need `openai-api-key` in a developer keyring; `node scripts/ai-eval.ts --live --runs 3` would then run them.
- Q-HK4-2: **Resolved (Nov 6, the product owner):** Flex yes in principle for background AI work only (conversation sorting, promise extraction, image descriptions), never for interactive work (the assistant, drafts, Break down). Not built in HK-4: an approved follow-up, built in AI-F1. Was: adopt Flex per background task?
- Q-AIF1-1: `conversations.comment` (the follow-through comment drafted on the upkeep tick) runs on standard: nobody waits on it, but it is a draft a person reads and it wasn't on the Flex list. Move it to Flex (one line in `ai/tiers.ts`)? Its volume is at most one per item per day, so the saving is small.
- Q-HK4-3: **Deferred (Nov 6, the product owner):** unchanged in HK-4; decided after the Diagnostics counts, and it stays item 5 of the cleanup list. Was: AP-1's rules pass still runs on every poll (`actions/request-poll.ts` `rules`: Requests and the `promises` table, with `asks.classify` and `promises.extract` on the token owner's and author's AI) beside CV-1's pipeline. Is anything still reading its output for people (see docs/azure/cleanup-list.md), or can it stop?

## Settings overhaul (ST-1, Nov 6)

- Q-ST1-1: `usePhone` and `useNarrow` read `innerWidth`, which a phone widens when a page is wider than the screen; ST-1 fixed the pages that did that (CSS only), but any new wide element on a phone page can bring back the "Maximum update depth exceeded" loop. Read the device width instead (`screen.width` or `visualViewport`), or keep fixing pages and rely on the width checks in the e2e tests? Proposal: read `visualViewport.width` in a follow-up with its own test on iPhone conditions.

## Late chip (UI-9, Nov 7)

- Q-UI9-1: On a desktop card with the timeline shown, the rail draws carried late promises on the block under way whatever its client (CV-3), while the chip (with no rail) puts each on its own client's block. Should the rail follow the chip's client rule too, so the two never disagree? A small change to `railMarks`' home rail; not done here, since the brief said not to invent a rule for the timeline.
- Q-UI9-2: A late promise whose client has no block today (or one with no client) shows on no Week card, only in Today's strip and the Inbox (and, for one I added, as U3's due badge on the day's first block). Is that enough, or should the day header carry a "N late" for those?
- Q-UI9-3: The wide layout's hour timeline (3840) and strip or mini cards never marked late promises; they now get the chip because they draw no rail. Confirm that's wanted on the wide layout, where the timeline is "shown".

## Phone overhaul (MB-1, Nov 7)

- Q-MB1-1: Join on the Now card needs the meeting's link. Calendar events in FocusTime carry no online meeting link; reading Graph's `onlineMeeting.joinUrl` (and Google's `hangoutLink`) is a source change. Worth adding, phone only, opening Teams?
- Q-MB1-2: Snooze for a to-do is "Snooze to this afternoon" (a move to PM). Should Snooze instead hide it until a time (as promises do), which needs a new pick field?
- Q-MB1-3: Open anyway on Ahead lasts the browser session. Should it be remembered per device, or should the phone get a small read-only Ahead summary instead (this week's dated features)?
- Q-MB1-4: the VM chip moved from the phone header into the status sheet; Today's morning VM prompt still shows. Is the prompt enough on the phone, or should the dot turn amber while the VM is off during working hours?
- Q-MB1-5: Settings › Data › Diagnostics lists Unsorted reasons as "<reason> <count>" and now reads "held back because they mention another client 20". It is ST-1's screen, so it wasn't changed here; reword to "20 held back because they mention another client"?
- Q-MB1-6: the phone's to-do sheet shows Done only on a confirmed day (as Today's checkboxes do). On an unconfirmed morning, should the sheet offer Confirm today first?
- Q-MB1-7: UI-9's late chip on the phone moved from the card header to the card's chips line (the status line) at the MB-1 merge. A card with no status now gets that line for the chip, so it is one line taller there; in the header it never was. Keep it on the chips line, or go back to the header for cards with no status? Answered in MB-1b: with no status pill it ends the title line (no extra line); beside a pill it stays on the chips line.

## Invite to FocusTime (IN-1, Nov 7)

- Q-IN1-1: Teams app added is known only from the bot's 1:1 chat (a person who installed the app but never opened its chat, or whose install event didn't arrive, reads No). Knowing it for certain needs Graph's installed apps for a user (`TeamsAppInstallation.ReadForUser.All`), a new permission, so IN-1 doesn't. Worth it?
- Q-IN1-2: DevOps connected means a write PAT for any client. A person who only reads DevOps (the company read PAT) reads No, though FocusTime shows them DevOps. Is "has write access somewhere" the right signal, or should it be "has a write PAT for every client they work on" (a count per person, still without naming clients)?
- Q-IN1-3: Outlook on the web's compose deep link (`/mail/deeplink/compose`) isn't a documented, versioned API; it works today. If Microsoft changes it, "Use my mail app instead" still works. Switch the main button to `mailto:` if it breaks?
- Q-IN1-4: the brief's tests list was cut off after "Non-admins get 403 from the People and". IN-1 checks 403 on the People section, Who's set up and recording an invite. Anything else meant?


## DOC-1

- Q-DOC1-1: the scheduler's comment says a run claims a lease, but `server/scheduler.ts` has no lease: one replica in prod makes this safe today, and `job_claims` stops double runs per job and day. Either add the lease or change the comment before running more than one replica. Noted in docs/technical/operations.md.
- Q-DOC1-2: "Coopilot" names left in the code on purpose, with where and the risk of renaming each:
  - `CoopilotId` (`MARKER_PROP`, `sources/graph/write.ts`): the marker on every FocusTime Outlook event. Renaming orphans every existing event (FocusTime would refuse to edit its own). Q98 has the migration path. Keep.
  - `LEGACY_BODY_TAG` "Timebox planned in Coopilot." (`plan/timebox.ts`): matched on old events' bodies. Removing it stops recognizing them. Keep.
  - `OLD_KEYRING_SERVICE` "coopilot" and the old folder names (`host/local/keyring-rename.ts`, `host/local/rename.ts`, `server/main.ts`): the one-time move in the developer loop. Low risk to remove once no developer machine has the old entries; removing it early loses their secrets on that machine.
  - `system/install.sh --remove-coopilot`: removes the old service, launcher and icons. Safe to drop once every developer machine ran it.
  - "Coopilot Desktop" and "Coopilot Dataverse Reader" (`config/starter.ts` comments, `infra/scripts/admin-group.sh`'s refusal, `actions/account.ts`): the registrations' real display names in Entra and Dataverse (Q97). Renaming them is an admin task outside the code; the script's refusal must follow any rename.
  - The Guide's Renamed row (`ui/guide/content.ts`): tells people the old name. Keep while anyone remembers it.
- Q-DOC1-3: `actions/account.ts`'s header comment still describes the desktop sign-in (PKCE over loopback, refresh token in the keyring); the hosted app signs in through Entra OpenID Connect and seals refresh tokens in `user_secrets`. The code wins (docs/technical/security.md); fix the comment with the next change to that file.
- Q-DOC1-4: the docs are public to anyone who can reach the app's address, though the panel needs a session. If a page ever needs to hold something only Cooptimizers may read, serve the pages from an authenticated route instead of bundling them.
- Q-DOC1-5: the "Edit on GitHub" link goes to `main`; a page read in an older build may differ from main. The footer's "This build" says which build it is.
- Q-DOC1-6: the exact Azure CLI text for an unregistered resource provider in operations.md's troubleshooting is marked Not verified.
- Q-DOC1-7: on a built UI (with the CSP), signing in to the demo logs one "Applying inline style violates ... style-src 'self'" from the main bundle. It happens on main at `13cd461` too, before the docs load; the docs panel adds none. Find the inline style (likely a library setting a style attribute) in a later step.
- Q-DOC1-8: `e2e/ui9.test.ts` "keeping or snoozing a promise updates the chip, with no reload" fails now and then in CI: after Done in the Inbox and back to Week, Monday AM's late chip is still there after 20 s. It failed the same way on main (`a6d16c6`) and passes locally. Week's chips come from `inbox.today` (`ui/inboxcount.ts`), read again when the week's data reloads or every 5 minutes; a Done whose week reload doesn't land leaves the chip until then. Look at it in a housekeeping step (re-read `inbox.today` on the Inbox's own changes). Answered in HK-6: the app was right (the chip went within half a second); the test's read was the race, fixed there.

## Cleanup step 1 (CL-1, Nov 7)

- Q-CL1-1: step 2 (`docs/cleanup-step-2.md`) needs the product owner's OK, and a counts-only check of the four user tables and the bytes column on dev and prod first (no existing script reads the hosted databases; CL-1 didn't connect). It is two releases: 2a takes the tables out of `USER_TABLES` and stops the 14-day cleanup, 2b drops.
- Q-CL1-2: the per-client "Delete stored messages" (`requests.purge`) reaches only the shared `teams_messages` since D519; a person's old `chat_messages` and `asks` rows for that client go only with the 14-day rule, Delete my data, or the drop. Asks keep their message past 14 days. Fine to wait for the drop, or should 2a clear them sooner?
- Q-CL1-3: can the org bootstrap's reading of a person's old `[ai]` keys go? It needs the `org_bootstrap_v1` mark confirmed on dev and prod (a read of `org_settings`, scope "meta"). Then `use`, `monthly_cap_usd` and `allowed_clients` can leave the settings model, with the loader ignoring them (BH-1).

## LP-1

- Q-LP1-1: the assistant opens the promise's draft but doesn't carry its own words over ("Tell Dana the counts match" opens Dana's promise with FocusTime's draft, not "the counts match"). Prefilling would mean the model's text lands in the draft box; it is still only sent after the preview. Worth it?
- Q-LP1-2: the Comment channel @mentions the recipient only when they are on the item (assignee, creator or last changer). Mentioning anyone else needs their DevOps identity id, which comes from the identity API on `vssps.dev.azure.com`, a host the PAT rule doesn't allow. Allow that host for this one lookup, or keep the mention where it is known?
- Q-LP1-3: an email draft waits for "I sent it". FocusTime could notice the draft moved to Sent Items on its own (reading that one message when the promise is opened, or on a schedule), but only with `Mail.ReadWrite` granted. Do that, or keep it a tap?
- Q-LP1-4: the preview lists outside people by name (the brief's decision 2), which D485 otherwise forbids. Names are shown, not stored. Should the inside people be listed too when the chat is small (it shows only their count now)?
- Q-LP1-5: Outlook on the web's compose deep link is the fallback for email, as in IN-1 (Q-IN1-3). If it changes, switch to `mailto:`.
- Q-LP1-6: the brief's IB-1 mockups (docs/ux/ib1) weren't in the repo; LP-1 follows the IB-1 Inbox as built (the detail pane's main button, the phone sheet).

## Ahead editors (AH-5, Nov 7)

- Q-AH5-1: DevOps itself may email someone assigned an item (per the organization's notification settings), including people outside Cooptimize. FocusTime sends them nothing; is DevOps's own email acceptable, or should the preview warn more strongly?
- Q-AH5-2: team members are read for at most 50 teams per project (the existing teams read). A project with more teams lists only those teams' members; enough?
- Q-AH5-3: a process that restricts state transitions (rules in an inherited process) can refuse a state the type has. FocusTime lists every state of the type and shows DevOps's refusal on save; should it read the transition rules and list only allowed ones?
- Q-AH5-4: not checked against a real org: the team members response for a real project (guests, groups, display names), and a state write on a real process. Both use fakes in tests.

## Ahead Gantt layout (AH-6, Nov 7)

- Q-AH6-1: a collapsed row with no dates of its own shows its children's span, which can't be dragged. Should dragging a summary bar move every child with it (one change per child in the change set)?
- Q-AH6-2: should the level, carets, Show callouts and the column width follow the person to another browser (server settings, like the filters) rather than stay in this browser?
- Q-AH6-3: the per-week hours are now in the marker's popover. Is that enough in the Gantt, or do people want them back on the timeline as an optional lane?
- Q-AH6-4: stories show in the Gantt only from their own dates. Should a story without dates get a bar from where it's planned (its week in Plan the week, or its to-do's day)?
- Q-AH6-5: not checked against a real org: a real client's view at 1440 (deep trees, long titles, dates years out). The demo covers the shapes; the real one should be looked at after deploy.
- Q-AH6-6: Clear filters resets People to D654's defaults too (Mine, or All for a lead). Should it keep each client's People choice, which AH-1 treated as a remembered preference?
- Q-AH6-7: the level is now one for every mode with Stories as the default, so the Gantt opens fully expanded. Would people rather the Gantt open at Features while Grid and Backlog open at Stories (one level per mode, but kept across switches)?
- Q-AH6-8: Stale sits in the Readiness group. Is it better as its own group, or should it count as a fifth readiness kind ("Untouched")?
- Q-AH6-9: Backlog's level picks which backlog is listed rather than folding a tree. Should Backlog instead show the chosen level's items with their children folded under them, like the other modes?


## Readiness you can finish (AH-7, Nov 7)

- Q-AH7-1: Break down fixes Needs stories in DevOps directly (it publishes on its own), so it isn't counted in "fixed this week". Should a Break down publish count as one fixed piece?
- Q-AH7-2: progress counts pieces (an item missing a target and a size is two). Would items read more naturally ("5 items ready this week")?
- Q-AH7-3: Start here is 5 across every client shown. Should it be per client when several are shown, or follow the toolbar's level (only features at Features)?
- Q-AH7-4: a skip lasts 2 weeks from the day it was made. Should Skip offer "until a date" or "until it changes in DevOps" instead?

## WK-3

- Q-WK3-1: should Week › Plan show a weekend cell too (pins to Saturday, a deployment's must)? WK-3 keeps Plan Monday to Friday: a weekend has no budget, and the Board, Today and the menu already place work there.
- Q-WK3-2 (resolved Nov 7): AH-7 merged first with no migration and no Export schema change, so WK-3 keeps schema version 33 and its migration as they are.
- Q-WK3-3: should the after-hours total count calendar events I organize myself after hours (a call I set at 19:00)? WK-3 counts only what I placed in FocusTime, so a meeting someone else set never reads as time I chose.

## Text boxes that grow (UI-10, Nov 7)

- Q-UI10-1: the phone sheets rest on the on-screen keyboard through `--kb-inset` (visualViewport) on iOS and `interactive-widget=resizes-content` on Android. Checked in Chromium with a simulated inset, not on a real iPhone or Android phone yet: does the capture box stay above the keyboard on both?
- Q-UI10-2: on the phone, the Assistant sheet's × sits 2px past the sheet's right edge (older than UI-10, seen while testing; the page doesn't scroll sideways). Fix in a phone polish step?

## Client boundary (GD-2, Nov 7)

- Q-GD2-1: a client known only by its key (no display name in my clients) shows its key in the "mentions" tag and the flag. Should the tag fall back to the Dataverse name for clients I don't follow?
- Q-GD2-2: Status's line box flags as you type and says it goes to "this client's status report". Is the debounce (half a second) right, or should it check only on Push?
- Q-GD2-3: a held message in a client-facing chat waits until someone sorts it or retention purges it (14 days). Should a lead get a quiet note when one waits more than a working day?
- Q-GD2-4: matching is on names and aliases as whole words. A client whose name is a common word ("Atlas", "Summit") will hold messages that use the word. Is an alias list per client enough, or do we need a "not a mention" button that teaches it?
- Q-GD2-5: Replace writes "another client". Would people rather choose the words (for example "a retail client")?
## Co-working calls (CW-1, Nov 7)

- Q-CW1-1: "who's on it" while a call is live. Graph's chat messages list participants only in the call ended event; showing who is on a live call would need the calls or online meetings APIs (a new permission, likely application-level). Worth it, or is "started by" enough?
- Q-CW1-2: freshness is the shared poll's 5 minutes. If people want the indicator within a minute, the options are a shorter Rule for everyone (more reads of every chat all day) or Graph change notifications on registered chats (a new subscription and endpoint, which CLAUDE.md rules out today). Is 5 minutes fine in practice?
- Q-CW1-3: should a live call show on Today's block card too (not only the Now card), for a client whose block isn't the one under way?
- Q-CW1-4: a live call in a chat whose reading is off (D523) can't show. Should co-working calls be read even when an admin turned reading off for the messages, or is the switch meant to cover everything?
- Q-CW1-5: not tried against real Teams: that starting a call from a group chat's header gives `callEventType` call (or meeting for Meet now) with a callId the end event repeats, and how long the end event takes. Check on dev with a registered chat after deploy.
