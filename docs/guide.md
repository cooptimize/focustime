# The Guide: adding a section, a tour or a try-it spot

UI-5. The Guide is `#/guide`, one section at a time beside a rail (`ui/guide/GuideFrame.tsx`, to become ST-1's shared shell). Every word is in `ui/guide/content.ts` (tours' words in `ui/guide/tours.ts`); keys are references to `ui/keys.ts` rows (`{key:<command>}`), never typed. Example data only, labeled on screen; never the person's data and never `sources/demo/` (no-demo-leak). Plain words, glossary terms, no em dashes.

## A section

1. Add `{ id, name, group }` to `SECTIONS` in `content.ts` (the rail order is the array's order; ids are lowercase, `[a-z-]`).
2. Put its words in `content.ts` as one export: one sentence on what it's for, the 3 to 5 things you do there, then "How it works" folded (`<details className="guide-q">`).
3. Draw it in `ui/guide/Guide.tsx`'s `Section` switch. Styles go in `ui/guide/guide.css` (loaded with the Guide).
4. `#/guide/<id>` now opens it; the link checker (`ui/guide/tours.test.ts`) and `e2e/guide.test.ts` cover the rail.

## A tour

1. On the real screen, add a `data-tour="<hook>"` attribute to each element the tour points at. Attributes only: no behavior change. List new hooks in `docs/decisions.md` under UI-5.
2. Add a `Tour` to `TOURS` in `ui/guide/tours.ts`: `start` (the `Nav` it opens), 4 to 7 `steps`, `end`. Each step: `target` (the hook), `title`, `text`; optionally `example` (a drawing in `ui/guide/tour/Illustrations.tsx` for when the screen has nothing there), `emptyWhen` (a selector inside the target that must match, else the drawing shows), and `phone` (other words, or `"skip"`).
3. Point a Show me at it (Start here's `START.week.steps[].tour`, or the section's own).
4. `ui/guide/tours.test.ts` checks every target exists on a screen and the address round-trips; add an e2e like `e2e/guide-tour.test.ts` (1920, 1366, phone, keyboard only, no new actions, store unchanged).

A tour never clicks, types or writes. If a step needs the person to act, it says "try it" in the end card and the person does it after the tour.

## A try-it spot

A small sandbox inside a section with its own in-page example data and no server session, like the sizing sandbox (`ui/guide/sandbox.ts`, drawn in `Guide.tsx`'s `Sizing`). Use the app's own pure functions (`plan/`, `week/`) so the Guide says what the app says, never a copy. State lives in the component, so it resets when the section closes. No `call()`, no fetch: a scripted answer stands in for anything the server would do (an assistant proposal, say). Keyboard usable; reduced motion shows end frames.
