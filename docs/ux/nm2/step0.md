# NM-2 STEP 0: what was found

## 1. An existing branch or pull request

None. No branch `fix/nm2-truth` and no NM-2 pull request existed; this step started from `origin/main` at eb6ed790.

## 2. Other open pull requests on the same files

None. On Nov 14 there was no open pull request at all, so none touches `ui/menu.ts`, `actions/registry.ts`, `ui/settings/` or `config/org.ts`.

## 3 to 5. The three tables

- The commands: `commands.md` (440 commands: 342 true, 52 wrong words, 46 hollow; and what the assistant and the Teams bot are told).
- The settings and rules: `settings.md`.
- The pointers: `pointers.md`.

## 6. C1: a to-do's title on a block card

**At FN-1's merge (29083904, Nov 10), Week's card did not link a to-do's title.** Week's cards drew to-dos with `<PickRow … density="week" … />` in `ui/WeekGrid.tsx` and no `link`, so the title was plain text there. Only Today's timeline rows (`TodayTimeline.tsx`) passed `link`.

**WD-2 then made it so on purpose.** ebb85712 (Nov 11, "WD-2: … card titles open the story card …") added `link` to `CardPick` in `ui/BlockCard.tsx` on Week and on Day. The comment there still says: "The title opens the story card (FN-1), on Week and on Day; a click on a row never opens the block panel." No later commit removed it, and no decision takes it away. GU-1 noticed it didn't happen, made the Guide say only what is true, and asked the question (open questions, GU-1). NM-1's review saw it again.

**Why it opens nothing.** `PickRow` draws the title as a link only when the to-do has a stored `itemUrl`. A to-do added through `pick.add` stores its item's URL. But a to-do can hold an item id and no URL:
- every to-do the demo seeds (`sources/demo/`): `"itemId": 4411, "itemUrl": null`;
- any to-do whose item's URL was not a `https://dev.azure.com/` address when it was added (`actions/plan-actions.ts` stores `null` then).

So the title of a to-do with a DevOps item was plain text: no anchor in the page (checked in the demo at 1440: four to-dos on Week's cards, no link in any).

**Verdict: lost by accident.** WD-2 meant it, and the stored URL it depends on is often missing. C1 is built (part C).

## 7. E: proof that nothing reaches what is removed

### `ui/Roadmap.tsx`

- Imports: no file imports it. `git grep` for `Roadmap.tsx`, `./Roadmap"`, `./Roadmap.tsx"`, `../Roadmap` finds only `scripts/words-guard.ts` and its test, which name it as a file to skip.
- Lazy loads or string routes: none (`lazy(`, `import(` with Roadmap: none).
- Tests: none import it; `e2e/` doesn't open it (Backlog's Grid is `ui/ahead/`).
- Styles: its class names stay in the stylesheet, unused by it now; removing CSS was not in this step.
- What it imported stays used elsewhere, except `roadmapRowMenu` in `ui/menu.ts`, which only it called (tested by `ui/roadmapmenu.test.ts`). Left in place (open questions).

### The empty conversations tick

- `server/ticks.ts`: `const conversationsTick = async () => {};` (IB-4 left it registered, NM-1 found it), registered as the slow part `conversation_notices` under the policy name `notices` (`SLOW_PARTS`), and run from the tick's `slow` table.
- Callers: only the `slow` table entry. `git grep conversation_notices` finds `server/ticks.ts` (the part and its entry) and `config/background-policy.test.ts` (the list of parts that exist). Docs name it only in history (`docs/architecture.md`, NM-1's notes).
- It sends nothing, reads nothing and writes nothing. Removing it removes one entry from `SLOW_PARTS`; the policy name `notices` stays (other parts use it), so the policy and what runs still match, and the policy's test says so with the part gone.
