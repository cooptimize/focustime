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
- Q94. (Step 17.5.) A "zero at-risk week" moment (Lumen bobs once when the week has no at-risk blocks) is not built. Suggested place: Week › Plan the week, right after Done when the planned week has no at-risk block, as a moment over the app like Close out's (never in the Week view itself, which stays Lumen-free). Build it? BR-1 (Nov 15): Lumen and the moments are removed, so this would need its own design.
- Q95. (Step 17.5, brief B08.) Live favicon: the tab and tray icon showing the real week's fills (planned, done) instead of the static mark. Queued as an app feature; it would make the icon carry information, so it needs a rule for when Lumen and the mark may do that. BR-1 (Nov 15): Lumen is gone; the rule would be for the week mark alone.
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
- Q-MB1-5: Settings › Data › Diagnostics lists Unsorted reasons as "<reason> <count>" and now reads "held back because they mention another client 20". It is ST-1's screen, so it wasn't changed here; reword to "20 held back because they mention another client"? Answered in HK-7 (D1194): Diagnostics now reads "20 messages held back because they mention another client".
- Q-MB1-6: the phone's to-do sheet shows Done only on a confirmed day (as Today's checkboxes do). On an unconfirmed morning, should the sheet offer Confirm today first?
- Q-MB1-7: UI-9's late chip on the phone moved from the card header to the card's chips line (the status line) at the MB-1 merge. A card with no status now gets that line for the chip, so it is one line taller there; in the header it never was. Keep it on the chips line, or go back to the header for cards with no status? Answered in MB-1b (D1035): with no status pill it ends the title line (no extra line); beside a pill it stays on the chips line.

## Invite to FocusTime (IN-1, Nov 7)

- Q-IN1-1: Teams app added is known only from the bot's 1:1 chat (a person who installed the app but never opened its chat, or whose install event didn't arrive, reads No). Knowing it for certain needs Graph's installed apps for a user (`TeamsAppInstallation.ReadForUser.All`), a new permission, so IN-1 doesn't. Worth it?
- Q-IN1-2: DevOps connected means a write PAT for any client. A person who only reads DevOps (the company read PAT) reads No, though FocusTime shows them DevOps. Is "has write access somewhere" the right signal, or should it be "has a write PAT for every client they work on" (a count per person, still without naming clients)?
- Q-IN1-3: Outlook on the web's compose deep link (`/mail/deeplink/compose`) isn't a documented, versioned API; it works today. If Microsoft changes it, "Use my mail app instead" still works. Switch the main button to `mailto:` if it breaks?
- Q-IN1-4: the brief's tests list was cut off after "Non-admins get 403 from the People and". IN-1 checks 403 on the People section, Who's set up and recording an invite. Anything else meant?


## Send invites from FocusTime (IN-2, Nov 7)

- Q-IN2-1: a Teams post that gets no answer at all (a timeout after Graph may have taken it) counts as not sent, so Retry posts again and could post twice. LP-1 has the same edge. Reading the chat's last few messages before a retry would need `Chat.Read` on a chat FocusTime didn't register; worth it?
- Q-IN2-2: a held send (for Retry) lives in the server's memory for 30 minutes, so Retry is gone after a restart or a scale-out to another instance. Persist it (an app table), or is "invite again" enough?
- Q-IN2-3: a draft counts as invited ("via Email (Outlook draft)") though the admin may never send it. Should a draft row read "Draft for <name>" until the admin says they sent it, as LP-1's "I sent it"?

## DOC-1

- Q-DOC1-1: the scheduler's comment says a run claims a lease, but `server/scheduler.ts` has no lease: one replica in prod makes this safe today, and `job_claims` stops double runs per job and day. Either add the lease or change the comment before running more than one replica. Noted in docs/technical/operations.md. Answered in HK-7 (D1195): the comment now says there is no lease and one replica is required until one is added.
- Q-DOC1-2: "Coopilot" names left in the code on purpose, with where and the risk of renaming each:
  - `CoopilotId` (`MARKER_PROP`, `sources/graph/write.ts`): the marker on every FocusTime Outlook event. Renaming orphans every existing event (FocusTime would refuse to edit its own). Q98 has the migration path. Keep.
  - `LEGACY_BODY_TAG` "Timebox planned in Coopilot." (`plan/timebox.ts`): matched on old events' bodies. Removing it stops recognizing them. Keep.
  - `OLD_KEYRING_SERVICE` "coopilot" and the old folder names (`host/local/keyring-rename.ts`, `host/local/rename.ts`, `server/main.ts`): the one-time move in the developer loop. Low risk to remove once no developer machine has the old entries; removing it early loses their secrets on that machine.
  - `system/install.sh --remove-coopilot`: removes the old service, launcher and icons. Safe to drop once every developer machine ran it.
  - "Coopilot Desktop" and "Coopilot Dataverse Reader" (`config/starter.ts` comments, `infra/scripts/admin-group.sh`'s refusal, `actions/account.ts`): the registrations' real display names in Entra and Dataverse (Q97). Renaming them is an admin task outside the code; the script's refusal must follow any rename.
  - The Guide's Renamed row (`ui/guide/content.ts`): tells people the old name. Keep while anyone remembers it.
- Q-DOC1-3: `actions/account.ts`'s header comment still describes the desktop sign-in (PKCE over loopback, refresh token in the keyring); the hosted app signs in through Entra OpenID Connect and seals refresh tokens in `user_secrets`. The code wins (docs/technical/security.md); fix the comment with the next change to that file. Answered in HK-7 (D1196): the comment describes the hosted sign-in.
- Q-DOC1-4: the docs are public to anyone who can reach the app's address, though the panel needs a session. If a page ever needs to hold something only Cooptimizers may read, serve the pages from an authenticated route instead of bundling them.
- Q-DOC1-5: the "Edit on GitHub" link goes to `main`; a page read in an older build may differ from main. The footer's "This build" says which build it is.
- Q-DOC1-6: the exact Azure CLI text for an unregistered resource provider in operations.md's troubleshooting is marked Not verified.
- Q-DOC1-7: on a built UI (with the CSP), signing in to the demo logs one "Applying inline style violates ... style-src 'self'" from the main bundle. It happens on main at `13cd461` too, before the docs load; the docs panel adds none. Find the inline style (likely a library setting a style attribute) in a later step. Answered in HK-7 (D1190): the bent mark's beam had a style attribute; it is dropped when inlined (brand.css already sets the blend), with a test that sign-in raises no CSP violation.
- Q-DOC1-8: `e2e/ui9.test.ts` "keeping or snoozing a promise updates the chip, with no reload" fails now and then in CI: after Done in the Inbox and back to Week, Monday AM's late chip is still there after 20 s. It failed the same way on main (`a6d16c6`) and passes locally. Week's chips come from `inbox.today` (`ui/inboxcount.ts`), read again when the week's data reloads or every 5 minutes; a Done whose week reload doesn't land leaves the chip until then. Look at it in a housekeeping step (re-read `inbox.today` on the Inbox's own changes). Answered in HK-6 (D1048): the app was right (the chip went within half a second); the test's read was the race, fixed there.

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
- Q-UI10-2: on the phone, the Assistant sheet's × sits 2px past the sheet's right edge (older than UI-10, seen while testing; the page doesn't scroll sideways). Fix in a phone polish step? Answered in HK-7 (D1197): the sheet's × keeps no right margin, with a test at 390 and 360 px.

## Client boundary (GD-2, Nov 7)

- Q-GD2-1: a client known only by its key (no display name in my clients) shows its key in the "mentions" tag and the flag. Should the tag fall back to the Dataverse name for clients I don't follow?
- Q-GD2-2: Status's line box flags as you type and says it goes to "this client's status report". Is the debounce (half a second) right, or should it check only on Push?
- Q-GD2-3: a held message in a client-facing chat waits until someone sorts it or retention purges it (14 days). Should a lead get a quiet note when one waits more than a working day?
- Q-GD2-4: matching is on names and aliases as whole words. A client whose name is a common word ("Atlas", "Summit") will hold messages that use the word. Is an alias list per client enough, or do we need a "not a mention" button that teaches it? Answered in HK-7 (D1191, D1192): "Match only as written" per client in Admin › Clients, on by default for a name that is an ordinary word; a "not a mention" button was not built.
- Q-GD2-5: Replace writes "another client". Would people rather choose the words (for example "a retail client")?
## Co-working calls (CW-1, Nov 7)

- Q-CW1-1: "who's on it" while a call is live. Graph's chat messages list participants only in the call ended event; showing who is on a live call would need the calls or online meetings APIs (a new permission, likely application-level). Worth it, or is "started by" enough?
- Q-CW1-2: freshness is the shared poll's 5 minutes. If people want the indicator within a minute, the options are a shorter Rule for everyone (more reads of every chat all day) or Graph change notifications on registered chats (a new subscription and endpoint, which CLAUDE.md rules out today). Is 5 minutes fine in practice?
- Q-CW1-3: should a live call show on Today's block card too (not only the Now card), for a client whose block isn't the one under way?
- Q-CW1-4: a live call in a chat whose reading is off (D523) can't show. Should co-working calls be read even when an admin turned reading off for the messages, or is the switch meant to cover everything?
- Q-CW1-5: not tried against real Teams: that starting a call from a group chat's header gives `callEventType` call (or meeting for Meet now) with a callId the end event repeats, and how long the end event takes. Check on dev with a registered chat after deploy.

## The client's draft status report (SR-2, Nov 7)
- Q-SR2-1. Where does Kat read "Upcoming PTO and Holidays" from? FocusTime doesn't know Kat's source, so the section comes from FocusTime's own PTO source (Dataverse Time Off Tracker, days away only, the client team's people, four weeks from the report's Monday) and says so under it. If Kat reads the same table, the note can go; if Kat reads a holiday calendar too, which one, so FocusTime can add it.
- Q-SR2-2. Kat's exact layout of the PTO lines (name then dates, or dates then name; "PTO" or "Out"), and whether a person on several clients is listed under each. FocusTime shows "<Name> · Tue, Nov 10 to Wed, Nov 11", one run of weekdays per line, sorted by date.
- Q-SR2-3. Which features does Kat consider: the whole project, or only Cooptimize's area paths or scope? FocusTime reads the whole project (`whole: true`) and keeps any feature with a comment in the window. If Kat limits it to the scope, the report preview should too.
- Q-SR2-4. Does an edited comment change the work item's ChangedDate? FocusTime reads comments for up to 60 features a client: active ones first, then any changed since Kat's watermark, then other open ones in backlog order. An edited older comment on a closed feature that DevOps didn't mark as changed, and features past the 60, would be missed. A real project's numbers would tell whether 60 is enough.
- Q-SR2-5. Answered (SR-3, Nov 8): yes; `comment_delete` for my own comment in the window, with Undo. Deleting one's own comment: DevOps lets the author delete a comment, but FocusTime's DevOps rule is "never deletes" (only Undo of a comment FocusTime posted deletes it). SR-2 adds no delete write: a line pushed from FocusTime is removed with its Undo, and any other own comment can be edited. A delete write for one's own comment in the report window would need the hard rule amended. Should it be?
- Q-SR2-6. A team member who doesn't follow the client in FocusTime (an Account Worker with no current Focus Time) can open its report: FocusTime reads that client's DevOps for them only when they open it (D144 limits fetches to followed clients). Is that the right reading of "the whole project team"?

## The Assistant answers real questions (AS-3, Nov 7)

- Q-AS3-1: holidays: answered by Q-AS3-6's table, waiting on its permission. Until then a holiday shows only as PTO or out of office.
- Q-AS3-2: Answered (Nov 7): keep the planning thresholds as defaults (over at planned > free + 30 minutes, a day called out at 4 hours of meetings or under 2 hours free); maybe settings later.
- Q-AS3-3: Answered (Nov 7): an over block's suggestion stays Friday AM, the overflow day.
- Q-AS3-4: Answered (Nov 7): no AI phrasing; FocusTime writes the answers from data. AI phrasing is a possible later option.
- Q-AS3-5: Answered (Nov 7): the conversation memory is 2 hours.
- Q-AS3-6: holidays need read access to `coop_workingdayscalendar`. FocusTime's Dataverse app user has the role "Coopilot Reader", which can't read its rows (403, missing `prvReadcoop_WorkingDaysCalendar`). Needed: a Dataverse admin adds Read on Working Days Calendar (Organization scope, since the rows are user owned by whoever imported them) to the "Coopilot Reader" security role. Nothing else changes: no new app registration, secret or API permission. Then the holidays reader can be built as planned (only `coop_observedholidayflag` = Yes, on exactly `coop_date`, "<Holiday Name> (observed)" or "Holiday", a day off for everyone since no column limits it).
- Q-AS3-7: Answered (SR-3, Nov 8): the section reads holidays through the new reader. SR-2 merged (Nov 7) with "Upcoming PTO and Holidays" from Time Off Tracker only (Q-SR2-1). The holiday calendar Q-SR2-1 asks about is `coop_workingdayscalendar`: once the holidays reader exists (Q-AS3-6), SR-2's section should read holidays through it too.
- Q-AS3-8: flaky candidate: `e2e/mb1.test.ts` "the to-do sheet: focus kept inside, Esc and focus back; …" failed once in AS-3's first full local run (Nov 7, about 21:50, 11 workers, Chromium): after Esc, focus wasn't back on the to-do's row (`mb1.test.ts:118`, expected the row to be `document.activeElement`). Two other files failed in that run too; the log was cut off, so they're unnamed. All passed on the rerun and in CI. It failed the same way again in the full run after merging SR-2 (Nov 7, about 23:30, the same line) and passed when the file was run again alone (7 of 7): twice in four full local runs, never in CI so far.

## Report preview you can finish (SR-3, Nov 8)

- Q-SR3-1. Kat's window and layout for "Upcoming PTO and Holidays": how far ahead the email looks, whether holidays are listed with people or apart, and the wording. FocusTime uses the next two weeks from the report's Monday, one line per holiday ("Thanksgiving Day (observed) · Thu, Nov 26") and per run of a person's days away, all in date order, with a note that Kat's email may lay it out differently. One example of Kat's sent email would settle it.
- Q-SR3-2. Holidays need the reader role's Read on Working Days Calendar (Q-AS3-6). Until then production shows "Holidays couldn't be read" under the section, and PTO still shows.
- Q-SR3-3. "Created a story" counts only stories created through FocusTime (the write log). Counting stories created in DevOps itself would need `System.CreatedBy` on the stories Status already reads (one more field, no new request). Is that wanted?
- Q-SR3-4. Should Needs your update also count time on the focus timer against a to-do on the feature? It isn't counted now, since a to-do already counts.
- Q-SR3-5. Flaky candidate: `e2e/client-boundary.test.ts` (GD-2's held list, the tag and Close the loop's flag) timed out on a `waitFor` once in SR-3's full local run (Nov 8, 11 workers, Chromium) and passed when run again alone. It doesn't touch Status.

## DP-2

- Q-DP2-1. Inbox › Captures' Sort form (`SortCapture`) still has native Due and Target date inputs. The brief covers Quick capture; say if it should change too.
- Q-DP2-2. Should the catalog itself be editable by admins (for every client), not only per client? It is config for now.
- Q-DP2-3. Should a hand untick survive a client switch for an item both lists share? The brief keeps only ticks.
- Q-DP2-4. A weekday evening Deployment doesn't appear on Today's blocks (it is on Week's Evening band), so the Today summary shows only where Today lists the to-do: its blocks and a weekend day. Should Today list evening deployments too?

## IB-2

- Q-IB2-1. An item's address (`#/inbox/item/<key>`) carries no view, so a reload or shared link opens it in Everything rather than the view it was opened from. Fine, or should the address carry the view?
- Q-IB2-2. Should my own changes count as new (closing a promise moves it to the top and, next visit, dots it)? For now any latest activity counts, as the brief defines it.
- Q-IB2-3. The audit log's When (`whenText`) and Notifications' "5 min ago" keep their words. Should they move to the shared format?
- Q-IB2-4. Done reaches back 14 days (the Rule). Should a person be able to scroll further back than that?

## KB-1

- Q-KB1-1: the 6,000 token budget leaves SQL Conventions out of a Gold fact feature for a client on the defaults (both D365 systems and Fabric): the real matched set is about 9,100 tokens. Raise the budget (the cost is small), or treat the source articles as lower priority than the general SQL ones? Coop rides them on every task, and the brief said artifact, then layer, then agnostic, so they stay ahead for now.
- Q-KB1-2: a layer word pulls every article of that layer ("Gold" brings Dimension Tables, Stored Procedures and Views too), as in Coop. Fine for a planning prompt, or should drafts stop at the exact artifact when one matched?
- Q-KB1-3: should `meeting.capture`'s proposed DevOps items use the standards too? It wasn't in the brief's list, it runs in the background on Flex and its proposals are shaped from a transcript.
- Q-KB1-4: `AGENTS.md` in the standards repo has unresolved merge conflict markers in "Structure and routing" (`<<<<<<< Updated upstream`). FocusTime doesn't read that file, so nothing here depends on it; worth fixing in the repo.
- Q-KB1-5: GitHub allows 60 anonymous API requests an hour per IP. Two a check is well inside it, but the Container App shares an outbound IP. If that ever bites, a token goes through the Key Vault scripts.

- Q-GD3-1. Step 0's database counts (held by chat, audience and reason) weren't read: dev's database takes connections only from Azure services, and running a read inside the dev container was refused in this session. The re-check logs them when it first runs (`held_recheck`, `all:before:<audience>:<reason>`, `all:released`, `all:still_held`) and keeps them in `org_settings` `meta/held_recheck_v1`.
- Q-GD3-2. Should bulk Sort all and Mark all have an Undo? Neither single action has one today (This is work brings a message back from Chatter).
- Q-GD3-3. Should a chat with reading off still have its held messages re-checked? They are skipped for now, as nothing else works on such a chat, and may show "Reason unknown" until they expire.

## TY-1

- Q-TY1-1. Should 3840's older day timeline retire now that Today has this one? It stays while the switch is off, so nothing changes for people who don't use the switch.
- Q-TY1-2. Should the timeline become Today's default once people have used it? It is off by default for now.
- Q-TY1-3. Should a drag auto-scroll near the top and bottom of the window? The wheel works during a drag; a to-do's tray sits right above its own hours, so it is rarely needed.
- Q-TY1-4. Should Accept all write Outlook per suggestion again? The bar has one Put on Outlook for all of them; the per-row choice went with the popup.
- Q-TY1-5. Should a placeholder be allowed over a show-as-free event visibly marked? It already may (`planMyDay`'s rule), with nothing to say so.

## TX-1

- Real processes weren't read from this environment. The code reads each type's fields at run time, so it follows whatever a client's process has. Worth checking on a real Agile project after the dev deploy: expect the comment on User Story and Remaining Work on Task and Bug.
- On stock Agile most stories will get the comment, not the field. If that's more noise than value, the choice is to roll Remaining Work into child Tasks or turn the comment off per client.
- Should a focus session on a to-do pre-fill Partly with the focused time? It doesn't today: only an answer moves time left.
- Teams shows the DevOps offer as a line pointing to Close out. If people close out from Teams and never open the app, the offer goes unused; an in-card preview would be the next step.
- TX-1b, partly answered by TX-1c: a plain tick now removes later to-dos too. An earlier day's still-planned to-do stays. Should that change?
- TX-1b: a later to-do a Done removes keeps its timebox if that timebox is on Outlook, because a check-in changes nothing external. Should it offer to take the event off?
- TX-1c: a to-do that inherited more than its size before TX-1c keeps that number, because it reads as the person's own.
- A to-do marked done outside a check-in (a tick) with an ended timebox stops being asked about and its timebox stays unanswered. That reads right, but spent time isn't recorded for it.

## TB-3

- Should Ask's "what's next" show the next meeting, as Today's Now strip does? The bot had that line until TB-3 moved "what's next" onto the Assistant's read. Adding it would change the panel and Teams together.
- Is "Edit in FocusTime" enough for a change you want to tweak from Teams, or do people want the text boxes on the card? Waiting for use.
## Part 0 (shared owner)

- Should FocusTime post "I've got this" to the chat when someone takes a conversation? Nothing is posted to Teams today, by the spec.
- Part 1 and Part 3 weren't in the brief this was built from. The five per-person views are row statuses on today's rail, which Part 1 redesigns. Do Part 1's statuses map one to one?
- "Each Up for grabs request" assumes requests of their own. The code has only conversations, so the record lives there. Is a separate kind planned?
- A chat member who doesn't follow the client can't see the conversation, so they aren't offered in Give to. Should the list explain who's missing?
- An Open item someone said "I'll do it" about now shows as Up for grabs to teammates until they tap. If this adds noise, should the committer's teammates see it quieter?

## CX-0

Open points on the [Coop comment contract](technical/coop-contract.md), for Coop's owner to agree:

- Does Coop's own contract test fixture match proposal v1 here? `cooptimize/coop-agent` wasn't readable when this was written, so the fields are FocusTime's copy.
- `size` allows `XS` in the code (`COOP_PROPOSALS_V1`), while D529 and the glossary say S, M, L. Does Coop send `XS`?
- Are the new text limits on proposals acceptable to Coop?
- Which identity posts Coop's updates in Phase 1, and can Coop read `createdBy.id` on comments to check a brief's author?
- Does a `format=markdown` comment with a fenced block survive a real DevOps round trip, and is 32,000 characters safe?
- How does FocusTime tell Coop to stop? Today only deleting the brief does, and FocusTime's comment delete is limited to the status report window.
- The Nov 3 draft had `ask_type`, `due_at`, `priority`, `data_policy_id`, `event_id`, `run_id`, `sequence` and `work_item_changes`. None are in v1. Does Coop need any of them now?
- Is a brief edited in place, with no new revision, right to stop Coop?

## FN-1

- Teams: should the card offer Suggest (AI) for the comment, or is the typed comment enough? (The comment box itself is done.)
- Close out's batch has a comment per row but no Suggest and no feature status line. Worth adding, or are those sheet-only?
- Should the story card show Coop brief status (C1) once that merges?
- Should Wrap it up open for a story whose client has no write PAT, to record Made progress on the plan with a nudge to turn writes on? Today the tick is plain.

## WD-1

- The hour rail is now the slim 56 px strip at every width (event titles on hover and in the detail panel), so to-do titles keep their width. Is the rail with event titles wanted back on wide screens (2560 and up)?
- Reordering features inside the panel is Move up and Move down in a feature's ⋯, not drag. Is drag to reorder in the panel needed?
- The heads-up offer when a confirmed must is dropped or demoted (D147) was Plan the week's; the panel doesn't offer it yet. Bring it back in the panel's notice line?
- Plan the week's draft feature from the type box and "Epic needs features" aren't in the panel (the type box makes stories; draft features come from Capture). Is that enough?
- J and K between clients and "N of M clients planned" are gone with Plan mode. Does anyone miss them?
- Team is hidden but its address still works. When it comes back, as a tab or inside Week?
- Status's tab count is SR-3's "need your update" count. Should it show only from Friday, like the nudge? (RF-1: answered. A dot, not a count, amber and red on the person's last two scheduled workdays before the report.)
- "This week's features: the selected block's client first, then the others": the panel lists the selected block's client's features in full and every other client as one line ("Atlas · 2 features") that moves the panel to that client's next block, since + adds to the selected block and another client's block refuses the drop. Full lists for every client instead?
- DevOps health's Mark as being broken down and Ask the client about priorities aren't on Week any more (Break down is in the client chip's popover, dates and owners in Ahead › Readiness). Bring them into the chip's popover?
- Esc in More from DevOps' search takes up to three presses (clear the text, leave the box, close the panel). Should Esc close the panel at once when the box is already empty?
- A past week has no Add work (the panel doesn't open there). If it ever does, its star, Add to this week and row ⋯ need the same past-week refusal as + has.
- WD-1 review: the timeline default changed to off only for people who never chose; anyone who saved "on" keeps it. Should everyone be reset to Cards once?
- WD-1 review: To place folds again when another block is chosen in the panel, even after Review opened it. Should it stay open for the rest of that panel session?
- WD-1 review: the client chip popover no longer shows the musts pace line ("about 2h free left. Still realistic?") so the hours appear once. Is the pace nudge wanted elsewhere (the chip's tooltip, the notice line)?

## RF-1

- The week model always treats Friday as the catch-up day (`week/build.ts`), and Dataverse focus blocks are Monday to Thursday only, so a "Monday to Friday" week behaves like Monday to Thursday: amber Wednesday, red Thursday. If someone's catch-up day is ever another day, `dotDays` already reads the day's kind, not its name.
- Late in Kolkata or Tokyo, Monday's working day ends before the 7:00 AM ET send, so Monday is red for them (their last day before the report). Right?
- "Start of the day" for the dot is the start of that day's working hours, not midnight. Amber Wednesday means from Wednesday's first working hour. Right, or should it be midnight?
- The dot uses Kat's fixed schedule (Monday 7:00 AM ET) for the send, not each client's watermark. If Kat sends late, the dot goes at 7:00 anyway. Fine?
- With no focus blocks at all the working days stand in. Should such a person get no dot instead?
- If Kat sends a client's report late, the dot still goes at 7:00 AM ET while the "3 to update" hint (counted against Kat's real last send) can stay until the next read. Worth reading Kat's send per client for the dot?
- The brief said the command menu's Status entry keeps its hint "3 to update". The Ctrl+K entry's hint is its key (now 4); "3 to update" is the phone ⋯ menu's, which keeps it. Should Ctrl+K show "3 to update" too?
- Setup's Done screen still offers "Plan your week" (a setup screen, not Day). Rename it to "Add work to your week" with WD-1's words?

## MC-1c

- Microsoft's docs say an invitee can read a meeting's transcript (calltranscript-get) and list `GET /me/onlineMeetings?$filter=JoinWebUrl eq …` for delegated OnlineMeetings.Read with no organizer-only rule, but this hasn't been tried against real Graph for a call someone else organizes. If the lookup or the transcript list comes back empty or 404 for an attendee, Admin's line will say "Microsoft didn't find this call for <name>". The fallback then (organizer as first reader, as the brief described) needs the organizer to be a FocusTime user and a reviewer. Try it on dev with the reported call first.
- The brief named `actions/meetings.ts`, which doesn't exist; the meeting rules are `plan/meetings.ts` (and the store `store/meeting-store.ts`), which this step changed. Read that way.
- The candidates list now shows only weekly calls with an occurrence in the next 5 weeks (from the calendar view). A call paused for longer has to be pasted. Fine?
- "Diagnostics can count them": the failures are logged by kind (`meeting_graph_failed`, `meeting_action_failed`, the job's `meeting_check` and `meeting_layout`), but Settings › Data › Diagnostics (DX-1) counts only chat sorting and shows no meeting counts yet. Add a meeting section there, or is the log enough?
- The demo has a fictional calendar link that always answers "Microsoft isn't answering", to show the failure. Keep it in the demo, or test-only?
- The organizer notice ("<name> organizes this call. FocusTime reads its transcript through their sign-in") wasn't built, because the docs say attendees can read it. If the dev check above fails, build it then.

## CF-1

- Taking the last story of a feature off the week leaves the feature on the week (it was added when the story was placed). Should the feature go with its last story?
- Taking a to-do off today now deletes it, where a confirmed day kept it as dropped (and Close out counted it). Is losing that count fine, or should today keep removed to-dos as dropped?
- A week draft's row still carries a tier column; FocusTime writes one value and reads only whether the row is there. When the idea comes back, a must could be read from it again.
- The command menu hides the retired actions (Confirm the week, Confirm the day, Make it a must, Move up and down, heads-up), but the registry keeps them for old tabs. Drop them from the registry in a later release?
- Status's "active this week" now updates on every change. Someone who puts a feature on and takes it off a minute later may show it as planned in between. Fine?
- The assistant answers "confirm" requests by words ("confirm", "lock in", "commit" with day or week words). A request like "commit #4417" is left to the model. Enough?

## DV-2

- Taken as the simpler reading: "every open screen within about 2 minutes" is measured from the change reaching the store (the Rule, 1 minute in hours) plus the next 30-second versions ask. Week › Team isn't covered: it shows what people committed, which isn't DevOps. Should Team reread on a version move too?
- Refresh counts "changes" as items the check added, changed or removed for the clients on screen, including changes FocusTime itself wrote since the last check. Should a person's own writes be left out of the count?
- Find an item answers for one client at a time; a number in another of my clients' projects reads as "found no #N". Should it try my other clients and say where it is?
- The finder's Ahead line uses my saved Ahead filters, not what an open Ahead tab has unsaved. Fine?
- Ahead's "Changed in DevOps just now" lasts until Ahead is left; coming back reads fresh values with no flag. Should it last until I save or discard?
- Not done here (the brief's "not in this step"): service hooks or webhooks to cut the 1 to 2 minute delay, and what Ahead shows by ownership or level (AH-8).
- Find an item answers from FocusTime's store (the review's call: the brief keeps the company PAT off a person's request, and the poller already reads the whole project). The cost: an item made in the last minute reads as "found no #N … If you just made it, Refresh checks now" until the next check, and the finder can't say the store is behind DevOps. Fine, or is a live read worth an exception?
- The finder's Status line comes from my plan and the item, not Status's own read: a feature I only commented on this week reads "unless you commented on it this week". Good enough?
- Not done from the review: "Changed in DevOps just now" also shows for my own writes from other screens (a story card comment raises the item's revision). Rare; worth separating?

## WD-2

- A plain to-do taken off the plan is kept as a draft with no feature, listed under To place ("Not in DevOps"). That was the route with no migration. Put back from there it is a draft story on the block, not a plain to-do (Undo right after the take off does restore the plain to-do). Is a draft the right home, or should a plain to-do stay plain while it waits (that needs a column or a table)?
- To place lists that draft only in the panel of its own client's blocks (one client's items never show under another's heading). The line over Week ("N to place") doesn't count it. Should it?
- "Above the blocks: the urgent strip, the chips, the moment card, and nothing else" was read literally, so the "What's next" card with Start focus is gone from the top of Day. Start focus is on the next to-do's row on its card, in the panel, in a to-do's ⋯ and under Focus in the top bar. Is that enough, or should what's next come back somewhere?
- "2 setup steps left" still shows above the blocks while setup is unfinished (it is a first-run aid, not part of the day). Keep it there?
- The line of chips keeps a secret about to expire (and, on the phone, a source that needs reconnecting) beside promises due and the VM. The brief named only promises due and the VM. Move the others elsewhere?
- The 3840 day timeline beside Day's cards is gone: Day's Timeline (TY-1) covers it at every width, and its drop target took Day's old row drag. Anyone who used it on a very wide screen now switches to Timeline. Fine?
- A to-do with a timebox on Outlook can't be taken off until its timebox is removed (removing an Outlook event is an external write with its own preview). Should Take off offer that preview in one step?
- Taking off a to-do with a local timebox removes the timebox, and Undo puts the to-do back without its time. Should Undo restore the time too?
- A deployment can't be taken off the plan (it is its window); Move and Drop work. Right?
- "+" on a story that is on another block moves it here (with Undo) instead of refusing. The search's Enter does the same. Is a move the right default, or should it ask?
- The block's ⋯ menu keeps Open and the calls. The panel does both, so the menu could go entirely; it stays so a right-click on a card isn't empty and a call is one step away. Drop it?
- The command menu still has "Add work to today", "Add work to a day…" and "Add work to the week", which open Week with the panel. Should "to today" and "to a day" open Day instead?
- Day's panel being open or closed is remembered per device on a computer; on the phone the sheet always starts closed. Fine?
- Dragging a to-do out of its block opens the panel as the drop area, which moves the cards over while the drag is under way. It closes again if the to-do is dropped on another block. Acceptable, or should the drop area be a strip that doesn't move the grid?
- The panel no longer lists a feature's teammates as faces with "N open stories by <name>" (PV-1's "No stories for you yet"); each teammate's story is a row with its owner and Take one. "Add a story for me" is "New draft story" under the feature, then Create in DevOps on the draft. Good enough?
- Day's old card listed a block's meetings as rows in time order among the to-dos. Day's cards now show one meetings line that opens the list (as Week does), and the panel's agenda and the Timeline have the times. Does Day's Cards view need the meetings always open?
- Not done here (the brief's "not in this step"): Week's timeline as calendar columns (WD-3).
- From the review, not done: Undo of a take off doesn't put a local timebox back; an unsized plain to-do comes back from To place as M (a draft has a size); about 30 `.detail-panel` style rules are left in `ui/styles.css` (nothing uses them; a cleanup of its own); the Add box's feature select sits inside a list option (a screen reader reads it, but the pattern is unusual); on a catch-up Friday afternoon the panel's "+" adds without Week's drop check (as in WD-1).
- A story with time on it can't be taken off the plan, only moved (the store keeps worked to-dos as dropped to hold their time). Should Take off work for it, with the time kept some other way?
- Follow-up: a feature I put on my week that isn't assigned to me, with no story of mine under it, now sits under More in <client>, not in the first section. Should "on my week" also count as mine there? (Answered Nov 11: yes. A feature on my week is in Assigned to you even when it isn't mine and holds no story of mine, and says whose it is.)
- Follow-up: "More in <client>" lists what is in Cooptimize's scope for that client (as Ahead does without "Show the whole project"). Should it show the whole project? (Answered Nov 11: no. More stays within the areas FocusTime reads for the client.)
- Follow-up: the target date sort uses a story's own target date; most stories have none, so they keep backlog order after the dated ones, and a feature I don't own sorts by my first story's date. Should a story fall back to its feature's date? (Answered Nov 11: yes. A story with no target date uses its feature's; items with neither go last, in backlog order.)
- Follow-up: the hover says the size as DevOps has it ("size 3"), not the field's name ("Story Points"), which the week load doesn't carry. (Answered Nov 11: the hover shows the size the way the rest of the app does, the letter and its hours, not the DevOps field's value.)
- Follow-up 2: a feature's hover says its size only when it is on the week's list with an estimate ("about 6h"); otherwise the hover has no size. Should it say the 4h default?
- Follow-up 2: a story's size on hover is FocusTime's own (its to-do's size, else the week list's, else "Size? · 2h"); DevOps points are not turned into a letter anywhere in the app, so they aren't here either.

## QT-1

- The brief as received stopped after B.3: parts C (a block that ended today takes work), D (collapse past days) and the three WD-2 review fixes had only the title line. Each was built from the simplest reading of that line; if the full brief said more, it is still to do.
- Past days fold to one line on every past day, including a whole past week (all its days are past). Should a past week stay full, as a review, and only this week's earlier days fold?
- A folded card shows counts only ("2 done · 1 not done"). Should it name the not-done to-dos, or show a late promise's chip (it keeps the phone's late chip in its header)?
- "Double-booked" (two focus blocks on one half-day) still makes a block At risk. It comes from the schedule (Dataverse, standing blocks), not from the plan, but it isn't a meeting or a personal event either. Keep it?
- Watch's reasons are a hover on the card's header and the panel's time line only. On the phone there is no hover. Show them somewhere there, or drop them?
- The three WD-2 review items taken were the ones that fit without a migration: the panel's "+" with the drop check, Undo restoring a local timebox, and the unused styles. If the brief meant others (an unsized plain to-do coming back as M, the feature select inside a list option), they are still open.
- Admin's per-level "Plan up to" column was removed with Settings' (it only moved the chips' amber line on Week). Ahead's capacity still reads the stored values, which nobody can now change on screen. Remove them from Ahead's budget too, in the next step?
- Still talking about over-planning, outside Day, Week and the panel: the midday check-in, the assistant's "overloaded blocks" and move note, Ahead's weekly "about 2h over". For the next step.

## CI-2

- The offline path needs the cache to be written on the same runner image. On the first run after GitHub rolls out a new `ubuntu-latest` image (about weekly), every shard takes the online path once; an outage on that day would still fail them. Accept, or also allow the offline path from the previous image's cache when WebKit starts (the launch is the check)?
- A new Playwright version also takes the online path once (its package list may differ). Same question; read as "accept" for now.
- The proof runs on pull requests that change the script or the CI workflows, and by hand (from main only, as GitHub allows). Should it also run weekly, so a new runner image that breaks the offline path shows before an outage does?
- `docs/architecture.md`'s scripts line doesn't list `ci-webkit-deps.sh`: this step was limited to `.github/`, `scripts/` and the named docs while QT-1 works in `docs/`. Add it in a later docs pass.
- The other step outages can still stop are `npm ci` (npm's registry) and Install WebKit on a browser cache miss (Playwright's CDN). Neither failed on Nov 11. Worth the same treatment?
- Each install-deps attempt is cut off at 3 minutes (3 attempts, about 10 minutes at worst), because the browser jobs time out at 20 minutes and the tests take up to 6.5. A mirror slow enough to need more (AP-2 saw 8 to 17 minutes) now fails in the step instead of timing the job out. The review suggested one overall deadline instead; kept per attempt so each retry starts fresh. Fine?
- `e2e/wd2.test.ts` now sets the address again until the page shows. Other browser tests set `location.hash` once after a reload the same way. Give the harness one `goTo` for all of them (a later step), or leave each until it flakes?

## VM-2

- Azure refusing the start with 403 (no deallocate or start permission on the VM) is treated as a failure ("couldn't start your VM"), not as a sign-in problem: Allow Azure access wouldn't fix it. Is that the right word for it?
- PTO is read fresh from Dataverse for each start (a cached snapshot isn't trusted: PTO entered this morning must count). Someone without a Dataverse user id, or on a day Dataverse can't be read, gets no automatic start. Is a cached snapshot good enough on a Dataverse outage?
- A start Azure accepts and later fails (the operation ends Failed or times out) is said as "is starting" and the write log has the failure, but no second notice. Add a "couldn't start" notice from the follow?
- Once a day is claimed the attempt is spent, even when the VM turned out to be running already or the start failed. A second try later the same morning would need a retry rule; none for now.
- PTO or holidays that can't be read leave the VM off that day (the safer reading). Should it say so?
- In the demo the environment comes only from `FOCUSTIME_DEMO_AUTOSTART_ENV` (tests); the hosted demo sessions never set it, so they show "production only". Fine?
- The auto-start uses each person's stored sign-in (their refresh token) while they're away. If Entra's token lifetime or a conditional access policy ends it, the start is skipped with "couldn't sign in". Worth watching on prod for a week.
- The demo's working week is Monday to Thursday, so its pause takes a calendar week; on prod it depends on each person's hours.

## ENV-1

- The focus timer still ends on time on a test site and its end shows in the page (the person pressed Start there); only its Web Push waits for the person's switch. Read as "the person started it", not as an unprompted notice. Should a test site's timer end be silent in the page too?
- Check now runs the AI pass when it finds a transcript, under the presser's switches and caps (a button press, for that person). Taken as allowed; say if a test site should store the transcript without the AI pass.
- An admin editing a client's names on a test site doesn't re-sort held messages (it spends AI on everyone's chats, not just the admin's). Held messages stay held there. Is a button for it wanted on dev?
- The retention purge still runs on dev, so dev's stored chat text and transcripts go after 14 and 30 days as the hard rules say. Read "what dev's database already holds stays" as "this step deletes nothing", not as "retention stops on dev". Confirm.
- VM-2 merged while this step was open. Its production check now comes from the policy's `vm_autostart` (never outside production), and its tick part and wake are skipped on a test site, which shows "production only" as VM-2 designed. VM-2's demo override (`FOCUSTIME_DEMO_AUTOSTART_ENV`) is unchanged.
- The Settings switch is hidden by `/version`'s env label, which is lowercased and trimmed, while the server's policy needs exactly `prod`. With a misspelled `FOCUSTIME_ENV` such as `Prod`, the label says prod and the switch is hidden while the server treats it as a test site: nothing is sent, the safe side. Fix the label too, or leave it?
- The DevOps store on a test site runs only while someone is active there, so the first screen after a quiet night reads from a store up to a night old until the next poll (seconds). Acceptable?
- Not run here: a live Bicep what-if against Azure (the step's rules allow nothing against Azure). The compiled parameters were compared offline (`az bicep build-params`); deploy-dev prints the real what-if on merge.

## QT-2

- **For the product owner: Ahead's amber.** The Gantt's weeks still say "8h free · 10h planned · about 2h over" in amber when a week's features need more than its free time. It's the one place left that says "over" about a plan, kept because it's a forward-planning view (QT-2 point 4). Keep the amber, show only "8h free · 10h planned" in the neutral style, or drop the planned hours there too?
- The check-in's "2h 30m free this afternoon" is the free time after meetings and personal events, not after what's planned (the block panel's "1h 45m free" subtracts the to-dos, QT-1). Saying the afternoon's time as a fact seemed the simpler reading of "the afternoon's free time"; subtracting the plan would bring "No free time" back as a fullness signal. Is that the right reading?
- Every unfinished to-do in the check-in now has its move button. On a block with many to-dos that's a column of "Move to Thu". Fine, or show it on hover only?
- The assistant's "Move the <client> to-dos from Wed PM to Fri AM" is now offered for a block the calendar puts at risk (it was for an over-full one). It's the same step a person relied on, for a calendar reason. Keep it, or drop suggestions from "what should I look out for" altogether?
- Week's drop refusal on a past day still reads "Can't drop here · Already over" (QT-1's ground, not changed here). "Over" there means the day has ended. Reword to "That day has ended" in a later Week step?
- The stored `plan_share` and `keep_open` values are no longer read anywhere. Settings' autosave still names "Plan up to" in its saved notice, but no control on screen can change it. Remove the stored values in a later release (a column drop needs `safe-drop`), or keep them in case Ahead's capacity wants them again?
- `plan/addpane.ts` still picks a default block that isn't "over" (`BlockChoice.fit`); nothing shows a word for it. Left alone.
- The style guide page (`/styleguide`, development builds only) still shows "fits, 1h spare" and "over by 30m" samples. Left as it is; it never ships to the hosted app.
- From the review: the check-in's Move button is on every unfinished row, including the to-do under way in the open block. With two open blocks (an 11 AM check-in) only the total free time shows, not which block has it. A move keeps its half, so "Move to Thu" can land on another client's Thursday block and be refused (as before QT-2, now on more rows).
- `ui/Roadmap.tsx` still says "Over-booked weeks", but nothing imports it. Delete the file in a cleanup step?

## QC-1

- DevOps' title limit: 255 characters is what FocusTime enforces (a String field). The pages read for this step (work items create, work item type fields list, 7.1) don't state it; confirm on dev with a 256-character title.
- Capture keeps plain Enter as "save" (Capture is saved at once, never a form); only Ctrl+Enter on a Draft story or Draft feature opens the New form. Should plain Enter on those two kinds open the form too?
- Save as draft keeps the type, parent, assignee, date and description, but not the More's size number (a draft keeps S, M or L). Worth a field?
- The step expected no migration; drafts at any level needed one additive column pair (`item_type`, `assign_to`). Fine?
- A new item assigned to someone else gets DevOps' own notice only, no FocusTime note. Should they get Ahead's quiet note too?
- A created feature from the block panel sits on the block as a to-do (the draft path), not as WD-1's week pin. Should it also go on the week's features list?
- "+ New" sits in Ahead's header beside Refresh rather than in the filter toolbar, so it is there in every mode. Right place?
- Review pass: closing the form after the panel's New feature keeps the draft on the block (with a line saying so) rather than removing it. Should Cancel remove it?
- Review pass: when a process has several types at a level, the form starts on the level above's default child type, else the first. A process rule can also make a field required only in some states; FocusTime checks only the always-required fields, so such a refusal comes back from DevOps at Confirm in its own words.
- Review pass: "the same create" is the same title, type and parent within 15 minutes. Two people making the same title on purpose in that time each make their own (it's per person); one person must change the title or wait. Fine?
- A level above epics shares the epic tier in Ahead (Show: Epics opens it too, named "Domains / Epics" once one is listed). Better as its own level in the control?

## WP-1

- A monthly inventory, production only, could keep the numbers fresh. Not built: nothing in this step runs on its own.
- The prompt asked for e2e tests "in the demo". The demo has no app-level DevOps reader, and a demo reader would mean a demo source for every client's history; the e2e runs in the live harness (real sessions, fake DevOps and the stub AI, fictional data) instead. Say if a demo seed is wanted.
- DP-2's `data_platform` client rule overlaps the page's Platform. The page keeps its own (Azure, Fabric, Both) and shows DP-2's as a hint when not set. Should one feed the other?
- The Flex tier isn't used: a classification runs on the standard tier so the estimate and the cost stop mean the same thing. Flex could halve the cost.
- The person's monthly AI cap applies to a classification, like any request they start. A large first run may need a raised cap for that person (Admin › AI).
- Dev scales to zero: a run lives only while the replica does. The page asks for status every 5 seconds while open, which keeps it up; a closed tab can let it scale down, and the run then shows Stopped with Resume. Fine for a preview?
- Only the inventory's own reads are paced against the poller; the estimate reads only the store. A Resume of a classification needs a fresh estimate (the cost may have changed).
- The history sample (200 closed items per client) reads one request per item. With 30 clients that is up to 6,000 requests on a first run, paced; later runs read it again (history isn't kept between runs). Keep it, or keep the booleans per item and revision?
- The shared `htmlToText` (`sources/devops/normalize.ts`) throws on a numeric entity past U+10FFFF; the patterns page guards itself, the rest of FocusTime (screens, the poller's normalizing) doesn't. Fixing it is outside this step's scope; worth a one-line fix.
- After a restart the page shows a run as running until its heartbeat is 3 minutes old, then Stopped. Shorter risks stopping a live run that is waiting out a DevOps delay. Fine?
- An item's history over 200 updates is read in up to 5 pages back to back (one item's request). Rare; pace them too?
- The AI's "other" names are kept with client names and emails replaced; a person's name in them can't be recognized. The instructions forbid names, and the list is made from names and meanings only.

## SG-1

- Kept rows are remembered only for the visit (in the page). After a reload a block that has only kept to-dos is an ordinary block with work and offers nothing more. Should a kept suggestion keep the rest of its block's offers across reloads?
- A draft story (local, not yet in DevOps) never makes a feature "has stories": a feature with only drafts is still offered as Needs breakdown. Count drafts?
- On a Thursday the next working day is Monday of next week, which Day shows but Week (this week) doesn't. Fine?
- Keep all is the existing actions one after another, not one server transaction: a failure part way keeps what worked and says how many couldn't be kept, and Undo takes back what was kept. Worth one batch action later?
- A cleared row is cleared for the week it was suggested in; next week it can come back. Right length?
- `planday.carry` and `planday.carry_hint` are no longer used by the UI. Remove them in a later release.
- From the review: on a Thursday, this week's view suggests on Thursday and Day on Monday shows next week's: an unfinished to-do can be offered on both at once, and a row cleared Thursday (for this week) can show Monday. Compute over today and the next working day whatever week is shown?
- From the review: Keep from a stale tab adds the story even when another tab placed it on another day this week (`pick.add` checks only the same day). Refuse a second placement in the week?
- From the review: dragging a suggestion onto its own block makes a to-do that isn't "kept", so the block's other offers go, where clicking Keep leaves them. Same rule for both?
- From the review: cleared choices (`markers` kind `sg_clear`) are never pruned. Remove ones older than two weeks in the daily cleanup?
- A block whose free time the calendar fills still gets one suggestion (A4's "at least one"). Offer none there?

## WP-2

- Dataverse names one DevOps project per client, so the page reads one project per client. The scope model takes several projects, but listing a client's other projects in the org needs a new DevOps read (the org's projects) outside this step. Add it if a client's BI work lives in a second project.
- A team whose team field isn't the area path (a custom team field) can't be matched by area; the page says so and asks for area paths instead. Read the team field's values per item if such a client appears.
- The ticket guess thresholds (80% no parent, half closed the same day, 50 items, a quarter of the client's) are a first guess; every kind can be changed on the page. Adjust after the first rerun?
- Items outside scope are kept only as layout rows (id, project, area, type, created date) so the scope can be chosen again without reading DevOps. Fine to keep, or drop them after the inventory?
- The page's scope can be copied into Admin › Clients only by hand (the link opens it). Copy it with one button later?
- "Too few to read" is 20 items for every figure. Some (agreement per field) might want more.
- A WP-1 run can't be resumed under the new rules; its labels stay as they were. Delete WP-1's labels once a new run is done?
- From the review: Resume of a classification starts its cost count again against a fresh estimate of what is left, so across several interruptions the total can pass 1.5 times the first estimate (each part stays under 1.5 times its own). Keep a run-wide total?
- From the review: the agreement sample is drawn across the clients pass 1 started with; a client skipped later (Allow AI turned off), and items that moved out or failed, take places without giving a pair, so the pairs can come out under 100. Draw it again after pass 1?
- From the review: a refusal before anything is sent (one item that still holds a secret or an outside address) counts as "the answer failed its check", though nothing was paid. A separate "not sent" reason?
- From the review: the AI's "other" names go into the summary with client names and emails replaced; wording from an item could still echo in them. Show them only on the page?

## WP-3

- A merge carries the merged type's labels to the type it went into and asks for no relabeling (the brief said a merge "says how many items would need labeling again"; the page says the count and that none needs it). Relabel a merged type's items instead?
- `own-1` adds "data migration". Labels carried from WP-2's list as "other" or "can't tell" aren't marked to label again for it (an add on a later version is). Mark them on the first run?
- A carried label with no counterpart on the list in use counts as "other" and as needing a rerun; the next Estimate prices it. Fine, or leave it as "other" until someone asks?
- WP-2's AI list added a type named differently from "data migration"; it has no counterpart, so its items count as "other" with the AI's name as a suggestion. Map it to "data migration" by hand once the suggestion has been read?
- The per-client tables are on the page for Build work only; Tickets and support has them in the summary. Add them to the page too?
- Screenshots come from the live browser harness with fictional data (as WP-2's did), not the demo: the demo has no patterns reader. Give the demo one?
- "Not reliable yet" is under 70% on 20 or more pairs, for every fact and layer. Right line?
- A change to the list during a run applies to the next run; the running one keeps its list and its labels carry. Should a change wait until the run is done?
- The sample's second answer is asked again for an item labeled again (its first answer changed). That doubles the cost of relabeling sample items. Keep the old pair instead?
- From the review: carrying from WP-2's AI list treats a "split" as the same type (its labels go to the type it was split from). A split's labels might belong to either half. Label them again instead?
- From the review: an AI type with the same name as an own-1 type maps by name, even if the AI's changes said it was a merge. Follow the changes instead?
- From the review: agreement pairs on carried labels are compared after carrying, so two AI types with no counterpart both become "other" and count as agreeing; a carried first answer can sit beside a second answer made on a newer list. Leave carried pairs out of agreement?
- From the review: when AI is off and the page can't read the directory either, only client keys are checked in a type's words. Fine for a page only a few people have?

## PS-1

- "to place" stays the word for unfinished to-dos with no block ("7 to place · Review"), beside "unfinished" for a past day's. One word for both?
- The timeline's narrowest tier still says "9–1" where "9:00–1:00" doesn't fit. Kept as the fallback; fine?
- A card folds its done to-dos at six to-dos (`HEAVY`). Right number?
- Day opens with its panel at 1280 px and wider (`WIDE`). Right width?
- Items drawn by time on Week's rail and Day's timeline (events, timeboxes, promises) are shorter than 28 px when they are short; their height is their length, so they are exempt from the target size. Give them a bigger hit area?
- Holidays come from the Working Days Calendar's observed flag only. A company holiday not marked observed shows nothing. Right?
- On the phone with the weekend shown, Week's seven day tabs share the row and are narrower than 44 px (they keep the 44 px height). A scrolling row instead?

## NL-1

- After the day (and before it), Week and Day still select the afternoon (or morning) block for the keyboard, with its outline, from the server's `today.half`. It is the keyboard cursor, not a now mark, so it stays; should the selection outside hours land somewhere quieter?
- A block's hours are its working bounds. The early flex time that joins the morning's working windows (D122) sits before the morning block's start, so it gets no mark. Right?
- CV-3's overdue promises are still drawn "at now" on today's home block (`homeRail`), clamped to a block outside hours. That is a promise, not a now mark, so it is unchanged here. Should it move too?

## WK-5

- The day in focus takes twice a working day's share (`FOCUS_SHARE`). Too much at 1920 with every day shown? 1.6 would leave the other days a rail sooner.
- A hidden day shows its note only when it has open to-dos or is today (the reading that shows less). Should a hidden day with a meeting, a promise due or PTO say so too?
- Show (the note's) brings back every hidden day for the visit, not just the one with to-dos. One at a time instead?
- A past day lists six to-dos, then "N more" (`PAST_ROWS`). Right number?
- With every other day folded, the focus day may still be under twice a working day (1024 px with the panel and Larger text). Hide the panel's Add list sooner instead?
- Day's past cards list their to-dos too (they share Week's card). Keep the QT-1 line on Day?
- The demo's day off moved from Friday to Saturday on a Thursday (and the holiday is never today) so Week shows a working today. Right for demos on other days?
- With the panel open on another day, today folds like any day in the fold order; when today is the catch-up day it folds second. Keep today open whenever the week has it?
- Past days keep their full share of the width (review 1 noticed the empty space on Monday to Wednesday). Give past days a lighter share, like Friday's?

## BL-1

- Stale is counted in Needs attention only for items that are already its candidates (near the top of the backlog, dated in the next 4 weeks, or mine) and that I may change. Taken as the reading that shows less. Should every stale item I may change count, wherever it sits?
- A calm health (On track, Done) goes after the gaps in the Status chip, so a feature that is On track but unassigned reads Unassigned first. The brief said the health comes first; this reads the brief as "never lead with a reason that asks for nothing". Right?
- Collapse all from ⋯ changes the level shown, so the Filter button's count goes up by one. Should folding count as a filter?
- The Showing line names the level only through the one-level list ("Stories only, in rank order"), not Levels by itself (Epics, Features). The Filter button's count covers it. Enough?
- The change set pill moved from its own row into the header row beside the title, so it no longer takes a row. Is it seen enough there?
- One level as a list has no 40-row limit any more (the client fold and Needs attention's Show more are the limits). With 500 stories that is a long page. Bring back a per-client limit?
- A Guide link that turns a filter on (`#/backlog/attention`, `#/backlog/stories`) reads back as `#/backlog` once the filter is on, so Back after it returns to the plain Grid with the filter still on (it lives in the query). Right?
- Review 1 asked for one word per problem: the Status chip says the health ("Needs a date", "Not scoped") where Needs attention's kinds say "No target date" and "Needs stories". The health wins in the chip by rule (one chip per meaning). Rename the health states, or the kinds?
- A Dates cell with only a target shows "Oct 30" with no label (the tooltip and screen reader say target). Show "→ Oct 30", or "Target Oct 30"?
- The Dates cell shows the half ("Dec 23 PM") when a date was staged with AM or PM. Is the half worth showing in the Grid?
- The bulk bar has "To a date…" (move every target) and "Set a target date…" (only where none). One button with a choice inside?
- One level as a list shows the last change and the stale age only on hover and to a screen reader (the old Backlog mode showed them on the row). Bring them back as a column at the cost of width?
- Left on a child row moved focus to its parent in Readiness; in the Grid, Left moves to the previous cell. Add parent jumps (as a tree grid usually does)?
- 500 rows: the rows aren't memoized and the one-level list has no limit. Measure before adding either?
- Enter on a checkbox inside Filter closes the popover (Enter saves a cell popover); and when the bulk bar closes, focus goes to the page. Move focus to the first selected row's cell instead?
- The Dates editor (Start, Target, quick picks) is taller than the room above or below a row near the middle of a 900 px window, so by AH-5's rule it opens over its row. Make it shorter, or let it scroll beside the row?

## PS-2

- The check leaves out text cut at a scroll edge (a scroll container, the page's frame and the fixed status bar), which is scrolling, not clipping. Count the status bar too?
- From the review, seen before and after PS-2 and left alone (outside this step): on Day's Cards at 1280 one row's gap is a few pixels larger than the others; in a block's feature group a title's first line sits a few pixels below its checkbox; the phone's Week keeps an empty second line on one-line to-dos.
- The Timeline's "#id" sliver measured 3 px but showed no ink at 1x (the top of the digits' box is empty space). Fixed anyway; the check counts the box, so a font with taller digits would show it.

## TP-1

- The request type tag is checked for its own shape only; the GD-2 client boundary check scans the text (description, acceptance), not System.Tags. Type names are the team's own words, but an admin could name a type after a client. Scan tags too, or refuse a client's name in a type name?
- Microsoft doesn't document the error a create gets when the person may not add a new tag. TP-1 treats a 400 that names tags, on a create that carries a `type:` tag, as that refusal; a 403 keeps its own message. Confirm against a real project where a Stakeholder creates an item.
- "One story" is a story kind, for types that are usually one story (Small change) or Discovery then one fix (Data anomaly). Break down should offer these as its starting proposals: when, and how much should it lean on them?
- A type removed after a draft was saved stays with the draft, and creating that draft writes its tag. Should a removed type's tag still be written, or dropped with a note?
- An item written under the studies' earlier names (Target, Change, Control, Boundary) counts its Boundary text as How far filled, since it had no choice to make. Keep that, or ask for Done when it is there too?
- Why each line matters is the team's to edit (Admin › Work templates). Should those four sentences be fixed like the names?
- A patterns page could read the request types from the templates (how many items of each type, how many Ready). Build it from `work_template_uses` and the tags in the central store?
- When a client's platform needs its own hints (a Fabric client's "where" is a workspace and lakehouse, a Power BI client's a dataset), should a type's hints vary by the client's data platform (Admin › Clients) or stay one set for everyone?
- The target for "items with all four lines": choose it from real counts (Admin's counts per type) and the models' and reports' items once a few weeks have run, rather than now.

## TP-1b

- TP-1's questions above about the tag, request types, the four lines and Ready no longer apply while the request type and the four lines are off the form; they come back if Work templates does.
- Follow-up questions: when a person leaves a question empty, should FocusTime ever ask a follow-up (at create, or later from the item)? Not now: TP-1b never asks. Pick it up with the rule for when it may ask, and from which answers.
- Should an admin be able to edit the three questions' words or grey text? TP-1b fixes them in code (`plan/three-questions.ts`), the reading that asks less of the person; the stored templates aren't used for them.
- When does Work templates come back? Its tables, store and seed are kept; the plan is that Break down offers a type's typical stories. Until then nothing reads or writes them, and the Admin page and Settings view are hidden.
- The third answer goes after a draft's own acceptance text, separated by a blank line, when a draft has both. Keep both, or let the box replace it?
- From the consultant review, seen but outside this step: size is asked three ways (the draft editor's XS to L chips, the New form's box, the card's Story Points); the phone's Description box is grey in dark mode; on the phone at the largest text size the Size help sits under the + button; the card's labels sit a few pixels below their values; "Saved on this computer" in the draft editor reads oddly for a hosted app.

## RB-1

- Languages people open that aren't colored yet: C#, JavaScript and TypeScript, Bicep and ARM templates, Scala and Spark SQL in notebooks, KQL, CSV. Each is one Prism grammar (a few hundred bytes) and one row in `ui/code/languages.ts`; add them once the view log shows which extensions people open (the log keeps paths, so counting extensions needs no new data).
- Notebooks stored as source show as Python with their `# COMMAND` and `# METADATA` lines; `.ipynb` shows as JSON. Should a notebook show as cells, and Markdown as a page? Both are out of this step, and a rendered page would need the same "never live content" care as the code view.
- A view by kind (reports, models, pipelines, SQL) across a client's repos, and picking a real report or model on a work item.
- Search across clients, and search inside files. Both mean reading many files per question, which the per-click, nothing-kept design doesn't do today.
- Is 12 months the right time to keep the Code views log? Long enough to answer "who looked at this client's code this year", short enough not to become a history of people. Taken as 12 months; the Rule could move to Admin if a client asks.
- Should an admin be able to switch a client's code off entirely (for a client whose contract says its code stays with its team, Its team only may not be enough if the team itself is large), or hide Code for one person?
- DevOps doesn't document what a token without Code (read) gets back; 401, 403, 203, a redirect and a sign-in page with 200 are all read as "needs Code (read)". Check against a real token without the scope once the product owner adds Code (read) to the first client, and narrow it if one of those means something else.
- The admin status line checks each client's repos when Admin › Clients opens (one request per client, through the limiter, remembered 5 minutes). With many clients that is many requests on open; check it on Check only if that turns out slow.
- Find matches file names; should it also match folder names (to jump to a folder)?
- Opening a repo's top folder counts as "Opened the repo" each time the repo's tree is read again after the 5 minute memory; a person who keeps the panel open reads it once. Fine as a signal of use, not a count of visits.
- A file's path is in Code's address, so it sits in the browser's history (never the file's text; the stored last place leaves Code out). Is a path in history acceptable, or should Code replace history entries instead of adding them? Taken as acceptable: Back and Copy link need it.

## ED-1

- Should a moved item take its new parent's area and iteration? ED-1 changes only the link (the reading that changes less in DevOps); DevOps doesn't do it either.
- Should tables and images become editable? Today a description with either gets Add to the end; a table editor is a bigger step, and images need attachment uploads outside a create.
- Should the assistant offer these edits (a title fix or a move as a proposal)? Not in ED-1: the assistant keeps its own `description_edit` and offers neither `item_edit` nor `reparent`.
- What should ED-2 carry into the Backlog grid first: an inline title edit, Move… by drag, or bulk move of selected rows?
- The revision guard counts any revision, a comment included, so a comment while I type means Save again. Narrow it to the fields being edited (as `fields` does per field), or keep the whole-item guard?
- Markdown fields rely on API 7.2-preview.3's `multilineFieldsFormat`; when it leaves preview, move to the released version and check the format op's casing again.
- The DevOps docs don't state that a remove and an add on relations can go in one patch, nor the one-parent rule; ED-1 relies on the patch being applied all or nothing (as the docs say for a test failure). Recheck if DevOps ever returns a partial result.
- The not-allowed note on the card says "Harbor's leads" with the client key where Backlog says the client's name; the write framework's rights note uses the key. Use the name everywhere?
- From review 2, accepted for now: runs of non-breaking spaces used for indenting collapse to one space, a line break inside bold or a heading becomes a space, and an edit that only adds or removes blank lines saves nothing. Refuse those fields too, or keep editing them?
- A Markdown field's live look and preview use FocusTime's light look, not a full Markdown renderer: `_x_`, code, quotes and `1)` lists may show differently from DevOps, though the text written is exactly what was typed.

## IB-4

- Should chats be read less often now that the Inbox shows only suggestions, given Call live? IB-4 leaves the 5-minute poll as it is (not in this step).
- Is 7 days right for an untouched chat promise? And should a promise to someone at the client wait longer before it expires? IB-4 uses 7 days for everyone.
- Should the AI ever point out that a promise looks delivered (from a later message)? Not in this step: only a finished item, the date rule or the person clear one.
- Should suggestions and drafts later move into Backlog, and the Inbox tab go? Not in this step.
- The 4 working hours use the viewer's own working hours, not the union of the chat's followers' (the union would need the server wiring that RB-1 is changing). Each person sees a suggestion after their own 4 working hours.
- GD-2 point 3 said a held-back message stays visible and sortable by hand. IB-4 takes the held list out of view (the reading that shows less); held messages stay held and the flags at every exit stay. Bring the list back if people miss it.
- Promises I added by hand (follow-ups) never expire and a finished item doesn't clear them (they have no linked item in the same sense). Should one linked to an item clear like a chat promise?
- "Add to my week" on a promise from a chat still puts it on Today, as before.
- IB-4 touched a few lines of RB-1's files (the action list, the Inbox lists in nav, the keys in the menu, the demo seeds). Merge order: whichever lands second takes both sides.
- The first look's note ("N older promises from chats were cleared") shows nothing in the demo, whose promises are seeded fresh each session.
- A promise linked to an item that is Resolved (done, awaiting verification) stays open until the item is Completed. Should Resolved count as finished for this?
- From review 1, seen but left: on the phone at the largest text size the switch's labels wrap with their counts; at 1440 the Inbox is a narrow centered column (960 px); the demo has two promises titled "Confirm the intake form go-live date" (one found in a chat, one I added), which reads like a duplicate.
- There is no key to switch between the three lists (Tab and Enter reach them). Add one?

## RS-1

- The light themes' washes need their own strengths. With muted and faint text held at AA, Cooptimize Light takes the accent wash at 9% (not 14%) and Neutral's light side takes 2%, 3% and 4%, where its faint text has only 4.8:1 on the page to begin with: there, hover is hard to see. A slightly deeper faint text in Neutral light would let it take the same strengths as the others; that is a color change, so it was not made. Is the quiet hover in Neutral light acceptable, or should its faint text deepen?
- The quiet line (`--line`) was read as "between the surface and the control outline" (60% of `--border-strong` on the surface), which lands about where `--border` is. Read the other way (between the surface and `--border`) outlined buttons were close to invisible in the dark themes. Is the line the right strength?
- Small buttons (28 high) keep the meta size (12), not the body size (13): at 13 they would widen about 450 places inside cards and rows, some of them rows with a fixed room for the title. Should they be 13?
- Links in sentences (Review, Dismiss, Edit, Delete on a comment, Open in Teams) stay links, underlined in the accent or the text's color: they were not made quiet buttons. Should row actions that are links today become quiet buttons?
- "⋯" still appears as a word in sentences: the Guide's answers (33 places, "open ⋯ › About"), a few hints in Settings and tooltips ("the setting is in Week's ⋯"), the key legend's foot. The control it names is now the More icon (three dots), with the same accessible name. The sentences were left because no word was to change; should they say "More"?
- Left in the old shape, and why: the Demo data tag (a filled brand-like tag that opens Settings: it has no line, though it can be pressed); the phone's day tabs on Week (Mon 2, Tue 3: kept as the phone's layout has them, 8 radius); an empty block's dashed "Add" row (PS-1's one dashed invitation); things drawn by time on the rail, the timeline and the Gantt (their size is their length); the keyboard chip (`kbd`); color swatches in Admin; checkboxes and radios (the browser's own); the focus screen's large buttons (pills, at their larger size); the capture box (an input at the title size, 10 radius).
- Icons people might misread: Week (four columns: could read as a table or a board); Backlog (an indented list: close to Status's bars at a glance); Capture (a plus in a square) beside the header's Add (a plus); Close the loop and Send to… share the paper plane; Promise is a handshake, which could read as a meeting; a capture to sort is a note sheet, close to File; Catch-up day uses the "history" clock arrow; Stale has no icon of its own. Worth watching in the pilot.
- Things icons placed so far: promise and From chats on Day's lines and chips and the Inbox's switch, a capture to sort on the Inbox's switch, call on Join, PTO, holiday and the catch-up day in Week's whole-day cells, folder and file in Code's tree, people, meeting, standing and the rest in menus. Not placed on a card's At risk pill or a meeting's line (they would widen the narrowest cards past WK-5's minimum widths). Should At risk carry its icon where there is room (the panel, Day)?
- The stepper's "−" and "+" (hours) are the minus and add icons now; "+15" on the focus timer, "+N" for more chips and "→ Thu" are words and stayed.
- A browser fold (`details`) shows the family's chevron through a CSS mask (the same drawing as the icon module's), since a `summary` marker can't hold a component. One drawing in two places: if the family's chevron changes, the mask in `ui/styles.css` and `ui/guide/guide.css` changes with it.
- The top bar keeps one row down to 1024 px at the Default text size by sitting closer under 1100 px. At Large and Larger text under about 1280 px it can still wrap to two rows, as it could before (the words grew then too). Is that enough, or should the VM chip fold to its dot first?
- Spacing: the named steps (24, 16, 8, 2) are tokens used by the new control and row rules. Week's grid gap (14), card paddings and page heads were left as they were, since moving them moves content (WK-5's minimum widths are measured on them). Should a later step move the grid to 16?
- The lucide-react version is pinned (1.66.0). Its icons are drawn on a 24 unit grid with a 2 unit stroke; FocusTime draws them at 16 px with a 1.5 px stroke that doesn't scale (`nonScalingStroke`), so at the largest text size (21 px icons) the stroke stays 1.5.
- From review 1, seen and left: Status keeps its nested boxes (a client's card, Needs your update, a feature's box): they are cards, not rows, and were out of this step; should Status be flattened next? With no lines between the Backlog's rows, tracing a title across to its status takes the hover band; is that enough on a wide screen? Mine, Contributing and Everyone with nothing chosen reads as one grey slab. The Today pill is the accent wash now and anchors Week's header less than the filled pill did.
- From review 2, seen and left: the stepper's − and + and its value keep their own small shapes (one compound control); the date picker's days and the timeline's placeholder buttons are drawn at their own sizes; two CSS marks with no element left in the app (`.dp-calls .lc-start`, a "☎") were not touched; "›" between steps and in a story card's path is a separator in a sentence.


## TD-1

Not verified (who could confirm):
- How long dev waits before scaling to zero: the Bicep sets no cooldown, so it is Container Apps' default; the runbook says 300 seconds (whoever runs Azure, from the portal's scale settings).
- Each line of Admin › Status against the code (an engineer, with an admin account on dev).
- The exact error text Azure shows when a resource provider isn't registered (whoever next sees it).
- Which Dataverse columns are read beyond those the adapters name, and whether Dataverse's own audit records FocusTime's reads (Cooptimize IT, Dataverse admin).
- How far behind a calendar added by link can be: the provider decides how often its feed changes (none to confirm; a note for people).
- Which Web Push services a person's browser uses and what they keep (the browser vendors' terms; IT if it matters).
- Encryption at rest of Azure SQL (on by default in Azure SQL; whoever runs Azure, from the portal).
- The 32,000 character comment limit in the Coop contract against a real DevOps comment (the Coop owner).

Where the code looked wrong (the pages say what it does; nothing changed):
- Settings › Notifications still shows switches for `commitment_item` and `taken_over`, and the notifier still lists `conversation_given` and `conversation_activity`, but nothing sends any of the four. Remove the kinds and the switches?
- `conversations_upkeep` still runs after each chat read on prod and does nothing; the background policy's description still names escalation, reminders and follow-through drafts. Drop the job or fix its description?
- The client boundary's point 3 says a held message is visible and sortable by hand; since the slim Inbox no list shows held messages (the rows are kept and re-sorted when an admin edits a client's names). Is that the intent?
- Urgent requests are still picked out by the chat poll and still remind people (the `asks` kind), while the Inbox no longer shows requests. Keep the reminder, or show it somewhere?
- Send feedback creates a DevOps item in Cooptimize's own project (`FOCUSTIME_FEEDBACK_*`, a preview, 10 a day). The hard rules don't name this write. Add it to the rules, or is Cooptimize's own project outside "external systems"?
- `@microsoft/teams.cards` is installed with the Teams SDK and nothing imports it. Remove it from `package.json`?
- The in-app Guide still says "Delivery chats" where the screens say "Client chats" (the Guide is GU-1's).
- The Coop contract sits beside the technical docs but isn't in the panel (`scripts/tech-docs.ts` lists seven pages). Add it to the panel?

Kept but not written:
- `chat_messages`, `asks` (the retention purge still deletes old rows), `delivery_chats` (neither read nor written) and `dedupe_log` (only counted at a SQLite start). Each can go in a later release through a `safe-drop:` migration once nothing reads it. Who decides when?

Should `docs/architecture.md` and `docs/spec.md` be cut down now that `docs/technical/` is the reference for how FocusTime works? Both still describe old screens in detail; this step left them alone.

From the IT review (TD-1):
- Azure SQL, Key Vault, the registry and the bot use public endpoints with no private endpoints. Is that acceptable to Cooptimize IT, or should A6 add private networking?
- A person's outside-write log (Settings › Activity, `loop_sends`) goes with Delete my data, and `admin_audit` is kept forever. Should outside writes have an audit trail people can't erase, and should `admin_audit` have an age limit?
- OpenAI: the pages say only `store: false`. Who records the data region, the provider's retention and the data processing agreement?
- Every Cooptimizer can read every client's code by default (Code access: Whole company). Do client contracts allow that, and who checks?
- No rotation schedule is written down for `ft-data-key` or the OpenAI key. Who owns rotation?

## RS-2

- The demo's catch-up day has no working hours (`fri = []` in `sources/demo/data.ts`), so the demo shows it as one dashed Catch-up cell and the tests give the demo person a working Friday through `hours.set_day`. Should the demo always have a working catch-up day, so a first look shows its blocks?
- STEP 0.5's numbers came from a fake Outlook in a test (`actions/slow-source.test.ts`, RS2_MEASURE): fails at once with no copy 21 ms, with a copy 4 ms; fails after 20 s with no copy 20002 ms (unchanged: nothing to show), with a copy 20007 ms before and 3002 ms after. They weren't taken against the real Outlook or Google.
- When the server answers from an earlier copy, the read goes on in the background and refreshes the copy, but the screen shows the new data only on the next refresh (the next ask, R, or the 5 minute refresh). Should a late answer push itself to the open screen?
- C5 covers Outlook and Google (the calendar source). Link calendars (ics) and Dataverse still answer only when their read ends; should they get the same early answer?
- Neutral's dark `--client-tint` was lowered from 14% to 13% so faint text passes AA on the yellow client fill (4.47:1 before). The fills are a touch lighter in that theme only.
- A catch-up day with no working hours shows Day's one Catch-up cell but no header Add (there is no block to add to); Week's own cell offers Add hours on a Friday with to-dos. Should Day's header offer Add hours there too?
- A weekday with no working hours (not a catch-up day) still says "Nothing scheduled" on Day while Week draws its "No working hours" cards. Left as it was: should Day draw them too?
- PTO days are unchanged: Day says "You're off" and shows only what is still planned (nothing when nothing is), while Week shows the hatched cell. Should Day draw the hatched cell as Week does?
- The phone's block heads (`.ph-block`) aren't filled in the client color as Week's cards now are; they keep the swatch. Should they be?
- The day header's Holiday or PTO pill now drops on a column under 11em (was 9em), since the hatched cell below names the day. Week's all-day event chips in day headers still end in "…" on a narrow column: they are event titles, not two-part pills, and wrapping them would push the grid down. Should they wrap?
- A failed read shows its line in the header ("This week didn't load" with Retry) and, as before, the status bar's "Could not reach the FocusTime server. Showing what was loaded earlier". Both stay: the second also covers reads that aren't a week change. Should the status bar's be dropped while the header says it?
- From review 1, seen and left: while a week is read or failed, the old week's column dates, its Today chip and selection show dimmed under the new header (the spec asked for the old blocks dimmed; showing the new dates over the old blocks would mislead more). The failed line says "This week didn't load" next to the "This week" button; the words were set by the spec. The client fills are at the timeline bands' strength, which in dark is quiet; Northwind and Atlas are both teal-green in the demo's colors. Day's Timeline on the catch-up day shows the now badge over the hour label and the now line across a free gap's label, as on any day. The phone's Day has the header Add and the floating capture button, as on any day. "Not today" is a quiet button beside Start, the row style for secondary actions.
- "Mixed" shows only from 1400 px: at 1280 it pushed Backlog's filters to a second row (BL-1 keeps one row) and on the phone at Larger text it made the page scroll sideways. Below 1400 the switch is as before, nothing lifted, with "People: <each client's choice>" as its name and tooltip. Should the toolbar make room for it at every width? A call's mark that wraps starts its second line with "· Review 6 proposals" (moving the dot changed the mark's text, which `e2e/meetings.test.ts` reads).

## GU-1

- Places the app's own words looked wrong. None was changed. The Guide's own sentences don't repeat them, with one exception: "Every key" in Settings, phone and keys shows the app's key legend as it is, so the legend's old names and "⋯" show there until `ui/keys.ts` is fixed. Should the Guide drop that list and point to More › Keyboard shortcuts?
  - The key legend (`ui/keys.ts`, shown as the Guide's "Every key" and in Keyboard shortcuts): the Inbox row lists "Needs you, Promises, Waiting on, Captures and drafts" (the lists are From chats, Promises, Captures); two rows say "Actions (⋯)" and "Week's ⋯" (the buttons are named Actions and View options).
  - The Backlog tab's tooltip says "Readiness and Backlog" (`ui/App.tsx`).
  - On a phone, Backlog's notice has a button "Back to Today" (the tab is Day).
  - Settings: the section is named "Today and Week"; two settings are "Readiness nudges" and "Plan ahead rituals"; an org setting's label is "Fix next…" (`config/org.ts`).
  - The command menu's summary for Open Settings says "connections" (the section is Accounts and calendars).
  - `.dp-calls .lc-start` in `ui/styles.css` styles nothing.
- Client calls: the Guide used to say "⋯ › Client calls". It is not in More; it opens from the call's mark on Week and the command "My client calls". Should it be in More?
- In the Gantt, Enter on a row runs Break down. The Guide used to say it opens the side panel, and now says nothing about Enter there. Is Break down on Enter meant?
- Backlog's section keeps the id `ahead` (`#/guide/ahead`), the tab's code name, so no address moved. Should it become `#/guide/backlog` with the old one mapped, like Today to Day?
- Hand-drawn, and why, is the third table of `docs/ux/gu1/ledger.md`: the 13 tour drawings and most of the try-its stand for screen states that need the person's data and a server session. Should the block card and the Inbox row get a display-only form the Guide could render with example data?
- The urgent strip in the Guide is the app's lines laid out by the Guide, not `UrgentStrip` itself (it reads the person's Inbox items). Same question.
- Should Renamed be removed after the next production release, or kept while people still type the old names? Its 33 rows include names from before October.
- "Today" is allowed in Guide text only as the day that is today, the Today button and pill, a time, and "Settings › Today and Week" (`TODAY_ALLOWED` in `ui/guide/retired.ts`). If the Settings section is renamed, that entry goes.
- The check that a bold label or a path's last label is "a string the app shows" reads the source of `ui/`, `actions/`, `config/` and `plan/` for the label, or its first words. It catches a renamed or removed label; it cannot tell that the label is on the screen the sentence names.
- The tour's id for Day is still `today` (`#/guide/tour/today`) and its hooks are `today-…`: addresses and attributes of the app, left alone.
- Not added to the Guide: Admin's pages beyond one answer. RS-2 merged while this pull request was open; the Guide gained Day › What does Day show on my catch-up day?, Week › I changed week and the screen dimmed. Is it stuck?, and Mixed in Backlog's filters answer. The before and after screenshots of Day, Week and the tours were taken before RS-2's colors and show the app as it was then.
- CLAUDE.md's glossary was brought up to date by TD-1, which merged while this was in review; it is not edited here. Where it and the Guide differ after the merge: the glossary writes Add as "+ Add" (the Guide draws the Add icon and the word); it calls Status's second side a switch "My features · <Client> report" (on screen the client is chosen from a picker named Client report…); its Renamed list groups several old names in a row where the Guide has one row each; and it lists Confirm week and Confirm today as gone with nothing in their place, where the Guide's row says "Nothing to confirm: what's on your week is your plan".
- The Cards and Timeline try-it uses the app's own switch, so inside the Guide it carries the switch's tooltips ("(B)"), and B does nothing there.
- The check on bold labels and path labels can't tell a search label from a heading: "DevOps write access" is what Settings' search calls the group whose heading is "Write access" (review 2 caught it).
- Renamed has no row for Week › Team: where what it showed lives now wasn't confirmed.
- From review 1 (a first-day consultant with only the demo and the Guide), seen and left:
  - App words that disagree with the app's own names, beyond the list above: the Backlog phone notice ("Grid, Gantt, Gaps and Backlog need room for the whole roadmap"), the Inbox tab's tooltip ("promises, conversations, sends, captures and drafts"), Status's Push all preview ("logged in Settings > Data with Undo"; the section is Activity).
  - On a block card a to-do's title did not open its story card in the demo; titles in the block's panel, Backlog, Status and the Inbox do. The Guide now says only that. Should a to-do's title on a card open it too?
  - Opening Settings from a Guide link and closing it lands on Day, not back in the Guide. The Guide now says Close "closes Settings".
  - On the phone, More has no Send feedback and Backlog asks first; the footer now says "on a computer".
  - The app hides keys on the phone; the Guide shows them there, because its sentences are written around them. Should the Guide have phone wording instead?
  - Your first day's empty circles can read as checkboxes; they only show a state.
  - A tour's ring can run a few pixels past the window's edge where its target touches the edge (Add work step 2, Week step 5): the tour layer's own drawing, unchanged here.
  - Backlog shows a "Start here" chip beside Why these? that the Guide doesn't mention; what it does wasn't clear in the demo.
  - Not checked on a real screen by either review: Writing, Capture, the assistant, Ask, Teams, Client calls and Code beyond their links; anything past the first preview of a write; drag and drop.

## NM-1

- Left as it was from STEP 0.3's list, and why, is the last table of `docs/ux/nm1/words.md`. The ones that need a decision:
  - The command menu still lists the commands of the Inbox before it was slimmed: a group "Conversations" (Give a conversation to someone, Take it over, Merge…) and, under "From chats", "Resolve a request", "Sort a request again", "Show a hidden request" and others. Each only opens Inbox › From chats. Should they be hidden, like Team's commands (`HIDDEN_FOR_NOW`), or removed with their actions?
  - Admin › Clients calls a client's chats "Delivery chats" (and "Delivery team"); Settings calls them Client chats. Not on the Renamed list's patterns. Should Admin follow Settings?
  - `docs/demo/script.md`, `docs/demo/README.md` and `scripts/demo-walkthrough.mjs` describe the demo as it was on Nov 2 and Nov 9 (Today, Ahead, Fix next · 7, the Inbox's Needs you rail). Renaming words would not make their steps true, so the names guard skips them. Rewrite the script for today's app, or mark both as dated and keep them as history?
- A commitment from the client's side on a client call ("Dana will send the test accounts") was shown as going to "your Waiting on". That list went with IB-4. Confirm still stores it (a commitment with nobody at Cooptimize as its owner), and no screen lists it. The words now say "noted with this call". Where should it show: on the call's review only, or as something the person can follow up?
- The Settings pointer for chat reading: `plan/permissions.ts` says "Settings > Clients: Add a chat to allow it" for the Chat.Read permission. Chats are added in Admin › Clients by an admin. Left as it was, since what a person without admin should do there isn't clear from the code.
- Anything in C found still in use: none. Each proof is in `docs/ux/nm1/dead-parts.md`.
- The now mark on a PTO day or a holiday went with the catch-up day's: all three are one cell, not a block, and the rule given was "a cell that isn't a block gets no now mark". Before, a PTO day's hatched cell had the thin line inside working hours. Is that wanted for PTO too?
- Not in this step, as seen in the demo (nothing changed):
  - (Built in NM-2.) A to-do's title on a block's card: on Week, clicking the title of "Export orders to CSV" on its card opened nothing; no story card, and the address stayed `#/week`. The same title in the block's panel opens its story card.
  - (Built in NM-2.) Close from Settings opened out of the Guide: from `#/guide/settings`, opening `#/settings/display` and closing Settings (Esc or Close) lands on Day (`#/day`), not back in the Guide.
- Unused, noticed along the way (nothing removed):
  - `ui/Roadmap.tsx`: nothing imports it. It still says "Roadmap". (Removed in NM-2.)
  - `plan/work-templates.ts` and `store/work-templates-store.ts`: no screen or action imports them since TP-1b; the store and its table remain.
  - `conversationsTick` in `server/ticks.ts` is an empty function still registered as the tick part `conversation_notices` (it sent the four kinds removed here). (Removed in NM-2.)
  - `escalationHours` in `actions/dispatch.ts` has one caller left (Snooze in the Inbox); `PollPerson.openItems` and `pipelineAi` lost a caller with the job and are still used by the pipeline.
  - Tables TD-1 already listed as kept but unread (`chat_messages`, `asks`, `delivery_chats`, `dedupe_log`); the columns the upkeep job once wrote (`escalated_at` on commitments, the follow-through suggestions) have been written by nothing since IB-4.
  - Stored settings unread: a person's `[notify]` switches for the four removed kinds.
  - The action registry's summaries are shown nowhere (the command menu shows titles); they were brought up to date with the titles anyway.
- The config file's comments written beside a setting (`"Display (U5.1): show personal events on Week and Day."`) now use today's names; an existing file keeps the comment it has.
- `docs/architecture.md` still describes the upkeep job and the removed kinds in its history of CV-1 and IB-1; TD-1 left that file alone and so does this step.
- From review 1 (someone who knows only today's names, with only the demo), seen and left:
  - "Team" as a place: a tooltip on Ask a lead to look ("Sends a link to your planned Harbor features in Team"), Admin › People ("leads, Team and notes"), and a command menu group "Team". Team is hidden for now (WD-1). Should these words go while it is?
  - "request" as a thing: Settings › Client chats ("My request phrases", "Client chats read for requests", "becomes a request when"), Admin › Conversations ("Request phrases", "Keep messages that aren't requests"), Admin › AI ("Sorting requests"), Admin › Status. The Inbox shows no requests; the phrases still drive what is picked out as urgent. What should they be called?
  - The command menu's "loop update" commands (Draft a loop update, Send the loop update shown, Loop updates sent) beside "Close the loop".
  - Admin › Conversations: "Closed conversations stay shown (days)" with the hint "In Inbox › Conversations › Closed, then they're no longer listed." The Inbox has no Closed list. Does the rule still do anything a person sees?
  - The command menu: "Backlog › stories in each client's rank order" (a filter, written as a view) and "Settings · Coming soon" although Settings exists.
  - The phone's Week accessible name starts "Day view" (it shows one day at a time). The phone's day bar draws ← and → as the buttons' text (their names are Previous day and Next day). A hint says "The ⚑ flags in Backlog's Gantt". Backlog's status column shows "+1" for a second reason, and the Focus screen's button is "+15": counts and an amount, left alone.
  - Pointers it could not place: Chat.Read's "Settings > Clients: Add a chat to allow it" (above); the Guide's Day section says the focus screen has "Done, +15 and Stop" where a plain timer shows Finish, +15 and Stop (a timer on a to-do was not checked).
  - Drawing: on Day with a block's panel open, the source status row opened from the dot at the bottom left is covered at its right end by the panel ("DevOps 4 of 4" cut off). On Day's Timeline the "1h 45m free" pill sits on the 10 AM hour line.
  - Settings' search shows the old name after "was" on each result found by one, as it did before.

## RB-2

- **Is a search across every client fast enough?** STEP 0.5, measured with a fake DevOps behind the real reader, memory and limiter: 5 clients with 4 repos each are 25 requests to DevOps (5 repo lists, 20 file name lists) and 25 reads of the company token from Dataverse. The shared limiter adds no wait of its own (it only holds a client DevOps told to wait), so at 150 ms an answer the search took 602 ms: two rounds, three clients and four repos at a time. A real large repo's file name list is one big answer (up to 20,000 names) and will take longer than 150 ms; with 30 clients it is 10 rounds of clients. Results fill in as each client arrives, and a second search inside 5 minutes asks DevOps for nothing. Not measured against real DevOps (nothing here reads real client code).
- **The token is read from Dataverse for every request** (25 for the search above), as RB-1 decided ("at each read"). One read per client per search would do; left as it is because it is RB-1's rule.
- **Each client's names go to the browser, and the browser matches the words.** That keeps the words typed off the server altogether (no request carries them), at the price of sending a client's whole list of things per search (a few hundred KB for a 20,000 name repo). Matching on the server would send less and would put the words in a request. Taken as the browser, because "the words typed appear nowhere" changes less.
- **Should the words typed be logged?** They aren't, and can't be today (the server never sees them). A log of searches would say what people look for and would itself be a record of client names.
- **Each press of Search is a row per client read** ("Searched names"), including a second search with other words a minute later. Fine as a signal; with many clients one search across all of them is many rows.
- **Layouts the documentation doesn't settle.** The Data Factory and Synapse pages say each resource is exported as its own JSON under a root folder, but none of the pages read names the folders (pipeline, dataset, linkedService, trigger, dataflow, integrationRuntime, credential; notebook, sqlscript, kqlscript, sparkJobDefinition). The rows in `FACTORY_FOLDERS` are the resource type names; check them against a real factory repo. A factory's root is taken as a folder with two or more of those folders holding JSON, or one beside `publish_config.json`, `arm-template-parameters-definition.json` or `template-parameters-definition.json` (the files the pages put in the root folder). A lone folder named `pipeline` is not a factory.
- **Fabric type names.** The Git pages show the folder rule (`{display name}.{public facing type}`) but only "Report" and "Notebook" as examples; the other suffixes are taken from the REST API's ItemType list (SemanticModel, DataPipeline, Lakehouse, Warehouse, Dataflow and the rest). A type not on the list shows as it is written, under Other Fabric items. "Dataset" (an older Power BI project's model folder) is counted as a semantic model.
- **Renamed item folders.** The name shown is the folder's name. The documentation says a folder renamed by hand in Git no longer follows the item's display name, and reading `.platform` to get the real name would mean opening a file. A folder with no ".Type" is typed by a file inside it where one says (definition.pbir, definition.pbism, notebook-content.*, pipeline-content.json), else "Fabric item". When the folder name isn't available Fabric uses the item's GUID, which then shows as the name.
- **Not covered by the rules:** a TMSL model's tables (they are inside `model.bim`), report pages (inside the report), a Synapse or Data Factory resource's own folder (kept inside its JSON), Databricks notebooks stored as `.py`, dbt projects, SSIS packages (`.dtsx` shows under Other as XML), SQL object folders with other names (the usual four are a habit, the documentation names no layout).
- **Other can be long.** Every file that isn't something else is a row under Other (50 shown, then Show all). Should Other fold by default, or group by folder?
- **What people will want next that needs a file's content:** measures and columns by name, which reports sit on a model (`definition.pbir`'s dataset reference), a report's pages, what a pipeline's activities call. Each means opening files, which this step never does to search (RB-3 and later).
- **The search across clients is the first screen with more than one client on it.** Names only, grouped by client, and the rule now says so. Should a client's lead be able to keep even its names out of other people's searches without setting the whole client to Its team only?
- **The search view's address holds no words**, so a reloaded or shared search address opens an empty box. Putting the words in the address would put them in the browser's history.
- **"Table in <folder>" reads the folder above Tables as the schema.** For `/sql/Tables/Orders.sql` that says "Table in sql", which is a folder, not a schema (review 2). The label is a reading of the path; should it say "Table · sql" or only "Table" unless a `.sqlproj` sits above?
- Review 1, left as they are: changing This client to All clients doesn't search again until Search is pressed (nothing is read without Enter or Search), and after a search across clients there is no This client to switch back to (no client is open); a client set to Its team only, or one that can't be read, still shows the search box (All clients works from there); Esc closes Code and with it the results; a report's JSON opens on one line until Format is on; a data factory's datasets, linked services and triggers sit under Other while its pipelines sit under Pipelines; By kind is a small switch in the left side and the right side still says "Choose a repo." until it is pressed.
- Review 1 could not check the light theme (its browser stayed dark); the screenshots in `docs/ux/rb2/` are in both.
- **A test that sometimes fails on main, not from this step:** `e2e/nowline-label.test.ts` (HK-3, the now line's time on a compact rail) failed 2 runs in 8 on main's own code (371b604f) with the machine's zone set to America/Los_Angeles, and passed 5 in 5 in America/New_York. It measures once after the time has moved, and the time's box sometimes still touches an hour label. This step doesn't touch Week. Whose step fixes it?

## BL-2

- Needs attention keeps BL-1's shape (client › epic › feature, a gap's parents shown for context). Should it follow the rank rule too, listing the level's items with gaps in rank order with their parent as a label? Left as it was: the spec named only the levels.
- STEP 0.5: Last change reads FocusTime's own change log in the plan store (one indexed query per client, 30 days), not DevOps, so it now loads on every Backlog load. If the log grows large for a client with a busy project, should the window shrink, or the column load on demand again?
- Children opened under a row have no rank number (the number is the rank at the level listed). Should an opened story show its own rank among stories, perhaps muted?
- What BL-1's tree did in one step that now takes more: seeing every story of an epic at once (now Epics, then Expand all); seeing which features sit under an epic at a glance (now the parent label, or the Epic filter). A person who used the tree daily may want a remembered "open everything" per level.
- Closed items keep their place dimmed with no rank, as BL-1 showed them. Should Backlog hide closed items at a level by default?
- Items below the level with no item at the level above (a story straight under an epic, an orphan feature) are listed after the ranked rows with no rank. Is "after" right, or should they be in their own folded group ("Not under a feature")?
- A link from before BL-2 with no `l=` used to open the tree with stories (BL-1's default); it now opens at Features, or the person's saved level.
- When a row's parent is not an epic (a story's feature), its label puts the Epic filter on that feature, and the chip says "Feature: <title>". The filter field is still called epic in the code and the address (`e=`). Should it be renamed to parent?
- The Backlog view's presence note (`aheadPresence`) does not include the level, since the level is kept in the browser and not on the server.
- Found while testing, not changed: in the demo, the review panel's Saved list (writes since the panel opened) stays empty, because the demo's server clock is Nov 2 and the browser's is today, and the list compares the two. Writes land and show in Settings › Activity. Real use has one clock. Should the list compare against the server's own time?
- From review 1, left as they are (not the rank rule, or wider than BL-2):
  - A client with no backlog order (listed by target date) still shows its numbers under "Rank". The header says "by target date (no backlog order)". Should the column say so too, or show no numbers?
  - The Gantt shows rank numbers only in each row's accessible name. Should it show them, as the Grid does?
  - Counts read differently: the header's items, Showing N of M, Select all N shown, and a client's "N need attention", which counts every level and ignores search. One count rule for Backlog?
  - A target date set with "+1 week" shows a half-day ("Nov 9 PM") in the cell and in Review.
  - The keyboard: Home and End do nothing in the Grid; Tab from a cell goes on to the next row's link rather than leaving the grid.
  - A screen reader reads a client's heading line whole, with "Select all N shown in <client>" twice, and the Select all box has no name when focused.
  - Review lists every client's staged changes, also those of clients not shown.
  - The Filter button's count differs between the Grid and the Gantt at the same level.
- From review 2, left as they are:
  - The Gantt at Stories has no feature rows, so the Free time row's "Crowded month" and the features' "can't reach the target" callouts don't show there (they do at Features and Epics, where features are rows). Should the Gantt at Stories still count the features behind the stories?
  - The parent label's filter on a story's feature puts a feature in the Epic filter (`e=`). The chip says "Feature: <title>", but Filter's Epic picker lists only epics, so it shows none chosen. Same question as renaming the field to parent.
  - With no backlog order field a project lists by target date, so staging a new target date moves the row (on save, as DevOps would order it too).

## RB-4

- **What the documentation left unsaid about the code search request (STEP 0.4), and how each is handled:**
  - *What an organization without the Code Search extension answers.* Not stated. A 404 is read as "this client's DevOps doesn't have code search turned on"; any other answer FocusTime can't read is "couldn't be read". To check on dev against a real organization without the extension: which status and body it really gives, and whether a 404 can also mean something else there (a project the token can't see).
  - *Who can add the extension, and whether it costs anything.* Not stated for Azure DevOps Services (the page names a Collection Administrator only for the server product). The screen says "An administrator of that DevOps organization can add Microsoft's Code Search extension to it" and names no price.
  - *The most files one request may ask for.* Not stated ("Top value trimmed to maxresult allowed" is info code 8). FocusTime asks for 100 and reads code 8 as "there are more".
  - *Which body fields are required, and the keys of `filters`.* Not stated; the sample shows Project, Repository, Path, Branch and CodeElement. FocusTime sends no filter: the address names the project, and the answer is checked against the client's own repo list and each repo's default branch.
  - *The shape of `matches`.* Only the sample shows it (`content` and `fileName` lists of offsets). The match count is the length of `content`; when it is missing the row shows no count. The offsets are never used.
  - *Whether a file found on two branches is one result or two.* Not stated. A file is listed when the default branch is among its branches, or when DevOps names no branch; an organization that indexes many branches could spend part of the 100 on other branches' files.
  - *Whether filters like `ext:` may sit beside words in brackets.* The pages show `words ext:cs` and brackets around Boolean words, never the two together. `(<the words>) ext:sql` is sent only as a second request, when the first was cut; if DevOps answers it with anything but OK the first answer stands.
  - *Rate limits for search.* Not stated. Requests go through the shared limiter (a 429 or 503 holds that client), three clients at a time.
  - *What a token with Code (read) but no access to a repo gets.* The pages say results are "access-based". Treated as fewer results.
- **Should matching lines show in the results?** Today a result is a file with a count, and a line shows only after the file is opened and logged. Showing lines would mean either asking DevOps for snippets (text of files on a screen with several clients, with no file open logged) or a logged file open per result. Left out by decision.
- **Should the words searched inside files be logged for admins?** They aren't: the view log says who searched which client and when. A log of the words would say what people look for and would itself hold client names.
- **The words now pass through the server.** Search names still matches in the browser. Is the difference clear enough on screen? The line under the box says "Each client's DevOps is asked which files hold the words."
- **Layouts still not found by name:** a TMSL model's tables (inside `model.bim`), measures and columns (inside table files; Inside files finds them where the client has code search), report pages by their display name (inside the page files), a Synapse or Data Factory resource's folder (inside its JSON), and anything past the first 20,000 file names of a repo. "azure-pipelines.yml" is YAML under Other, so the Pipelines kind doesn't find it.
- **A two-part file name isn't read as a schema** ("ops.Shift.sql" is a "Table"): "Orders.v2.sql" would be "Table in Orders" (review 2). SSDT's schema.object.sql habit is real; should it count when the first part is also a folder name in the repo?
- **"Table in etl" became "Table" where no SQL project sits above** (`/sql/etl/Tables/x.sql` in a repo with no `.sqlproj`). The folder is very likely a schema, but the path alone doesn't show it. Should a short list of folder names that are never schemas (sql, src, database) decide instead?
- **Only SQL is narrowed by DevOps.** A notebook, a report or a pipeline has no one file type (`notebook-content.py`, `.json`), so those kinds are narrowed in the browser from the first 100 files; with more than 100 the kind may show few or none and says to narrow the search.
- **The kind of a result needs the repo's file names**, one more read per repo with results (from memory inside 5 minutes). A search across many clients with results in many repos makes that many requests after the search itself.
- **The demo's fake search is not DevOps's.** It matches whole words, a `*` at the end, phrases, AND, OR, NOT and `ext:`; DevOps's own tokenizer (how it splits `dim.Store` or `usp_LoadOrders`) may match differently. The marks in an opened file are found by plain text, so a file DevOps matched another way says so.
- **Filters typed in the words go to DevOps as typed** (review 2): `ext:`, `path:`, `file:`, `repo:` and `proj:` are DevOps's own query language. The request's address names the client's project and every listed file is checked against the client's own repos, so nothing from elsewhere is listed; but the total in "Showing the first 100 of N" is DevOps's own count. Whether DevOps honors `proj:` on a request already scoped to a project wasn't checked (to check on dev). Should FocusTime refuse `proj:` and `repo:` in the words? That would be a rule of its own in the query language.
- **Whole words only.** "Watermark" doesn't find Watermarks and "LoadSalesLine" doesn't find usp_LoadSalesLine without a `*` (review 1). The help line says so. How DevOps really splits `usp_LoadOrders` or `dim.Store` into words isn't in the documentation; to check on dev.
- **Lower case "or" and "not" are plain words** (the documentation says the operators must be capitals). The help line says "in capitals".
- Review 1, left as they are: after Back to results the caret is in the search box, not on the result that was opened; the stepper has no key of its own (Previous match and Next match are buttons); on the phone a result opens scrolled to its first match, with Results above it; with a file open from a search across clients the side's search shows This client; "Gold" opens its `.platform` file while "Returns" opens a table (an item opens on its most telling file, RB-2); the group "Files" beside "Other"; "Store" also finds what sits in a folder named StoredProcedures (folder names count, after the names).
- Review 1 could not check the light theme; the screenshots in `docs/ux/rb4/` are in both.
- **Esc still closes Code** from the results, as RB-2 left it.

## RB-5

- **Object folders the documentation names that the rules don't cover.** None: the pages name Tables, Views, Functions, StoredProcedures and the shared queries folder, and all are read. What the documentation does not name, and the rules therefore don't read as types: folders the extract tool is known to write for other objects (sequences, synonyms, user-defined types, and the like). A `.sql` file in one of those lands in Scripts under "No schema". Should those folders become types of their own, shown by the folder's own name?
- **The Security folder rests on the tool, not the documentation.** No page says where a schema's own definition or a role or user sits. `Security` at the top of the database is read because that is where the extract tool puts them. To check on dev against a real warehouse and a real SQL database repo: is that the folder, and is a schema's file named as the schema? A schema with no objects yet is listed as a Security object, since nothing in the paths says it is a schema.
- **A role and a user can't be told apart by name**, so both are "Security object" under Security. Opening the file would tell, and no file is opened to group.
- **SQL files that still land in Scripts, and why:** a file at the top of a database (a post-deployment script); a file in a schema's folder but in no type's folder; a file in a folder the rules don't know (above); every `.sql` file outside a database that isn't under Tables, Views, Stored procedures or Functions; a Synapse SQL script (a JSON file with no type folder). In a project laid out by type first (`Tables/dbo/x.sql`), by schema only or flat, the folders don't say the type or the schema the way the rules read them, so most objects land in Scripts or under "No schema". The documentation gives no folder names for those layouts. Worth reading once a real repo shows one.
- **The project file is listed** (No schema › SQL projects) so that everything By kind listed before is still in the tree. Should it be left out of the tree and only be found by name?
- **Should other kinds group the same way?** A model's tables by display folder can't be had from names. Pipelines, notebooks and reports could group by the folder they sit in; Fabric items by workspace folder. Not in this step.
- **Should search results show schema and type as columns?** They say "Table in dim · Gold warehouse" in one line now and are not regrouped. Columns would let a person sort by schema.
- **Review 1 (a data engineer in the demo), left as they are:**
  - Opening a file from the tree with Enter moves the keyboard to the file, as it does everywhere in the panel; getting back to the row is one Shift+Tab into the tree, but from the file it is a long way. Should Code keep the keyboard in the list when a file is opened from it?
  - A schema's own definition sits in its schema (rpt › Schemas › rpt), so "Schemas 2" counts definition files, not the warehouse's schemas. "No schema" holds what never has one (a role, a shared query, the project file, a script) and can read like something is wrong. Would "Database" or "Not in a schema" read better?
  - Two objects with one name look the same in their rows; the folder above, the hover text and the opened file tell them apart. Under a filter each hit sits in its own folders, which is a lot of rows for a few hits. A flat "schema.name" list for filtered results was wished for.
  - Changing the switch shows the other grouping's own open folders (closed at first, apart from the path to the open file); Expand all and Collapse all work on one tree, while the switch is one for all.
  - An item's name opens its file and only its caret opens what is inside (RB-4); in the SQL group a database's whole row opens. An item's "22 inside" doesn't drop while the filter has words.
  - Every type but a table has the same mark. No type-ahead and no "*" in the tree. After a reload the open file's row isn't shown in the tree.
  - The phone: Back from a file returns to the top of the list; the grouping can't be changed while a file fills the screen.
- **Where no database is found** (loose SQL files) the tree is still two levels: "No schema", then the types. A flat list would be shorter there.
- **Deep link.** Opening a link to a file in By kind doesn't open the tree to it; only changing the switch does.

## ED-2

- Should a moved item take its new parent's area and iteration? Still open from ED-1. ED-2 changes only the link, from the Grid as from the card.
- Should description ever be edited in the Grid? Not in ED-2: it stays on the story card with its own preview. E on a row opens the card ready to edit.
- Should bulk offer tags or priority? Not in ED-2: only what the Grid shows (owner, state, size, parent, target date).
- From the DevOps documentation (STEP 0.6), left unsaid: the Update page never says in words that fields and relations may share one patch (its "Add a hyperlink" and "Add an attachment" examples do it); it doesn't say that a patch is applied all or nothing, or what a failed `test` returns; it doesn't say a `remove` on `/relations/{index}` uses the index as last read (ED-1 relies on the rev test for that); and no page read states the Title's 255 character limit (FocusTime keeps QC-1's 255). Recheck if DevOps ever returns a partial result.
- Conflicts are per field in the Grid (a comment doesn't block a title) and per revision on the card (any newer revision refuses). ED-2 was told to keep the Grid's way. Should the card move to per field too (ED-1's open question)?
- A row's staged title and parent are laid over the item everywhere the Backlog model is read (`buildRows`), the assistant's reads included, so the assistant names an item by the title I staged. Should it say the DevOps title instead?
- Assign to… in bulk needs rows from one client (each client has its own people). Should it instead take a mixed selection and assign per client where the person is on both?
- State… lists a state only some rows' types take but doesn't let it be picked. Should it be pickable, staging the rows it fits and skipping the rest with the reason?
- The drag only reaches parents that are rows on screen (it doesn't scroll the page while dragging, and at the Stories level no parent is a row). Move… reaches all of them. Should the drag scroll, or a level always show its parents as drop rows?
- A row's menu shows only on rows I may change; a read-only row has no menu, and E still opens its card. Should a read-only row have a menu with the reasons?
- The move rule's words use "a" or "an" by the first letter ("An User Story doesn't go under…"), as QC-1's and ED-1's do. Fix the article for words like User?
- Renaming in the Grid writes the title only; the card's Edit can fix the title and the description in one preview. Two ways to do one thing: keep both?
- The Grid's hover buttons (Rename, New under, the menu) take room in the Item cell while a row is pointed at. On narrow windows the title gets short. Move Rename into the menu only?
- The demo's features now have a state stories don't (On hold). It exists only to show State… on mixed types.
- From review 1, left: a click elsewhere cancels a rename (as the other cells' editors do) and the typed words go; should it keep them instead? A staged title or move says so in words, a staged date, owner, state or size only with the cell's tint and dot: give all of them words? A cell's editor says Save where it only stages. Enter on a title cell opens nothing (it folds a row with children); double-click doesn't rename. Esc in Review closes it only with focus inside. The bulk bar is a long way from a row by Tab. Move…'s popover sits over the rows above its own.
- From review 1: after a drop, the story shows among its new parent's stories where its own rank puts it, which can be first. That is its true place, but it can read as a reorder for a moment. Say "by rank" there?
- From review 1 (not ED-2's): "N changes to save" and Save span every client whatever the client filter shows, and the demo starts with three seeded changes.
- From review 2, left: an item with two parent links in DevOps whose first is the staged parent is skipped as already there (the card's Move… would repair it); a title that differs only by inner spaces is announced as staged but there is nothing to stage.

## NM-2

- The hidden commands (`HOLLOW` in `ui/menu.ts`) and what would bring each back. Their actions, data and tests are kept.
  - Conversation ownership (I'll take it, Give to…, Add helper, Release, Take it over, its Undo), Merge (and its preview and Unmerge), Resolve, Reopen, Not a request, Hide for me, Close out a conversation, Move or split messages, Mark seen, the count of conversations that need you: a conversation screen with these buttons again (From chats lists suggestions only since IB-4). Or remove the actions in a later step, with their tests.
  - The held-back list (Show, Sort in bulk, Not work): a held-back view in the Inbox again (GD-2's list is out of view since IB-4).
  - This is work: a Chatter list to answer from.
  - Unlink a conversation's item: a place that lists linked conversations (a linked one leaves From chats). The assistant's `unlink` tool still does it for a promise.
  - Skip a follow-through suggestion: follow-through suggestions made again.
  - The `requests.*` commands (context, resolve, reopen, search, sort again, show hidden, refresh) and the `inbox.*` ones (today, count, hide, snooze, looked, seen): a Requests list or an Inbox with those buttons again. Refresh From chats does the same read as requests.refresh.
  - Snooze a promise and Review heads-ups: Snooze on Promises, or a heads-up review screen.
  - Add a draft feature to the week, its tier, Nothing this week, Mark as being broken down, Ask for priorities, the carry hint: a week list with these again (WD-1 and WD-2 took it apart).
  - Ask a lead to look: Team shown again, or a way for a lead to reply outside Team. The lead's notice and the replies are kept; replies to asks made before NM-2 now show only in Team.
- STEP 0.6: C1 (a to-do's title on a block card) was lost by accident: WD-2 added it, and `PickRow` linked only a stored DevOps URL. Built in this step.
- Unreachable now, left in place (nothing removed beyond E):
  - `roadmapRowMenu` in `ui/menu.ts` and its test `ui/roadmapmenu.test.ts`: only `ui/Roadmap.tsx` called it.
  - The CSS for the day bar's `kbd` and for `ui/Roadmap.tsx`'s classes.
  - `conv.closed_shown_days` is hidden but still read by the Inbox's read and the assistant's commitments read; whether those reads still need it is a question for a later step.
- Taken as the reading that changes less:
  - Settings' and Admin's lists are named Asking phrases (a client's message with one is checked for what it asks); "Urgent request" stays the notice's name, since it is a notice kind people switch.
  - The send-can't-take-a-Must notice to the other leads said Open Team and opened Week; it now says Open Week, like Ask to look's.
  - The command "Settings" moves from the group Week to the group Settings.
  - The Renamed list's word budget went from 260 to 270 rather than dropping an older row.
  - The Technical docs' "Checked against" lines are left as they were: only the lines this step changed were checked again.
- From the review:
  - The assistant's `unlink` tool still names a conversation as well as a promise. A linked conversation leaves From chats, so the inbox read the tool depends on never lists one, and in practice only promises are unlinked. Left as it is; drop the conversation case from the tool when its actions are next looked at.
  - Replies to Ask a lead to look made before NM-2 show only in Team (hidden); the `look_reply` notice opens Week, where the reply isn't shown. Show the reply in the block panel's You sent again, or show Team?
  - To place's group still has the heading "From your team" (its own section heading, not a pointer). Rename it with the next pass on the block panel's words?
  - The pointer check reads only the first segment of a path ("Settings › Profile › Run setup again" checks Profile).
  - The command menu shows the From chats group heading twice: the registry's commands keep their order (RS-2 D7), and the Inbox's keys sit between two runs of From chats commands.
- From the newcomer review (the demo only), not changed here:
  - On Week, a to-do's title on a card is a link with tabindex -1, like every control inside a card (the cards use roving focus: arrows and Enter open the block panel). A click opens the story card; the keyboard reaches the same card from the block panel. Should a card's title join the card's tab order?
  - The demo's chats contradict each other: From chats has suggestions and "last checked", while Settings › Client chats and Admin › Clients say "Not read yet", Admin › Status "Last poll: never", and Chat.Read shows Missing. Demo data, not a screen; a demo pass should line them up.
  - Near-duplicates in the command menu: Promises twice, "Link a promise to a DevOps item" twice, "From chats" twice, "Close the loop without sending" beside "Close the loop on a promise without sending", "Send a test notification" beside "Send a sample notification".
  - Sign out and Sign in with Microsoft open Settings › Profile, where the buttons are, rather than doing it.
  - Admin › Status and Admin › Audit carry Admin's "Changes save as you make them" subtitle though nothing there changes.
  - The demo's Lunch reads "12:30-12:30"; Profile promises first-run setup, which the demo says isn't part of it.
  - On the phone's Week, the week's Previous and Next sit just above the day's and look the same (each is named).
  - "1 late" chips and the Demo tag are about 22 px tall on the phone.

## RB-6

- **What gave way in the top bar, and does it read well?** With the Code tab, at Large text up to 1500 px and at Larger up to 1800 px, Focus, Capture and Ask show their icons only (the words are in each title and read by screen readers), and the VM chip says its state in one word up to 1320 px at Default and 1500 px at Large. Three icon-only buttons in a row may be less clear than words for someone new; the alternative was to fold Capture and Ask into More, which takes a step.
- **Should Code be on the phone's bottom bar?** Not in this step: it stays in More. The bar holds five things now; Code would take one of their places.
- **Should the kind filter offer object types of its own** (tables, views, stored procedures) rather than Databases as a whole? Databases finds databases and every object inside them; a result says "Table in dim · …", so a person can read the type, but can't narrow to it.
- **What now takes more steps than before:**
  - Find a file (type part of a file's name in the left side) is gone. The same is done by Search code, which lists files by their own names, but it searches the client's whole set of repos, not just the open repo, and the results replace the tree until the box is cleared.
  - Switching between This client and All clients, or between Names and Inside files, needs the box focused first (one click) because the choices are hidden until then.
  - Group by Schema · Type is at the top of the Databases group only; with a long list above it, it is a scroll away from a database opened lower down.
- **The SQL project as a database row.** A SQL project outside any item is listed under Databases by its project name, and its file opens the `.sqlproj`. A project inside a warehouse or SQL database item stays part of that item. Should a project with no objects (only the file) still be listed as a database?
- **Esc on Code.** Esc in the search box leaves the search; elsewhere on Code it does nothing, as on the other tabs (the old panel closed). Someone used to Esc closing Code may expect it.
- **The choices stay open while the search's words are in the box** on a results page, so the kind and scope can be changed and run again. Once a result is opened the choices close until the box is focused again.
- **Review 1 (someone new, on the demo), left as they are, each from an earlier step or a choice this step didn't reopen:**
  - A names search for "Store" lists every stored procedure, because their folder is StoredProcedures and folder names count (RB-2). Should a folder match count only for whole words, or come after the name matches under its own heading?
  - A database's name opens its own file (`.platform` or the project file); only its caret opens what is inside (RB-4's rule for items). People expected the name to open it.
  - Group by Schema (the start, RB-5) shows no object types until a schema is opened; "where are the stored procedures" took switching to Type or the filter. Should Type be the start?
  - Inside a client, Files with "Choose a repo" and an empty right side is the first screen when the client has more than one repo. Should By kind be the start, or the first repo open?
  - The search keeps Names or Inside files from the last search. Someone may run the wrong one; the choice shows each time the box is used.
  - Inside files results: the long lines for clients that couldn't be searched (no code search, a token without Code (read)) take more room than the results. One short line with the reasons folded away?
  - A demo SQL project is named "Warehouse", which reads like a type beside "Gold · Warehouse". Demo data only.
  - On the phone the search row and its choices take about a third of the screen above the results.

## UC-1

- Are other full-page screens centered, and should they move left too? Status already starts at 24 px like Day and Backlog. Settings, Admin, the Guide and the Technical docs are panels with their own nav and a reading column, not tabs, and were left alone. Week starts at 16 px (its grid's gutter), 8 px left of the others; UC-1 lined the Inbox up with Day, Backlog and Status at 24.
- Should the tab's number include captures to sort? It counts suggestions from chats and my promises late or due today (IB-4), and the chips now show the same count per client, so a client with only captures or drafts shows no number while its Captures list has rows.
- A counted row with no client (a promise I added with no client) is in the tab's and All clients' number and in no chip, so the chips can add up to less than the tab. Should there be a "No client" chip?
- The chips' numbers don't follow the list I'm on: on Captures a chip still says how many chats and promises need me there. That is "counted the way the tab counts", as decided; a per-list number would be a different count.
- STEP 0.5, a title shown differently: none. But two places read worse with the made title than with typed words. The draft to the client when no items are ticked says "Deployment - Northwind - Sat, Nov 7 is deployed." (it said "Deployment is deployed." for an untitled one before), and the promise says "Tell Northwind it's deployed: Deployment - Northwind - Sat, Nov 7". The draft is editable and goes only from its preview. Should the draft say "The deployment is done" for a made title?
- Week's weekend column is narrow (WK-3): a made title there breaks mid-word and is cut after two lines ("Deployme nt -…"), as "Deployment" alone already broke. The whole title is on Day and in the block panel. Should the weekend column show a deployment's client and window instead of its title?
- Plan a deployment… (the day menu and the command menu) and the assistant still make an untitled deployment as "Deployment". Should they make the same "Deployment - <client> - <date>"? UC-1 named only the capture box, so `deploy.add` was left alone.
- A made title is recognized by its form, not by a stored mark. If I type exactly "Deployment - <anything> - <the day's date>" myself, it follows a move like a made one. A stored mark would need a column; not worth it unless titles become editable.
- A made title keeps the client's name as it was when saved; renaming the client later doesn't change it.
- The deployment's date, start and end stay as I last set them after a save (they did before), so a second deployment in a row gets the same day in its title.
- A made title goes stale one way: the deployment is made a plain to-do, moved to another day, and made a Deployment again. Its title still names the old day and no longer follows. Rare; a stored mark would fix this too.
- The hint is the box's placeholder, and the box is one line until text is typed: a client name of about 30 characters in a narrow box (the phone's Quick capture) wraps the hint and hides its date. The line under the kinds still says the whole title.
- At 1920 the Inbox's column ends at 944 px and the rest of the window is empty. Day's top lines do the same, but its cards fill the width. Should an open row use the space beside the list?
- The kinds under the capture box are now a Tab stop for every kind (the keyboard way to an empty Deployment). Should Tab in an empty box cycle the kinds instead, as it does with text?
- On an empty Deployment with no client, Enter now says "A deployment needs a client" where an empty box did nothing before.

## BR-1

- Should the 8 s line ("Still waiting on Outlook") stay? It is the loader's only words. Until the week arrives every source is still loading, so it names all four ("Dataverse, Outlook and 2 more"); naming the slow one needs the sources to report one by one.
- Do Close out's end and the first launch feel bare now? Close out ends on Today with its toast; the first launch opens straight on the app. Nothing was put in Lumen's place.
- Places left with no mark that had one: the Guide's footer, a Guide tour's last card ("You're set"), Close out's reverse and the fun moments (first launch, musts done, a reconnect). Sign-in, About and the Guide's Start here changed mark (the bent mark and Lumen became the week mark).
- Generated assets: rerunning `gen.py`, `outline.mjs` and `bake.py` changed only mark-week.svg's token block (it no longer names `--lime` and `--beam-blend`); the drawing is the same (hash pinned). The PWA and Teams icons came out byte for byte the same.
- `--brand-ghost` is still in every theme but nothing uses it (it drew the bent mark's dashed band). Removed in a later step, or kept for the week mark's next drawing?
- `ui.first_launch` is still recorded on the first launch (its marker in the plan store), but nothing shows for it now. Keep the action, or drop it with a later step?
- Taken as the reading that changes less:
  - `public/prefs.js` is a small script the page waits for before the first paint (a same-origin file, cached by the service worker). It is how the loader shows in the person's theme and text size without an inline script.
  - The loader's timing is measured from its CSS start, so a load that takes 400 to 1000 ms in all is held to about 1 s, as before: the 600 ms minimum counts from when the loader appeared.
  - "Musts done. See you tomorrow." went with Lumen's moment; Close out's own toast is unchanged.
  - The loader's screen-reader words ("Loading FocusTime", "FocusTime is ready") are the only new words besides the 8 s line and the Reduce motion hint.
- From review 1 (the frames only), not changed here:
  - Should the loader's mark be larger on a big desktop window? It is 96 px wide at Default text size, scaled with the text size only.
  - Every block dims together at the end of a pass, so a frame caught then looks stalled. Keep one block lit through the dim?
  - The mark crosses the app's first rows while it moves (0.4 s), as the old week did. Fade it as it goes instead?
  - The empty-state pair (Inbox › Done) isn't empty in the demo; no empty state drew Lumen before BR-1 (they went in U2 and IB-1), so nothing there changed.
  - Settings' reconnect shot says "Outlook is connected again." while the row still says it needs sign-in. That is the shot's routed answer, before and after, not the app.
- From review 2 (the diff), not changed here:
  - The loader's line ships as "Still waiting on FocusTime" in `index.html`, for when the app's script or the sign-in check itself takes over 8 s (the app names the sources once it runs). It is the one place the line can name FocusTime.
  - The 400 and 600 ms now count from the first paint, not from the app's script starting, so the script's own loading counts. Timed side by side it isn't slower, but a load right at 400 ms can now show the loader where it showed nothing before.
  - `public/prefs.js` is served `no-cache`, so a load with a cold service worker revalidates it before the first paint (one small request).
  - Sign-in, About and the Guide's Start here show the week mark where the bent mark or the unroll was; the prompt made the week mark the only mark, so they carry it.
  - While the loader finishes, a key skips it and does nothing else, and a click skips it, as Close out's reverse did before. Keys before the app is ready reach nothing, as before.

## TD-2

- Facts found nowhere else and where they went: how tests stay apart (the old guide's Testing section), now in `docs/technical/development.md` (How tests stay apart); and the two raw-body routes beside `/api/action` (from its AS-1 and MC-1 sections), now in `docs/technical/architecture.md` (A normal request). Everything else in the old guide is in its step's decisions, a file's header comment or a `docs/technical/` page (`docs/ux/td2/architecture.md` has the table).
- Docs left as history that someone may want true again: `docs/demo.md` and `docs/demo/` (a walkthrough with screenshots of Nov 2), `docs/phone.md` (the phone on Nov 7), `docs/settings-inventory.md` (the Settings proposal of Nov 6), `docs/roadmap.md` (the direction on Nov 1) and `KICKOFF_PROMPT.md`. Rewrite any of them for the app now, or leave them as records?
- `docs/technical/architecture.md` opens by saying the per-file detail is in `docs/architecture.md`. The per-file detail is now in each file's header; the guide says where folders and entry points are. Left, since `docs/technical/` changes only for a rescued fact here; reword it with the page's next re-check?
- `docs/open-questions.md`'s first line says it mirrors spec section 16; the spec is in `docs/history/` now. Left (only this step's section is edited).
- `store/retention.ts` points to "docs/architecture.md, Retention", a section neither the old guide nor the new one has; retention is on `docs/technical/data.md`. Fix the comment with the next code step there?
- CLAUDE.md's Folder map doesn't list `docs/`, so the guide's `docs/` section is the one the check allows beyond the map. Add `docs/` to the Folder map with the next CLAUDE.md change?
- Should `docs/open-questions.md` be split into open and closed? It holds about 780 entries and table rows (914 lines), of which 484 look open and many are answered by a later step without saying so (`docs/ux/td2/open-for-owner.md` is one pass at the open ones).
- Should `docs/decisions.md` be split by month? It is over 1 MB, which some editors and the GitHub viewer open slowly.
- The runners apply timestamped migrations in name order, and some existing files carry stamps later than today (up to `20261205T0900`). A migration named for the real UTC time now would sort before them. Should the rule say "later than the newest file" (a CLAUDE.md working style change, not made here)? Found by the TD-2 review.
- `docs/technical/architecture.md` says 396 actions; the registry has about 400 now. Left for the page's next re-check.

## CI-3

- `docs/ux/U1/designer-handoff.zip` (16 MB) is still on main, kept because the step moves only image files. It holds U1's screenshots, among them the 32 of the owner's real FocusTime (real client names, a person's name, meeting titles) that left main from `docs/ux/U1/screens/live/`. The repo is public. Remove it from main too? Answered in PV-1: removed from main; it remains in history (see PV-1).
- Should the old images ever be dropped from history? They are about 380 MB of every full clone's `.git` (a fresh clone was 900 MB, of which `.git` 470 MB). Dropping them means rewriting history and a force push, which this step doesn't do; the archive branch would keep the demo ones.
- `ci` runs in full on every push to main, beside deploy-dev, which reuses the pull request's run (all ten deploys measured did). That is about 45 runner minutes per merge for a tree already tested. It also saves the WebKit package cache from main, which pull requests restore. Keep it, or run only the cache-saving part on main?
- The test gate and infra check out the whole tree to read one commit's tree id or `infra/`. After CI-3 a checkout is about 57 MB rather than 430 MB; a sparse checkout would make it smaller still. Worth it?
- The shards keep the name "Browser tests N/6 (Chromium and WebKit)" though they no longer run WebKit, because a branch rule that can't be seen may name them. If no rule does, rename them "(Chromium)"?
- `e2e/rs1-audit.test.ts` and `e2e/rs1-scan.test.ts` have no assertion either: they write RS-1's layout audits as JSON when a variable names a file. Move them to `e2e/shot-scripts/` as well?
- What each browser test file costs, for the next step: `docs/ux/ci3/browser-cost.md` (run 43777256271). The 155 files added up to about 3,679 s, and the 20 slowest to about 1,918 s (52%); `guide-tour`, `ps1`, `ahead` and `rs1` alone are 731 s.
- A docs-only pull request still waits for the unit job (about 6 minutes), which holds the docs checks and the guards. A lighter job with only those for docs-only changes would answer in about a minute, but it would be a second definition of the unit job's checks.
- `docs/azure/runbook.md` ("How deploy-dev reuses the PR's CI") doesn't mention docs-only pull requests; `docs/azure/` is outside this step. Add a line at its next change?
- `e2e/uib-shots.test.ts` stays in the suite: it has assertions (no now mark on a day off, Today and Week no wider than the phone), so it isn't screenshot-only, but the whole file is skipped unless `FOCUSTIME_SHOTS` is set, so CI has never run them. Split those checks into a real test and move the screenshots to `e2e/shot-scripts/`? (The CI-3 review found it; making checks run that never ran is a change to the tests, left for the next step.)
- A docs-only merge still gets one full CI run, from deploy-dev (its pull request's run records no tested tree, the review's fix). Reusing it safely would need deploy-dev to also check that main's own last full run passed. Worth it?
- If the What changed job fails or is cancelled, the heavy jobs and the gate show as skipped and the run fails. No branch rule can be seen that would treat skipped as passed; if one is added, make those jobs fail unless What changed succeeded.
- A docs-only pull request into another branch than main skips the browser tests even if that branch has code; the code is tested by that branch's own pull request into main. Limit the skip to pull requests into main?

## RM-1

- CLAUDE.md GD-2 point 3 says a held-back message is "sortable by hand". The held list's commands were off the screen since IB-4 and RM-1 removed them, so held messages stay held until an admin changes a client's names (`held_recheck`) or retention deletes them. Reword the rule, or bring sorting by hand back on the Inbox?
- `conversations.undo_ownership` stays for assistant proposals confirmed before IB-4 (confirmed proposals are deleted 24 hours after they're done). Remove it in the next release that follows a prod deploy of IB-4 by more than a day?
- `weekplan.add_draft` and `weekplan.draft_tier` are hollow since WD-2 but weren't on RM-1's list, so they stay. Remove them in a later step?
- The ownership backfill (`conversation_ownership_backfill`) still runs once per build and still writes the claim columns. Retire it once every environment has run it?
- Tables, columns and settings nothing writes any more, with what still reads each, are in `docs/cleanup-step-2.md` (RM-1). Each drop needs the product owner's OK; `work_templates` was earlier said to be kept "for a later use". The patterns tables hold user ids in `started_by` and `made_by` that Delete my data never cleared; dropping the tables would clear them.
- `conversation_suggestions` has had no live writer since before RM-1 (only tests called `addSuggestion` on main). Stored suggestions still show with Post and Skip. Remove the writer and, later, the table?
- Exports already dead on main, not behind a hidden feature, were left: `pinLabel`, `pickDoneFrom`, `otherStoriesLine` (plan/weeklist), `planBudget`, `pinnedToPto`, `PINNED_TO_PTO` (plan/weekplan), `weekModeStatus` (plan/modes), `MoveTo` and `openBreakdown` (ui/WeekStories), `suggestionCount`, `tabCount`, `escalateAt`, `kindOf`, `estimateMicros`, `prioritiesKey`. A later cleanup can take them.
- `docs/analysis/wp1-*.md` describe the removed patterns page; they are kept as a record with a note at the top. Delete them?
- Old Ask to look requests: my unanswered ones still show in Inbox › Waiting on for 14 days, but nobody can reply any more, and a lead's earlier reply no longer shows anywhere (it was drawn only in the removed views). Leave them to age out, or stop listing them in Waiting on?
- Found in RM-1's demo review, not caused by it (also on main): the Send to… dialog's success line says "You'll see their answer in Plan" (`ui/Team.tsx`), but Week has no Plan mode; the answer shows in the block panel's You sent. An Inbox address for a conversation that doesn't exist (`#/inbox/conversation/<id>`) lands on the Inbox with no error text but logs a 404 in the console. After Accept and schedule the address goes from the day's block to `#/week` while the panel stays on that block. Fix in a later step?

## PV-1

- The zip and its 32 pictures of a real session, and the 32 that were in `docs/ux/U1/screens/live/`, remain in the repository's history and in the refs GitHub keeps for every pull request (`refs/pull/<n>/head`). Anyone can still fetch them from a commit before CI-3 or PV-1. There are two ways to close that, both the product owner's decision: make the repository private, or rewrite history to drop them (a force push to `main` and every branch that has them), then ask GitHub Support to remove the cached views and pull request refs that still hold them. A rewrite changes every later commit id, so open pull requests and worktrees would need rebuilding.
- These 29 files under `docs/demo/` may hold real screens: the scripts for steps 15.4 to 16.3 use demo mode only when given `--demo` and nothing records that they were, and step 17.6's four have no script on main and no record that they came from the demo. They are not opened, described or removed here (`docs/ux/pv1/step0.md`). Check them, and remove any that aren't demo?
  - `docs/demo/154-inbox-sort-chips.png`
  - `docs/demo/154-settings-you.png`
  - `docs/demo/154-today-vm-prompt-light.png`
  - `docs/demo/154-today-vm-prompt.png`
  - `docs/demo/154-vm-delay-preview.png`
  - `docs/demo/154-vm-menu.png`
  - `docs/demo/154-vm-stop-preview.png`
  - `docs/demo/155-settings-notifications-light.png`
  - `docs/demo/155-settings-notifications.png`
  - `docs/demo/155-settings-you.png`
  - `docs/demo/162-menu-person-light.png`
  - `docs/demo/162-roadmap-ahead.png`
  - `docs/demo/162-today-checkin-light.png`
  - `docs/demo/162-today-now.png`
  - `docs/demo/162-today-plan.png`
  - `docs/demo/162-week-plan.png`
  - `docs/demo/162-week.png`
  - `docs/demo/163-focus-deep.png`
  - `docs/demo/163-help-presence-light.png`
  - `docs/demo/163-help-presence-word.png`
  - `docs/demo/163-roadmap-presence.png`
  - `docs/demo/163-settings-focus.png`
  - `docs/demo/163-today-vm-prompt.png`
  - `docs/demo/163-vm-menu.png`
  - `docs/demo/163-week-vm-running.png`
  - `docs/demo/176-1920-dark-planday.png`
  - `docs/demo/176-1920-dark-today.png`
  - `docs/demo/176-1920-light-planday.png`
  - `docs/demo/176-1920-light-today.png`
- The archive rule names the common archive types (zip, 7z, rar, tar, tgz, gz, bz2, xz, zst, jar). Office files (docx, pptx, xlsx) are zip files inside and can hold pictures too; they aren't refused because none is on main and the step names archives. Add them?
- The rule covers `docs/` only, as the step says. An archive elsewhere (for example under `assets/`) is still allowed below 300 KB. Widen it to the whole repository?

## PF-1

- **What is still in the first download, and should it go next?** Day, Week and the top bar need React (about 190 kB minified), the planning rules, the menus and keys, the block panel and the icons. These are in it too, though Day and Week don't need them until something is pressed: Break down (`ui/BreakDownPanel.tsx`, 50 kB before minifying), Send to (`ui/Team.tsx`, 28 kB), Client calls (`ui/meetings/`, 27 kB), Wrap it up (25 kB), the first-run Setup (23 kB), Close the loop (23 kB), Ask to collaborate (15 kB), Feedback (13 kB) and About. Together about 200 kB before minifying, roughly a tenth of the script. The step named which screens load on demand, and these were not on the list, so they stay. They would move the same way (`ui/screens.ts`).
- **Should the stylesheet be split next, and what would it save?** `ui/styles.css` is 472 kB (82.7 kB gzipped), all in the first download, and it blocks the first paint of the app. About 660 of its rules start with a Backlog, Settings, Inbox, story card or Status prefix alone; a rough guess is that a third to a half of the file belongs to screens that now load later, so 25 to 40 kB gzipped could travel with them. It needs each rule's owner worked out first, because later rules override earlier ones across screens (`:root` overrides by step), and a wrong cut changes how a screen looks.
- **What does the background fetching cost on a metered connection?** On an ordinary connection the app fetches about 725 kB more (about 210 kB gzipped) in the minute after it opens: every screen but the Guide and the Technical docs. That is what the old first download carried anyway. Where the browser reports data saving or a slow connection (Chromium only), none of it is fetched until a tab is pointed at. Safari and Firefox report nothing, so an iPhone on a metered plan fetches all of it. And the installed app's service worker fetches every file again when it installs (every file, 3.1 MB, on a first visit and after each release), as it did before this step: on a metered connection that is the larger cost. Should the worker keep only what was fetched, or skip the Technical docs?
- **Does anything in front of the hosted app compress?** FocusTime's own server sends files uncompressed, so on a slow connection the wait follows the raw size (1.5 MB for the first screen now). If nothing in Azure compresses either, turning that on would cut the first download to about 410 kB. Not checked here (it needs the hosted app), and what the server sends is outside this step.
- **The server answers a file it doesn't have with the page (200).** That is why a replaced file fails as "not a script" instead of a plain 404. The app handles it either way; a 404 for `/assets/` would be clearer in logs. Left alone (what the server sends is outside this step).
- **The assistant, the New form and the draft editor across a release:** if their file was replaced, the app reloads once onto the place, but the dialog is not opened again (the place and Capture are, by address). The person presses again. In the background they are fetched within a minute of opening the app, so this needs a release in that minute.
- **A screen's own error has no screen.** A load error gets a line with Retry; an error thrown by a screen's code is thrown on as before, and since FocusTime has no error boundary, the person sees the screen they were on and nothing else (before this step such an error at load would have blanked the whole app). Should FocusTime have one plain error screen?
- **"Loading…" is in the top bar, not in a screen's header.** The step said "the header says Loading as a week does". A week's line is in Week's own header; a screen that is still arriving has no header yet, and the screen before it may be any screen, so the line hangs under the top bar's edge at the left. Is that the right place?
- **Esc takes back a dialog that is still arriving** (Capture pressed, its file not in yet). A new key meaning, but only in a moment that didn't exist before.
- **Offline, never opened.** With the service worker installed a tab never opened does open offline (the worker keeps every file), which is better than the step's "says it needs a connection". The line shows only where the file was never fetched and there is no worker's copy: a browser tab before the worker finished installing, or with the worker off.
- **STEP 0.6 and 0.7 found one thing already broken:** a release while the app was open, then opening the Guide or Code where the old file was gone, blanked the whole app. Fixed by this step (the reload). Nothing else.
- **The check's limit and other steps.** The limit is 3% over today's size (about 11 kB gzipped of script, 3 kB of styles). A step that adds to Day, Week or `ui/styles.css` will hit it and must raise it on purpose. Is 3% the right room, or should styles have more until the stylesheet is split?
- **The browser tests build React's development build** (a build inside a test run has `NODE_ENV=test`), so the app they test is larger and slower than a release. The size check sets the release mode itself. Found while writing it; unchanged.
- **Hover fetches on every connection.** A tab's hover or focus fetches its file even on an ordinary connection (it is about to be fetched in the background anyway).
- **From review 2, left as they are:**
  - The address, the tab's mark and the remembered place follow the screen drawn, so they change when the file arrives, not at the press. Back pressed while a tab is arriving leaves the place before it.
  - Opened at an address whose file fails, the address becomes Day's (Day is what is drawn); a reload then opens Day, and Back returns to the failed address.
  - A file that never answers (no failure, no data) has no timeout: at a cold-start address the loader stays on "Still waiting on FocusTime", as it does today when the main script never answers.
  - A dialog that arrives late opens and takes the focus even if the person has started on something else.
  - A tour gives a step's screen 3 s to appear; on a very slow connection a tab still arriving after that has its steps skipped.
  - Planning rules that only Backlog, Status or Code use (`plan/ahead-model.ts`, `plan/status-report.ts`, `plan/code.ts` and others) are in `main`, because something in the first download imports from the same files. Not measured apart; a later step could cut those files in two.
  - During a deploy, if the worker's install asks a server that doesn't have a screen's file yet, the page it gets back (200) is cached under the script's name, and that screen fails until the next release. The same fault before this step would have broken the whole app; fixing it means the server answering 404 for a missing `/assets/` file, which is outside this step.
  - A screen opened after a release can reload the page mid-session (once), and typed text in a box on the screen before is lost. The background fetching narrows this to the first minute, the Guide, the Technical docs and slow or data-saving connections.
  - With the server down while the browser says it is online, the line says "You're offline", as the app's own offline line does.
- **From review 1 (a phone on a weak signal), left as they are:**
  - A tap on a screen not yet fetched shows nothing for 300 ms, then the Loading pill, and the tapped tab is not marked until its screen arrives (the step's rule: the screen before stays, Loading past about 300 ms). On a weak signal that is 1 to 2.5 s of the old screen. Should the tapped tab be marked at once?
  - After the connection comes back the failed line stays until the screen is asked for again or Retry is pressed; nothing retries by itself. That try may reload the app once (a browser can remember a file that failed while offline). Should the app try again by itself when the connection returns?
  - On a computer the Loading pill hangs over the top-left corner of the screen's own header for the moment it shows.
  - The same jumps as before this step: Week's "to place" row arriving, the story card's buttons reshuffling when its rights are read, the Inbox's counts starting at 0.
  - Backlog is not offered on the phone's bars or in More (as before); the reviewer could not open it.

## PF-2

- **Should the hosted app's front door do more?** Container Apps' ingress passes answers through as they are (no compression, no cache), so the app compresses its own. A CDN or Front Door in front could cache the hashed files near people and compress at the edge; that is a change to Azure, not made here.
- **What the first download is now, and what is left to cut.** 440 kB of files on the wire for the first screen: the fonts (100.6 kB, compressed already), the styles (85 kB compressed of 472 kB) and `main`'s script (about 270 kB compressed of 1,068 kB). The stylesheet is the next thing to split (PF-1's question stands). Brotli 11 at build time would save about 8% more on the files; left for when the build is the place for it.
- **The time compression adds:** about 11 ms for a 1 MB answer (Code's largest file), under 1 ms for the demo's largest read (the week, 61.6 kB). On real data the week and Backlog are larger; worth reading `dataWork` or a timing in telemetry once real numbers matter.
- **Large reads left off the list:** `settings.load` (7.9 kB, never: it shows each secret's state), `planday.start` (6.0 kB), `roadmap.ahead` (5.1 kB), `team.commit` (4.5 kB), `inbox.today` (2.6 kB), `data.export` (a whole person's data, a download) and `item.card`. None carries a secret except settings; adding one is one line and its test.
- **Small reads go plain.** Week's 11 kB is mostly many reads under 1 kB (people's photos, the week's plan). Batching them is a different step.
- **Dev and the demo differed in one way:** dev answers over HTTP/2 through the ingress (no length line on the plain answers before PF-2), the demo over HTTP/1.1 from the app itself. Both sent everything plain. After the merge deploys, the check in `docs/technical/operations.md` (What the server sends) against dev is the proof.
- **Public files during a release** (review 2, older than PF-2): if two revisions serve at once, a new worker can fetch `/prefs.js`, the manifest, the icons or `/` from the old replica and keep them until the next release (hashed files are safe: the old replica answers 404 for the new names). Container Apps switches a single revision's traffic at once today.
- **A tag for the same form across releases:** each form's tag is taken from its own bytes, so a change of compression level or zlib gives new tags (one download each, once).

## BT-1

- **CLAUDE.md, for the product owner to change (BT-1 doesn't edit it):** the folder map's `e2e/` line could say "browser tests in one folder per screen (day, week, backlog, inbox, code, status, settings, admin, shell, phone) on a throwaway demo server (harness.ts)"; the inner loop line could add `npx vitest run e2e/<screen>/` for one screen's browser tests and `npx vitest related --run --project unit --project sql <files>` for only the unit tests; "One e2e per feature" could point at the harness's three ways to start.
- **A private repository's runners have two cores.** The limits follow the machine (`test/workers.test.ts` checks two cores gives 2 unit, 2 SQL Server, 1 browser), so nothing breaks, but six shards of one browser worker each would take about twice as long. If the repository goes private, measure again before choosing the number of shards.
- **The shard names keep "N/6" and "(Chromium and WebKit)".** Kept because a branch rule the token can't see could name them (`step0.md` 0.7). With no rule found, renaming "Browser tests N/6 (Chromium and WebKit)" to "(Chromium)" would be more accurate.
- **If deploy-dev is turned off or its reuse job errors,** main's own push no longer tests anything (F). Today deploy-dev runs on every push and falls back to all of `ci.yml`. If it is ever turned off, `ci`'s push to main should test again (drop the `code=main` answer in `scripts/ci-changes.sh`).
- **On main the skipped jobs show as skipped** under their names (the unit job, the six shards, image, test). Nothing reads them (no branch rule, no badge, deploy-dev reads only pull request runs), but a person looking at main's checks sees grey instead of green.
- **Files that still start per describe or per test:** `e2e/day/now-mark.test.ts` and `e2e/week/now-mark-catch-up.test.ts` (each test is its own clock), and twelve files with a describe per clock, server setting or real session (`docs/ux/bt1/files.md`). A server that could move its clock between tests would let them share a start; that is app code, outside this step.
- **Repeats kept** (`step0.md` 0.6): the six tabs' list in `e2e/code/code-tab.test.ts` (one line in a test whose other checks are its own), the top bar in one row at 1280 (two files at different sizes and text sizes), × and Esc closing (focus return is only in `close-button`), and the tick opening Wrap it up (three screens). Merging any of them saves seconds and makes one test do two jobs.
- **`e2e/admin/admin-screens-shots.test.ts` (was `adm2-shots`) has one check and runs only with `FOCUSTIME_SHOTS`,** like `uib-shots` did, so CI never makes it. Split it the same way next?
- **The answer above for `e2e/uib-shots.test.ts` (CI-3) is superseded:** BT-1 moved its checks into CI tests and its screenshots to `e2e/shot-scripts/`.
- **Making a demo session is most of a fresh page** (about 0.8 of 1.3 s: `buildDemo` and `seedDemo` in `server/main.ts`). Making that faster (a seeded store copied instead of built) would help every browser test, but it is app code, outside this step.
- **`e2e/code/search-inside.test.ts` (was `rb2-code`) timed out once on main** ("inside a client the search starts on This client, and All clients widens it", run 43866488225) and passed on the same tree's pull request run. Not reproduced here; watch for it.
- **The move changed the import lines inside each moved file** ("./" to "../"), because the files can't run otherwise; the step asked for moves with no content change. Read as: no change but what the move needs.
- **A release build for the browser tests would save about 12%** (`docs/ux/bt1/g-other-waste.md`) but would stop running every effect twice (StrictMode) and would turn the service worker on in every test. Worth it for most files, keeping the test build for a few? Which few?
- **The guide tours' "plan store unchanged" check never runs in demo mode** (found by BT-1's review 2; true before BT-1 too): `data.export_mine` answers "Export isn't available here" for a demo session, so `before` is null and the comparison is skipped. What keeps a tour honest is the other check (no action the tour's screens don't call on their own), which caught an injected write. A write that the screens also make on their own would get past both. Fixing it needs a demo session that can be read back (app code, or a test seam): worth a step?
- **`FOCUSTIME_TEST_WORKERS` sets all three limits, past SQL Server's cap of 6** (review 2): `FOCUSTIME_TEST_WORKERS=12` puts 12 on the container from one session. Kept, since the variable is for bisecting with fewer; cap it too?
- **One browser test's name changed in the rename commit:** add-work's name held a file path ("… is in e2e/wd2.test.ts"), updated to the new path with the other references. A name that names a file will change again whenever files move; drop the path from the name?
- **`e2e/shell/opening-and-brand.test.ts` (was `brand`) failed once on CI** (run 43885253766, shard 4, after the merge of PF-2): "no words on screen before 8 seconds…", `expected 2 to be greater than 2`: sixteen samples of the loader's animation over 1.6 s saw only two distinct opacities. BT-1 changed only its import path; it passed in the two runs before and on the rerun, and eight copies at once on three cores passed on main's tree and on this branch alike. A sampler that a slow runner can starve: sample by the animation's own time (`getAnimations()` and `currentTime`) instead of the wall clock?
- **`e2e/shell/first-download.test.ts` (PF-1's, was `pf1`) fails under load, on main too** (run 43890805790, shard 6: "a release replaced a screen's file…", `expect(loads).toBe(1)` saw 0; passed on the rerun). Copies of the one test at once, run here: main's tree and config 0 of 12 at 6 copies on 4 cores but 12 of 24 at 8 copies on 3 cores; this branch 4 of 18 at 6 on 4. It fails at each step that routes a screen's file (Ahead, Capture, Status, Inbox): the screen opens, or its line shows, with no reload counted, and a trace of the page's requests shows no request for that file after the key. BT-1 changes only its path, but makes it likelier on CI: the browser files now start together, longest first, so this one runs beside the heaviest. Not found yet: why the file arrives with no request the test can see. PF-1's to look at: set the routes before `cold()` and count reloads from the navigation entries instead of the `load` event?

## RB-3

- **Which layouts B covers, and what the others would take.** Covered: a legacy report's pages (`report.json`) and a TMDL table's measures and columns (its one `.tmdl` file). PBIR, now Power BI's default report format, keeps one `page.json` per page under folders named by ids: listing one report's pages means opening every page's file, one `code.file` (and one File opened row) per page. A `model.bim` model lists no tables from file names; offering its tables means reading the whole model (often over 1 MB, Code's text limit) once. Either could be added if one row per report or model read is acceptable in the log.
- **Should the story card's description get the same lookup?** Not in this step. It is a longer text with formatting; a pick there would be the same plain words.
- **Should an item ever keep a real link to a thing in Code?** Today a pick is only words, the same as typing them, which keeps "nothing of the code is kept" true. A link (repo and path) would be a stored pointer into a client's code in FocusTime's store, and in DevOps if written there: a change to that rule, for the product owner.
- **Does "which reports use this model" belong in Code?** A report names its model in `definition.pbir`; listing that means opening every report's file. Not here.
- **How slow is the first read for a real client with many repos?** On the demo, Northwind (three repos) takes 7 ms on the server. A real client costs one file names request per repo, four at a time, each up to 20,000 names, the same as Code's By kind; the box stays a text box until they arrive, and past 3 seconds the line says the read is still going. Worth measuring on dev with the largest client before the pilot leans on it.
- **Should the other two boxes suggest anything?** Not in this step.
- **Inside a name only from four letters.** At three, "old" offered Gold and "are" a SQL project while writing sentences (review 1). Two and three letters match only the start of a name. The threshold is one constant (`WHERE_HOLDS`).
- **Esc twice closes the New form with no question** (review 1): the first Esc closes the list, the second the form, losing what was typed. That is how Esc has always worked on the form, and this step keeps everything the same while the list is closed. Should the New form ask before closing with text in it?
- **Lookalike names across a client's repos** (review 1): Store and Date show twice for a client with two repos, told apart by the repo's name in grey. Should one repo come first (the one most picked, or the client's main one)?
- **Enter picks only after Down.** The list opens as you type, but no row is chosen until Down, so Enter still makes a new line and Tab still moves on. Choosing the first row by default would make one more key unnecessary but would take Enter and Tab from typing whenever a word happens to match.
- **TMDL measures declared in another file** (TMDL allows all measures in one `[measures].tmdl`) aren't listed under their table.
- **A rollback to the build before this step** shows the new Code log rows as File opened (its fallback for an event it doesn't know). Nothing else changes; no migration.
- **Picked names and a client change** (review 2). The text stays as typed when the client changes (C3), so names picked from one client's code could be created in another client's DevOps. GD-2's exit flag checks client names, not code names. Clear picked words on a client change, or say "picked from <client>'s code" in the preview? Left as typed text for now, as the step decided.
- **Where the list goes after create** (review 2). The list never reaches an AI, but the words a person keeps in the box become the item's description, which Break down and a draft's AI version can read later, the same as any typed description. Worth saying in so many words in CLAUDE.md's AI rule if the product owner wants it explicit.

## RB-3b

- **Ways a picked name can still cross to another client.** Covered: a pick left in the box when the form's client changes, in the New form and the draft editor, by keyboard or click, after Undo, after a second change. Not covered: a draft saved with picks and later reopened under another client (the picks aren't remembered across a save, by design, so its words are typed text then); words copied from the box and pasted by hand (a paste is typed text); a pick moved by cut and paste inside the box (the cut edits it, so it's typed text). GD-2's exit flag still checks client names, not code names, at the preview. Do any of these need more, for example a "picked from <client>'s code" flag in the create preview?
- **Is one row per listing enough for an admin?** A PBIR report's 60 page files are one "Pages listed" row with the report's file. An admin sees which report was listed, not which page files were opened. Code itself still logs every file opened there.
- **Layouts still not covered.** A paginated report (.rdl) has no pages to list. A model.bim over Code's 1 MB text limit says it is too large (file names don't give sizes, so the row is offered first). TMDL measures declared in a file inside `tables/` look like a table of their own. A PBIR report over 60 pages isn't offered Pages. A legacy report.json has no page limit (one file); its hidden pages rely on `"visibility": 1` in a section's config, which the documentation doesn't describe.
- **Should Enter pick the first match now that the lookup has more levels?** Not changed: Enter picks only after Down. With pages and tables a level down, a first-row default would make Enter open more often by accident while typing sentences.
- **Glossary.** CLAUDE.md's Code views row lists what the log keeps; it doesn't name the new listing rows (CLAUDE.md changes only for rules, the glossary and the milestone; left for the product owner).
- **The "Checked against" line on the technical pages** was not moved: only the Where is it? sections of Security and Architecture were checked and changed in this step.
- **A flaky Code browser test.** `e2e/code/by-kind-and-search.test.ts` "inside a client the search starts on This client" failed one run in two locally (Atlas's search results not showing in 30 seconds); it doesn't touch what this step changed.
- **Finding a page by its name** (review 3). Typing "drill" finds nothing: pages, measures and columns are read only when their report or table is opened, so the person must know which report the page is in. Offering them while typing would mean reading every report's pages and every table's file on first use: many more files and rows. Worth it for reports only, or never?
- **"Nothing matches" while typing** (review 3). A word that matches nothing shows nothing, as RB-3 decided (the box is a text box then). A quiet "Nothing named drill. Browse with Alt+Down" would help someone looking, and distract someone writing.
- **Undo on another client** (review 3). Undo puts Northwind's names into Atlas's form and says so; a consultant expected it to switch the client back too. The step decided Undo only puts the names back.
- **Keeping the Level on a client change** (review 3). The New form resets Level to the new client's default; keeping it when the new client has that type would save a click. Not this step's.

## UC-2

- **The server's `deploy.add` still saves "Deployment" when a caller sends no title.** Every screen and the assistant now send the made title, so only a direct call sees it. Should the server make the title itself? It needs the client's name, which the action has; left as it was, the reading that changes less.
- **Deployments saved before UC-2 as "Deployment"** keep that title. `isMadeTitle` treats a bare "Deployment" as made, so their sentences still name the day.
- **QC-1's create rule keeps "a" and "an"** ("A User Story doesn't go under an Epic in this process. Under an Epic go: Feature"), in the New form, drafts and `new_item`. Item 9 named only the move rule. The same rewording would fit it ("In this process, Epic isn't the level above User Story. Under Epic go: Feature").
- **The No client chip and the Code object type are for the visit only.** Storing them would be a new setting, which UC-2 rules out. Should No client be remembered with the chosen clients?
- **Code's switch with several databases open** sticks at the top of the Databases group rather than under each one (one switch for all of them, as RB-6 has it). Under each open database it would be several copies of one choice.
- **Keeping the place across a Schema · Type switch** puts the object at the top of the list back at the same height when it is in both trees, which every object is; with a filter typed the switch is off, as before.
- **"Exported" for item 11.** `conv.closed_shown_days` is a team Rule in `org_settings`, never in a person's Export. It is still stored, read by the conversations job and returned by `admin.load`; nothing about it changed.
- **Items 10 to 12 were already done on main** by NM-2 (26463b84). UC-2 adds checks only.
- **Next round:** the Inbox's chips on the phone have no No client chip (the phone was to stay unchanged); a deployment's weekday card at Larger text could show the window on its own line; Backlog's title is still only part of a 602 px Item cell at 1280 because the parent chip and New under share the line.
- **Review 1 (a daily user on the pairs), left for the next round:** the Inbox's chip numbers count what needs me (UC-1, the tab's count) while the group headings count every row shown, so "Harbor 1" sits over "Harbor 3"; changing either would change a count's meaning, which UC-2 rules out. The bulk result line reads "State On hold: staged 1, skipped 1." as every bulk action's does ("Set to On hold: 1 staged, 1 skipped" was suggested for all of them). The sticky switch doesn't name the database scrolling under it when several are open.
- **The Code test "inside a client the search starts on This client" timed out once** in the full browser run under load. RB-3b (f0bebb59, merged into this branch) found and fixed its cause; left here only as a record.

## FT-1

- **Test or app, for each of the three (and the fourth):** all four were the test's (`docs/ux/ft1/step0.md`).
  - `first-download`: a route added to an open page, or removed from one, let a screen's `import()` through unseen under load. Chromium sent the request (a CDP session saw it) and Playwright reported none. The app did what it should.
  - `opening-and-brand`: it read the loader at fixed times on the test's clock, so a slow page's 7.9 s was the test's 8.7 s.
  - `search-inside`: the same route habit, and it read the progress line once, before the page had drawn it.
  - `by-kind-and-search`: it typed before Code opened Atlas's only repo, and the move emptied the box.
- **BT-1's question named the wrong file:** the CI time-out "inside a client the search starts on This client…" is in `e2e/code/by-kind-and-search.test.ts` (was `rb2-code`), not `search-inside` (was `rb4-code`). FT-1 fixed it there. BT-1's questions on `opening-and-brand`, `first-download`, the Admin screenshots' check and the tours' plan store check are answered by FT-1 (`docs/decisions.md`, FT-1).
- **Code emptied the search box when it opened a client's only repo by itself.** FT-1 left that app behavior alone; RB-3b fixed it on main (f0bebb59, `ui/code/Code.tsx`), merged into this branch. `by-kind-and-search` still waits for the repo to open before typing, so it reads the search after the move either way. Answered.
- **Files with the same route habit, shaken once each (8 copies at once on 3 cores, on this branch):**
  - Passed 8 of 8, left as they are: `admin/delivery-chats`, `admin/invite-send`, `backlog/where-lookup`, `code/code-tab`, `day/progress-checkin`, `settings/autosave`, `shell/guide`, `shell/tech-docs`, `week/story-card`, `settings/first-run-setup` (fake clock).
  - Failed for another cause, not fixed here. None failed in a test that sets a route, and none is a few lines:
    - `backlog/change-set` (1 of 8): the staged change count is one off ("3 changes to save" where 4 was expected, and the other way), and one count of gaps was 10 where 11 was expected. Each test is its own demo session, so something staged or saved late under load.
    - `day/timeline` (2 of 8): "the switch shows and hides the timeline…" timed out on a `waitFor` after 30 s, in a test with no route.
    - `day/timeline-checklist` (1 of 8): the keyboard test read a timebox at 10:00-11:00 where 10:15-11:15 was expected, and a drag's timebox wasn't there yet. Most likely a read once before the move was saved.
    - `settings/panel-shell` (2 of 8): Esc or Close left the address on the section. Most likely the key came before the panel took it under load.
    - `week/loading` (3 of 8): "the header within 150 ms" measured 152 to 559 ms. That is a time budget for a page, which a loaded machine misses by its nature. Measure it another way, or keep it only where the machine is quiet?
  - Each is worth its own small step with the shake.
- **`opening-and-brand` shaken whole fails 0 of 40** (8 copies on 3 cores, 5 runs), in three tests FT-1 doesn't change. Its fixed test, shaken alone, passes (B3). Taken as "each of the three tests", the reading that changes less. The three, each failing on most copies:
  - "a click or a key while it finishes goes straight to the app": it reads `#boot .brand-stage` once, just after the top bar shows, and sees 0 when the loader had already gone. It also expects the loader gone within 400 ms of the key on the wall clock, which measured 1.1 to 2.4 s.
  - "a source failing at load: the app opens as fast…": the failing source's open must be within the healthy open plus 500 ms, on the wall clock. The healthy open runs first, and the gap measured 0.2 to 2.2 s over.
  - "Close out ends on Day…": after Done, the address stayed on `#/day/closeout` for the poll's 5 s.
  - The first two are time budgets for the app, which a loaded machine misses by its nature; loosening them would weaken them. The third looks like a click lost before the panel was ready. Each passes on CI today. Worth a step: measure the budgets on the page's own clock (as A1 does), or run them where nothing else runs?
- **Clock sampling left alone:** `opening-and-brand`'s other tests read the mark at `t0+1300` and reduced motion at `t0+1000`. Both passed the shake, but they are the same habit, and the loader's own clock (as A1 reads it) would suit them too. `e2e/shot-scripts/br1-shots.ts` takes pictures at fixed times. It is no check, so it is left alone.
- **C2 was done with a test seam** (`FOCUSTIME_TEST_DEMO_EXPORT`, `server/demo.ts`): the demo's plan store answers Export my data only when the tours' browser test asks. Should the demo answer Export my data for everyone instead? It would be the demo's fictional data only, but it is a change to what a person sees, so it isn't made here.
- **"A fast file never shows the line" is a time claim** (found by FT-1's review). Before FT-1 the test asked that the line never showed for Status. On a busy machine Status can take past 300 ms to draw, and then the line is right to show. So the check now holds only where Status was drawn inside the delay. Past it, the line may show at 299 ms or later, before Status was drawn, and must be gone after. A change that made Status's file slow on every machine would pass that. Worth a budget measured where nothing else runs (the first-screen timings, `scripts/first-screen-times.ts`)?
- **"No reload" and "no reload loop" still watch a span of time** (1.5 s twice, 0.8 s once, in `first-download`'s release test), since proving that nothing happens needs one. A reload in that span is now counted when its document starts, so it can't slip past; one that started after it would. The app reloads at most once right as the file fails, before the line shows.
- **The archive guard found nothing** on `main` or on this branch: no archive and no Office file anywhere.

## VM-3

- **What the logs left open:** the log can't show which line the start returned at on Nov 17, only that it wrote nothing and read no single-day holidays. The code and the reproduction (`server/ticks-vm3.test.ts`, lead 1) point at the PTO read with no Dataverse user; it fits every line, and nothing else does, but it is a reading of the code, not a log line. From VM-3 on, each outcome is logged once a day, so the next one will say. Also open: whether the two VM starts by a person that morning (9:07 and 9:45 AM Eastern) were the person whose start didn't run.
- **A second try later the same day?** Not built (the spec said not in this step). After a left-off morning the person is told and can press Start. Wanted for "Azure refused" or "FocusTime wasn't running"?
- **Is 24 hours right for using an earlier PTO read?** Taken from the spec. A shorter window leaves the VM off more often on a Dataverse hiccup; a longer one risks starting on PTO entered late.
- **Awaits still without a limit:** the scheduler's `planWake` asks each person's wake with a limit, but the stored next-due write and the idle rule's own reads have none; the app jobs' own inner awaits (Graph, DevOps, AI) rely on their clients' time-outs; a person's `fast` parts have a 30-second limit each but the notifier's own sends inside them have none. A stuck one is left behind now, never waited on, but it still holds a busy key until it ends.
- **Other quiet background failures:** reminders that didn't go out and chat reads that failed are logged but not said to the person (chat reads show at the foot of Inbox › Conversations and in Admin › Status). Should they say so the same way, once, with the reason?
- **"Not running" after a deploy:** a deploy that lands across someone's planned start now says "FocusTime wasn't running at the time" if the new replica's first pass comes after the late limit. Fine as is?
- **The notices' own PTO check has the same cause** (found in VM-3's review): the gate's facts read today's PTO with the person's raw settings (`ptoOff`, `server/ticks.ts`), which on the hosted app carry no Dataverse user, so reminders and notices never know a PTO day. Fixing it changes when notices are sent, which VM-3 leaves out; the reading that changes less is to leave it. Its own small step? Answered by NT-1: the background reads settings with the sign-in, and a day off is PTO or a company holiday.
- **From the VM safety review (low):** a PTO entered after the last good read and before a Dataverse outage the next morning is missed by the 24-hour fallback (the VM starts, and says an earlier read was used). And the day is the person's local date: changing the time zone across a date line mid-day could give a second automatic start on the same real day (as in VM-2).
- **From the scheduler review (low, left as is):** settings read to pick a person's parts (`parts()`) have no limit; in production they read nothing, elsewhere a hang holds that person's pass key. A pass that never ends keeps Admin's warning on until a restart. A part stuck forever is logged once, then skipped quietly until a restart; Admin › Status shows passes, not parts. A job over its limit keeps its old "Last run" in Admin. On the first slow pass after a restart the start's notice waits one pass (30 s) for the notifier's facts. The start's turn comes first within a pass; a slow pass with long jobs can still hold the next one up to its 10 minute limit.
- **From the demo review (low, left as is):** a left-off notice stays in ⋯ › Notifications on later days still saying "Left off today" (under its own date); drop it once a later start succeeds, or date its words? "FocusTime wasn't running at the time" may read as "I didn't have FocusTime open"; the spec's words were kept. Day's own "VM is off · Start · Not today" prompt doesn't give the reason (the chip does). On dev the form says production only twice (VM-2's note and the line). The demo moves its pretend PTO with its clock, so the PTO morning can't be walked through in the demo (unit tests cover it).

## MC-1d

- **Why passes ended as "couldn't answer" before, and what the log now tells apart.** Before MC-1d, every failure was stored as `ready` with only its kind, and "provider" covered: a 4xx from OpenAI other than 429 (a bad request, often a request too large or a model the account can't use), an answer that wasn't JSON, the network or a 5xx after the one retry (`unavailable`), and FocusTime's own missing client context. The log line had the kind only. Now the context case is `no_context`, and a failed request keeps the provider's HTTP status and the tier (Flex or standard). Still not told apart: which 400 it was (the body is never kept), and a Flex timeout that the standard tier then answered. Worth a look once production has a few weeks of statuses.
- **Calls in the Inbox.** Not in scope. A call to review is a decision waiting on me, which is what the Inbox lists; today it is the More menu's count, the mark on its meeting and the note. Should "Review 6 proposals" be an Inbox item under its client?
- **Attendees see the whole transcript or only the proposal lines?** Taken as the whole transcript, the reading that changes less: MC-1 already shows attendees every proposal with its quotes, and the hard rule says transcripts are shown to the call's reviewers and attendees. A narrower reading (only the quoted lines) is a smaller change to who sees what, if the team prefers it.
- **Is three retries over an hour right?** 3 tries, 15 minutes apart, after the first failure: a provider outage longer than about 45 minutes ends at the reviewer's note and Propose again. Longer gaps, or a try the next morning, would catch more outages and cost little.
- **What should a meeting that isn't registered offer?** Today it is unchanged (Open in Outlook, and Accept, Tentative and Decline where they apply). Offering "Register this call" to admins, or "Ask an admin to register it" to others, would be the natural door, but registering from Day isn't in scope and the rule is that only registered calls are read.
- **The match is by time, not identity.** A meeting is the call when it is an Outlook meeting with others on it that starts and ends exactly when the occurrence does (a solo hold and a calendar added by link never are). A meeting moved in Outlook is no longer the call's door that week (the card's line still shows the call), and a second meeting with exactly the same times would carry the mark too. Matching by identity (the occurrence's Outlook instance or iCalUId, the series already stores the master's id) would fix both, but needs `meeting.mine` and the calendar events to carry that id: a bigger change than MC-1d's, found by its third review.
- **`meeting.mine` is now asked app-wide** (every 5 minutes while the tab is visible), not only on Week, so the mark and More's count follow on every tab. It re-renders only when the answer changed. It is a session check and a small read every 5 minutes while the app is open, as Week already was.
- **Propose again from the menu runs on the page.** It opens the call and runs there so the result is seen. Running it in place with a toast would save a step; it would also hide what it replaced.
- **Found by the first review (a person in the demo), left for a later step:**
  - *Propose again and decided proposals.* It replaces the open proposals (MC-1's rule); a skipped one stays skipped, and the new pass can propose the same thing again beside it. Now Propose again asks first when open proposals would be replaced. Should a new pass leave out what was already skipped or done? That changes the proposals, which MC-1d doesn't.
  - *The phone's Day in Cards* doesn't list a block's meetings, so the call shows there only on the Timeline; the phone's Week card and More › Client calls have it. Should the phone's Day cards carry the card's call line, as Week's do?
  - *The menu is where meetings already had one:* Day's Timeline, Week's rail and the block panel's agenda. A card's open meeting list (Day Cards, the phone) has no per-meeting menu today, so there the mark and the title are the door.
  - *Keyboard:* a Timeline meeting isn't in the Tab order (as before MC-1d), so its menu needs a pointer; the mark is a button and is. On Week only the selected card's controls are in the Tab order, the mark included.
  - *Escape and Back* on a call's page go to the Client calls list and then to Week, wherever it was opened from (MC-1's overlay), and the back button says "Calls".

## PH-1

- **STEP 0.3's compromises** (`docs/ux/ph1/reach.md`): today's Day lost its arrows, Cards or Timeline, Timebox my day and the Day menu. Another day is reached from Week (a day's header) and keeps all of them; Timeline and Timebox my day are also in the Desktop version. A phone with the timeline turned on (TY-1) keeps today's header, the reading that changes less, since otherwise it could only be turned off from another day. Should the timeline on the phone go, or move under More? The urgent strip became the one thing; its other lines are in the Inbox. Midday check-in and Close out moved from the moment card to More › Everything else. Is Everything else too deep for Close out, used daily?
- **A client call to review isn't in the one thing.** The spec's order puts a call between "due today" and a chat's suggestion, but calls aren't the Inbox's rows or in its count, so "1 of N" couldn't match the bar. Taken: the one thing reads the Inbox only; calls show on More's Client calls line. Should a call to review count in the Inbox?
- **Ask in the top bar, or back in the bar?** The bar has five places now and Ask moved up beside the VM. Watch whether people find it.
- **One name or two.** The bar says Day and Inbox, as the computer does (the spec's last word on names). The one thing's heading on Day is "Needs you", as MB-1's phone already said; the Guide doesn't use it, being a retired name there. Keep it, or say "Inbox"?
- **The Desktop version in the installed app and on devices.** The zoom (`initial-scale`) is set from the screen's width; Chromium's emulation lays out at 1280 but doesn't apply the scale, so the zoomed-out first look and pinching were not seen on an iPhone or an Android phone. The official pages (MDN viewport meta, Apple's Using the Viewport, WebKit's iPhone X note, MDN `env()` and VisualViewport, Chrome's viewport resize note) don't describe changing the viewport after load or in an installed app, which is why switching reloads. Check on a real iPhone (Safari and the installed app) and Android (Chrome and installed).
- **More isn't an address.** It's a screen over the page, so the browser's Back doesn't close it (Esc and the bar do). Give it `#/more`?
- **Notes for the next phone steps:** Week as day rows and Today at a glance (the Now card is ready to reuse); the Inbox one at a time (the one thing's order is in `plan/phone-now.ts`); a quick Backlog (More's row opens today's "made for a bigger screen" notice); Status in a pinch (More's row has the count).
- **From the hallway review, for the next phone steps (not this one's):** Week on the phone is still the computer made narrow ("+ time", bare S/M/L, a ⋯ per row, 22 px boxes, two Adds); the Now card's Add opens the computer's block panel as a sheet; Capture says keyboard hints on a phone ("Tab changes the kind · Enter saves"); the Inbox's client chips have no counts on the phone (UC-1 chose that); Day's Today list repeats the client under each to-do and the Now card's to-do; "VM is off · Start · Not today" takes a row even after the day; Ahead's Grid and Gantt are reached only by Backlog's Open anyway. Each belongs to Week as day rows, Needs you one at a time, Capture's new look or the quick Backlog.
- **The one thing opens the Inbox as the urgent strip did** (`#/inbox/item/<key>`): the phone's Inbox shows the list with the row open and scrolled into view, not as a sheet. A person in a hurry may not see which row it was. Worth a sheet on the phone?
- **More at 360 by 640** scrolls: Guide and Everything else are below the fold. Shorter rows, or two columns?
- **Old screenshot scripts** (`scripts/screenshot-phone.ts`, `screenshot-rf1.ts`, `e2e/shot-scripts/mb1-shots.ts`, `rs1-shots.ts`) record their own steps and still name the old bar; they aren't tests and were left as they were.

## MC-1e

- **Why two passes over the same transcript differ so much (STEP 0.6).** From the code: the AI's answer isn't deterministic (no fixed seed, and the task allows several readings of one sentence: a gap, a promise or a comment); a long call is sent in windows, and what lands in each window and the open items given as context (features first, clipped) change what is proposed; the context is read fresh each pass, so items created since change what counts as a gap. Before MC-1e a second pass deleted the open proposals (with any edits), kept done, skipped and failed ones, and could propose the same thing again beside them. Now copies of decided ones are dropped by rule; the number from the AI can still vary a lot between passes. A fixed seed or a smaller temperature would steady it; that changes the AI task, which MC-1e doesn't.
- **What was said about a feature with no story under it is left out.** The AI is told to comment on the story it is about, and to propose nothing when no story fits; it may still come out as a new item or a promise. A reviewer can't pick the story for a comment (not in this step). Should a reviewer be able to point a comment at a story, or turn a dropped comment into a new story under the feature?
- **One target date for all ticked rows?** Each new item takes its own target date on its row. Setting one date for every ticked new item (as Backlog's bar sets a date) would save clicks when several need one; taken as not in this step, the reading that changes less.
- **Does "the same thing" drop too much or too little?** The same kind, and the same transcript lines or the same words apart from case and punctuation (a comment also on the same item). Too much: two different promises on one line (one person promising two things in one sentence) count as the same when one is decided. Too little: the same item worded differently on other lines comes back. Worth a look after a few real calls.
- **What the first reviewer missed from the old page.** Edit was a separate state with Done editing; now a row's words are always editable and saved when the field is left. The old Confirm counted every ticked row and showed one list of everything; now DevOps changes and promises go separately, by design. Untick all is gone (Select all and Clear per section and on the bar take its place). The consultant review's findings are in the pull request.
- **What didn't fit the New form or the preview, and the workaround.** The New form is a dialog with its own Create; a call needs its fields on many rows at once, so the row uses the form's field controls and rules (`ui/meetings/GapFields.tsx`: Level, Parent, Assigned to, Target date, More) and the server's `new_item`, not the dialog itself. The New form's Start date isn't asked (it isn't on the form either). The preview's refusals for an inline begin now come back to the caller by key, so the call says each on its own row; nothing else in the preview changed.
- **The other screens with their own preview.** Mark done in DevOps, Week › Status, the timebox check-in, Break down and Send feedback use the write framework's preview and confirm with their own dialogs (STEP 0.4). The guard covers the call's page only. Should they move to the one preview, and the guard cover every screen?
- **The phone's sticky header is tall.** The title row, the filter row (wrapping to two lines at 390 px) and the Proposals and Transcript switch take about a third of the screen while scrolling. A smaller form (the filter as one picker on the phone) would give rows more room.
- **Found by the consultant review, left as they are:**
  - *The New form doesn't ask first.* Northwind's demo Epic shows Target date "Optional" in the Backlog's New form, and the form says the field is needed only when Create is refused; the call's page now marks it Needed before. Bringing the New form's own check forward is a New form change, not in this step.
  - *Three create forms still look different.* The Inbox suggestion's Create item has an older layout (a native parent list, an Assign it to me box, no target date or level switch). Out of this step.
  - *The count includes a comment that won't be sent.* A stored comment above story level still needs a decision (Skip), so it stays in "to review". Should it be skipped by itself instead?
  - *Section Clear and the bar's Clear.* "Select all" turns into "Clear" for that section only; the bar's Clear clears every section. No half-ticked state on a section header.
  - *A promise's due date and whom it's to* can't be edited on the row (only its words), as before.
  - *Done rows show #5100 as text,* not a link to DevOps, and Undo is in Settings › Activity, not on the row.
  - *The transcript's line button doesn't say whether its proposal is done or skipped,* and quotes show time into the call ("1:05") while the transcript shows the time of day.
  - *No "all done" state:* a reviewed call shows "0 to review · 3 done · 8 skipped"; the mark on Week says Reviewed.
  - *The bar is at the foot* (the spec's choice); the Backlog's is at the top under its filters.
  - *Propose again asks first* (a browser confirm) when open proposals would be replaced; a headless browser dismisses it, so the reviewer saw no change there.

## PK-2

- **Can a personal key be told from an organization key?** Pocket's docs describe only organization API keys and no field, prefix or "who am I" call that tells them apart. FocusTime can't refuse an organization key, so the guide asks for a key made for the person alone. If an organization key works, it may list everyone's recordings in that organization, not only the person's. Ask Pocket; until then the count may include others' recordings.
- **Does Pocket offer a read-only key, and does a person (not an admin) make one?** The docs show scopes (`recordings:read`) on organization keys made by an organization admin, and don't say where a person makes a key in the app, or which scope the list call needs. The guide's first two steps are written from that; they need checking against the real Pocket app by someone who has it.
- **Rate limits and the terms.** Not documented: a 429 is shown with no numbers or headers, and no terms page is linked from the API docs. FocusTime calls Pocket only on a press, once, so it is far from any likely limit; the terms for use by another app need reading before the next step reads transcripts.
- **Should an admin be able to turn Pocket off for everyone?** Taken as no for now (the step says no admin step). A Rule in Admin could hide the section if Cooptimize decides recordings shouldn't come in this way.
- **The list call sends a recording's words with it.** Asking for one item still brings that recording's title, transcript and summaries to the server, where they are dropped unread. A count-only call or a field filter would avoid it; the docs offer neither.
- **What the next step needs (choosing a recording for a call):** one recording with its transcript (`GET /public/recordings/:id`, not read here); whether its lines carry times and speaker labels (the list shows `speakers` as a map of names and ids and `transcript` as one field, shape not documented); how a recording's start is given (`recording_at`, ISO text) and in which time zone (the docs say all dates are UTC); how long a call's audio and words stay in Pocket.
- **Found by the review passes:** see the pull request; rows are added here when they are left for later.

## VM-4

- **Why Azure refused some reads.** From 21:11 UTC on Nov 17 about one read in four of the VM's state answered 403 in about 60 ms, with the same token that answered 200 a minute before and after. Azure's error code wasn't logged, so the logs can't say whether it was a role assignment propagating or changing (`AuthorizationFailed`), a policy, or something else. The code is now logged; the subscription's activity log for role assignments around 21:00 UTC would say more. The background reads of the VM also stopped at 21:10 (the person's sign-in changed then); not explained either.
- **Are 10 seconds and 2 minutes right?** 10 s between reads while checking is about 6 reads a minute for one person; 2 minutes before the reason shows hides short blips. Taken from the spec; worth a look after a week of the new `kind` codes.
- **Should other chips and status dots keep their last state?** Sources (Outlook, DevOps), presence and the database line still show their failure at once. The reading that changes less: only the VM chip in this step.
- **Awaits with no time limit in a request's path.** The Azure client has its 20 s limit and the scheduler its own; a request that waits on the plan store, Dataverse or Graph has the driver's or fetch's own limit, and the page's call none. Not changed here.
- **Is tomorrow's automatic start safe?** Yes, as far as the logs show: a failed read at the planned time no longer uses up the day, and it reads again on each later pass until the late limit. If Azure keeps refusing the reads all morning, the person is told once at the late limit and the VM stays off. A start Azure refuses is still the day's one try.
- **A sign-in failure at the planned time still uses the day.** VM-2's rule, kept: one notice with Allow Azure access, no retry loop. Should a sign-in that recovers later in the morning (a refresh that failed once) get another try?
- **A PTO read that fails after a state read failed.** At the late limit the start says "couldn't read your VM's state" even when PTO was the last thing that couldn't be read. Rare; the words could name both.
- **The Azure client's own line on each failed read** repeats every pass while reads fail (the reason line is once a day). Call lines, not reasons; left as they are, as they carry the code that was missing on Nov 17.
- **The stored sign-in that can't be read is "Can't reach Azure".** It is usually back in a moment; the person can't fix it. Should it have its own words?
- **Two older failures the logs show, not fixed here:** `setup.mark` (17 on Nov 16) and `inbox.looked` (31 from Nov 10 to 13) failed with a MERGE conflicting with a CHECK constraint on SQL Server. Both now answer with the plain words and a reference instead of "bad request"; the cause is a separate step.
- **Where an unexpected failure is said, and how it looks** (the second review). The words are the same everywhere, but each screen shows them its own way: Day's tick in the status bar's notice (easy to miss on a laptop; a toast on the phone), Capture and the check-in as plain inline text with no error colour. None says what failed ("Couldn't save the capture"), and the reference can't be copied with one tap. One shared error line with a Copy button would fix all three; taken as not in this step, the reading that changes less.
- **The phone's chip with a reason** shows "VM Stopp…" and the "!": the state is cut by the mark. A narrower mark, or the dot alone with the "!", would fit.
- **The menu's "Checking…" row** looks like something to tap; it is (it says the whole sentence), but a plain line might read better.

## OP-1

- **What a screen lost or gained by moving.** Status lost its one view of every client's lines grouped by feature (now one client per preview, each line its own section) and gained one client per Confirm, Reload and the preview's Retry. Break down lost the batch list in its own panel with each card's type icon and size chip, and the line "Each is assigned to you, with the parent's area and iteration... Sizes stay in FocusTime" (the preview shows each field instead, Size marked "not written to DevOps"); it gained Reload and Undo from the preview. The check-in lost its inline list before Confirm (the preview shows it) and gained per-row outcomes with Undo. Send feedback lost the ‹ Back arrow on its preview (Not now does it) and its "Created as X in org › project" line (Where and Writes as say it).
- **Is 10 at a time right for Status and Break down?** It is the write framework's own limit. Status rarely has more than 10 lines for one client; Break down's draft already holds at most 10 cards, so it never splits. A person pushing 14 lines confirms twice; a higher limit would need the framework's limit raised.
- **Should Send feedback become a kind of change later?** It writes to FocusTime's own backlog with the person's Internal write PAT. As a `devops.preview` kind (`feedback_create`) it would get Retry, Reload and Undo from the one preview, and its daily limit and setup checks would move into the framework. Left as its own action, through the same parts.
- **Should Azure's preview look the same?** `vm.preview` (Start, Stop) has its own dialog. The parts (`PreviewFrame` and the rest) would fit it; the guard covers DevOps only.
- **What STEP 0.3 found that MC-1e missed.** Wrap it up (`ui/WrapUp.tsx`) and Close out's Wrap up batch (`DoneBatch` in `ui/DoneOffer.tsx`) call `wrapup.preview` and `wrapup.confirm`, plus `devops.retry` in `WrapUp.tsx`; MC-1e listed Wrap up as through the one preview. Its confirm writes several changes to one item in turn and previews again when its own earlier write moved the revision, a server composite; moving it changes the server's write rules, which this step excludes. It is a named "not yet moved" exception in the guard. PK-1's Mark done card (`useDoneOfferFlow`) had its own preview but was no longer shown anywhere; it was removed. Also outside DevOps and out of scope: the assistant's proposal card (`assistant.confirm`), Close the loop's send preview (which includes a DevOps comment), Outlook writes in Timeboxes, and the VM.
- **"Create all" on the Guide's Renamed list.** Break down's Create all is gone (Preview, then the preview's Confirm). The Renamed list has a word budget (270 words, `ui/guide/app-names.test.ts`) that one more row exceeds, so it isn't listed; the server action `stories.publish` keeps "Create all" as its registry title.
- **A refusal before the preview.** When DevOps refuses every change at the preview (Break down under a parent closed since), no dialog opens and the screen shows the reason; the check-in and Status show the same per row. Should the preview open to say it instead?
- **Found by the consultant review, left as they are:**
  - *Close out's default path is Wrap up's batch,* with its own inline Preview and Confirm (no Where, Writes as or Who can see it); Mark done in DevOps shows only when Wrap it up is off. It is the "not yet moved" exception above.
  - *A comment's Now says "(none)"* even when the item has comments, and Remaining Work shows "1" with no unit; both are the one preview's own words for every screen, unchanged here.
  - *Preview 2 of 2 doesn't say Preview 1 was written;* Not now on it stops quietly and the line stays to push.
  - *Pushed just now lists features without their client,* and the check-in's rows have two Undo buttons close together (the timebox answer's and DevOps's).
  - *Break down's 5-item preview is long:* Where and Writes as scroll away before Confirm. Mark done is two dialogs (the state, then the preview), as on main.
  - *Fixed in this step:* the preview's head overflowed at 390 px once it said "Preview 1 of 2"; the check-in's heading kept asking after the write.

## PK-1: A Pocket export as a call's transcript (Nov 17)

- **The step's name.** An earlier step was also called PK-1 (D877 to D887, the DevOps update on checking off a to-do). This one keeps the name it was given, with its full title in every heading; it could be renumbered at merge.
- **How sure is this to read a real export?** Only an invented PDF was tested, made to the layout one real export showed on Nov 17 (date and length at the top right, a title, "Transcript", then SPEAKER_ turns, Identity-H text). A real export may break lines differently (a label in its own text item, a different heading's case, page headers or footers). The product owner will try a real one; if it's refused or a turn looks wrong, the refusal's code is in the log and the layout reading is in `plan/pocket.ts`.
- **Named speakers and other sections (STEP 0.5).** Pocket's docs (docs.heypocketai.com, Speaker Management) say speakers can be named and the name carries across recordings, but nothing says how a named speaker is written in an exported transcript, so only SPEAKER_ is read: an export with names would be refused as having no turns. A community answer says the transcript and the AI summary export as separate files, so a summary in the same PDF wasn't designed for; a section before "Transcript" is ignored, one after it would be read as part of the last turn. Should either be added when a real example shows it?
- **Should a reviewer be able to say who a speaker is?** Today nobody names a speaker (NOT IN THIS STEP). Naming "Speaker 2" once per call would let promises go to the right person, but Pocket mixes speakers up, so a name per label could be wrong for some lines.
- **Should a promise with no owner ask for one on its row?** It's noted with the call (in the reviewer's Waiting on, from "Someone on the call"). A "Whose is this?" picker of the call's attendees on the row would let the reviewer put it in someone's Promises on purpose, not on a guess.
- **Should other PDFs be read?** Only Pocket's layout is read. A Teams transcript printed to PDF, or another recorder's export, is refused as having no turns.
- **For the next step (connecting to Pocket).** The reader takes bytes (`readTranscriptFile`), so a recording fetched from Pocket can go through the same intake and limits. The export's date is checked against the call's; picking a recording from Pocket could match by date and length instead of asking. The kind is stored as `transcript_kind = 'pocket'`; an API source may want its own value. The title is never kept today; matching by title would need a decision.
- **The date question asks every time the days differ.** A call just after midnight, or a recording made in another time zone, may be dated the day before; there's no tolerance. Should a day either side pass without asking?
- **The drop's replace question is a browser confirm**, like Propose again's. An in-page question (like the date's) would read better on a phone; both use the browser's for now.
- **After "Use it for this call", nothing records that the recording was from another day** (consultant review). Another reviewer sees only "Pocket export uploaded by a reviewer". Should the call keep and show the recording's date when it differs, and who uploaded it?
- **A promise Pocket didn't say whose can't be claimed** (consultant review): "I'll add the row limit warning" may be ours, but the row offers only Note with this call or Skip. Linked to the question above about asking for an owner.
- **Where a noted promise lives** (consultant review): "Noted with this call" goes to the reviewer's Waiting on from "Someone on the call" and folds into the call's done count; the row doesn't say so. Should its words say "in Waiting on"?
- **The two questions look different** (consultant review): replacing a transcript asks with the browser's dialog, the recording's date in the page. See the question above about the replace confirm.
- **Uploads not limited per person.** PDFs are read 2 at a time server-wide with 8 waiting; one reviewer uploading many could make others wait. Enough for a team, worth watching.

## EV-1: A Dev mark on the dev site (Nov 17)

- **Q-EV1-1: production asks nothing new, so the mark's cue is in the page.** The brief said both "the environment comes from what the app already asks (/version)" and "nothing on production changes: not a word, a pixel or a request". The app didn't ask `/version` at start (only About, Settings, Send feedback and the docs do, when opened), so asking it for the mark would have been a new request on production. The reading that changes less: the server marks the page on dev and local only, and only a marked page asks `/version`. If a request on production is fine, the page's cue could go and every page could ask.
- **Q-EV1-2: apps installed from dev before this step (STEP 0.4).** Android (Chrome): the new name arrives by itself, once Chrome checks the manifest (on opening, at most about once a day) and all the app's windows are closed; on Android also charging and on Wi-Fi ([web.dev](https://web.dev/articles/manifest-updates)). iPhone: the name is taken once, when added to the home screen ([Apple](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)); no source says it is ever updated, so it has to be removed and added again. Should the dev site say so once to a person who opens it from the home screen (`display-mode: standalone`) with an old name? Nothing can read the installed name, so it couldn't tell who.
- **Q-EV1-3: should dev have its own icon?** Not in this step. A dev icon would tell the two apart on a home screen even before the name is read, and in the task switcher, where the name may be cut.
- **Q-EV1-4: the phone's bar in a demo on dev.** With the demo's mark too, the VM's word is cut at 390 and below ("VM St…"), as PH-1 lets it give way at the largest sizes. A person on dev has no demo mark and fits at 360. Should one of the two marks give way (for example "Dev" folding into the demo's), or is the VM's word the right one to give?
- **Q-EV1-5: should the app say which account is signed in beside the mark?** The same confusion could come from being signed in as someone else on the right site. Not in this step; the photo at the top right is the only sign today.
- **Q-EV1-6: the docs' screenshots in the developer loop.** The e2e demo runs as "local" (no `FOCUSTIME_ENV`), so every top bar in a test or a screenshot taken there now shows "Local". Fine for tests; screenshots for the Guide or the docs may want `FOCUSTIME_ENV=demo` to leave it out.

## RQ-1: Needed fields asked before DevOps refuses, and Break down from a call (Nov 17)

- **What a real org answers (for the product owner to try on dev).** Only the demo and test fakes were run. Not shown without a real org: that `validateOnly=true` evaluates the process's rules and saves nothing, its status and body for a rule failure (all fields in `RuleValidationErrors` or only the first in the message), whether a check counts against DevOps' rate limits in a way that matters, and that the field's display name in the message matches the type's field name. A quick try: a client whose process requires Target Date on features; open New, choose Feature, and see Needed before typing anything.
- **Should updates to existing items be checked too?** Only creates are (`validateOnly` works on Update as well). Backlog's change set and the story card's edits still learn about a rule at Confirm, in plain words.
- **Should stories take other values from their feature?** Break down starts each story's needed date from the feature's. Area, iteration, tags or an assignee could come along too; nothing else does today.
- **Should FocusTime read the process's rules list** (the process API's work item type rules) to know them before asking? It would say why a field is needed ("when State is Active"), but needs a read FocusTime doesn't make today and differs between inherited and hosted XML processes. The check covers the case without it.
- **Should Create and break down put the stories in the same preview?** Today the feature has its own preview, then Break down runs and its stories have theirs. One preview would need the feature's id before it exists.
- **A rule that depends on another field's value** (for example required only when State is Active) is asked for the new item as it would be sent; changing another field may make it needed or not. The screens ask again as fields change, a few times at most.

## NT-1

- **STEP 0.4 rows with a different cause.** The Teams rhythm's own settings (`configOf` in `server/main.ts`), the chat poll's and meeting capture's person contexts read raw settings; none of them uses the Dataverse user today, so they were left. The VM chip's morning prompt counts PTO but not holidays (its own rule, also in requests); a holiday reaches the notice only through the gate.
- **The first morning back (the second review).** Up to six app notices at once (Plan today, the week, the direction review, promises due, expiring secrets, the VM), each pushed to every device, plus the Teams brief; nothing merges them as "While you were focused" does. Sends, assignments and notes older than 72 hours and urgent requests older than their window never notify (Week › Plan, Backlog and the Inbox still show them). A quiet notice leaves no row in More › Notifications. A direction review missed until the next month is never sent. Should a "While you were off" notice gather them?
- **A holiday for someone who chose to work it.** It quiets their notices like PTO (with the setting on) and skips their reminders whatever the setting. Should working a holiday (planning it, or a setting) undo that?
- **Is 24 hours right for notices?** Taken from the VM start. If PTO reads keep failing for longer (a missing Dataverse role, an outage), the reminders, the Ahead rituals and the status nudge wait every working day with one log line a day and nothing told (the first review). A person with that problem sees "no reminders"; should it say so, or fall back to a working day after a while?
- **The Teams rhythm and unknown PTO.** It takes the gate's fact, so with PTO unknown its status nudge and brief send while the app's status nudge waits. Left as it was (the rhythm uses the gate's facts).
- **The stored last read's time.** The start and the chip stamp their read `now`, though the shared read may be up to 30 minutes old, so the 24 hour rule can stretch to about 24.5 hours, and PTO entered in the last 30 minutes can be missed by the start. VM-3 left the stamp; not changed.
- **Cost.** In production every background settings read also reads the stored identity (as requests do); a failing PTO read also reads the start's stored state on each gate pass. Small; not cached further.
- **The background's morning prompt now knows PTO** in production (as the chip in a request always did), so a PTO morning no longer gets "Your VM is off" even with the setting off.
- **A flaky browser test, not this step's:** the shake of `e2e/settings/notifications.test.ts` failed once in 40 on "clicking a notification opens its view" (its poll for `#/week/2026-11-09/add`); the new Days off test passed 40 of 40.

- **VM-3's "the notices' own PTO check has the same cause"** is answered by this step (marked there).

## DY-1

- **STEP 0.4, does each calendar say whether an event repeats?** Outlook: yes, `type` on an event is `singleInstance`, `occurrence`, `exception` or `seriesMaster` ([event](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)); calendarView returns occurrences, exceptions and single instances ([calendarView](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0)). `Calendars.ReadBasic` leaves out "body, attachments, and extensions" ([permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)) and doesn't name `type`, so it should come with the basic read; not yet tried with a ReadBasic-only token (the old desktop registration). Google: yes, `recurringEventId` is set on an instance of a recurring event, and `recurrence` is left out for instances with `singleEvents=true` ([events](https://developers.google.com/calendar/api/v3/reference/events), [events.list](https://developers.google.com/calendar/api/v3/reference/events/list)). By link (ICS): yes, a series is an RRULE on its master and an override carries RECURRENCE-ID ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) 3.8.5.3, 3.8.4.4); not kept in this step (next).
- **Calendars added by link and the repeat mark.** Keeping it needs a `repeats` column on `calendar_link_events` (a migration), or the series in the instance key, which would change every event's id. Left for a step that may add a column.
- **Should Week fold?** Not in this step. Week's past days are already quieter (WK-5); a fold on today's ended block there would follow the same rule and the same provider.
- **Should the notices above the blocks shrink in the afternoon?** At 3:55 the three promises, the From chats line and the Midday check-in card take about 240 px at 1280x720 before the first block; with a block folded the block under way still starts at about 410 px and Day scrolls to it. A Midday check-in already done, or promises already shown at noon, could fold to one line.
- **What should Planning mean?** Both types are read the same way; the type only names the call. A Planning call might propose dates and order rather than gaps and promises.
- **A call before it happens shows Repeats, not its type.** The mark comes from the call's occurrence, which exists once the call has been read. Naming a registered series' future meetings needs the match by identity that this step leaves out.
- **Folding by hand on another day.** The arrow is only on today's blocks; the reading that changes less, since what is kept is forgotten the next day anyway.
- **Hand folds are per browser, not per person.** Two people sharing one browser profile share them. Small; the store is for this screen, like Day's panel.
- **What a folded line doesn't name (second review).** The line counts done, not done, meetings, late and due promises and a call to review. It doesn't name a timebox with no to-do (an item's own), a "Changed in Outlook" conflict, Midday check-in's suggested moves (after PM starts; Check-in itself never folds), the features placed on the block or its suggestions. The reading that changes less: these are about the block's planning, which has ended; unfolding shows them. If one should stop a block folding, it is one more fact in `plan/day-fold.ts`.
- **A drag started inside an open block as it ends.** It counts as the person in it through the pointer; a drag of the pointer outside the block at that moment would let it fold, and the drag's source row with it. Not seen in the tests.
- **Focus under a tall card header.** Tab's scroll-padding takes a block header as one line (38 px at the Text size); a card header that wraps to two lines can cover focus by a few pixels. Measuring every header would need an observer per block.
- **The call's mark in a 30-minute event on the Timeline** sits on the event's second line (Outlook) and covers it, as before DY-1; with the type it is wider.
- **The Dentist band.** An event that crosses into the next block draws there as an unlabeled band once the first block folds; its name is still in the block's risk. Unchanged by DY-1, but more noticeable.

## ID-1

- **STEP 0.4 rows with a different cause.** None found that are wrong today. The Teams rhythm's own settings read (`configOf` in `server/main.ts`), the followers' hours and the admin check read raw settings for hours, zone and the Outlook client only. NT-1 listed the chat poll's and the meeting job's person contexts here as not using the Dataverse user: they did (the poll's open items and GD-2 boundary, the pass's items), and ID-1 fixes them.
- **Did the morning's failed pass on Nov 17 have this cause?** What the code can show: an upload by a hosted person always read DevOps without a Dataverse user, which ends a pass `no_context` before any AI request, and logs `ai meeting_capture` with kind `no_context` and no row in the AI request log. A pass that fails at once and works on Propose again fits that. What it can't show: the stored outcome is `no_context` whether DevOps was read without the person or was really down, and this step didn't read production's logs. A count of `meeting_capture no_context` lines right after `meeting_upload` lines, with no AI request between, would settle it.
- **Should the ticks move to `signedContext`?** NT-1's `bg` is `withSignedIn` alone, in production only, without `onlyClients`. Left as NT-1 owns it; the guard exempts `server/ticks.ts` because its own guard covers it. One function for both would need NT-1's "nothing new is read outside production" to be decided again.
- **Other code that could come inside the dispatcher.** The upload and push-to-talk take raw bodies, so they can't be actions as the API stands; a chat's image is a GET. The Teams hub's `transcribe` duplicates the panel's route. If the action API ever takes binary bodies, all three could be dispatched actions and the routes would go away.
- **The guard reads source text.** It matches calls by name and the first argument as written, so a context passed through a helper with another name, or held in a variable not bound to `signedContext` in the same file, is flagged (safe) and a context that reaches an action some other way than a named function in `actions/` isn't seen. Good enough for the current shape of `server/`; a type-level brand would be stronger but changes every action's signature.
