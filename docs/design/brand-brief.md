# FocusTime | Brand Brief v0.2 (repo copy)

November 2, 2026. Repo copy of the planning brief. The v0.1 sections that v0.2 refers back to (voice, palette, type, token mapping) are inlined so this file stands alone. The drawing step (old section 9) has already run; integration notes are at the end. Everything not marked **[confirmed]** is a proposal.

**Palette source:** the Cooptimize Brand Guide PDF (eyedart creative studio, April 2022). **Logo source:** the Cooptimize logo PNG set (icon, horizontal and stacked).

## 1. Name and story

**FocusTime** is the companion that helps a Cooptimizer see the week clearly and steer it. [confirmed]

**The found connection.** [confirmed] The Cooptimize mark is four concentric arcs (navy, deep green, mid green, lime) opening to the right as a C, with a red dot at the center. The opening cuts each ring into an upper arc and a lower arc. Four rings, two halves each: eight segments. The parent mark already contains a four-day week of half-days, bent into a circle. FocusTime's identity is that circle unrolled into time.

**Story in one line:** Cooptimize is the whole; FocusTime is the week; Lumen is the segment that stepped out to look at both.

Coop (the coding agent) remains visually unrelated. [confirmed]

## 2. Personality and voice

- **Lucid.** FocusTime shows what is true, in plain words, with the source and freshness attached. Rules out: hedged copy, decorative abstraction, anything that hides a failure behind a smooth state.
- **Guided.** FocusTime always offers the next step and makes the healthy path the easy path. Rules out: scolding, alarms, guilt framing, and "productivity" cheerleading.
- **Rhythmic.** FocusTime respects the beat of the week: Plan the week, Plan the day, Check-in, Close out, AM and PM. Rules out: constant notifications, loops that never settle, motion in working views.

**Voice rules for UI copy.** Say what happened, say who it touches, offer one action. Never "you failed to", "overdue", "warning". Prefer "slipped", "moved", "needs", "ready". Second person is fine; no exclamation marks in working views. Numbers and times are exact; feelings are not assigned to the user.

| Situation | Before (avoid) | After (FocusTime) |
|---|---|---|
| A block slips | "Warning: you missed your T&W block." | "T&W PM slipped: 2h 10m of meetings ran through it. Move it to Thu AM, Fri, or an evening?" |
| A source fails | "Error 401: authentication failed." | "Google Calendar needs reconnecting. Showing events from 8:02 this morning. Reconnect?" |
| A plan is reset | "Are you sure? All changes will be lost." | "Reset this week to source data? Your local moves (3) will be cleared. Keep a copy first?" |

## 3. Marks

**Derived from the Cooptimize rings.** [confirmed] The week was already inside the parent mark, and a visible family link matters if FocusTime is later hosted for other Cooptimizers. Caveat (B07): mention it to the other members before the mark is final.

**Bent week (brand mark).** The parent's four rings, stroke-based, opening on the right. Each ring cut at the horizontal centerline into an AM (upper) and PM (lower) segment. Eight segments. AM in `brand-am`, PM in `brand-pm`. The innermost AM segment is a dashed ghost: that segment is Lumen, who has stepped out through the opening and stands outside it, light pointing back in. Used on: splash, About, the lockup, shared or hosted surfaces. Not the app icon.

**Unrolled week (app mark).** The same eight segments laid flat: 4 columns (Mon to Thu), 2 rows (AM over PM), row gutter about twice the column gutter. Mon AM hollow in `accent` (the standing Internal block). Used on: app icon, window favicon, in-app header. The unroll from bent to flat is the signature motion.

**Monochrome.** The unrolled grid in `currentColor` is the symbolic icon (tray, menus, Waybar): seven filled, one hollow. The bent mark has a mono form for single-color lockups but is never a tray icon (it would be confused with the Cooptimize icon).

**Not inherited from the parent:** the red center dot, the four-hue rings, the parent wordmark (except on shared surfaces).

**Must not resemble:** Microsoft four squares, Microsoft Copilot, generic calendar icons, and at icon size the Cooptimize icon itself.

**Lockup.** Bent mark small, Lumen beside the opening, "FocusTime" in IBM Plex Sans 600, "by Cooptimize" in `muted` beneath.

## 4. Lumen

**Subject.** [confirmed] An abstract object, never an animal. Lumen is the missing segment: a rounded block in `accent` green with a short light bar in lime (`mascot-highlight`) on one edge. Three shapes: body, light bar, cast light (a soft wedge, only in motion and larger placements).

**No face.** [confirmed] No pupil, iris, ring or single centered circle. Nothing on Lumen receives; it emits. Expression comes from tilt (a few degrees) and where the light points.

**Motion.** [direction confirmed]
- **Loading:** Lumen at the ring's center, light sweeping around the segments like a radar pass, about 2.5 s per revolution.
- **Opening the app:** the unroll. Ring opens, segments flatten into the 4x2 grid, about 900 ms, ease-out, outer ring leading; Lumen steps aside and settles beside the grid. **Close out reverses it**: the week curls back into the ring.
- **Idle (empty states):** light bar brightens and dims slowly; body tilts 1 to 2 degrees. No sweep.
- **Fun moments:** a single settle with a small upward bob, then still.
- **Still pose:** body upright, light bar steady. Reduced-motion fallback and empty-state default.
Everything is slow and small; no spinning, no bouncing.

**Where it may appear.** [confirmed] Loading screens (animated), empty states, the lockup and bent mark, fun moments. The app icon is the unrolled grid, not Lumen. Fun moments: first launch, Close out when the day's musts are done, a week with zero at-risk blocks, a successful reconnect after a source failure. More is better; refine later.

**Rules.** [confirmed] Never carries information: risk, status and freshness stay on their own badges. Never in the week view, Plan the day or any working view. Animation only in loading, empty states, the open/close transition and agreed fun moments. Everything respects `prefers-reduced-motion` and falls back to the still pose. No chicken, hen, chick, egg, nest or coop imagery anywhere.

## 5. Palette

**Inherited from Cooptimize** [confirmed]: Navy #00416B (primary hue), Deep green #42783C (accent, light), Mid green #82AA43 (accent source, brightened for dark), Lime #B2D235 (Lumen's light bar and fun moments only; never text on light surfaces), Red #EF412D (not used by the brand; available to risk tokens), Gray #58595B (neutral reference).

**Theme ramps** [proposal, not yet applied to the app]:

| Token | Dark | Light | Role |
|---|---|---|---|
| surface | #0E1620 | #F5F7FA | App background |
| raised | #162130 | #FFFFFF | Cards, panels |
| border | #2B3A4D | #D3DBE4 | Hairlines |
| text | #E6ECF2 | #14212E | Primary text |
| muted | #9AAABB | #56687A | Secondary text |
| primary | #4FA3DD | #00416B | PM segments, primary buttons, links |
| primary-soft | #1E3A55 | #D9E8F3 | AM segments (dark), selected/hover fills |
| accent | #9CC24F | #42783C | Hollow block, Lumen, confirmations |
| focus | #F2C94C | #B8860B | Focus ring only |
| on-primary | #0E1620 | #FFFFFF | Text on primary/accent fills |

All text pairs pass WCAG AA. Borders are decorative and never the only cue.

**Kept out of the brand palette:** client colors, risk, source status. These are domain tokens; the brand must not compete with them. Navy and green families must never be assigned to a client; risk never uses the brand accent.

## 6. Type

**IBM Plex Sans** 400, 500, 600 (SIL Open Font License, self-hosted). Tabular figures for times and durations. **IBM Plex Mono** only where fixed width helps (timestamps in lists, keyboard hints). No display typeface: the wordmark is Plex Sans 600 with tightened tracking. Cooptimize's Red Hat Display is not used.

## 7. Concepts retired (for the record)

Bands, Open block, Tide, Nudge, Lens; Beam, Lantern, Level; Stepped out, Live mark, Horizon, Reduced dashes; Lumen at center or at the opening. **Live mark** (favicon or tray shows the real week's fills) is queued as an app feature (B08), not part of the brand.

## 8. Token mapping

| Brand primitive | Semantic token | Notes |
|---|---|---|
| navy family | primary (style guide "accent") | Buttons, links, selection |
| navy soft | primary-soft | Selected and hover fills |
| green family | positive | Confirmations, successful reconnect |
| lime #B2D235 | mascot-highlight | Lumen's light bar and fun moments only |
| primary-soft / #7FA6C9 | brand-am | AM segments in both mark forms (dark / light) |
| primary | brand-pm | PM segments in both mark forms |
| Domain: client.*, risk.*, source.* | unchanged | Not derived from brand primitives |

## Decisions

| ID | Status | Entry |
|---|---|---|
| B01 | Reversed | Palette-only inheritance. Now: mark derived from the Cooptimize rings; palette inherited; type and wordmark not |
| B02 | Confirmed | Lumen has no face and nothing that receives; it emits light |
| B03 | Confirmed | Bent week = brand mark; unrolled week = app icon and in-app mark; grid mono = symbolic icon |
| B04 | Confirmed | Two hues in the marks (AM/PM navy); Lumen in accent green with a lime light bar; red and lime never on working surfaces |
| B05 | Confirmed | Signature motion: Lumen's sweep (loading), the unroll (open), reverse unroll (Close out) |
| B06 | Confirmed | Identity is hand-drawn SVG, not image-model output |
| B07 | Open | Tell the other Cooptimizers that the mark derives from the company mark, before it is final |
| B08 | Queued | Live favicon/tray showing the real week's fills, as an app feature |

## Integration notes (Nov 2, after drawing)

- The identity is drawn (assets/brand/): token-based SVGs, baked dark and light variants, five unroll keyframes (unroll-frame-0 bent to unroll-frame-4 flat), and a PNG icon set 16 to 512 px.
- **Light theme:** `primary-soft` (#D9E8F3) is too pale for AM segments on light surfaces, so light `brand-am` is **#7FA6C9**. Dark `brand-am` stays #1E3A55.
- **App icon:** use the delivered icon PNGs as-is (AM slightly brighter than the in-app mark so it reads on the dark tile).
- **Typeface confirmed:** IBM Plex Sans, chosen over Red Hat Display after a side-by-side on the Today screen.
- The delivered `wordmark.svg` is live text; outline it with the real font before it ships as a standalone file.

## Name history

The app was called **Coopilot** from its start (Oct 31, 2026) until Nov 2, 2026, when it was renamed **FocusTime** (R1, see `docs/decisions.md`). The marks, Lumen, icons and the week mark did not change. Only the wordmark and the lockup were re-set, in IBM Plex Sans 600 with the same tracking. One trace of the old name remains on purpose: the Outlook marker property is still named `CoopilotId`, because renaming it would orphan every event created before the rename.
