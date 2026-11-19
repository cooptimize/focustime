# How a step records its decisions and open questions

1. Name the file by the step's code in lower case: `docs/decisions/<step>.md` and `docs/open-questions/<step>.md` (MC-6 → `mc-6.md`, MC-2c → `mc-2c.md`).
2. Start each with the step's heading, `## <CODE>: <name> (<date>)`, then the rows or questions under it.
3. Decisions are a table, one row per decision, with no global number: a row is named by its step and its place, "MC-6.3" for the third.
4. Add one line for the step to the end of each index, `docs/decisions.md` and `docs/open-questions.md`, and nothing else there: no heading, no row (the guards fail on either).
5. Never edit another step's file, except to mark one of its questions answered, naming the step that answered it.
6. If the index line conflicts with another step's, keep both lines.

Example, a step ZZ-1 (made up): `docs/decisions/zz-1.md` holds `## ZZ-1: A short name (Nov 20)` and its table, and `docs/decisions.md` gains `- [ZZ-1: A short name (Nov 20)](decisions/zz-1.md)`.
