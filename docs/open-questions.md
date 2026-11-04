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

## Costs (Nov 4)

- Q-COST-1: Budget alerts per environment (for example $175 prod, $50 dev, at 80% actual and 100% forecast)? A budget needs a contact email or an action group, which the repo doesn't hold (D523). Whose address, and in Bicep (with the address as a parameter outside the repo) or set by hand in Cost Management?
