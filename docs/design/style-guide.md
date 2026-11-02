# Coopilot style guide (proposal)

Status: proposal, Oct 31 2026. Step 6.1 built the token layers (section 3) with the step 6 palette, the AA contrast fixes, and parts of section 6 (Tab scope, F6, O, the legend); see D110 to D115. Step 6b built the themes (Cooptimize Dark default, Cooptimize Light, Neutral) and self-hosted Red Hat Display (D120); the Omarchy option stays a proposal. It describes the token system, themes and components that Phase 5 would implement, starting with a token layer and theme switcher that changes no layout. Words follow the glossary in `CLAUDE.md` (Plan the day, Check-in, Close out, focus block, Open, PTO). Step 17.5 replaced the font with IBM Plex Sans and Plex Mono (D358) and added the brand tokens and components (section 4.1, docs/design/brand.md).

## 1. Principles

1. **Week first, wide and short.** Both target screens are 1080 px tall (3840x1080 ultrawide, 1920x1080). Vertical space is the scarce resource; horizontal space is plentiful on the ultrawide. Nothing important lives below the fold of a half-day card.
2. **Calm by default, loud only for risk.** Surfaces are quiet, client color is a thin rail and a swatch, and only risk, PTO and failures use strong color.
3. **Never color alone.** Risk, PTO, show-as, source state and client identity always carry a word, icon, pattern or label as well as color.
4. **Same words everywhere.** The UI, the command menu, chat and docs use the glossary terms.
5. **Truthful states.** Every source shows live, cached (with time) or failed (with the cause in one line and one fix).
6. **Keyboard and pointer parity.** Anything a key does, a visible control or menu does, and the reverse.

## 2. Brand source (cooptimize.org, read Oct 31 2026)

Computed styles read in Chromium from the home page. Only palette and type were collected.

| Role | Value | Source (element / variable) |
|---|---|---|
| Primary accent (navy) | `#00416B` | `--nv-primary-accent`; link color; the band under the header |
| Secondary accent (forest green) | `#42783C` | `--nv-secondary-accent`, `--primarybtnbg`; active nav item; section rule band |
| Button hover (lime) | `#B2D235` | `--primarybtnhoverbg` |
| Logo green | `#82AA43` | `--nv-c-1`; logo arcs |
| Logo dot (red-orange) | `#EF412D` | `--nv-c-2`; logo center dot |
| Secondary button gray | `#58595B` | `--secondarybtnbg`; `.wp-block-button__link` background |
| Text | `#030303` | `body` color, `--nv-text-color` |
| Page background | `#FFFFFF` | `body`, `--nv-site-bg` |
| Light background | `#F4F5F7` | `--nv-light-bg` |
| Dark background | `#121212` | `--nv-dark-bg` |
| Typeface | Red Hat Display 300–900 | `body` and headings `font-family`; self-hosted under `/wp-content/fonts/red-hat-display/` |
| Weights in use | body 300, headings 600, buttons 700, nav 500 | `body`, `h1`–`h3`, `.wp-block-button__link`, nav links |
| Button radius | 3 px | `--primarybtnborderradius` |

**Logo treatment:** a horizontal lockup. A "C" mark made of concentric arcs (navy, forest green, logo green and lime) around a red-orange dot, then the lowercase wordmark "cooptimize" in navy. Coopilot uses only the mark, as a small app glyph, never the wordmark, so it reads as a Cooptimize tool, not the company site.

**Tone:** plain, friendly, confident. Light weights at large sizes, generous whitespace, green as the action color, navy as the trust color.

**Type licensing:** Red Hat Display, Red Hat Text and Red Hat Mono are SIL OFL 1.1 and free to self-host (Fontsource packages `@fontsource/red-hat-display`, `-text`, `-mono` 5.3.0, OFL-1.1). Proposal: ship the woff2 files in the repo (latin subset, about 15 KB per weight), no runtime CDN. Today the app asks for Inter, which isn't installed, so it renders in the system fallback.

## 3. Token layers

Three layers. **Components use semantic and domain tokens only**, never primitives or raw hex.

```
primitives (raw palette, per theme file)
  └─ semantic tokens (surface, text, accent, focus…)   ← components
  └─ domain tokens (client slots, risk, PTO, show-as…)  ← components
```

A theme is one file that assigns every semantic and domain token. Switching a theme swaps one attribute on `<html>` (`data-theme="cooptimize-dark"`), live, with no reload.

### 3.1 Primitives (Cooptimize)

| Token | Hex | Note |
|---|---|---|
| `navy-900` | `#00416B` | brand primary |
| `navy-300` | `#6FB0E3` | navy lifted for dark backgrounds |
| `green-700` | `#42783C` | brand secondary, primary buttons |
| `green-400` | `#82AA43` | logo green |
| `lime-400` | `#B2D235` | focus ring on dark |
| `coral-500` | `#EF412D` | logo dot; base of risk red |
| `ink-950` | `#0D1318` | dark background (navy-tinted, not pure gray) |
| `ink-900` | `#141B22` | dark surface |
| `ink-850` | `#18212A` | dark raised |
| `ink-800` | `#1A232C` | dark card on surface |
| `ink-700` | `#222C36` | dark line |
| `ink-600` | `#2E3A46` | dark strong line |
| `fog-50` | `#F4F5F7` | light background (brand light bg) |
| `white` | `#FFFFFF` | light surface |

### 3.2 Semantic tokens

| Token | Cooptimize Dark | Cooptimize Light | Neutral Graphite | Use |
|---|---|---|---|---|
| `--bg` | `#0D1318` | `#F4F5F7` | `#111317` | app background |
| `--surface` | `#141B22` | `#FFFFFF` | `#191C21` | cards, panels |
| `--raised` | `#18212A` | `#F7F8FA` | `#1D2026` | menus, popovers, hover rows |
| `--sunken` | `#10171D` | `#ECEEF1` | `#15171B` | Friday overflow, wells |
| `--border` | `#222C36` | `#E1E5EA` | `#2A2E35` | dividers |
| `--border-strong` | `#2E3A46` | `#D0D6DD` | `#363B43` | control outlines |
| `--text` | `#E8EDF1` | `#13202B` | `#E7E9EC` | primary text |
| `--text-muted` | `#A9B4BE` | `#4A5663` | `#B3B8C0` | secondary text |
| `--text-faint` | `#8592A0` | `#5F6B78` | `#8A909A` | labels, times |
| `--accent` | `#6FB0E3` | `#00416B` | `#7EA2FF` | links, selection tint, active view |
| `--action` | `#42783C` | `#42783C` | `#3767D0` | primary button background |
| `--on-action` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | text on primary button |
| `--focus` | `#B2D235` | `#00416B` | `#7EA2FF` | focus ring |
| `--shadow-1` | `0 1px 2px #0007` | `0 1px 2px #10202B14` | `0 1px 2px #0006` | cards |
| `--shadow-pop` | `0 12px 32px #0009` | `0 12px 32px #10202B2E` | `0 12px 32px #0008` | menus, dialogs |

### 3.3 Domain tokens

| Token | Dark | Light | Graphite | Always paired with |
|---|---|---|---|---|
| `--risk` (at risk) | `#FF6B57` | `#C0311F` | `#FF7A52` | "At risk:" label and dot |
| `--watch` | `#E8B04A` | `#8F5A00` | `#E6B13E` | "Watch:" label |
| `--ok` (source live) | `#6CC287` | `#2C7A45` | `#5CC48A` | "live" label |
| `--stale` (source cached) | `= --watch` | `= --watch` | `= --watch` | "cached" + time |
| `--error` (source failed) | `= --risk` | `= --risk` | `= --risk` | the cause in words |
| `--pto` | `#7CC4F0` | `#1F679F` | `#6CB8F5` | "PTO · title" + diagonal hatch |
| `--open` | `--text-muted` on `--surface` | same | same | the word "Open", no client rail |
| `--standing` | client slot + dotted rail | same | same | "Standing block" in details |
| `--overflow` (Friday) | `--sunken` + dashed border | same | same | "Overflow · catch-up" |
| `--double-booked` | second client swatch | same | same | "Also booked: X" line |
| `--show-busy` | `--meeting-card` solid | same | same | "busy" in title |
| `--show-tentative` | dashed outline, 85% | same | same | "tentative" |
| `--show-free` | dotted, 45% | same | same | "free" |
| `--show-oof` (`--oof`) | `#C79BFF` + hatch, double rule | `#7B35B8` | `#C592FF` | "out of office" in the meta line |
| `--show-elsewhere` | muted surface, dotted rule | same | same | "working elsewhere" |
| `--personal` | `#F07AA6` | `#B8336A` | `#F2729C` | "Personal" group label |
| `--sample` | `#A58BFF` | `#6A52D6` | `#A58BFF` | "Sample" pill |

### 3.4 Client colors

Eight named slots, each with a value per theme. Config maps a client to a slot (`CSC = "ochre"`); a raw hex still works but is used as is in every theme (no contrast guarantee). The current four clients keep their hues.

| Slot | Dark | Light | Today's client |
|---|---|---|---|
| 1 `teal` | `#3FC1AE` | `#0F8576` | W&C |
| 2 `violet` | `#B8A2FF` | `#6B4FD8` | Quiddity |
| 3 `ochre` | `#E3A24A` | `#A8620C` | CSC |
| 4 `blue` | `#4F8DE8` | `#1F5FB8` | Cooptimize |
| 5 `rose` | `#F0B0E8` | `#D0457A` | |
| 6 `earth` | `#EFE3C4` | `#5E5040` | |
| 7 `green` | `#9ACD5A` | `#4B8A1F` | |
| 8 `slate` | `#8FA0B8` | `#4E5F78` | |

Checked numerically (WCAG contrast; color-vision simulation with Machado 2009 matrices at full severity; distance in OKLab ×100):

- Against the card surface: dark 5.2 to 13.6:1, light 4.2 to 7.8:1. Swatches and rails need 3:1, so all pass. Client names are always drawn in `--text`, never in the client color.
- First 6 slots, closest pair: dark normal 10.4, deuteranopia ≥ 7.3, protanopia 7.3, tritanopia 8.9; light normal 10.6, deuteranopia 5.3, protanopia 5.2, tritanopia 4.4 (violet and blue, the weakest pair).
- Slots 7 and 8 fall below 3 for some color-vision types (green against ochre in deuteranopia, earth against slate in protanopia). They rely on the client name, which is always on the card. Assign them last.
- Today's palette: closest pair (Quiddity and Cooptimize) 9.1 normal, 4.9 deuteranopia.

**Risk overlays:** risk never tints the whole card in client-like hues. At risk is a labeled badge plus a 1 px risk outline; watch is a labeled badge only. Every client slot sits at least 10 (dark) or 9 (light) away from `--risk` in normal vision, and the badge text carries the meaning regardless.

## 4. Type, spacing, density

**Families (step 17.5, D358):** IBM Plex Sans 400, 500 and 600 for everything (`--font-ui`), self-hosted from `@fontsource/ibm-plex-sans` (latin, woff2, OFL 1.1, `ui/fonts.css`); every `font-weight` in the stylesheet is one of those three. Tabular figures (`tnum`) are on for the whole body, so times, durations and counts line up. IBM Plex Mono 400 and 500 (`--font-mono`) only for keyboard hints and shortcut chips (`kbd`). No network fonts. Red Hat Display (step 6b, D120) is gone.

**Type scale (U3, D385).** Today and Week use four sizes and three weights, nothing else (tested in `e2e/week.test.ts`). The same pixel sizes at 3840: the ultrawide is 1080 px tall, so text needs no scaling. Other screens (Plan the day, Plan the week, Roadmap, Settings) still use the older steps below until their own pass.

| Token | Size | Weight | Use |
|---|---|---|---|
| `--fs-4` | 15 | 600 | page and panel titles ("Week of Nov 2–6, 2026", the panel's client) |
| `--fs-3` | 13 | 600 | client names on cards, the next pick's title |
| `--fs-3` | 13 | 500 | buttons, Plan chip, + Add work |
| `--fs-3` | 13 | 400 | body: pick titles, rows, follow-ups |
| `--fs-2` | 12 | 500 | pills and badges (At risk, Due today, size chips) |
| `--fs-2` | 12 | 400 | meta: time ranges, counts, features line, status bar |
| `--fs-1` | 11 | 500 | rail labels and hour marks |
| `--fs-1` | 11 | 600 | section labels, uppercase +0.06em (MUSTS, THIS WEEK, AGENDA) |

Uppercase is for section labels only, never for tags or pills. Fewer than 12 text styles on Today › Now and on Week (U3: 8 and 9).

Older steps, still used outside Today and Week:

| Step | Size / line | Use |
|---|---|---|
| `--fs-xs` | 11/14 | group labels, uppercase +0.06em |
| `--fs-sm` | 12.5/16 | meta lines, work item rows |
| `--fs-md` | 14/19 | event rows, stats, menu items |
| `--fs-base` | 15/20 | body, picks |
| `--fs-lg` | 18/22 | client name on a card |
| `--fs-xl` | 20/24 | week title, panel titles |
| `--fs-2xl` | 24/28 | empty-state headline |

**Spacing:** 4 px base: 2, 4, 6, 8, 12, 16, 20, 24, 32. **Radius:** 6 (controls), 10 (menus, pills), 14 (cards, panels). **Hit targets:** 28 px minimum for pointer, the whole card row for menus.

**Density:**

- *3840x1080 (wide layout):* half-day cards show the rail (client, stats, picks, work items, badge) on the left third and the hour timeline on the right. Plan the day takes the planned day's whole widened track. Room for the Now strip and every top-bar item on one line.
- *1920x1080 (medium layout):* compact cards. The top bar hides "coming soon" tabs and Settings text behind a "More" menu when space runs out, never by wrapping the week title. Work item lists collapse to a count when a day is committed.
- Both: the status bar is one line when everything is live; failures add one line per cause, never per source.

## 4.1 Brand (step 17.5)

Tokens, in every theme (`ui/styles.css`, domain layer):

| Token | Cooptimize Dark | Cooptimize Light | Use |
|---|---|---|---|
| `--brand-am` | #1E3A55 | #7FA6C9 | the marks' AM bars |
| `--brand-pm` | #4FA3DD | #00416B | the marks' PM bars |
| `--brand-accent` | #9CC24F | #42783C | Lumen's body, the hollow Mon AM |
| `--brand-ghost` | #2B3A4D | #B9C6D3 | the dashed inner AM band |
| `--mascot-highlight` | #B2D235 | #B2D235 | Lumen's light bar and beam; only inside `ui/brand/` (tested) |
| `--brand-beam-blend` | screen | multiply | how the beam blends |

Neutral uses the dark values in dark mode and the light values in light mode. The brief's full surface and text palette is not applied (Q93).

Components (`ui/brand/`, docs/design/brand.md): `WeekMark` (top bar, about 18 px tall), `BentMark` (sign-in), `Lockup` (About), `Lumen` (`pose` still, idle or bob), `LumenLoading` (the loader), `Unroll` (`direction` open or close), and the overlays `Opening`, `CloseReverse`, `MomentOverlay`, plus `EmptyState` (idle Lumen, one line, one action) and `InlineMoment`. Every mark is decorative (`aria-hidden`); the words beside it carry the meaning.

## 5. Core components

| Component | Anatomy | States | Notes |
|---|---|---|---|
| **Day header (Week)** | weekday and date, Today pill, PTO pill (reason on hover), Plan chip only when not planned, ⋯ on hover or selection; all-day chips and before/after lines only when present | default, today, PTO | no ALL DAY, BEFORE or AFTER labels (U3) |
| **Half-day block (Week card)** | header: swatch, client, muted "9:00–12:30", ⋯ on hover; the status pill with its reason; picks (size chip, + time and ⋯ on hover; a timed pick shows its time); "N done" off today; due badges; + Add work on hover; the features line; the rail on the right | default, hover, selected (focus ring), at risk (pill with reason), past (faint); PTO day as one hatched cell, Friday as one dashed Catch-up column | no AM/PM labels; the rail is the one home for meetings; the selected block is the keyboard cursor (U3) |
| **Detail panel** | title (swatch, client, date), range, ⋯, close; risks; agenda with free gaps; picks as full rows; where you left off; features with story counts, Draft stories, Coop brief; follow-ups; assigned and not planned | open on a block; focused section highlighted | 440 px at 1920, 560 px at 3840; Week and Today; Esc closes; not modal (U3) |
| **Pick card** | checkbox, title, size chip (S/M/L), ⋯ | planned, done (strike + faint), carried over ("from Tue"), other client (warning tag) | size chip: S about 1 h, M about 2 h, L a block |
| **Risk pill** | "At risk · <short reason>" | at risk, too much planned (amber), fits | the reason is on the pill (0 clicks); full sentences in the detail panel |
| **Source status bar** | all live: a green dot and Refresh only; otherwise per cause: dot, name, state word, its data's age, fix button | live (quiet), cached (age), failed (cause), sample, needs sign-in | identical failures are grouped into one line with one fix; age only beside a stale or failed source (U3) |
| **Top nav** | glyph, views (Week, Plan the day, Plan the week / Check-in / Close out as "soon"), week nav, Now strip, Refresh, Commands, Settings | active view (underline in `--action`), disabled "soon" | |
| **Command menu** | search, grouped list (views, week, sources, Plan the day, picks, work items), shortcut on the right, steps for targets | empty ("Nothing matches"), step with back | built from the action registry |
| **Buttons** | primary (`--action`), secondary (outline), quiet (text), mini | hover, active (pressed 1 px), disabled (40%, cursor default), busy (spinner + label) | one primary per panel |
| **Inputs** | label above, 32 px field, inline hint | focus ring, invalid (risk border + message under) | |
| **Menus** | title row, items with hint, submenu arrow, disabled with reason | active row tint, disabled reason inline | popover above dialogs |
| **Toast / inline error** | inline next to what failed; toast only for background actions | info, success (rare), error with retry | errors name the cause and the fix |

## 6. Interaction rules

- **Focus visibility:** a 2 px ring in `--focus` with a 2 px `--surface` gap (`box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--focus)`). Never removed; `:focus-visible` only for pointer users.
- **Hover vs selected vs active:** hover lifts the background to `--raised`; selected is the focus ring (the keyboard cursor); active (pressed) darkens 1 step and moves 1 px. A selected block keeps its ring even when the pointer is elsewhere.
- **Keyboard map:**

| Key | Does |
|---|---|
| ← → ↑ ↓ | move between half-days |
| Enter / Space | details of the selected half-day |
| Tab / Shift+Tab | (proposed) items inside the selected half-day only, then the next region |
| F6 | (proposed) next region: top bar, grid, panel, status bar |
| O | (proposed) open the top pick or work item of the selected half-day in Edge |
| Shift+F10 / Menu | the ⋯ menu of what has focus |
| P (or I) | Plan the day |
| C | commit (in Plan the day) |
| T | today |
| [ ] | previous / next week |
| R | refresh |
| Ctrl+K | command menu |
| Esc | close the top layer (menu, dialog, panel) |

- **Motion:** 120 ms ease-out for opacity and transform only, no layout animation. `prefers-reduced-motion: reduce` turns every transition to 0 ms.
- **Empty states:** say what's missing and the one next step ("No focus blocks this week. Open half-days are free for client or internal work."). Never a blank card.
- **Error states:** cause in words, when the shown data is from, one fix ("Keyring locked. Showing what was saved at 3:36 PM. Unlock, then Retry"). Group identical causes.
- **Loading:** keep the last good week on screen with a thin progress line under the top bar; never blank the grid on refresh.

## 7. Contrast (WCAG 2.x, text on its usual background)

All proposed text tokens pass AA (4.5:1) on `--bg`, `--surface` and `--raised` in all three themes; the focus ring passes 3:1 (non-text). Measured, among others: dark `--text-faint` 5.5 on surface (5.9 on bg), light `--text-faint` 5.4 on white (5.0 on bg), light `--watch` 5.8, light `--risk` 5.7, dark `--risk` 6.2 (5.7 on raised), primary button text on `--action` 5.3, focus ring 10.1 (dark) and 10.7 (light) on surface.

Exceptions, by design:

- PTO-day content is dimmed to 50%. It is not actionable and the "PTO · title" line itself stays full contrast.
- Disabled controls and "coming soon" tabs (WCAG exempts inactive controls).
- Free events at 45% opacity: the word "free" is in the tooltip and details.

Today's dark theme fails AA for faint text: 4.48:1 on cards, 3.93:1 on meeting cards.

## 8. Themes

- **Cooptimize Dark** (default): navy-tinted charcoal, navy-lifted accent, green action, lime focus.
- **Cooptimize Light:** brand light background, white cards, navy accent and focus, green action.
- **Neutral Graphite:** today's palette with the faint text fixed. It proves the system carries a non-brand theme and gives a no-surprise fallback.
- **System** (setting, not a theme): Cooptimize Dark or Light by `prefers-color-scheme`.

Stored in config through Settings (step 6b): `[ui] theme = "cooptimize-dark" | "cooptimize-light" | "neutral" | "system" | "omarchy"`.

**Following the Omarchy theme (proposal, not for the first slice):** an `omarchy` option that reads the active theme's `colors.toml` read-only (found through `omarchy theme current` and `omarchy theme dir`, rechecked on window focus) and maps only `mode`, the background tiers, `foreground`, `accent` and `selection` onto the semantic tokens. Domain tokens (risk, watch, PTO, client slots) stay from Cooptimize Dark or Light by `mode`. Omarchy palettes reuse ANSI names freely: Lumon's `red` is a blue (`#4D86B0`), so risk can never come from the theme. If the theme's text on background contrast is under 4.5:1, it falls back to the Cooptimize theme for that mode. Nothing is written into `~/.config/omarchy`. A template under `~/.config/omarchy/themed/` would be cleaner but touches Omarchy and needs your approval first.

## 9. `/styleguide` route (proposal)

A route in the existing UI (no new dependency), reachable from the command menu ("Show style guide") and `?view=styleguide`. Not in the top bar. It renders, live in the active theme:

1. A theme switcher (the same control Settings will use).
2. Token swatches by layer with hex values and measured contrast against `--surface`.
3. Client slots under normal vision and simulated deuteranopia, protanopia and tritanopia (SVG `feColorMatrix` filters, same matrices as above).
4. Every component in every state from section 5, built from fixture data (`fixtures/`), not live sources, so it works offline and never shows client data.
5. The keyboard map, generated from the action registry.

It lets every theme change be checked on screen in one place, and screenshot-diffed in tests.
