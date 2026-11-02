# U5: app-wide type scale, text size, and a light prune

U5 takes the U3 type scale from Today and Week to the rest of the app. It also adds a Text size setting, and lightly prunes Roadmap, Inbox, Settings and the dialogs. Layout changes only where the prune needed them. Data and domain tokens are unchanged.

Screenshots come from demo mode:
- `screens/before/`:
  - Roadmap, Plan ahead and Inbox;
  - each Settings section;
  - the focus screen and sign-in;
  - Capture, Timebox…, the VM preview and the draft editor.
  
  All at 1920, in dark and light.
- `screens/after/`:
  - the same screens;
  - Today, Week, Plan the week, Plan the day, Roadmap, Inbox and Settings › Display at Large and Larger, at 1920 and 3840 dark (`-large`, `-larger`).

## What changed

### Type scale, app-wide

- **Literal sizes:** all 433 literal font sizes in `ui/styles.css` now use the four steps. The mapping:
  - under 12 px → `--fs-1`;
  - 12 to 12.5 → `--fs-2`;
  - 13 to 14.5 → `--fs-3`;
  - 15 and up → `--fs-4`.
  
  The one-off sizes are gone rather than overridden. The two U4 overrides that held old sizes were removed.
- **Body:** 13 px, the third step. It was 15.
- **Weights:** headings, `strong`, `b` and `th` are 600, never the browser's 700. A heading with no size of its own takes the title step.
- **Uppercase:** only section labels are uppercase (11/600). The 14 tags that were uppercase are now plain pills at 12/500:
  - Next, Draft, Story, Added by me, New today and To sort;
  - and the other eight.
- **Dialogs:**
  - titles at 15/600;
  - body at 13;
  - hints at 12, muted;
  - field labels at 12/500;
  - one primary button.
- **Focus screen:** its label is a section label. The pick title is 15/600.
- **Exceptions:**
  - The countdown stays a display size. It is the one exception, and it is excluded in the test.
  - Avatar initials follow the avatar.
  - The brand module (loader, moments, Lumen) is unchanged.

### Text size (Settings › Display)

- **The base:** `--text-base` is the body size. The four steps are base − 2, − 1, base and + 2, so one value moves them all.
- **Choices:** three radio buttons (D401):

  | Choice | Steps (px) |
  |---|---|
  | Default | 11/12/13/15 |
  | Large | 13/14/15/17 |
  | Larger | 15/16/17/19 |
- **Applying it:**
  - It applies live and is saved as `[ui] text_size` (`ui.set_text_size`).
  - It is mirrored locally, so the first paint is right.
  - The config wins once the week loads.
- **Keys:** Ctrl+plus (or =) and Ctrl+minus step through the choices and stop at Larger and Default. Ctrl+0 goes back to Default.
  - Only when no text field has focus and no dialog is open. Otherwise the browser's own zoom keys behave as usual.
  - Both are in the keyboard legend and in the command menu (Text size, with the three choices).
- **Spacing that scales with the base** (`--text-scale`, base / 13):
  - pixel line heights;
  - text row heights: day headers, card headers, the strip, the status row and the Plan ahead rows and cells;
  - square text buttons;
  - Today's 3840 day timeline (minutes to pixels).
- **What doesn't scale:** outer layout widths, the top bar icons and the brand mark.
- **3840:** the current rule keeps the same pixel sizes at 3840, because the screen is 1080 px tall. Its multiplier is 1, so text size applies alone.

### Light prune

- **Inbox:**
  - **Removed from rows:**
    - "Added by me";
    - "New today";
    - the "client · opened … · on Teams" line. It is now the row's hover title.
  - **Kept:** the state ("snoozed until", "closed …") and the heads-up "Why" reason.
  - **One action per row:**
    - Close the loop;
    - or Mark done in DevOps (Enable DevOps writes without a PAT) for a DevOps update. Close the loop then moves into ⋯.
  - Heads-up Draft and Copy moved into ⋯.
  - **Captures:**
    - a row with the text and client, plus Sort, which opens the kind chips and fields;
    - Dismiss is in ⋯;
    - the open form has Cancel.
  - The explainer sentence above the capture box is gone. The kind chips and the empty state stay.
- **Roadmap:**
  - The summary filters are one-line chips ("2 ■ Blocked"). They were tiles with a big number.
  - The "What do these mean?" button and legend are gone. Each badge and summary chip gives its meaning on hover, and the order rule is on the summary row's hover.
  - The "Open stories, 3 weeks" label under every trend is gone. It is the trend's hover title.
  - The ⋯ menus already hid disabled items (U2).
- **Plan ahead:**
  - The four-line instruction is now one line.
  - The "Feature or epic" column header is gone.
  - Weekly sub-labels show only "2 weeks ago", "Last week" and "This week". "Week 2" to "Week 4" and "5 weeks" are gone; the dates say it.
- **Settings:**
  - About 60 helper sentences and section intros are cut to one line, or to the fact the label doesn't already say. Words fell by 20 to 35% per section.
  - Read-only values owned by Dataverse say "Change this in Dataverse". Values from config name the config key.
  - Field labels are 12/500.

## Counts

See `counts.md`.

| Screen | Text styles before → U5 |
|---|---|
| Roadmap | 16 → 8 |
| Plan ahead | 22 → 10 |
| Inbox | 17 → 9 |
| Settings sections | 9 to 16 → 6 to 8 |
| Dialogs, open over their page | 11 to 16 → 8 to 10 |
| Today, Week, Plan the week, Plan the day | unchanged at 8 to 10 |

| Screen | UI words before → U5 |
|---|---|
| Inbox | 223 → 117 |
| Settings › Planning | 638 → 420 |

## Where Larger doesn't fit at 1920

- **Week:** nothing overlaps. I fixed the risk pill running into the rail. But the cards are tight:
  - client names truncate to three letters ("Coo…");
  - pick titles and rail labels truncate;
  - "2 features · 1 needs stories" wraps to two lines.
  
  It is readable but not comfortable. At 3840, Larger fits well.
- **Plan ahead:** feature titles in the label column truncate. The Blocks rows grew to hold two lines.
- **Fit at Larger, 1920:** Today, Plan the week, Plan the day, Roadmap, Inbox and Settings fit, with more scrolling.
- I didn't force Week to fit (for example by hiding the rail at Larger). That would be a layout change beyond U5.

## Deviations

1. **Fixed offsets, not ratios.** The three presets the prompt names step by exactly 2 px, and ratios off 13 would give 12.7/13.8/15/17.3. So the steps are base − 2, − 1, base and + 2. A ratio, base / 13, is used only for spacing.
2. **No 3840 multiplier was added.** The current rule is the same pixels at 3840. "Multiplies on top" holds with a multiplier of 1.
3. **The focus countdown stays a display size.** At 15 px it would defeat the focus screen.
4. **Every follow-up kind label moved to the hover title,** not only "Added by me". DevOps update and Heads-up went too: the row shows who, what and the due badge, and a DevOps update says so through its Mark done in DevOps action. Captures keep their "To sort" tag.
5. **Roadmap's legend is gone rather than trimmed.** Its sentences now live in hover titles on the badges and the summary chips, so nothing is lost and nothing shows twice.
6. **Commits:** `ui/styles.css` is in the type-scale commit whole, including the few prune rules (Roadmap chips, the capture row), because its changes interleave.

## Not checked

- Light shots at Large and Larger.
- A real (non-demo) restart with `[ui] text_size` set. The config path is covered by a unit test (`actions/ui-actions.test.ts`). In demo mode the config is in memory, so the browser test proves a fresh window reads the size from config, not from local storage.
