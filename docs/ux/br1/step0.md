# BR-1 STEP 0 (Nov 15)

## 1. An earlier BR-1

There was none: no `feat/br1-loader` branch on origin or locally, and no pull request named BR-1. The branch and the worktree `~/Code/focustime-wt/br1-loader` were made from origin/main at 7fd1c59d.

## 2. Open pull requests on the same files

None. `gh pr list --state open` lists no open pull request at all, so none touches `ui/brand/`, `index.html` or the sign-in screen.

## 3. Every place Lumen or its beam is drawn or named

| Where | What | Lumen or only the week mark |
|---|---|---|
| `ui/brand/Brand.tsx` | `Lumen` (poses still, idle, bob), `LumenBody` (body, light bar, beam gradient), `LumenLoading` (Lumen at the ring's centre, the sweeping light), `Unroll` (the ring straightening into the week, Lumen hopping into Mon AM), `BentMark` (inlines mark-bent.svg), `Lockup` (inlines lockup-horizontal.svg) | Lumen (all six). `WeekMark` in the same file is the week mark only |
| `ui/brand/geometry.ts` | `LUMEN`, `RING`, `STAGE`, `SEGMENTS`, `bandPath`, `segmentAt`, `finalFade`, `lumenAt` (Lumen's hop), `UNROLL`, `WEEK_BOX` | Lumen and the unroll. `WEEK` is the week mark's own geometry |
| `ui/brand/Opening.tsx` | `Opening` (loader with LumenLoading, "Loading your week" and four source lines, then the unroll and the hop), `CloseReverse` (Close out's reverse and the "All done. See you tomorrow." moment, Lumen bobbing), `MomentOverlay` (the first launch's "Welcome to FocusTime. Here's your week."), `InlineMoment` (Lumen beside Settings' reconnect line) | Lumen |
| `ui/brand/opening.ts` | `openingAt` (timing), `sourceLines`, `sourceWord` (the loader's words), `allDone` (Close out's moment) | Words of the loader and the moment |
| `ui/brand/brand.css` | `--lime` and `--beam-blend` mapped in `.brand-svg`, `.lumen-beam` blend, Lumen's poses (`lumen-sway`, `lumen-glow`, `lumen-bob`, `lumen-settle`), `.loading-sweep`, the stage, `.brand-loading-text`, `.brand-moment-line`, `.brand-skip`, `.brand-empty` | Lumen |
| `ui/brand/highlight.test.ts` | `--mascot-highlight` only in `ui/brand/` | Lumen's token |
| `ui/brand/opening.test.ts` | source lines and the all-done moment | The loader's words |
| `ui/styles.css` | tokens `--mascot-highlight` and `--brand-beam-blend` in each of the four theme blocks; the brand comment | Lumen |
| `ui/App.tsx` | `Opening`, `MomentOverlay` (welcome), `CloseReverse` (closing), `sourceLines`, `allDone` | Lumen |
| `ui/Account.tsx` | `BentMark` on the sign-in screen | Lumen (mark-bent holds Lumen and its beam) |
| `ui/Settings.tsx` | `Lockup` in About; `InlineMoment` for "<Source> is connected again."; Reduce motion's hint "No opening or Close out animation; Lumen stays still." | Lumen (the lockup holds the bent mark with Lumen and its beam) |
| `ui/guide/StartHere.tsx` | `Unroll` as Start here's picture | Lumen (it hops into Mon AM) |
| `ui/guide/Guide.tsx` | `Lumen` still, 22 px, in the footer | Lumen |
| `ui/guide/tour/Tour.tsx` | `Lumen` idle, 26 px, on a tour's last card ("You're set") | Lumen |
| `ui/StyleGuide.tsx` | BentMark, Lockup, Lumen still, idle and bob, LumenLoading figures and the line naming Lumen's places | Lumen |
| Empty states | None draws Lumen any more: Inbox's and Close out's Lumen empty states went in earlier steps (U2, IB-1), and `.brand-empty` is used only by `InlineMoment` | n/a |
| `ui/icons.tsx` | a comment naming Lumen | Words (code comment) |
| `actions/registry.ts` | `ui.set_reduce_motion` summary "no moving Lumen; the still pose shows"; `ui.first_launch` summary "(for the welcome moment)" | Words |
| `ui/settings/registry.ts` | Reduce motion's search keyword "lumen" | Words (settings search) |
| `assets/brand/mark-bent.svg`, `mark-bent-mono.svg` | The bent ring with Lumen (the mono one draws Lumen's body without the beam) | Lumen |
| `assets/brand/lumen.svg`, `lumen-loading.svg` | Lumen alone with its beam; Lumen at the ring's centre with the sweep | Lumen |
| `assets/brand/lockup-horizontal.svg` | The bent mark with Lumen, the wordmark and the by-line | Lumen |
| `assets/brand/unroll-frame-0..4.svg` | Preview frames of the unroll (frame 0 is the ring without Lumen) | The unroll only, no Lumen |
| `assets/brand/baked/{dark,light}/` | Literal-color copies of each of the above | Same as their source |
| `assets/brand/mark-week.svg`, `mark-week-mono.svg`, `focustime-symbolic.svg`, `favicon.svg`, `wordmark.svg` | | Week mark (and the wordmark) only. mark-week.svg's token block names `--lime` and `--beam-blend`, which its drawing doesn't use |
| `assets/brand/icons/focustime-{16..512}.png`, `mark-week-icon.svg` | The icon set | Week mark only |
| `public/icons/` (install icons: 192, 512, maskable 512, apple-touch-icon) | Made by `scripts/pwa-icons.ts` from the week mark | Week mark only |
| `assets/teams/color.png`, `outline.png` (the Teams app's icons) | Made by `scripts/teams-icons.ts` from the week mark | Week mark only |
| `assets/brand/tools/gen.py` | `lumen()`, `beam_grad()`, the bent mark, lumen.svg, lumen-loading.svg, the unroll frames, the lockup; `--lime` and `--beam-blend` in the token block | Lumen |
| `assets/brand/tools/bake.py` | `lime` and `beam-blend` values | Lumen's colors |
| `e2e/brand.test.ts` | The opening, the reverse, Lumen's places, `[data-lumen]` | Lumen |
| `e2e/today.test.ts`, `e2e/rs1-audit.test.ts`, `e2e/textsize.test.ts` | `.lumen` and `[data-lumen]` selectors | Lumen (tests) |
| Docs | `docs/design/brand.md` (Lumen, the opening, Close out, the files table), `brand-brief.md` and `motion-reference.html` (the delivered brief and motion reference), `docs/design/style-guide.md` (brand tokens and components), `CLAUDE.md` (Lumen, WeekMark and Opening rows; the `ui/brand/` folder line), `docs/architecture.md` (`ui/brand/`), `docs/spec.md` (step 17.5), `docs/decisions.md` (D358 to D365 and later), `docs/open-questions.md`, `docs/ux/U1`, `U2`, `U5` | Words. `docs/technical/` and the Guide's words never name Lumen |

## 4. From pressing sign in (or opening the app signed in) to the first usable screen

Measured on the demo with `e2e/br1-shots.test.ts` (Chromium, 1440x900; "usable" is the overlay gone and the top bar up, from navigation start; three runs each, in `before/timings.json`).

| # | State | What shows | Words | How long |
|---|---|---|---|---|
| 0 | Pressing Sign in with Microsoft | The button reads "Opening Microsoft sign-in…", then Microsoft's own pages, then the server's callback redirects to `/` | "Opening Microsoft sign-in…" | Microsoft's time |
| 1 | `index.html`'s first paint | An empty `#root` on the browser's own default background (no FocusTime styles until the app's script and its CSS load) | None | Until the scripts load: a few ms warm, longer cold (on an iPhone the Temporal polyfill loads first) |
| 2 | The sign-in check (`AuthGate`) | "Loading…" centred, in the app's theme | "Loading…" | Until `auth.status` answers |
| 3 | The opening's wait | The page background (an overlay, hidden from screen readers) | None | 0 to 400 ms after the App mounts |
| 4 | The loader | The bent ring with Lumen at its centre and its light sweeping, "Loading your week" and "Dataverse waiting", "Outlook waiting", "Google waiting", "DevOps waiting" (each turning "done" or "didn't load" as the week arrives) | Five lines | From 400 ms after the App mounts until the week loads, at least 600 ms |
| 5 | The unroll | The ring straightens into the week while Lumen steps aside, the loading words fade | Fading | 1.5 s (1.0 s unroll, 0.5 s Lumen's hop into Mon AM) |
| 6 | Lumen fades, then the flight | The week shrinks into the top bar's mark while the app fades in | None | 0.2 s, then 0.45 s |
| 7 | First launch ever only | Lumen bobs over the app: "Welcome to FocusTime. Here's your week." and "Click or press any key" | Two lines | 3.2 s or a key |

Fast load (the week within 400 ms of the App mounting): states 1 to 3 then the app; usable at about **0.27 s**. Slow load (the week held 1.5 s): the loader until the week, then 2.15 s of unroll and flight; usable at about **3.98 s**. The week held 3 s: about **5.5 s**. A failed source counts as loaded: it never holds the loader, it says "didn't load" for the moment the loader is still up, and the status bar names it in the app.

Reduced motion: the same states, the loader still (no sweep), and the app straight after it with no unroll or flight.

## 5. The before set

`docs/ux/br1/before/`, from `e2e/br1-shots.test.ts` (run with `BR1_SHOTS=<folder>`): the opening as frames on a slow load (`opening-1-first-paint`, `-2-loading`, `-3-loader` and `-3b-loader`, `-4-eight-seconds`, `-5-move-NN` taken about every 100 ms from the week's arrival, `-6-app`), sign-in, About, the Guide's Start here, a tour's last card, the Guide's footer, an empty state (Inbox › Done), the end of Close out (the reverse playing) and Settings after a reconnect, dark and light at 1440x900, and the phone's loader.
