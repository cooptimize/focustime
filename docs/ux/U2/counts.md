# U2 counts beside U1

Same demo day as U1: a throwaway demo-mode server with fictional data and the clock at Mon Nov 2, 9:30 AM. The day was planned through the app's own actions: 4 picks in the morning (one done, one a follow-up) and 4 in the afternoon (one an intention), then committed. Both blocks are at risk. Two follow-ups are due (one overdue).

The count script is U1's, with two changes:

- An element hidden by its parent's opacity no longer counts. These are the "+ time" and ⋯ controls that show only on hover. U1 had no such controls on Today, so U1's numbers stand as they were.
- Names in the attention line and the Close out item links count as titles, the same way U1 treated follow-up "who" text.

What is counted is unchanged: UI words cover the whole page including the status bar and excluding the top bar. Titles are counted separately. The mode switch counts as UI.

Script: `demo-shots.mjs` from U1, plus `--now`, `--only` and `--tag`. Raw numbers are in `screens/after/metrics-*.json`.

## 1920x1080 dark, demo, 9:30 AM

| Screen | UI words U1 → U2 | Title words U1 → U2 | Elements U1 → U2 | Buttons U1 → U2 | Text styles U1 → U2 | Colors U1 → U2 | Scroll U1 → U2 |
|---|---|---|---|---|---|---|---|
| Today › Now | 157 → **72** | 78 → 78 | 87 → 59 | 66 → 30 | 22 → 27 | 29 → 26 | none → none |
| Check-in | 348 → **103** | 71 → 37 | 77 → 39 | 56 → 25 | 19 → 23 | 19 → 22 | 1 page more → none |
| Close out | 330 → **105** | 69 → 52 | 86 → 54 | 69 → 35 | 22 → 26 | 17 → 24 | 1.5 pages more → none |

- Now's target was "about 60" UI words (U1 report). The guard is 80 or fewer, checked by `e2e/today.test.ts`. The result is 72, and 7 of those are the status bar.
  - The VM prompt adds 5 words: the demo VM is stopped, so "VM is off · Start · Not today" shows.
  - Without the VM prompt, Now is 67.
- Text styles went up on all three screens. The new pieces bring their own sizes: the attention chip, the next pick's bold title, the `#id` cue, This week's label and the numbers line. That is the main open item for the designer pass.
- Check-in and Close out are no longer pages, so neither scrolls on the demo day.

## Check-in and Close out at 1:05 PM (the mockups' time)

| Screen | UI words | Title words | Elements |
|---|---|---|---|
| Check-in | 99 | 37 | 40 |
| Close out | 105 | 52 | 54 |

## 3840x1600 dark, demo, 9:30 AM

| Screen | UI words U1 → U2 | Title words U1 → U2 | Elements U1 → U2 |
|---|---|---|---|
| Today › Now | 155 → 111 | 78 → 92 | 86 → 60 |
| Check-in | 346 → 142 | 71 → 51 | 76 → 40 |
| Close out | 328 → 105 | 69 → 52 | 85 → 54 |

The 3840 numbers include the day timeline, which adds:

- hour labels;
- "Free · 1h 30m" on each gap;
- the timeline's one-line help.

Now at 3840 now uses the full width (timeline, two cards), where U1 used the middle 42%.

## Failed source (Google cached, network cause), 1920 dark

`screens/after/1920-dark-now-failed.png`: the attention line gains one chip ("Google · showing data from … · Retry"). The status bar grows as before, which was out of scope.

## Clicks for the Today jobs (demo, from opening Today › Now)

| Job | U1 | U2 | Note |
|---|---|---|---|
| Start focus on what's next | 1 | 1 | Now only on the next pick, not 9 targets |
| See why a block is at risk | hover (tooltip) | 0 | The reason is on the pill |
| Tick a pick done | 1 | 1 | |
| Open a pick in DevOps | 1 (no cue) | 1 | The title is a link with its `#id` |
| See who is owed a follow-up today | 0 | 0 | Names are in the chip; 1 more click opens the rows |
| Close a due follow-up | 2 (Inbox, Close the loop) | 3 (chip, row, Close the loop) or 2 from Close out | |
| Timebox a pick into a gap | 2 (+ time, gap) | 2 at 1920 (hover, + time, gap); 1 drag at 3840 | |
| Check-in: move a pick that no longer fits | 2 (Check-in, Move to …) | 2 (Check-in, the one suggested move) | |
| Check-in: make it up tonight | 3 (Check-in, I'll make it up…, Tonight) | 2 when it is the suggestion, else 4 through ⋯ | |
| Check-in: add walk-on work | 4 | 4 (Check-in, + Add walk-on work, item, Add) | |
| Close out: write a resume note | 2 + typing | 2 + typing | |
| Close out: Mark done in DevOps | 2 + preview | 2 + preview | |
| Close out: carry a not-done pick to tomorrow | 2 (Close out, Move to Tue) | 2 (Close out, → Tue) | |
| Close out: close the day | 2 | 2 | Then the reverse unroll, unchanged |
| Week: change the hours shown | 1 (status bar) | 2 (Week ⋯, choose) or H | Moved off the status bar on purpose |
