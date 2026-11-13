# The Guide: adding a section, a tour or a try-it spot

UI-5, rebuilt by GU-1. The Guide is `#/guide`: one section at a time on ST-1's panel shell (`ui/PanelShell.tsx`, through `ui/guide/GuideFrame.tsx`), the rail of sections with search at its top; on a phone or a narrow window the rail is its own page (`#/guide/contents`). Every word is in `ui/guide/content.ts` (tours' words in `ui/guide/tours.ts`); keys are references to `ui/keys.ts` rows (`{key:<command>}`), never typed; a control is written by the name it has in the app with the app's icon drawn beside it (`{icon:<name>} More`, a name from `ui/icons.tsx`), never as a character; a path reads "More › About", each label exactly the app's. Example data only, labeled on screen; never the person's data and never `sources/demo/` (no-demo-leak). Plain words, glossary terms, no em dashes, no real names (the example people are Priya, Sam, Alex, Jordan and Dana).

**The one rule (GU-1): a step that changes a name or a control updates the Guide and the retired-names list in the same pull request.** The app's words are the truth; the Guide follows.

## Names, controls and the ledger (GU-1)

- `{icon:name}` in any Guide text (`content.ts`, a tour's `text`) draws that icon from `ui/icons.tsx`, kept on the line with the first word of the control's name. Follow it with the name: `{icon:add} Add`, `{icon:more} View options`. An unknown name, or an icon with no name after it, fails `ui/guide/app-names.test.ts`.
- `{b:Label}` is a control's label in bold. It, and the last label of every path ("Settings › Activity"), must be a string the app shows; the same test reads the app's source for it.
- `ui/guide/retired.ts` is the one list of names FocusTime no longer uses: `was`, `now` (where it lives now, in the app's words, never another old name) and `match` (how the old name is recognised in text). Renamed is this list, one row per old name; the Guide's search finds every one; and a Guide sentence outside Renamed that uses one fails the test. When a step renames something: add its old name here, and fix every sentence the test then names.
- A control written as a character (⋯ ‹ › × ✓ ✕, a lone +) fails the same test. Arrows inside a sentence ("→ Thu") and the › between path labels are text.
- No answer is over 120 words (`MAX_ANSWER_WORDS`). Cut it, or split it into two questions. No "Where did X go?" questions: that is Renamed's job.
- The five tab sections are in the app's tab order and carry the tabs' icons (`TAB_SECTIONS` in `sections.ts`; the test compares them with `TABS` in `ui/nav.ts` and the top bar's icons).
- `docs/ux/gu1/app.md` is the stock-take of the app the Guide was checked against (tabs, switches, More, menus, addresses, icon buttons' names, Settings and Admin sections, commands, keys). `docs/ux/gu1/ledger.md` has a row for every sentence the Guide had before GU-1 with where it is true, what became of each wrong or gone one, and which drawn pieces are the app's own and which are hand-drawn. `e2e/gu1-shots.test.ts` (with `GU1_SHOTS=<folder>`) takes every section, try-it and tour step.

## A section

1. Add `{ id, name, group }` to `SECTIONS` in `ui/guide/sections.ts` (the rail order is the array's order; ids are `[a-z-]`). If it replaces an old address, map that in `OLD_SECTIONS`.
2. Add its line to `SECTION_LINES` in `content.ts` (the description under the title).
3. An area (most sections): add an entry to `AREAS` in `content.ts`: `lead` (one sentence on what it's for), `does` (2 to 5 things you do: `title`, `text`, optionally `go` for an Open link and `tour` for Show me), `tryIts` and `extras` if it has any, and `faqs` (questions from `QUESTION_POOL` by their exact text). `Guide.tsx`'s `Area` draws it. Anything else gets its own component in `Guide.tsx`'s section switch.
4. Questions live once in `QUESTION_POOL`; place each in exactly one section. Each section has its own array (`Q_DAY`, `Q_WEEK`, …), so a question sits where a person would look. Removing one needs nothing else; if it explained an old name, the old name goes in `ui/guide/retired.ts`.
5. `ui/guide/sections.test.ts` then checks the order, the word budget (add the section's to `budget`), every link and Show me, plain words and search; `e2e/guide.test.ts` opens every section at 1920 and phone, light and dark. Search finds the new words with no extra work.

Styles go in `ui/guide/guide.css` (loaded with the Guide), and follow style guide section 11: a list is rows, not boxes, and nothing boxed sits inside another box; a status is a pill with a wash; buttons are the app's (`mini`, `mini quiet`, one `primary` at most); section labels are small uppercase. Layouts follow the body's width through container queries, so 1366 and Larger text work without media queries.

## A tour

1. On the real screen, add a `data-tour="<hook>"` attribute to each element the tour points at. Attributes only: no behavior change. List new hooks in `docs/decisions.md` (D986).
2. Add a `Tour` to `TOURS` in `ui/guide/tours.ts`: `id`, `title`, `section` (where Back to the Guide goes), `start` (the `Nav` it opens), 4 to 7 `steps`, `end`. Each step: `target` (the hook), `title`, `text`; optionally `at` (another screen: the tour changes the address there and later steps stay on it), `example` (a card in `content.ts` `TOUR_EXAMPLES.cards`, drawn by `ui/guide/tour/Illustrations.tsx` in one of the app's three shapes by its `kind`: `block` (a block card), `rows` (a list, each row's second part a status pill) or `preview` (a line per change); `main` names its one filled button; shown when the screen has nothing there; a step with no `target` is the drawing only), `emptyWhen` (a selector inside the target that must match, else the drawing shows), and `phone` (other words, or `"skip"`).
3. Point a Show me at it (an area's `does[].tour`, or Start here's `START.week.steps[].tour`). The command menu offers "Show me: <title>" by itself.
4. `ui/guide/tours.test.ts` checks every target is a hook on a screen and every drawing exists; `e2e/guide-tour.test.ts` runs every tour at 1920, 1366 and phone with the keyboard only, against a baseline that visits the same screens without the tour: no extra actions, the plan store unchanged.

A tour never clicks, types or writes, and never opens a dialog or flow (those run actions): it changes the address like a link and highlights. If a step needs the person to act (Check it off, Close out), it's a drawing, and the person does it after the tour.

## A try-it spot

A small sandbox inside a section with its own in-page example data and no server session (`ui/guide/TryIt.tsx`, its words and data in `content.ts` `TRY`). Add an id to `TryItId`, a component to `TryIt`'s switch, and the id to an area's `tryIts`. Wrap it in `Frame` (the heading, Start over and the "Example data" note). Use the app's own pure functions (`plan/`, `week/`, like the sizing sandbox on `ui/guide/sandbox.ts`) and, where one needs no server session, the app's own component (`CardsTimelineSwitch`, `Icon`, `TypeIcon`), so the Guide says and shows what the app does, never a copy. What has to be drawn by hand is listed as hand-drawn in `docs/ux/gu1/ledger.md`. State lives in the component, so it starts over when the section closes. No `call()`, no fetch: a scripted answer stands in for anything the server would do. Keyboard usable (a button for every drag); motion under 600 ms, the end state under reduced motion (`useReducedMotion`). `e2e/guide.test.ts` asserts the try-its make no request.
