# PF-2: before (origin/main at 69bb0bce, Nov 16)

STEP 0 of PF-2, measured on main before any change. The same measurements after the change are in `after.md`.

## 1. Branch and pull request

No branch `perf/pf2-compress` and no PF-2 pull request existed; the branch was made from origin/main at 69bb0bce
(PF-1's merge).

## 2. Other open pull requests

None was open when this step started, so none touches `server/app.ts` or the service worker (`server/sw.js`,
`server/pwa.ts`).

## 3. What the hosted app sends today

Asked without signing in and without any secret, with `Accept-Encoding: gzip, br, zstd`
(`curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, br, zstd' <dev>/` and the same for one script under
`/assets/`; dev's address is in `docs/azure/runbook.md`):

| | The page (`/`) | A script (`/assets/index-DxLMOdDe.js`) |
|---|---|---|
| Status | 200 (HTTP/2) | 200 (HTTP/2) |
| `content-encoding` | none | none |
| `content-length` | none (sent in frames without a length) | none |
| `cache-control` | `no-store` | `public, max-age=31536000, immutable` |
| `vary` | none | none |
| Who answered | no `server` or `via` header: every header is the app's own (`server/app.ts`), passed through Container Apps' ingress unchanged | the same |

- Nothing in front of the app compresses. The ingress passes the app's answer as it is, and the app sends every file
  plain. The same with `Accept-Encoding: gzip` alone.
- A missing file under `/assets/` (`/assets/missing-XXXX.js`) answered 200 `text/html` with the page (2,532 bytes),
  the fault PF-1 found.
- `manifest.webmanifest` answered `cache-control: no-cache` with no `etag` and no `last-modified`: nothing to check
  against, so every check downloads it whole.
- The local demo (`server/main.ts` on a built dist, the server PF-1 measured) sends the same way: every file and every
  data answer plain (the tables below, "Sent as: plain"), the files' bytes on the wire equal to their raw sizes.

## 4. The documentation

- Azure Container Apps' ingress (the hosted app's front door):
  [Ingress overview](https://learn.microsoft.com/azure/container-apps/ingress-overview) and
  [Configure ingress](https://learn.microsoft.com/azure/container-apps/ingress-how-to). Neither describes any
  response compression or a setting for it; what the ingress does is TLS, routing, traffic splitting, session
  affinity, CORS and IP rules. Measured above: it passes the app's answer through as it is. Compression is the
  app's to do (or a CDN's or Front Door's, which this step doesn't add).
- Node's own compression: [zlib](https://nodejs.org/api/zlib.html) (Node 26 here). Brotli
  (`brotliCompress`, quality 0 to 11, `BROTLI_DEFAULT_QUALITY` 11), gzip (`gzip`, level 0 to 9, default 6) and
  Zstandard (`zstdCompress`, marked experimental). Every function but the `*Sync` ones runs on libuv's thread pool, so
  compressing an answer doesn't hold up other requests.
- Their cost, measured on this build's files (every text file of the build together, 3,036 kB, one core):

| | Time | Size |
|---|---|---|
| Brotli 5 | 49 ms | 750 kB |
| Brotli 9 | 153 ms | 723 kB |
| Brotli 11 | 3,078 ms | 668 kB |
| gzip 9 | 53 ms | 828 kB |
| Zstandard 19 | 574 ms | 704 kB |

  And for a data answer (a 1 MB file in Code, the largest answer the server can give: Code shows text files up to
  1 MB): Brotli 4 11 ms (1,003 kB to 300 kB), Brotli 5 17 ms (280 kB), gzip 6 17 ms (305 kB), gzip 1 8 ms (350 kB).
  For a 45 kB week-like answer every one of them takes a tenth of a millisecond.

## 5. Every kind of answer the server gives

### Files (the UI build, `dist/`)

| Type | Files | Raw | Largest | Brotli 9 | Compress? |
|---|---|---|---|---|---|
| `.js` | 24 | 2,476.9 kB | 1,067.6 kB (`main`) | 635.0 kB | yes (over 1 kB) |
| `.css` | 7 | 551.4 kB | 472.5 kB (`main`) | 85.3 kB | yes |
| `.woff2` (fonts) | 5 | 100.6 kB | 24.3 kB | 100.6 kB | no: compressed already |
| `.png` (icons) | 5 | 23.7 kB | 11.4 kB | 20.2 kB | no: compressed already |
| `.html` (the page, the legal page) | 2 | 6.3 kB | 3.7 kB | 2.3 kB | yes |
| `.svg` (the favicon) | 1 | 0.8 kB | 0.8 kB | 0.3 kB | no: under 1 kB |
| `.webmanifest` | 1 | 0.6 kB | 0.6 kB | 0.2 kB | no: under 1 kB |
| `/sw.js` (made by the server per build) | 1 | about 5 kB | | | yes |

None of these carries a token, a session, a key or anything about a person: they are the same for everyone.

### Data

Every data answer is JSON from `POST /api/action` (one action named per call). By action, on the demo, as the app
reads them opening each place in turn (`node scripts/data-sizes.ts`, which this step adds): the 20 largest, then the
rest under 1 kB.

| Action | Calls | Typical | Largest | Carries a secret? |
|---|---|---|---|---|
| `week.load` | 1 | 61.6 kB | 61.6 kB | no |
| `ahead.load` | 1 | 35.5 kB | 35.5 kB | no |
| `roadmap.load` | 1 | 22.6 kB | 22.6 kB | no |
| `code.kinds` | 1 | 22.3 kB | 22.3 kB | no (a client's file names: Code's rules) |
| `settings.load` | 1 | 7.9 kB | 7.9 kB | **yes**: where each secret's state is shown and set |
| `status.load` | 3 | 7.0 kB | 7.0 kB | no |
| `planday.start` | 1 | 6.0 kB | 6.0 kB | no |
| `inbox.list` | 1 | 5.3 kB | 5.3 kB | no |
| `roadmap.ahead` | 1 | 5.1 kB | 5.1 kB | no |
| `team.commit` | 3 | 4.5 kB | 4.5 kB | no |
| `followups.list` | 1 | 2.6 kB | 2.6 kB | no |
| `inbox.today` | 2 | 2.6 kB | 2.6 kB | no |
| `my_promises.list` | 1 | 2.3 kB | 2.3 kB | no |
| `weekplan.proposal` | 2 | 1.7 kB | 1.7 kB | no |
| `conversations.suggestions` | 1 | 1.6 kB | 1.6 kB | no |
| `people.photos` | 23 | 0.1 kB | 1.3 kB | no |
| `suggest.load` | 2 | 1.3 kB | 1.3 kB | no |
| `capture.load` | 1 | 1.2 kB | 1.2 kB | no |
| `item.card` (a story card) | 1 | 1.1 kB | 1.1 kB | no |
| `chats.calls` | 1 | 1.0 kB | 1.0 kB | no |
| `code.file`, `code.folder`, `code.clients`, `code.repos` | 2 to 3 | 0.1 to 0.7 kB | 0.8 kB | no (a client's code: Code's rules) |

On real data the reads grow with the person's work: the week, Backlog (`ahead.load`, a client's whole backlog),
Status, the Inbox's lists and Code's file (text files up to 1 MB) are the large ones. The Guide's and the Technical
docs' text are not data: they come with the app's files (`guide-text` and `TechDocs`, 105 kB and 506 kB).

Answers that carry a token, a session, a sign-in or sign-out step, a key or another secret, in the body or in a header
a script can read:

| Kind | Where |
|---|---|
| Sign-in and sign-out | every route under `/auth/` (redirects with state, the session and CSRF cookies; the demo's session; sign-out); `auth.*` actions (the sign-in address and its state, the account, connect steps) |
| A new session or a cleared one | any answer that sets a cookie (`/auth/demo`, `/auth/logout`, the 401 that clears cookies) |
| Push | `push.*` (the server's public key, this device's subscription) |
| DevOps write PATs | `devops.set_write_pat`, `devops.clear_write_pat`, `devops.write_status` |
| Calendar links | `calendar_link.*` (a private calendar address is a secret) |
| Settings | `settings.*` (each secret's state shown and set) |

Answers that are streamed: the Teams bot's endpoint (`/teams/messages`), answered by the Teams SDK with its own
token check; nothing else in the server writes an answer in pieces. Other answers that are neither files nor
`/api/action` data: `/healthz`, `/readyz`, `/version`, `/api/db-status`, `/api/activity`, `/api/open-request`,
push-to-talk (`/api/assistant/transcribe`), a transcript upload (`/api/meetings/upload`) and chat images
(`/media/chat-images/<id>`, already compressed images, behind the chat's member check).

## 6. Before: times and bytes

A 1440 by 900 window on the demo, a new session and an empty cache each run, ten runs, the middle value
(`node scripts/first-screen-times.ts`, as PF-1 ran it). Slowed is PF-1's: the processor four times slower,
1.6 Mbit/s down, 750 kbit/s up, 150 ms each way. Each tab's key pressed the moment the screen before it showed.

### Times, as PF-1 ran them

| | Unslowed | Slowed |
|---|---|---|
| First screen usable | 250 ms | 10.1 s |
| Week | 58 ms | 185 ms |
| Backlog | 99 ms | 838 ms |
| Status | 36 ms | 802 ms |
| Inbox | 38 ms | 1.3 s |
| Code | 31 ms | 814 ms |

### Times on a true first visit (`--first-visit`, added by this step)

PF-1's runs open the demo once before the timed load, which lets the service worker install. With `--first-visit`
the browser blocks service workers, so every file of the timed load comes from the server. The numbers came out the
same within noise: the slowed time is the download either way.

| | Unslowed | Slowed |
|---|---|---|
| First screen usable | 257 ms | 10.1 s |
| Week | 68 ms | 179 ms |
| Backlog | 134 ms | 841 ms |
| Status | 61 ms | 886 ms |
| Inbox | 40 ms | 1.1 s |
| Code | 36 ms | 813 ms |

### Bytes on the wire (`--bytes`, added by this step)

What the browser received from the server, headers included, as Chromium's network log reports it, three runs,
the middle value. Files and data apart. Each tab is counted once its screen and its data are in, after the files the
app fetches in the background have arrived (their own row), so each tab's row is what that tab itself asked for.

| | Files | Data |
|---|---|---|
| First screen usable | 1,630.3 kB | 112.1 kB |
| Background, after the first screen | 735.8 kB | 0.7 kB |
| Week | 0 | 11.1 kB |
| Backlog | 0 | 74.8 kB |
| Status | 0 | 8.5 kB |
| Inbox | 0 | 10.5 kB |
| Code | 0 | 11.4 kB |

The first screen's 1,630 kB is the page, its scripts and styles (1,548 kB raw, PF-1's `after.md`) and the fonts its
styles name, all plain.

## 7. The service worker

- It keeps the app shell only: at install it fetches every file of the build (`cache: "reload"`) and keeps them in one
  cache for the build, all or none (`addAll`). Its fetch handler never keeps anything; a shell file is answered from
  the cache, a page load goes to the network first.
- `addAll` refuses an answer that isn't 2xx, but keeps any 200: the page answered under a script's name (the fault in
  3) would be kept as that script for the whole release, and the installed app would fail to open that screen until
  the next release.
- A compressed answer changes nothing it keeps: the browser decodes it before the worker sees it, and the cache holds
  the decoded body with the answer's headers. An answer that says `Vary: Accept-Encoding` is still matched by its
  address, because the worker's own requests carry no `Accept-Encoding` the cache can compare (the browser adds it
  below the cache); PF-2 asks the cache to ignore Vary anyway, so a browser that did compare can't miss.
