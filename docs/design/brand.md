# FocusTime brand in the app

Step 17.5, Nov 2 2026. How the identity in `assets/brand/` is used in FocusTime. The why is in `brand-brief.md` (B01 to B08); the motion feel is in `motion-reference.html` (a reference only, none of its code is used). Decisions: D358 to D365; BR-1 (Nov 15) made the loader the week mark alone and removed Lumen (decisions under "BR-1"). The brief and the motion reference still describe Lumen; they are kept as history.

## Files

| Path | What |
|---|---|
| `assets/brand/mark-week.svg`, `mark-week-mono.svg` | The unrolled week: four columns Mon to Thu, AM over PM, Mon AM hollow. The only brand mark: the app icon, the in-app mark and the loader |
| `assets/brand/focustime-symbolic.svg` | 16 px grid, one hollow block, `currentColor` |
| `assets/brand/wordmark.svg` | "FocusTime" in IBM Plex Sans 600, outlined to paths |
| `assets/brand/favicon.svg` | mark-week in a square, dark by default, light under `prefers-color-scheme: light` |
| `assets/brand/baked/{dark,light}/` | Every SVG with the tokens replaced by literal colors, for places without CSS |
| `assets/brand/icons/focustime-{16..512}.png`, `mark-week-icon.svg` | The icon set (AM #2F5F8C, brighter than the dark token so it reads on dark panels) |
| `assets/brand/tools/gen.py`, `outline.mjs`, `bake.py` | Generate, outline the text, bake (see Re-baking) |
| `ui/brand/` | `Brand.tsx` (WeekMark, WeekLoader, Lockup), `boot.css` and `boot.ts` (the loader from the first paint and its hand-off), `Opening.tsx` (the app's side of the loader), `geometry.ts`, `opening.ts`, `motion.ts`, `brand.css` |
| `public/prefs.js` | Sets the theme, text size and reduce motion from localStorage before the first paint, so the loader is drawn in the person's own theme and size |
| `system/install-icons.sh` | Installs the icons into the user's hicolor theme, or removes them (`uninstall`) |

The SVGs name their colors `--brand-am`, `--brand-pm` and `--accent`. In the app, `.brand-svg` maps them to the brand tokens (`--brand-am`, `--brand-pm`, `--brand-accent`); the asset's own `:root` block is dropped when it is inlined. The week mark's drawing, colors and proportions are as in step 17.5 (`ui/brand/assets.test.ts` pins them).

## Which mark goes where

| Place | Mark |
|---|---|
| Top bar | WeekMark (18 px tall) and the live "FocusTime" text, one button to Today |
| Launcher, notifications, window icon | `focustime` hicolor PNGs (mark-week); symbolic: `focustime-symbolic` |
| Browser tab | `favicon.svg`, with the 32 px PNG as fallback |
| Loader | The week mark alone, centered, its blocks lighting in turn; no words (BR-1) |
| Sign-in screen | WeekMark at the loader's size, at the top of the sign-in card |
| Settings > About | Lockup: WeekMark, the wordmark and "by Cooptimize" |
| The Guide's Start here | WeekMark (68 px tall) |
| /styleguide | WeekMark, the Lockup and the loader, live in each theme |

Nothing else carries a mark: the Guide's footer, a tour's last card, empty states, Close out and the first launch have none (BR-1 removed Lumen everywhere and put nothing in its place).

## Clear space and minimum sizes

FocusTime's own rules (the brief sets none):

- **Clear space:** around WeekMark, the height of one AM bar (about a third of the mark's height) on every side; around the lockup, the same. No text, border or other mark inside it. The top bar's text sits 9 px from the mark.
- **Minimum sizes:** WeekMark 14 px tall (the 16 px icon is the smallest raster); the lockup 220 px wide (the by-line stays at 10 px or more); the wordmark 80 px wide.
- Never recolor the mark outside the tokens, never rotate, outline, add a shadow or put it on a busy image.

## The opening

1. **From the first paint.** `index.html` carries the loader itself (`#boot`, styled by `ui/brand/boot.css`, no inline style or script), so nothing different shows between the first paint, the sign-in check and the app: a blank page in the theme's background, then the loader in one place and size.
2. **Loader timing.** A load that finishes within 400 ms shows the app directly; the loader never appears. Otherwise, from 400 ms, the week mark alone, centered (96 px wide at Default, scaled with the text size), its eight blocks lighting in turn: one every 120 ms, all lit by 960 ms, held, then dimmed together, a pass every 1.6 s. No words. Once shown, it stays at least 600 ms and ends with all blocks lit.
3. **Into the top bar (0.4 s).** The mark moves and shrinks (FLIP) onto the top bar's WeekMark while the app fades in under it. No unroll, no hop.
4. **A slow source.** A failed or slow source never holds the loader longer than the week takes; its state shows in the status bar. If the loader is still up after 8 s, one quiet line appears under the mark: "Still waiting on Outlook" (or the sources still loading).
5. **Screen readers** hear "Loading FocusTime" and then "FocusTime is ready" from a status line that is never drawn.
6. **Skip.** A click or any key during the loader or the move goes straight to the app; the key does nothing else.

Close out ends on Today with its own words, and the first launch opens straight on the app; neither has an overlay.

## Reduced motion

The system's `prefers-reduced-motion: reduce` or Settings > Display "Reduce motion" (`[ui] reduce_motion`, kept in localStorage too so `public/prefs.js` knows before the first paint): the loader's mark holds still with every block lit (it still appears after 400 ms, for at least 600 ms), and the app appears with no movement.

## Re-baking and re-outlining

```
cd assets/brand
python3 tools/gen.py        # SVGs from the measured geometry (paths are repo-relative)
node tools/outline.mjs      # "FocusTime" to paths, in Plex Sans from @fontsource (opentype.js)
python3 tools/bake.py       # baked/dark and baked/light with literal colors (the brand token values)
```

The PNG icons were delivered rendered: mark-week-icon.svg on a dark rounded tile. The tile and the render step are not in `tools/`, so the icons are not regenerated here; mark-week's drawing did not change in step 17.5 or BR-1. If it ever does, add the icon recipe to `tools/` first (Q96), then run `system/install-icons.sh`.
