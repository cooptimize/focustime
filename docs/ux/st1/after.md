# ST-1: Status, before and after

Measured on the demo (a fictional person and fictional features, Thursday Nov 5, 2026 10:00 AM ET, dark) by `e2e/shot-scripts/st1-shots.ts`, before on main at `be816c48` and after on this branch, both with the same script. Words are what is on screen inside Status (the top bar left out). "With lines" is the same three actions on both: one suggestion used (main: Use; after: Add), one line typed, one Draft (after: Suggest a line). The distance is from the last line that will be pushed, scrolled into view, to the button that pushes it, at 1440 by 900.

## Counts

| | Before (main) | After (ST-1) |
|---|---|---|
| Words on screen as Status opens | 470 (all five features) | 273 (it opens on Needs an update: three of the five features; "with the three lines in" below is all five) |
| Words with the three lines in | 492 | 473 |
| Words in Preview with the lines in | 262 (lines not pushed drawn in italics) | 163 (only what is On the report) |
| Sentences of help or explanation as it opens | 5: the two under the header ("What Monday's report will show…", "Add your own lines here; Kat sends the email, not FocusTime."), and "You worked on this since Kat's last send and haven't added a line yet." under each of three clients | 0 (the key is three names with a few words each). Kept because something is wrong or a choice needs it: the read-only line and AI-off's line, as before |
| Facts said more than once as it opens | "Kat last sent <client>'s report Mon, Nov 2, 7:0x AM" on each of four clients; "N features need your update" in the count and again as each client's label | Kat's time once per client, on the name's hover; the count once, on the Needs an update chip |
| Times a feature says it has no update (visible, as it opens) | 3 ("No update yet" chips), plus a "You worked on this" chip beside each | 2 ("· nothing yet" in On Monday's report, on the features shown); one tag, "Needs an update", where it needs mine |
| Distance from a line to be pushed to its Push | 876 px (Push all in the bar at the top) | 610 px (Push to DevOps in the bar at the foot), under the window's 900 |

## Every kind of text under a feature (STEP 0.3)

The rule is `stateOf` in `ui/status-states.ts`; `ui/status-states.test.ts` has this table as its tests.

| What it is | Where it comes from | In DevOps? | Would Push send it? | Before: drawn as, words | After: state, drawn as, words |
|---|---|---|---|---|---|
| A comment of mine | DevOps, in the window | Yes | No | blue left edge, "You · Tue, Nov 3, 9:17 AM", Edit, Delete, click to edit | **On the report**: a bullet, "· Alex Rivera, Tue", Edit, Delete |
| A comment of someone else's | DevOps, in the window | Yes | No | grey left edge, "Priya Shah · Wed, Nov 4, 4:01 AM" | **On the report**: a bullet, "· Priya Shah, Wed" |
| A Coop update | DevOps, in the window | Yes | No | dashed grey edge, "Alex Rivera · Coop · Tue…" | **On the report**: a bullet, "· Alex Rivera, Tue" (its "[Coop update v1]" text says it is Coop's) |
| A suggestion from the AI | `status.suggest`, for a feature I worked on | No | No | a grey card, "AI SUGGESTS", Use, Edit, Dismiss | **Suggested**: a dashed blue box, "SUGGESTED", Add, Edit, Dismiss, "Based on 2 things you worked on" |
| A suggestion made without AI | `status.suggest`'s plain line, AI off | No | No | a grey card, "SUGGESTED LINE", Use, Edit, Dismiss | **Suggested**: the same box and words |
| A Draft (now Suggest a line, Suggest for all) | `status.draft` | No | **Before: yes**, it went among the lines to push | a pending line with a dashed amber edge, "Suggested, not pushed yet", Remove | **Suggested**: the same box as a suggestion; Push never sends it until Add |
| A used suggestion | Use (now Add) | No | Yes | a pending line, dashed amber edge, "Suggested, not pushed yet", Remove | **Ready to push**: a solid amber edge, "Ready to push", Remove |
| A typed line | Add a line (now Write a line) | No | Yes | a pending line, dashed blue edge, "Not pushed yet", Remove | **Ready to push**: a solid amber edge, "Ready to push", Remove |
| A Draft's line kept in the browser from before ST-1 | localStorage | No | Yes | as a Draft, above | **Ready to push** (it was among the lines to push, and still is) |
| An edit of my comment | Edit | Not this text | Yes | the comment's text replaced, "Edited, not pushed yet", Undo edit | **Ready to push**: in Not on it yet, "Ready to push · Edit of your line", Remove; the bullet keeps DevOps' text |
| A delete of my comment | Delete | Yes, until pushed | Yes | the comment struck through, "Deleted when you push", Keep it | **Ready to push**: in Not on it yet, struck through, "Ready to push · Deletes your line", Keep it |
| A line being pushed | Push's preview open | No | In the preview | unchanged under the preview | **Ready to push**, unchanged under the preview |
| A pushed line | Confirm in the preview | Yes | No | "Pushed just now": "Comment added in DevOps", Undo | **On the report**: in its feature as a bullet, and in Pushed just now "On the report", Undo |
| A line that failed to push | DevOps refused or didn't read back | No | Yes (Retry) | "Pushed just now": the reason in red, Retry; the line stays pending | **Ready to push**: stays in Not on it yet; Pushed just now "Ready to push · Didn't push: <why>", Retry |
| Last week's lines | DevOps, last week's window | Yes (last week's report) | No | folded "Last week (1)" | **On the report** (last week's): a bullet with author and day, behind "See last week's lines" |

## Every control and state on Status (STEP 0.4)

Checked in the browser on the demo by `e2e/status/three-states.test.ts` ("every control and state on main is still reachable") and the other tests in `e2e/status/`.

| On main | When it shows | Where it is now |
|---|---|---|
| Edit · Preview | always, unless read only | Write · Preview, the same place |
| My features · <Client> report | when I'm on a client's team | unchanged |
| The sentence under the header | always | gone (help that only explains the page) |
| The count line "5 features · 2 with an update · 3 without · N features need your update" | always | the Show row: "2 of 5 features have an update" with a bar, the Needs an update chip's count |
| "N lines to push" and Push all, in the bar at the top | always (Push all disabled with none) | the foot bar, only while something is Ready to push: "N lines ready to push · <client> N", Push to DevOps |
| OP-1's "11 lines go in 2 previews, 10 at most in each." | more than one preview | the foot bar |
| Refresh and "Refreshed …" (client report) | the client report | a row under the switch, the same words |
| Pushed just now: per-line result, Retry, Undo, Hide | after a push | unchanged; each row names its state |
| A client's head: name, Draft all | per client | name (Kat's last send on hover), "1 of 2 updated", Suggest for all, Add all (two or more suggestions) |
| "Kat last sent <client>'s report …" | per client | the client name's hover |
| "Needs your update" label and its sentence | a client with features I worked on | the Needs an update tag on each feature, and the Show row's chip |
| The suggestions' note: AI off, or another client's name removed | per client | AI off: the same one line under the client; a name removed: one line inside that suggestion |
| Draft's note (failed, nothing to draft from) | after Draft | the same line, "Nothing to suggest from: …" |
| "Read only: add your DevOps write access …" | no write access | unchanged |
| A feature's chips: "You worked on this", "N updates" / "No update yet" | per feature | "Needs an update" (one tag); "On Monday's report · N lines" or "· nothing yet" |
| "1 story · your to-dos" under the head | a feature I worked on | the tag's hover |
| Click my comment's text to edit it | my comment, writable | Edit after the line |
| Edit, Delete on my comment | my comment | unchanged, after the author and day |
| "Edited, not pushed yet", Undo edit | an edit waiting | Not on it yet: "Ready to push · Edit of your line", Remove (and Cancel edit in its box) |
| "Deleted when you push", Keep it | a delete waiting | Not on it yet: "Ready to push · Deletes your line", Keep it |
| The suggestion: AI suggests / Suggested line, Use, Edit, Dismiss; "Writing a suggestion…" | a feature I worked on | Suggested: Add, Edit, Dismiss, Based on; "Writing a suggestion…" |
| A pending line: "Not pushed yet" / "Suggested, not pushed yet", Remove, click to edit | a line waiting | Ready to push: Remove, click to edit |
| A line's box: its keys line, "Shows as …", Remove / Cancel edit, GD-2's flag | while writing | unchanged |
| + Add a line (Tab to the next feature's) | writable | + Write a line (Tab the same) |
| Draft on a feature | AI on | Suggest a line |
| Remove from the report | a feature I added to a client report | unchanged |
| "What a draft uses (N)" fold, or "This week" with AI off or read only | a feature with activity | Based on N things you worked on, in the suggestion; else the fold "What you worked on (N)" |
| "Last week (N)" fold | a feature with last week's lines | See last week's lines, on the head |
| Also assigned to you (N), with its sentence | per client | the fold; the sentence on its hover |
| Add a feature (client report) | the client report | unchanged |
| No update yet (N), with its sentence (client report) | the client report | the fold; the sentence on its hover (under All) |
| Upcoming PTO and Holidays (client report) | the client report | unchanged (under All) |
| Preview: lines not pushed in italics, "you, not pushed yet" | lines waiting | not in the report; the top line "N lines aren't on the report yet", Show them (drawn as Ready to push), Push to DevOps |
| Preview: a feature with only lines waiting (client report) | lines waiting | only with Show them |
| `#/status/needs` (the nudge) | the dot's click | opens on Needs an update, at the first feature |
| The tab's dot, keys and addresses | | unchanged |
| Loading, errors, "No clients with DevOps this week." | | unchanged |

## Parts (STEP 0.6)

| New piece | The app's part it uses |
|---|---|
| Write · Preview | the segmented control Status had (`st-toggle`, `ms-btn`) |
| The Show row | MC-5's: a section label, the Inbox's chips (`ib4-chip`, `seg-count`), Calls' thin bar (`calls-left-bar`) |
| "On Monday's report", "Not on it yet" | section labels (`--fs-1`, uppercase, muted) |
| Add, Edit, Write a line, Suggest a line, Suggest for all, Add all, Push to DevOps | pill buttons (`mini`, `mini quiet`, `mini primary`) and quiet links (`link-btn`) |
| What you worked on, Also assigned to you, No update yet | the fold (`details`, `summary`) |
| The foot bar | the ticked-rows bar (`bl-bulk`, as Calls' `mtg-bulk`: sticky at the foot, above the bottom bar on the phone) |
| Undo | Pushed just now's Undo, as before |
| Needs an update | the watch-colored tag Status had (`st-badge`) |
| The key; the Ready to push edge; the Suggested box | no part before: the three states are new. Style guide section 14 says why |
