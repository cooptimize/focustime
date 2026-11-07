# FocusTime brand in the app

Step 17.5, Nov 2 2026. How the identity in `assets/brand/` is used in FocusTime. The why is in `brand-brief.md` (B01 to B08); the motion feel is in `motion-reference.html` (a reference only, none of its code is used). Decisions: D358 to D365.

## Files

| Path | What |
|---|---|
| `assets/brand/mark-bent.svg`, `mark-bent-mono.svg` | The brand mark: four ring bands opening right, AM above PM, the inner AM band dashed (ghost); Lumen upright outside the opening, its beam pointing in |
| `assets/brand/mark-week.svg`, `mark-week-mono.svg` | The unrolled week: four columns Mon to Thu, AM over PM, Mon AM hollow. The app icon and the in-app mark |
| `assets/brand/focustime-symbolic.svg` | 16 px grid, one hollow block, `currentColor` |
| `assets/brand/lumen.svg` | Lumen alone, upright, with its beam |
| `assets/brand/lumen-loading.svg` | Lumen at the ring's centre with the radial sweep (stops under reduced motion) |
| `assets/brand/wordmark.svg`, `lockup-horizontal.svg` | "FocusTime" in IBM Plex Sans 600, "by Cooptimize" in 400, outlined to paths |
| `assets/brand/unroll-frame-0..4.svg` | Five keyframes, bent to flat (preview only; the app computes the unroll) |
| `assets/brand/favicon.svg` | mark-week in a square, dark by default, light under `prefers-color-scheme: light` |
| `assets/brand/baked/{dark,light}/` | Every SVG with the tokens replaced by literal colors, for places without CSS |
| `assets/brand/icons/focustime-{16..512}.png`, `mark-week-icon.svg` | The icon set (AM #2F5F8C, brighter than the dark token so it reads on dark panels) |
| `assets/brand/tools/gen.py`, `outline.mjs`, `bake.py` | Generate, outline the text, bake (see Re-baking) |
| `ui/brand/` | The components: `Brand.tsx` (WeekMark, BentMark, Lockup, Lumen, LumenLoading, Unroll), `Opening.tsx` (Opening, CloseReverse, MomentOverlay, InlineMoment), `geometry.ts`, `opening.ts`, `motion.ts`, `brand.css` |
| `system/install-icons.sh` | Installs the icons into the user's hicolor theme, or removes them (`uninstall`) |

The SVGs name their colors `--brand-am`, `--brand-pm`, `--accent`, `--lime`, `--ghost` and `--beam-blend`. In the app, `.brand-svg` maps them to the brand tokens (`--brand-accent`, `--mascot-highlight`, `--brand-ghost`, `--brand-beam-blend`); the asset's own `:root` block is dropped when it is inlined.

## Which mark goes where

| Place | Mark |
|---|---|
| Top bar | WeekMark (18 px tall) and the live "FocusTime" text, one button to Today |
| Launcher, notifications, window icon | `focustime` hicolor PNGs (mark-week); symbolic: `focustime-symbolic` |
| Browser tab | `favicon.svg`, with the 32 px PNG as fallback |
| Sign-in screen | BentMark |
| Settings > About | Lockup, the version, the credit line |
| Opening and Close out | LumenLoading, then Unroll; the week ends on the top bar's WeekMark |
| /styleguide | Every mark and pose, live in each theme |

## Clear space and minimum sizes

FocusTime's own rules (the brief sets none):

- **Clear space:** around WeekMark, the height of one AM bar (about a third of the mark's height) on every side; around BentMark and the lockup, the width of the outer band. No text, border or other mark inside it. The top bar's text sits 9 px from the mark.
- **Minimum sizes:** WeekMark 14 px tall (the 16 px icon is the smallest raster); BentMark 48 px wide (below that the ring gaps close); the lockup 220 px wide (the by-line stays at 10 px or more); the wordmark 80 px wide; Lumen's body 20 px (its beam still reads).
- Never recolor the marks outside the tokens, never rotate, outline, add a shadow or put them on a busy image.

## Lumen

**No face, it emits (B02).** Lumen is an upright rounded block in the accent green with a light bar on its left edge in the mascot highlight (lime). It has no eyes, mouth or anything that receives; it only gives light. Lumen never carries information: no status, count, warning or progress is ever shown through it.

**The beam:** level and symmetric about the light bar; as tall as the bar where it leaves it, about 1.8x Lumen's height at its far end and about 2.3x Lumen's width long; lime fading to transparent (0.85 at the bar, 0.25 just past half, 0 at the end); blended with `screen` on dark themes and `multiply` on light ones (`--brand-beam-blend`).

**Poses:** `still` (stands upright); `idle` (sways about 1.5 degrees over 6 s, its light breathes over 3 s); `bob` (settles in and bobs once in 0.7 s, then idles).

**Where Lumen may appear:** the loader, the opening and Close out's reverse, the sign-in screen (BentMark), About (the lockup), the Guide's footer (still, 22 px, G1), the Guide's Start here (the unroll) and the last card of a Guide tour ("You're set", idle, 26 px; UI-5), three empty states (Inbox empty and Close out with no open follow-ups use the idle pose, one plain line and one action), and three fun moments: the first launch ever (once, a plan store marker), Close out with all of today's musts done, and a calendar reconnected in Settings > Connections.

**Never:** in Week, Plan the week, Today › Now, Plan the day, Check-in, Roadmap or Plan ahead, on any card, or for inline waits (a spinner word or nothing). Never tilted at rest (it stands upright), never with a face, never speaking.

`--mascot-highlight` is referenced only inside `ui/brand/` (a test checks it).

## The opening

1. **Loader timing.** A first load that finishes within 400 ms shows the app directly. Otherwise, from 400 ms, the full-screen loader: LumenLoading (the light sweeps a full turn every 2.5 s, a radial fade about 50 degrees wide), "Loading your week", and Dataverse, Outlook, Google and DevOps each waiting, done or "didn't load". They load together, so each says waiting until the week arrives. Once shown, the loader stays at least 600 ms. A failed source never holds the reveal back and is never shown as done.
2. **Unroll (about 1 s).** The loading text fades. Beat 1: each ring segment straightens in place, the outer ring leading by 50 ms per band. Beat 2: the bars shrink and slide into their day, AM over PM, horizontal movement leading vertical; the dashed inner AM band turns into the hollow Mon AM. Each segment eases in and out. A crossfade lands on the exact mark-week geometry. Lumen steps aside as the week widens.
3. **Back into Mon AM (0.5 s).** Lumen hops in an arc into the hollow Mon AM while its beam fades.
4. **Into the top bar (0.45 s).** Lumen fades, then the week shrinks (FLIP) onto the top bar's WeekMark while the app fades in under it. Mon AM stays hollow: the mark and the icon never show Lumen inside.

## Close out

After Done commits: the week grows out of the top bar's mark, plays the opening backwards (Lumen hops out of Mon AM, the week rolls back into the ring), and fades to Today. If today has at least one must pick and every one is done (a story in a must's envelope counts), Lumen settles and bobs with "Musts done. See you tomorrow." for 2.6 s. Click or any key skips at any point; the key does nothing else.

## Reduced motion

The system's `prefers-reduced-motion: reduce` or Settings > Display "Reduce motion" (`[ui] reduce_motion`, kept in localStorage too so the next opening knows before it loads): no sweep, unroll, hop or bob; Lumen shows the still pose; the opening and Close out cut straight to the result (the loader still appears after 400 ms, still, for at least 600 ms, so a slow start never looks frozen without words).

## Re-baking and re-outlining

```
cd assets/brand
python3 tools/gen.py        # SVGs from the measured geometry (paths are repo-relative)
node tools/outline.mjs      # "FocusTime" and "by Cooptimize" to paths, in Plex Sans from @fontsource (opentype.js)
python3 tools/bake.py       # baked/dark and baked/light with literal colors (the brand token values)
```

The PNG icons were delivered rendered: mark-week-icon.svg on a dark rounded tile. The tile and the render step are not in `tools/`, so the icons are not regenerated here; mark-week did not change in step 17.5. If it ever does, add the icon recipe to `tools/` first (Q96), then run `system/install-icons.sh`.
