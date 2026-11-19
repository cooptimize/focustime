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
- **From the demo review, left as they are** (each is Calls as it was, or the brief's own words):
  - "142 lines" for a transcript counts what was said in turns (a speaker's run of lines is one), as the Transcript view does; the brief's words are kept. "4 turns" would say it better if wanted.
  - A pasted transcript's speaker with my own name isn't taken for me unless I'm on the call's invite; a hand-added call has no invite, so my own promise is "noted with this call". The same as an uploaded file; matching a speaker's name to the signed-in person would change who owns a promise everywhere.
  - Speaker 1 and Speaker 2 stay unnamed (naming them is outside this step).
  - Who sees it is said three ways ("Only you see it" in the header; "for this call's reviewers and attendees only" in the Transcript and notes views). On a call I added by hand they mean the same person (me); one sentence everywhere is a Calls change.
  - A paste the AI finds nothing in closes the call (Calls' rule since MC-4) and its page says "Nothing to propose from this call."; the call leaves Needs you for Closed.
  - What Keep, Create and Skip all do is the review's, unchanged.
