Paste everything below the line into Claude Code, started in this folder.

---

You're building FocusTime with me, step 1 of Milestones 1–2. Read CLAUDE.md, docs/spec.md, docs/decisions.md and docs/open-questions.md first. Don't restart discovery; the design is settled in those files.

Step 1 scope (authorized): the week model and the visual week grid, using sample data only. No real accounts, no network calls, no keyring use yet.

Build:
1. A git repo in this folder, TypeScript with strict type checks, Vite + React for the UI, Vitest for tests. Use the Node already installed through mise. Pin exact dependency versions. Before installing, show me the dependency list in one short message, then continue unless something on it is surprising. No global installs. For UI screenshots, use Playwright with the system Chromium (/usr/bin/chromium) instead of downloading browsers.
2. `week/` (pure, no I/O): expand Focus Time patterns into AM/PM blocks for a given week (Mon–Thu, All Day means both halves, blank end date means ongoing); add standing blocks from config (Monday AM Internal) with Dataverse blocks winning and a double-booked flag; mark empty Mon–Thu half-days as Open; place calendar events into AM/PM using the day shape (start 09:00, split 12:30, usual end 17:00, America/New_York), keeping evening events visible; apply the four risk rules in spec section 6 with readable reasons. Friday is an overflow column with events but no focus blocks.
3. Tests first for the behavior that matters: pattern expansion (date ranges, ongoing, All Day, DST week boundaries), standing block precedence, Open slots, event placement, each risk rule including boundary cases. No tests that just mirror implementation or check styling.
4. Sample data in one fixture file mirroring my real shape: four ongoing patterns (Mon AM; Mon PM + Tue PM; Tue AM; Wed All Day + Thu AM) on clients WC, Quiddity, CSC and Internal, plus realistic Outlook meetings and a few personal events (preschool drop-off 8:30, school pickup 3:30 some days, one evening event). Make at least one half-day at risk and one double-booked.
5. The week grid UI: designed for a single 3840x1080 ultrawide, Mon–Thu as the main grid and Friday as a lighter overflow column. Each half-day shows its focus block (client color), meetings and personal events layered in, Open state, and risk badges with the reason on hover/focus. A source status bar that says "Sample data". Keyboard: arrows move between half-days, Enter opens details, t = today, [ and ] change week. Modern, calm, readable; respect light/dark. Bind the dev server to 127.0.0.1 only.
6. Run type checks and tests, launch the UI, take screenshots at 3840x1080 and inspect them yourself; fix what looks wrong.

Stop when step 1 is complete. Don't start the Dataverse connection. Give me the completion report from CLAUDE.md, plus how to open the app myself, and record any decisions or open questions in docs/.
