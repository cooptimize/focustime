# PH-1: everything the phone can reach, before and after

STEP 0.3's list. Each row is something the phone could reach on main before PH-1, where it was, and where it is
after PH-1. Nothing becomes unreachable: a row with no other home is under More › Everything else. "Another day"
means Day for a date other than today (`#/day/<date>`), reached from Week; it is unchanged by PH-1 and keeps its
header (the day arrows, Cards or Timeline, Timebox my day, Add and the Day menu).

## The bottom bar

| Was | Is now |
|---|---|
| Day | Day (the bar's first item, the same address `#/day`) |
| Week | Week (unchanged screen) |
| Capture (the raised +) | Capture (unchanged sheet) |
| Inbox, with its count | Inbox, with the same count (the same screen) |
| Ask | Ask in the top bar (the same assistant) |

## The top bar

| Was | Is now |
|---|---|
| The mark and FocusTime (opens Day) | Today's date at the left; Day is the bar's first item |
| Demo | Demo, where the demo shows it |
| The sources' status dot (opens the sources sheet) | More › Everything else › Sources (the same sheet); a dot on More's bar item when a source needs attention |
| ⋯ (the More menu) | More, the bar's last item, a full screen |

## The More menu (⋯)

| Was | Is now |
|---|---|
| The person (Settings, Sign out or Sign in) | More › Everything else › the person's name (the same menu) |
| Status, with "N to update" | More › Status, "N features need your update" |
| Notifications, with "N new" | More › Everything else › Notifications |
| Start focus (the start menu) or Focus screen | The Now card's Start focus for the to-do; More › Everything else › Focus (the same start menu, or the focus screen while one runs) |
| Settings | More › Settings |
| Admin (admins) | More › Everything else › Admin |
| Guide | More › Guide |
| Technical docs | More › Everything else › Technical docs |
| Code (when Code is for me) | More › Code |
| Install app (when the browser can) | More › Everything else › Install app |
| About | More › Everything else › About |

## The sources' sheet (unchanged, opened from More › Everything else › Sources)

Each source with its state and age, DevOps per client, Retry, Connect or Reconnect, the VM chip, the "N personal
hidden" switch, Refresh and Settings for Disconnect.

## Today on the phone (`#/day`)

| Was | Is now |
|---|---|
| ‹ › previous and next day | Week (its day bar), then another day, which keeps them |
| The date and Today | The date in the top bar |
| PTO or Holiday pill | Day says "You're off today", as before |
| Cards or Timeline | Another day's ⋯ (the phone's setting, TY-1, so today follows it); with the timeline on, today's Day keeps its header under the Now card, Next and the one thing |
| Timebox my day | Another day keeps it; today's header while the phone's timeline is on; the desktop version |
| + Add (the header) | Add on each of today's blocks under Today, and on the Now card when its block has nothing planned |
| ⋯ Day: Personal events | Settings › Display (Personal events); another day's ⋯ |
| ⋯ Day: Suggestions on or off | Another day's ⋯ (a compromise, open questions) |
| ⋯ Day: Timeline | As Cards or Timeline above; with it on, today's ⋯ is back too |
| The day's suggestions line (SG-1) | Another day keeps it; the suggestions in an empty block stay under Today |
| The Now card: the block, until when, time left | The Now card (larger), with the block's bar |
| The Now card: the meeting under way or next | One line on the Now card, and Next |
| The Now card: Start, Done | Start focus, and the Done box beside the to-do |
| The Now card while focusing: the countdown (opens the focus screen), Done, +15 | The countdown (opens the focus screen), Done and Stop; +15 is on the focus screen |
| A live call in the client's chat, with Join (CW-1) | The Now card, unchanged |
| Needs you: the urgent strip (3 lines and "N more in Inbox") | The one thing that needs you, "1 of N", then the Inbox |
| The chips: promises due, From chats · N | The bar's Inbox, where they are listed |
| The chip for a source that needs a fix | The dot on More, then Sources |
| The VM's morning prompt (Start, Not today) | The top of Day, unchanged |
| The moment card: Plan today | Add on each block under Today; Week's Plan today |
| The moment card: Midday check-in | More › Everything else › Midday check-in |
| The moment card: Wrap up the day (Close out) | The Now card after the day; More › Everything else › Close out |
| The setup line ("Finish setting up") | More › Settings › Setup |
| To-dos by block: tick, the to-do's sheet, Add, suggestions | Today, under the Now card, unchanged |
| Next up (the rest of today's meetings and blocks) | Next: the next meeting and the next block; the rest on Week |
| Promises due (with Timeline on) | Inbox › Promises |
| Weekend, PTO, holiday, catch-up day, nothing scheduled | The same words, unchanged |

## Other places the phone reaches, unchanged

Week, the Inbox, Backlog's notice and Open anyway, Status, Code, Settings, the Guide, Technical docs, Client calls
(`#/meetings`), a story's card, the focus screen, Capture and the assistant open as before; only how they are reached
changed, as above.

## STEP 0.2, 0.4 and 0.5

- **Open pull requests (0.2):** none was open when PH-1 began its tests; VM-3's and MC-1d's had merged (MC-1d as #175). More's Client calls opens the client calls screen MC-1d left (`#/meetings`).
- **Changing the viewport after load (0.4).** Read: MDN's viewport meta (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport), Apple's Using the Viewport (https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/UsingtheViewport/UsingtheViewport.html), WebKit's Designing websites for iPhone X (https://webkit.org/blog/7929/designing-websites-for-iphone-x/), MDN `env()` (https://developer.mozilla.org/en-US/docs/Web/CSS/env), MDN VisualViewport (https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) and Chrome's viewport resize note (https://developer.chrome.com/blog/viewport-resize-behavior/). Each describes the viewport meta as the page loads (`width`, `initial-scale`, `viewport-fit=cover`) and the bottom safe area as `env(safe-area-inset-bottom)` with `viewport-fit=cover`; none describes changing the meta after load, or what an installed app does with it. So the reliable way is the one each documents: decide the viewport before the first paint. `public/prefs.js` reads the stored choice and writes the meta before anything draws, and switching saves and reloads. Only where storage is refused is the meta changed in place (it works in Chromium; untested on devices, `docs/open-questions.md`).
- **The first download (0.5).** Before PH-1 the first screen's script was 326.8 kB and its styles 83.8 kB gzipped, under PF-1's limit of 337 kB and 87 kB. After, with main's MC-1d merged: 332.0 kB and 84.5 kB for every device, plus the phone's own file on a phone only (4.4 kB of script, 2.4 kB of styles). The limit isn't raised.
