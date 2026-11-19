## Settings overhaul (ST-1, Nov 6)

- Q-ST1-1: `usePhone` and `useNarrow` read `innerWidth`, which a phone widens when a page is wider than the screen; ST-1 fixed the pages that did that (CSS only), but any new wide element on a phone page can bring back the "Maximum update depth exceeded" loop. Read the device width instead (`screen.width` or `visualViewport`), or keep fixing pages and rely on the width checks in the e2e tests? Proposal: read `visualViewport.width` in a follow-up with its own test on iPhone conditions.

