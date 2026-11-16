# PF-1: after (feat/pf1-split, Nov 16)

The same two scripts as `before.md`: `node scripts/first-download.ts` and `node scripts/first-screen-times.ts`
(ten runs each, the middle value).

## The first download

| | Before | After |
|---|---|---|
| Script the first screen needs | 1,767.8 kB (520.6 kB gzip) | 1,070.3 kB (326.2 kB gzip) |
| Styles the first screen needs | 479.7 kB (84.5 kB gzip) | 475.5 kB (83.8 kB gzip) |
| Files asked for before the first screen | 10 | 8 |

| File | Raw | Gzip |
|---|---|---|
| `index.html` | 2.8 kB | 1.0 kB |
| `prefs.js` | 1.1 kB | 0.6 kB |
| `assets/index-DKfBlOf3.js` | 0.4 kB | 0.3 kB |
| `assets/boot-CFijIu3R.js` | 2.2 kB | 1.1 kB |
| `assets/index-CwaHRmsU.css` | 3.2 kB | 1.0 kB |
| `assets/rolldown-runtime-XKyaHtl9.js` | 0.7 kB | 0.4 kB |
| `assets/main-DUCla-HX.js` | 1065.8 kB | 323.9 kB |
| `assets/main-BL6sGALv.css` | 472.3 kB | 82.7 kB |

`main` is now one script: Day, Week, the block panel, the top bar, the menus and keys. The styles are as they were
but for the Inbox's own file, which travels with the Inbox: `ui/styles.css` is not reorganized in this step.

## Every file the build writes

| File | Raw | Gzip |
|---|---|---|
| `assets/main-DUCla-HX.js` | 1065.8 kB | 323.9 kB |
| `assets/TechDocs-CMx_fx-T.js` | 488.8 kB | 121.1 kB |
| `assets/main-BL6sGALv.css` | 472.3 kB | 82.7 kB |
| `assets/Settings-CFKGbYn1.js` | 238.1 kB | 61.3 kB |
| `assets/Ahead-C9w1eFBP.js` | 127.3 kB | 39.5 kB |
| `assets/guide-text-BobZBEHn.js` | 105.1 kB | 36.2 kB |
| `assets/Code-BZBZr0fh.js` | 94.6 kB | 31.8 kB |
| `assets/global.esm-DN_YoG7n.js` | 58.6 kB | 19.7 kB |
| `assets/InboxPage-Dq92jpc4.js` | 55.2 kB | 15.6 kB |
| `assets/Status-B9RVKbSD.js` | 43.1 kB | 11.8 kB |
| `assets/shared-qYJ93fh2.js` | 39.0 kB | 12.8 kB |
| `assets/StoryCard-UF4pSPJA.js` | 29.8 kB | 8.7 kB |
| `assets/TechDocs-CEL19oWY.css` | 28.8 kB | 4.2 kB |
| `assets/ibm-plex-sans-latin-600-normal-CuJfVYMP.woff2` | 24.3 kB | 24.2 kB |
| `assets/ibm-plex-sans-latin-500-normal-6ng42L7E.woff2` | 24.2 kB | 24.2 kB |
| `assets/guide-text-CObx9j0J.css` | 24.0 kB | 5.1 kB |
| `assets/ibm-plex-sans-latin-400-normal-CDDApCn2.woff2` | 22.6 kB | 22.6 kB |
| `assets/Guide-HVnnxKPb.js` | 22.6 kB | 6.4 kB |
| `assets/Capture-Dug3vHvD.js` | 19.4 kB | 5.9 kB |
| `assets/Assistant-D66gR1J8.js` | 19.1 kB | 6.0 kB |
| `assets/Code-X1vF-Qiw.css` | 17.2 kB | 3.6 kB |
| `assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2` | 14.9 kB | 14.9 kB |
| `assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2` | 14.7 kB | 14.7 kB |
| `icons/focustime-512.png` | 11.4 kB | 10.1 kB |
| `assets/NewItem-D0mKYu6Y.js` | 11.0 kB | 4.1 kB |
| `assets/CloseOut-TkflIkLd.js` | 10.1 kB | 3.6 kB |
| `assets/Tour-D3oPMg9D.js` | 8.8 kB | 3.1 kB |
| `assets/DraftEditor-CakAElW_.js` | 7.1 kB | 2.6 kB |
| `icons/focustime-maskable-512.png` | 5.4 kB | 3.7 kB |
| `assets/Checkin-dg2bTJ0H.js` | 4.8 kB | 2.1 kB |
| `assets/FocusScreen-1J81fcyt.js` | 4.4 kB | 1.6 kB |
| `assets/InboxPage-Dvm5tFjf.css` | 4.4 kB | 1.2 kB |
| `icons/focustime-192.png` | 4.0 kB | 3.8 kB |
| `legal.html` | 3.7 kB | 1.7 kB |
| `assets/index-CwaHRmsU.css` | 3.2 kB | 1.0 kB |
| `index.html` | 2.8 kB | 1.0 kB |
| `assets/boot-CFijIu3R.js` | 2.2 kB | 1.1 kB |
| `icons/apple-touch-icon.png` | 2.0 kB | 1.7 kB |
| `legal.css` | 1.2 kB | 0.6 kB |
| `prefs.js` | 1.1 kB | 0.6 kB |
| `assets/focustime-32-CBZeTrvn.png` | 0.9 kB | 0.9 kB |
| `assets/favicon-C9k58aOu.svg` | 0.8 kB | 0.3 kB |
| `assets/rolldown-runtime-XKyaHtl9.js` | 0.7 kB | 0.4 kB |
| `manifest.webmanifest` | 0.6 kB | 0.3 kB |
| `assets/index-DKfBlOf3.js` | 0.4 kB | 0.3 kB |

Each screen is its own file. `shared` is what two or more screens use and `main` doesn't hold; `guide-text` is the
Guide's words, used by the Guide, its tours and the Technical docs. No module is in two files.

## What the first download's script is made of

Bytes before minifying, largest first:

| Part | Bytes before minifying | Share |
|---|---|---|
| `node_modules/react-dom` | 536.7 kB | 26.9 |
| `plan/` | 147.2 kB | 7.4 |
| `ui/App.tsx` | 131.2 kB | 6.6 |
| `ui/menu.ts` | 92.1 kB | 4.6 |
| `actions/` | 73.5 kB | 3.7 |
| `node_modules/lucide-react` | 55.5 kB | 2.8 |
| `ui/Account.tsx` | 52.3 kB | 2.6 |
| `ui/BlockPanel.tsx` | 50.4 kB | 2.5 |
| `ui/BreakDownPanel.tsx` | 50.1 kB | 2.5 |
| `ui/Day.tsx` | 37.2 kB | 1.9 |
| `ui/Timeboxes.tsx` | 36.3 kB | 1.8 |
| `ui/DayTimeline.tsx` | 33.2 kB | 1.7 |
| `ui/WeekGrid.tsx` | 31.5 kB | 1.6 |
| `ui/BlockCard.tsx` | 28.8 kB | 1.4 |
| `ui/DevOpsWrite.tsx` | 28.7 kB | 1.4 |
| `ui/Team.tsx` | 27.8 kB | 1.4 |
| `ui/meetings/` | 26.8 kB | 1.3 |
| `ui/WrapUp.tsx` | 25.2 kB | 1.3 |
| `ui/Setup.tsx` | 23.3 kB | 1.2 |
| `ui/SendLoop.tsx` | 22.7 kB | 1.1 |
| `ui/nav.ts` | 21.0 kB | 1.1 |
| `ui/FollowUps.tsx` | 17.4 kB | 0.9 |
| `node_modules/react` | 17.2 kB | 0.9 |
| `config/` | 16.3 kB | 0.8 |
| `ui/Menus.tsx` | 16.3 kB | 0.8 |

## Times in a browser

The same setup as before: a 1440 by 900 window on the demo, a new session and an empty cache each run; slowed is
the processor four times slower, 1.6 Mbit/s down, 750 kbit/s up, 150 ms each way; files sent uncompressed.

"Pressed at once" is each tab's key pressed the moment the screen before it showed, starting the moment the app
opened: the worst case, where the tab's file is still being fetched. "Once Day has been looked at" is the same keys
after the background fetching has gone quiet (two seconds with no file in flight).

### Unslowed

| | Before | After, pressed at once | After, pressed once Day has been looked at |
|---|---|---|---|
| First screen usable | 216 ms | 200 ms | 198 ms |
| Week | 44 ms | 54 ms | 44 ms |
| Backlog | 82 ms | 90 ms | 82 ms |
| Status | 16 ms | 35 ms | 18 ms |
| Inbox | 16 ms | 36 ms | 16 ms |
| Code | 794 ms | 26 ms | 14 ms |

### Slowed

| | Before | After, pressed at once | After, pressed once Day has been looked at |
|---|---|---|---|
| First screen usable | 13.4 s | 9.9 s | 9.9 s |
| Week | 139 ms | 142 ms | 132 ms |
| Backlog | 50 ms | 832 ms | 48 ms |
| Status | 34 ms | 796 ms | 35 ms |
| Inbox | 36 ms | 1.3 s | 36 ms |
| Code | 1.3 s | 802 ms | 45 ms |

What the numbers say:

- The first screen is usable about 3.5 s sooner on the slowed connection (13.4 s to 9.9 s). Unslowed it was already
  under a quarter of a second and still is.
- A tab pressed the instant the app opens on the slowed connection now waits for its file: about 0.8 to 1.3 s,
  where it was under 0.2 s (Code is faster than before: it used to load on demand with nothing fetched ahead). The
  screen before it stays and the top bar says Loading.
- Once the background fetching has finished, every tab shows as fast as before.
- The styles are now nearly a third of the first download and the largest thing left to cut.
