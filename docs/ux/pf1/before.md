# PF-1: before (origin/main at db84596d, Nov 16)

How these were measured: `node scripts/first-download.ts` (a real build, sizes raw and gzip level 9) and
`node scripts/first-screen-times.ts` (a browser on the demo, ten runs each, the middle value). Both scripts are in the
repo, so the same numbers can be taken again; `after.md` beside this file is the same run after the split.

## Every file the build writes

| File | Raw | Gzip |
|---|---|---|
| `assets/main-Be9wJzqr.js` | 1607.2 kB | 464.1 kB |
| `assets/TechDocs-DXPJ-aku.js` | 488.9 kB | 121.1 kB |
| `assets/main-DDmOYiDF.css` | 476.5 kB | 83.5 kB |
| `assets/motion-kCDG_CB0.js` | 112.0 kB | 38.5 kB |
| `assets/Code-DZi-S3iH.js` | 94.5 kB | 31.8 kB |
| `assets/global.esm-DN_YoG7n.js` | 58.6 kB | 19.7 kB |
| `assets/CloseButton-CkUS-whh.js` | 41.5 kB | 14.7 kB |
| `assets/TechDocs-CEL19oWY.css` | 28.8 kB | 4.2 kB |
| `assets/ibm-plex-sans-latin-600-normal-CuJfVYMP.woff2` | 24.3 kB | 24.2 kB |
| `assets/ibm-plex-sans-latin-500-normal-6ng42L7E.woff2` | 24.2 kB | 24.2 kB |
| `assets/guide--d7dN-Qq.css` | 23.6 kB | 5.0 kB |
| `assets/Guide-DMJhfWfk.js` | 22.7 kB | 6.4 kB |
| `assets/ibm-plex-sans-latin-400-normal-CDDApCn2.woff2` | 22.6 kB | 22.6 kB |
| `assets/Code-X1vF-Qiw.css` | 17.2 kB | 3.6 kB |
| `assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2` | 14.9 kB | 14.9 kB |
| `assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2` | 14.7 kB | 14.7 kB |
| `icons/focustime-512.png` | 11.4 kB | 10.1 kB |
| `assets/Tour-DKd67W0H.js` | 8.9 kB | 3.1 kB |
| `icons/focustime-maskable-512.png` | 5.4 kB | 3.7 kB |
| `icons/focustime-192.png` | 4.0 kB | 3.8 kB |
| `legal.html` | 3.7 kB | 1.7 kB |
| `assets/pages-_kUyysHL.js` | 3.3 kB | 1.4 kB |
| `assets/index-CwaHRmsU.css` | 3.2 kB | 1.0 kB |
| `assets/index-D9WVB0Kw.js` | 2.6 kB | 1.3 kB |
| `index.html` | 2.5 kB | 0.9 kB |
| `assets/Search-B6o8fXIw.js` | 2.3 kB | 1.1 kB |
| `icons/apple-touch-icon.png` | 2.0 kB | 1.7 kB |
| `assets/guide-3ID6YB42.js` | 1.9 kB | 0.9 kB |
| `legal.css` | 1.2 kB | 0.6 kB |
| `prefs.js` | 1.1 kB | 0.6 kB |
| `assets/focustime-32-CBZeTrvn.png` | 0.9 kB | 0.9 kB |
| `assets/favicon-C9k58aOu.svg` | 0.8 kB | 0.3 kB |
| `manifest.webmanifest` | 0.6 kB | 0.3 kB |
| `assets/Search-D9ezil0e.css` | 0.4 kB | 0.2 kB |
| `assets/code-DObzLPZL.js` | 0.0 kB | 0.1 kB |

## What the first screen downloads before it can be used

| File | Raw | Gzip |
|---|---|---|
| `index.html` | 2.5 kB | 0.9 kB |
| `prefs.js` | 1.1 kB | 0.6 kB |
| `assets/index-D9WVB0Kw.js` | 2.6 kB | 1.3 kB |
| `assets/index-CwaHRmsU.css` | 3.2 kB | 1.0 kB |
| `assets/main-Be9wJzqr.js` | 1607.2 kB | 464.1 kB |
| `assets/main-DDmOYiDF.css` | 476.5 kB | 83.5 kB |
| `assets/CloseButton-CkUS-whh.js` | 41.5 kB | 14.7 kB |
| `assets/motion-kCDG_CB0.js` | 112.0 kB | 38.5 kB |
| `assets/pages-_kUyysHL.js` | 3.3 kB | 1.4 kB |
| `assets/code-DObzLPZL.js` | 0.0 kB | 0.1 kB |

Script 1,767.8 kB raw (520.6 kB gzip) and styles 479.7 kB raw (84.5 kB gzip), plus five fonts its styles name
(100.6 kB, fetched as text is drawn). The Temporal polyfill (`global.esm`, 58.6 kB) is fetched first on Safari only.
`motion`, `CloseButton` and `pages` are parts the main script shares with the Guide, Code and the Technical docs; the
first screen downloads them too. `motion` holds the Guide's whole text (`ui/guide/content.ts`), pulled in by the
two-word tour link on Day.

## What the first download's script is made of

The build's own report, by screen and library, largest first (bytes before minifying; the script is about half that
once minified):

| Part | Bytes before minifying | Share |
|---|---|---|
| `node_modules/react-dom` | 536.7 kB | 17.1% |
| `ui/settings/` | 264.2 kB | 8.4% |
| `plan/` | 202.5 kB | 6.4% |
| `ui/ahead/` | 195.9 kB | 6.2% |
| `ui/Settings.tsx` | 139.6 kB | 4.4% |
| `ui/App.tsx` | 129.8 kB | 4.1% |
| `ui/guide/` | 123.0 kB | 3.9% |
| `ui/menu.ts` | 92.1 kB | 2.9% |
| `ui/Status.tsx` | 75.4 kB | 2.4% |
| `actions/` | 73.5 kB | 2.3% |
| `ui/inbox/` | 65.5 kB | 2.1% |
| `node_modules/lucide-react` | 55.5 kB | 1.8% |
| `ui/Account.tsx` | 52.3 kB | 1.7% |
| `ui/BlockPanel.tsx` | 50.4 kB | 1.6% |
| `ui/BreakDownPanel.tsx` | 50.1 kB | 1.6% |
| `ui/Day.tsx` | 37.0 kB | 1.2% |
| `ui/Timeboxes.tsx` | 36.3 kB | 1.2% |
| `ui/Capture.tsx` | 36.0 kB | 1.1% |
| `ui/StoryCard.tsx` | 34.7 kB | 1.1% |
| `ui/Assistant.tsx` | 33.7 kB | 1.1% |
| `ui/DayTimeline.tsx` | 33.2 kB | 1.1% |
| `ui/WeekGrid.tsx` | 31.5 kB | 1.0% |
| `ui/BlockCard.tsx` | 28.8 kB | 0.9% |
| `ui/DevOpsWrite.tsx` | 28.7 kB | 0.9% |
| `ui/Team.tsx` | 27.8 kB | 0.9% |
| `ui/meetings/` | 26.8 kB | 0.9% |
| `ui/WrapUp.tsx` | 25.2 kB | 0.8% |
| `ui/Setup.tsx` | 23.3 kB | 0.7% |
| `ui/SendLoop.tsx` | 22.7 kB | 0.7% |
| `ui/NewItem.tsx` | 20.7 kB | 0.7% |

## Times in a browser

A 1440 by 900 window on the demo, a new session and an empty cache each run. "First screen usable" is from opening
the app to the loader gone and Day drawn. Each tab is its key pressed at once after the one before it showed, timed
until that tab's screen is drawn. Slowed is a mid-range phone on a slow connection: the processor four times slower,
1.6 Mbit/s down, 750 kbit/s up, 150 ms each way. The demo server is FocusTime's own server, which sends files uncompressed, so the
slowed time follows the raw sizes (whether anything in front of the hosted app compresses is an open question).

| | Unslowed | Slowed |
|---|---|---|
| First screen usable | 216 ms | 13430 ms |
| Week | 45 ms | 139 ms |
| Backlog | 82 ms | 50 ms |
| Status | 16 ms | 35 ms |
| Inbox | 16 ms | 37 ms |
| Code | 794 ms | 1312 ms |

Code already loads on demand, which is its 0.8 s and 1.3 s. Every other tab is in the first download, so it shows in
well under 0.2 s, and the price is the 13.4 s before anything can be used.

## A release while the app is open (STEP 0.6)

Checked on this build by answering the Guide's file with the page, as the server does for a file it no longer has.

- With the service worker in charge and not yet updated, the Guide's and Code's files come from its cache and open.
- Once the new release's worker has taken over (it deletes the old cache), or where there is no worker (a first
  visit, a browser without one), the request goes to the server. The server answers any file it doesn't have with
  the page itself, which isn't a script, so the load fails with "Failed to fetch dynamically imported module".
- Nothing catches that: the whole app goes blank (the page's root is empty) until the person reloads.

## Offline (STEP 0.7)

- The service worker keeps every file the build wrote, 35 here, in one cache named for the build
  (`focustime-shell-<sha>`): the page, every script and stylesheet, the fonts, the icons and the manifest. That
  includes the files that load on demand (the Guide, its tours, Code, the Technical docs). Never an API answer.
- So a screen that loads on demand opens offline today, even one never opened before, once the worker has installed.
- Offline, the app that is open stays on screen under "You're offline. FocusTime needs a connection." Reloaded
  offline, the shell opens and says "Nothing to show without a connection. Reload when you're back online.": no
  data is kept for offline use.
- Nothing found broken here.
