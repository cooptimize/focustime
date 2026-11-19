## MC-7: Paste a transcript or your notes into a call (Nov 19)

- **Leaving with text in the box** asks on a reload or closing the tab (the browser's own question) and on Cancel or Esc in Add a call and the replace box. Moving to another tab or another call inside FocusTime doesn't ask: the app's navigation has no guard to hang it on, and adding one would change every tab. Taken as the smaller reading; a guard in the app's router would close it.
- **A dropped file's replace question** still says "Replace this call's transcript?" (MC-1d's words); only the paste names what is there. Naming it for a drop too is one line if wanted.
- **A pasted transcript with some numbered voices and some names** is treated as unnamed as a whole (as Pocket's), so no named speaker is taken for a person either. The other reading (only the numbered lines unnamed) would need a per-line rule in the AI step.
- **Clock times** ("10:03 AM", as some tools copy) are left out, not turned into times into the call: FocusTime doesn't know when the recording started. A time into the call needs one.
- **The writer of notes is whoever pasted them** (their "I"). If a reviewer pastes a colleague's notes, "I" is still the paster. The box says nothing about it; a line under it could.
- **"Ana: hi / Ben: hi"** (two speakers, each once, no times) reads as notes until switched: a speaker is sure only when they speak again or have a time, so that "Budget: / Timeline:" notes aren't taken for a transcript. Short exchanges need the switch.
- **A file over 4000 lines** is still cut at 4000 without a word; a paste over 4000 is refused, as the brief asks. Making a file say so too would change the upload.
- **The brief puts browser tests in e2e/calls/**, which doesn't exist; Calls' browser tests are in `e2e/week/`, so `e2e/week/calls-paste.test.ts` sits beside them.
- **The demo's two pasted calls are closed** so that no count elsewhere in the demo moves; an open one would need 27 browser tests' counts changed. They show how a pasted call reads; the screenshots of an open one come from a paste in the browser.
