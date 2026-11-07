# The Guide: adding a section, a tour or a try-it spot

UI-5. The Guide is `#/guide`: one section at a time on ST-1's panel shell (`ui/PanelShell.tsx`, through `ui/guide/GuideFrame.tsx`), the rail of sections with search at its top; on a phone or a narrow window the rail is its own page (`#/guide/contents`). Every word is in `ui/guide/content.ts` (tours' words in `ui/guide/tours.ts`); keys are references to `ui/keys.ts` rows (`{key:<command>}`), never typed. Example data only, labeled on screen; never the person's data and never `sources/demo/` (no-demo-leak). Plain words, glossary terms, no em dashes, no real names (the example people are Priya, Sam, Alex, Jordan and Dana).

## A section

1. Add `{ id, name, group }` to `SECTIONS` in `ui/guide/sections.ts` (the rail order is the array's order; ids are `[a-z-]`). If it replaces an old address, map that in `OLD_SECTIONS`.
2. Add its line to `SECTION_LINES` in `content.ts` (the description under the title).
3. An area (most sections): add an entry to `AREAS` in `content.ts`: `lead` (one sentence on what it's for), `does` (2 to 5 things you do: `title`, `text`, optionally `go` for an Open link and `tour` for Show me), `tryIts` and `extras` if it has any, and `faqs` (questions from `QUESTION_POOL` by their exact text). `Guide.tsx`'s `Area` draws it. Anything else gets its own component in `Guide.tsx`'s section switch.
4. Questions live once in `QUESTION_POOL`; place each in exactly one section. Retiring one means adding it to `RETIRED_QUESTIONS` with where its answer went.
5. `ui/guide/sections.test.ts` then checks the order, the word budget (add the section's to `budget`), every link and Show me, plain words and search; `e2e/guide.test.ts` opens every section at 1920 and phone, light and dark. Search finds the new words with no extra work.

Styles go in `ui/guide/guide.css` (loaded with the Guide). Layouts follow the body's width through container queries, so 1366 and Larger text work without media queries.

## A tour

1. On the real screen, add a `data-tour="<hook>"` attribute to each element the tour points at. Attributes only: no behavior change. List new hooks in `docs/decisions.md` (D986).
2. Add a `Tour` to `TOURS` in `ui/guide/tours.ts`: `id`, `title`, `section` (where Back to the Guide goes), `start` (the `Nav` it opens), 4 to 7 `steps`, `end`. Each step: `target` (the hook), `title`, `text`; optionally `at` (another screen: the tour changes the address there and later steps stay on it), `example` (a drawing in `ui/guide/tour/Illustrations.tsx`, or a small card in `content.ts` `TOUR_EXAMPLES.cards`, shown when the screen has nothing there; a step with no `target` is the drawing only), `emptyWhen` (a selector inside the target that must match, else the drawing shows), and `phone` (other words, or `"skip"`).
3. Point a Show me at it (an area's `does[].tour`, or Start here's `START.week.steps[].tour`). The command menu offers "Show me: <title>" by itself.
4. `ui/guide/tours.test.ts` checks every target is a hook on a screen and every drawing exists; `e2e/guide-tour.test.ts` runs every tour at 1920, 1366 and phone with the keyboard only, against a baseline that visits the same screens without the tour: no extra actions, the plan store unchanged.

A tour never clicks, types or writes, and never opens a dialog or flow (those run actions): it changes the address like a link and highlights. If a step needs the person to act (Check it off, Close out), it's a drawing, and the person does it after the tour.

## A try-it spot

A small sandbox inside a section with its own in-page example data and no server session (`ui/guide/TryIt.tsx`, its words and data in `content.ts` `TRY`). Add an id to `TryItId`, a component to `TryIt`'s switch, and the id to an area's `tryIts`. Wrap it in `Frame` (the heading, Start over and the "Example data" note). Use the app's own pure functions (`plan/`, `week/`, like the sizing sandbox on `ui/guide/sandbox.ts`) so the Guide says what the app says, never a copy. State lives in the component, so it starts over when the section closes. No `call()`, no fetch: a scripted answer stands in for anything the server would do. Keyboard usable (a button for every drag); motion under 600 ms, the end state under reduced motion (`useReducedMotion`). `e2e/guide.test.ts` asserts the try-its make no request.
