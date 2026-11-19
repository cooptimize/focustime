## MC-3: Calls is a tab (Nov 17)

- **Should the phone's bar carry Calls?** It stays in More, first, with its count (as decided). A person who reviews calls daily on the phone takes two taps; the bar has room for five.
- **Should Day on the phone point at a call that needs me?** The urgent strip shows the Inbox's own items only; a call waiting for review shows on its meeting's mark and in More's count.
- **Is 14 days right for the list?** Calls that need me stay until their transcript goes at 30 days; the rest fold under Earlier calls. A week and a weekend may be enough for the list itself.
- **Calls' browser tests in their own folder.** They are still in `e2e/week/` (and `e2e/day/client-call-door.test.ts`); the new one sits beside them. A folder of their own (`e2e/calls/`) would match the tab.
- **A repeating meeting in the list (MC-2's question).** A daily standup is still a row a day. Folding repeats into one row ("Team standup · 6"), or hiding a call for me, is open.
- **What MC-2b and MC-2c need from the list.** Pocket recordings (MC-2b) would match a recording to a row by start and length and put it on the setup's upload; calls in chats (MC-2c) would add rows with a source "From a chat". The row's second line has room for both.
- **The server's `#/meetings` links.** The Teams bot's notes and the assistant's links still say `#/meetings` (and "Open Client calls"). They land on Calls; changing their words was left out (no rewording in this step). Answered in UC-3: they say "Open Calls" and point to `#/calls`; `#/meetings` still lands on Calls.
- **Back in two steps.** Below 900 px a call has a Back button; side by side it has none (the list is there, and the browser's Back works). Should the wide page keep a Back for people who arrived from Day?
- **Choosing a filter goes into history.** Each filter press is its own Back step (as MC-1e's call filter is). Replacing the address instead would make Back leave Calls sooner.
- **The tab's title says its key (consultant walkthrough).** Every tab's title ends with its number key, "Calls: review the calls you were on (6)", beside a count of 1. A person read the 6 as a second count. Saying "key 6" would change every tab's title, so it was left. Answered in UC-3: every tab's title ends with "Press 6" (its key), never "(6)".
- **The client suggested for an internal call (consultant walkthrough).** A daily standup during a Northwind block is suggested as Northwind (MC-2's rule: the block's client when the title names none). One careless Continue files it under Northwind. Suggest nothing for a call whose people are all Cooptimizers?
- **A setup has no address (consultant walkthrough).** A calendar call nobody has read has no id FocusTime keeps, and its calendar key is not put in an address, so a reload closes its setup.
- **The call that needs me on the phone's list (consultant walkthrough).** Newest first puts it under that day's other calls; on a computer it opens beside the list by itself, on the phone it doesn't. Should the phone open on To review, or put calls that need me first?
- **A calendar call named after a client (consultant walkthrough).** "Northwind requirements workshop" says No client yet until it is reviewed, so the Northwind chip leaves it out. Its client is chosen in the setup by design.
- **Focus after the DevOps preview's Not now (consultant walkthrough).** It goes to the page, not back to Create in DevOps. The call's page is MC-1e's, unchanged in this step.

