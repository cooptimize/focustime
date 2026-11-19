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

- [Step 13.5 (Nov 1)](open-questions/step-13.5.md)
- [T-2 (Nov 3)](open-questions/t-2.md)
- [AP-1 (Nov 4)](open-questions/ap-1.md)
- [Shared polling (Nov 4)](open-questions/shared-polling.md)
- [Costs (Nov 4)](open-questions/costs.md)
- [Draft Stories (DS-1, Nov 4)](open-questions/ds-1.md)
- [Conversations (CV-1, Nov 4)](open-questions/cv-1.md)
- [Admin (ADM-1, Nov 4)](open-questions/adm-1.md)
- [Navigation (NV-1, Nov 5)](open-questions/nv-1.md)
- [DevOps polling (DV-1, Nov 5)](open-questions/dv-1.md)
- [Housekeeping (HK-1, Nov 5)](open-questions/hk-1.md)
- [Rolling into a new week (PL-1, Nov 5)](open-questions/pl-1.md)
- [Conversations fixes (CV-2, Nov 5)](open-questions/cv-2.md)
- [Sending work (SW-1, Nov 5)](open-questions/sw-1.md)
- [Costs (HK-2, Nov 5)](open-questions/hk-2.md)
- [Chat images without storage (CV-4, Nov 5)](open-questions/cv-4.md)
- [Quick fixes (QF-1, Nov 6)](open-questions/qf-1.md)
- [Backlog health (BH-1, Nov 6)](open-questions/bh-1.md)
- [Housekeeping (HK-4, Nov 6)](open-questions/hk-4.md)
- [Settings overhaul (ST-1, Nov 6)](open-questions/st-1.md)
- [Late chip (UI-9, Nov 7)](open-questions/ui-9.md)
- [Phone overhaul (MB-1, Nov 7)](open-questions/mb-1.md)
- [Invite to FocusTime (IN-1, Nov 7)](open-questions/in-1.md)
- [Send invites from FocusTime (IN-2, Nov 7)](open-questions/in-2.md)
- [DOC-1](open-questions/doc-1.md)
- [Cleanup step 1 (CL-1, Nov 7)](open-questions/cl-1.md)
- [LP-1](open-questions/lp-1.md)
- [Ahead editors (AH-5, Nov 7)](open-questions/ah-5.md)
- [Ahead Gantt layout (AH-6, Nov 7)](open-questions/ah-6.md)
- [Readiness you can finish (AH-7, Nov 7)](open-questions/ah-7.md)
- [WK-3](open-questions/wk-3.md)
- [Text boxes that grow (UI-10, Nov 7)](open-questions/ui-10.md)
- [Client boundary (GD-2, Nov 7)](open-questions/gd-2.md)
- [Co-working calls (CW-1, Nov 7)](open-questions/cw-1.md)
- [The client's draft status report (SR-2, Nov 7)](open-questions/sr-2.md)
- [The Assistant answers real questions (AS-3, Nov 7)](open-questions/as-3.md)
- [Report preview you can finish (SR-3, Nov 8)](open-questions/sr-3.md)
- [DP-2](open-questions/dp-2.md)
- [IB-2](open-questions/ib-2.md)
- [KB-1](open-questions/kb-1.md)
- [TY-1](open-questions/ty-1.md)
- [TX-1](open-questions/tx-1.md)
- [TB-3](open-questions/tb-3.md)
- [Part 0 (shared owner)](open-questions/part-0.md)
- [CX-0](open-questions/cx-0.md)
- [FN-1](open-questions/fn-1.md)
- [WD-1](open-questions/wd-1.md)
- [RF-1](open-questions/rf-1.md)
- [MC-1c](open-questions/mc-1c.md)
- [CF-1](open-questions/cf-1.md)
- [DV-2](open-questions/dv-2.md)
- [WD-2](open-questions/wd-2.md)
- [QT-1](open-questions/qt-1.md)
- [CI-2](open-questions/ci-2.md)
- [VM-2](open-questions/vm-2.md)
- [ENV-1](open-questions/env-1.md)
- [QT-2](open-questions/qt-2.md)
- [QC-1](open-questions/qc-1.md)
- [WP-1](open-questions/wp-1.md)
- [SG-1](open-questions/sg-1.md)
- [WP-2](open-questions/wp-2.md)
- [WP-3](open-questions/wp-3.md)
- [PS-1](open-questions/ps-1.md)
- [NL-1](open-questions/nl-1.md)
- [WK-5](open-questions/wk-5.md)
- [BL-1](open-questions/bl-1.md)
- [PS-2](open-questions/ps-2.md)
- [TP-1](open-questions/tp-1.md)
- [TP-1b](open-questions/tp-1b.md)
- [RB-1](open-questions/rb-1.md)
- [ED-1](open-questions/ed-1.md)
- [IB-4](open-questions/ib-4.md)
- [RS-1](open-questions/rs-1.md)
- [TD-1](open-questions/td-1.md)
- [RS-2](open-questions/rs-2.md)
- [GU-1](open-questions/gu-1.md)
- [NM-1](open-questions/nm-1.md)
- [RB-2](open-questions/rb-2.md)
- [BL-2](open-questions/bl-2.md)
- [RB-4](open-questions/rb-4.md)
- [RB-5](open-questions/rb-5.md)
- [ED-2](open-questions/ed-2.md)
- [NM-2](open-questions/nm-2.md)
- [RB-6](open-questions/rb-6.md)
- [UC-1](open-questions/uc-1.md)
- [BR-1](open-questions/br-1.md)
- [TD-2](open-questions/td-2.md)
- [CI-3](open-questions/ci-3.md)
- [RM-1](open-questions/rm-1.md)
- [PV-1](open-questions/pv-1.md)
- [PF-1](open-questions/pf-1.md)
- [PF-2](open-questions/pf-2.md)
- [BT-1](open-questions/bt-1.md)
- [RB-3](open-questions/rb-3.md)
- [RB-3b](open-questions/rb-3b.md)
- [UC-2](open-questions/uc-2.md)
- [FT-1](open-questions/ft-1.md)
- [VM-3](open-questions/vm-3.md)
- [MC-1d](open-questions/mc-1d.md)
- [PH-1](open-questions/ph-1.md)
- [MC-1e](open-questions/mc-1e.md)
- [PK-2](open-questions/pk-2.md)
- [VM-4](open-questions/vm-4.md)
- [OP-1](open-questions/op-1.md)
- [PK-1: A Pocket export as a call's transcript (Nov 17)](open-questions/pk-1.md)
- [EV-1: A Dev mark on the dev site (Nov 17)](open-questions/ev-1.md)
- [RQ-1: Needed fields asked before DevOps refuses, and Break down from a call (Nov 17)](open-questions/rq-1.md)
- [NT-1](open-questions/nt-1.md)
- [DY-1](open-questions/dy-1.md)
- [ID-1](open-questions/id-1.md)
- [MC-2: Calls, review any call you were on (Nov 17)](open-questions/mc-2.md)
- [DP-3](open-questions/dp-3.md)
- [DD-1: The dev deploy's check looks for the dev site's title (Nov 18)](open-questions/dd-1.md)
- [MC-3: Calls is a tab (Nov 17)](open-questions/mc-3.md)
- [PH-2](open-questions/ph-2.md)
- [SA-2: One way to draw a setting, one name per setting (Nov 18)](open-questions/sa-2.md)
- [SA-3: Settings regrouped: eleven sections, Reminders and notices in one place (Nov 18)](open-questions/sa-3.md)
- [SA-4: Admin as its own place, a list of clients, a page for each (Nov 18)](open-questions/sa-4.md)
- [MC-2b: Your Pocket recordings in Calls (Nov 18)](open-questions/mc-2b.md)
- [WK-6: Meetings named on the day in focus, a call's state on its meeting, no call chips (Nov 18)](open-questions/wk-6.md)
- [VM-5: A Stop before the day (Nov 18)](open-questions/vm-5.md)
- [CO-1: Ask to collaborate: pick your own time and check who is free (Nov 18)](open-questions/co-1.md)
- [MC-4: Calls you can scan, hide and close (Nov 18)](open-questions/mc-4.md)
- [PK-4: Your Pocket recordings, found by themselves and counted as yours (Nov 18)](open-questions/pk-4.md)
- [MC-5: Calls made scannable, a call's page with less to read, Add a call from Pocket (Nov 18)](open-questions/mc-5.md)
- [MC-2c: Calls started in a client's chat (Nov 18)](open-questions/mc-2c.md)
- [SA-5: Settings search that finds things, and all of Settings on the phone (Nov 18)](open-questions/sa-5.md)
- [UC-3](open-questions/uc-3.md)
- [VM-6: Azure refusing the VM's state (Nov 18)](open-questions/vm-6.md)
- [VM-7: a refused Azure answer's three facts (Nov 18)](open-questions/vm-7.md)
- [MC-6: Calls polish after the redesign, and a chat call keeps its chat's client (Nov 18)](open-questions/mc-6.md)
