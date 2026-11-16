# BT-1: what a browser test's start costs

Measured on Nov 16, 2026 on the developer's machine held to four cores (`taskset -c 8-11`), with a probe that starts a demo server as `e2e/harness.ts` does and opens six fresh people one after another, timing each step. Two builds of the UI: as the test run makes it (inside vitest, `NODE_ENV=test`, so React's development build; the main script is 1.47 MB) and as a release (1.07 MB). Milliseconds.

| Step | Test-mode build (six people) | Release build (six people) |
|---|---|---|
| Start the demo server and Chromium | 1,007 | 1,011 |
| Stop them | 240 | 243 |
| New page | 95, 82, 83, 86, 75, 83 | 94, 92, 84, 77, 78, 75 |
| The sign-in page | 99, 82, 89, 67, 71, 73 | 84, 81, 84, 74, 70, 79 |
| Try the demo (the button answers) | 168, 174, 159, 192, 195, 177 | 146, 126, 127, 144, 181, 177 |
| The demo session made and the first screen (`.demo-tag`) | 801, 817, 832, 809, 811, 809 | 797, 806, 821, 820, 807, 829 |
| The opening gone | 9, 9, 8, 10, 9, 9 | 8, 10, 9, 8, 9, 9 |
| The other screens fetched in the background | 178, 24, 77, 3, 25, 24 | 3, 3, 3, 4, 16, 3 |
| Close the page | 7, 4, 4, 4, 4, 5 | 7, 4, 4, 4, 5, 4 |
