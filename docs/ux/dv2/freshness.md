# DV-2: how fresh each screen's DevOps items are

Checked against the code on Nov 11 (main at 5a82b152), before DV-2 changed anything. "The store" is DV-1's central
DevOps store (`devops_items`), which the poller fills; every screen reads the store, never DevOps.

## Worst cases before DV-2

1. **Ahead (Grid, Gantt, Readiness, Backlog) never rereads on its own.** It loads when it opens and when a FocusTime
   write moves `dw.version`. A change made in DevOps while Ahead is open shows only after leaving Ahead and coming back,
   or Ahead's own Refresh button. This is Aaron's case: make an epic in DevOps, come back to Ahead, it isn't there.
2. **Status and Inbox never reread on their own.** Status rereads only when Week's plan version moves (a send, a
   capture, Break down); Inbox only after a FocusTime action. The story card reads once when it opens.
3. **Week and Day lag up to about 6.5 minutes** while you watch: the store is up to date within about 1.5 minutes in
   working hours, but the page rereads it only every 5 minutes (or on focus, at most once a minute).
4. **Outside working hours, 10 minutes between checks** even while you are working: someone working late waits up to
   10 minutes for DevOps, then up to 5 more for the page.
5. **R works only on Week** (the Board and Plan; not Team, Today, Ahead, Status or Inbox). The status bar's Refresh is
   on every tab but rereads only the week load, so Ahead, Status and the Inbox don't show what it found. Neither says
   what happened.
6. **Nothing says why an item is missing.** The brief's guess that out-of-area items are never read is half right: the
   poller reads the whole project (`buildScopeWiql`, projects only), and the area scope is applied when a screen reads
   the store (`scopeFor`), so an out-of-area item is in the store but hidden (Ahead shows it only with "Show the whole
   project"). An item in a project the client isn't set up with is never read.

## Before

| Screen | On open | On window focus | On a timer | After a FocusTime write | On Refresh (R or the button) |
|---|---|---|---|---|---|
| Day (Today) | week load | week load, at most once a minute | every 5 min while visible (quiet) | yes (`onDone` → quiet week load) | status bar button: yes (forces a check, waits up to 8 s). R: no |
| Week's cards (Board, Plan) | week load | same as Day | same as Day | yes | yes, R and the button |
| Add work panel | from the week load | follows the week load | follows the week load | yes | follows the week load |
| Details panel (Your stories) | from the week load | follows the week load | follows the week load | yes | follows the week load |
| Story card | `item.card` once | never | never | yes (Wrap it up, its own edits) | never |
| Ahead › Grid, Gantt, Readiness, Backlog | `ahead.load` | **never** | **never** | yes (`dw.version`) | Ahead's own Refresh button only; R does nothing; the status bar's Refresh doesn't reach it |
| Status (the tab) | `status.report` | never | never | only when Week's plan version moves | its own Refresh button only |
| Week › Team | `team.view` | never | never | plan version | never |
| Inbox items linked to DevOps | `inbox.list` and the sources | never | never | after an Inbox action | never |
| Status bar's DevOps entry | from the week load ("Showing items from …" per client) | with the week load | with the week load | with the week load | with the week load |

**The poller** (DV-1, `actions/devops-poll.ts`, run by the scheduler's slow pass every 30 s):

| When | Interval per client | Delay from a change in DevOps to the store |
|---|---|---|
| In the client's followers' working hours | the Rule, 1 minute by default | about 1 to 1.5 minutes |
| Outside them, someone (anyone) using FocusTime | 10 minutes | up to about 10.5 minutes |
| Outside them, nobody using FocusTime | no checks (the database can pause, D431) | until the next start of hours or the next use |
| Slowed by DevOps | doubled per slow-down, up to 15 minutes; Retry-After holds even Refresh | up to 15 minutes |

## After DV-2

| Screen | On open | On window focus | On a timer | After a FocusTime write | On Refresh (R or the button) |
|---|---|---|---|---|---|
| Day (Today) | week load | week load, at most once a minute; the versions are asked again | **when a shown client's version moves** (asked every 30 s while visible), plus the 5-minute quiet load | yes | R and the button on every tab: forces a check of the clients on screen, says what it found, then rereads |
| Week's cards (Board, Plan, Team) | same | same | same as Day (Team too) | yes | same |
| Add work panel | from the week load | follows it | follows it | yes | follows it |
| Details panel | from the week load | follows it | follows it | yes | follows it |
| Story card | `item.card` | the versions | **when its client's version moves** (quiet) | yes | yes |
| Ahead › Grid, Gantt, Readiness, Backlog | `ahead.load` | the versions | **when a shown client's version moves** (quiet: no "Reading…", place kept, staged changes kept; an item I have staged that changed shows "Changed in DevOps just now") | yes | R and the button: the shared check, then Ahead rereads |
| Status | `status.report` | the versions | **when a shown client's version moves** (typed lines kept) | plan version | R and the button |
| Inbox items linked to DevOps | `inbox.list` | the versions | **when one of my clients' version moves** | after an action | R and the button |
| Status bar's DevOps entry | "DevOps checked 40s ago", per client on hover | refreshed | every 30 s from the versions answer | | the answer: "DevOps checked just now · 3 changes" |

**The poller after DV-2:**

| When | Interval per client | Delay from a change in DevOps to the screen |
|---|---|---|
| In working hours | the Rule, 1 minute by default | about 1.5 to 2 minutes (store, then the next 30 s versions ask) |
| Outside them, someone who follows this client using FocusTime | **the Rule (1 minute)** | about 1.5 to 2 minutes |
| Outside them, someone else using FocusTime | 10 minutes (unchanged) | up to about 11 minutes |
| Nobody using FocusTime | no checks (unchanged; the versions ask is a background call, so it never counts as use) | |
| Slowed by DevOps | unchanged (D588) | |
