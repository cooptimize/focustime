## UC-3

- **Item 6 was already done on main** by UC-2 (item 8): bulk State… lets a state only some ticked rows take be picked, stages those rows, and its line says how many it skipped and why; Review then lists only those rows. UC-3 adds the browser test that follows it through Save (`e2e/backlog/bulk-state-some-rows.test.ts`). The skipped count is said on the line under the bar, not inside Review: Review reads the change set, which holds only what was staged. Should Review also say what a bulk action left out?
- **A heading where nothing needs me** says "none need you · 3", so it never reads as a count of what needs me. Captures' headings show only their rows, since nothing there ever counts. Is "none need you" too loud on a long Promises list?
- **The phone's chips still have no numbers** (UC-1), so on the phone only the headings and the tab show the count. Its new No client chip follows the same rule. Should the phone's chips get numbers?
- **The calls note's header still says "Client calls"**, the name of its switch in Settings › Reminders and notices (Settings is another step's). Rename the switch and the header to Calls together?
- **The draft editor's Undo puts the client back too.** Item 8 named the New form; the draft editor uses the same hook, and leaving it would let picked names sit under another client there. Its parent comes back with it.
- **"a" or "an" by sound** follows spelling rules (a word in capitals said letter by letter, "u" said "you", a silent "h"), not a dictionary. A made-up type name that breaks them ("Uber task" reads "a Uber task") would read oddly. Calls' gap form (`ui/meetings/`, not touched here) still lowercases the type before choosing, so an all-capitals type name there reads by its first letter.

