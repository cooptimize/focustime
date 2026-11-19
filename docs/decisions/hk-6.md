## HK-6: the flaky late chip test (Nov 7)

Numbered D1048 to D1050 in HK-7.

| # | Status | Decision |
|---|---|---|
| D1048 | Done | HK-6 (Q-DOC1-8): the flake was in the test, not the app. With network and chip logging on the failing runs, Monday AM's chip went within about half a second of Done (`inbox.today` came back without the promise, as it should). The test's `chipText` read it in two steps, `count()` then `textContent()`: when the chip went between them, `textContent()` waited Playwright's 30 s for an element that wasn't coming back, so the 20 s poll for "no chip" timed out. Under load that window is hit often (20 of 84 runs of that test failed this way, 10 at a time on this machine). `chipText` now reads the page once (`evaluateAll`), so a poll sees each state as it is. Every assertion is unchanged. |
| D1049 | Done | HK-6: no app change. `inbox.today` is already read again after every Inbox change (the Inbox's reload calls the week's reload, and the count reads after it), so the re-read Q-DOC1-8 suggested isn't needed. |
| D1050 | Done | HK-6: MB-1b's test (`e2e/mb1b.test.ts`) didn't read in two steps, but it waited a set 300 ms for the status sheet to slide in before measuring it. It now waits for the sheet's animations to finish. No other e2e reads a chip in two steps. |

