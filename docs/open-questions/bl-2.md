## BL-2

- Needs attention keeps BL-1's shape (client › epic › feature, a gap's parents shown for context). Should it follow the rank rule too, listing the level's items with gaps in rank order with their parent as a label? Left as it was: the spec named only the levels.
- STEP 0.5: Last change reads FocusTime's own change log in the plan store (one indexed query per client, 30 days), not DevOps, so it now loads on every Backlog load. If the log grows large for a client with a busy project, should the window shrink, or the column load on demand again?
- Children opened under a row have no rank number (the number is the rank at the level listed). Should an opened story show its own rank among stories, perhaps muted?
- What BL-1's tree did in one step that now takes more: seeing every story of an epic at once (now Epics, then Expand all); seeing which features sit under an epic at a glance (now the parent label, or the Epic filter). A person who used the tree daily may want a remembered "open everything" per level.
- Closed items keep their place dimmed with no rank, as BL-1 showed them. Should Backlog hide closed items at a level by default?
- Items below the level with no item at the level above (a story straight under an epic, an orphan feature) are listed after the ranked rows with no rank. Is "after" right, or should they be in their own folded group ("Not under a feature")?
- A link from before BL-2 with no `l=` used to open the tree with stories (BL-1's default); it now opens at Features, or the person's saved level.
- When a row's parent is not an epic (a story's feature), its label puts the Epic filter on that feature, and the chip says "Feature: <title>". The filter field is still called epic in the code and the address (`e=`). Should it be renamed to parent?
- The Backlog view's presence note (`aheadPresence`) does not include the level, since the level is kept in the browser and not on the server.
- Found while testing, not changed: in the demo, the review panel's Saved list (writes since the panel opened) stays empty, because the demo's server clock is Nov 2 and the browser's is today, and the list compares the two. Writes land and show in Settings › Activity. Real use has one clock. Should the list compare against the server's own time?
- From review 1, left as they are (not the rank rule, or wider than BL-2):
  - A client with no backlog order (listed by target date) still shows its numbers under "Rank". The header says "by target date (no backlog order)". Should the column say so too, or show no numbers?
  - The Gantt shows rank numbers only in each row's accessible name. Should it show them, as the Grid does?
  - Counts read differently: the header's items, Showing N of M, Select all N shown, and a client's "N need attention", which counts every level and ignores search. One count rule for Backlog?
  - A target date set with "+1 week" shows a half-day ("Nov 9 PM") in the cell and in Review.
  - The keyboard: Home and End do nothing in the Grid; Tab from a cell goes on to the next row's link rather than leaving the grid.
  - A screen reader reads a client's heading line whole, with "Select all N shown in <client>" twice, and the Select all box has no name when focused.
  - Review lists every client's staged changes, also those of clients not shown.
  - The Filter button's count differs between the Grid and the Gantt at the same level.
- From review 2, left as they are:
  - The Gantt at Stories has no feature rows, so the Free time row's "Crowded month" and the features' "can't reach the target" callouts don't show there (they do at Features and Epics, where features are rows). Should the Gantt at Stories still count the features behind the stories?
  - The parent label's filter on a story's feature puts a feature in the Epic filter (`e=`). The chip says "Feature: <title>", but Filter's Epic picker lists only epics, so it shows none chosen. Same question as renaming the field to parent.
  - With no backlog order field a project lists by target date, so staging a new target date moves the row (on save, as DevOps would order it too).

