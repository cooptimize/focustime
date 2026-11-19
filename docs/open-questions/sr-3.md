## Report preview you can finish (SR-3, Nov 8)

- Q-SR3-1. Kat's window and layout for "Upcoming PTO and Holidays": how far ahead the email looks, whether holidays are listed with people or apart, and the wording. FocusTime uses the next two weeks from the report's Monday, one line per holiday ("Thanksgiving Day (observed) · Thu, Nov 26") and per run of a person's days away, all in date order, with a note that Kat's email may lay it out differently. One example of Kat's sent email would settle it.
- Q-SR3-2. Holidays need the reader role's Read on Working Days Calendar (Q-AS3-6). Until then production shows "Holidays couldn't be read" under the section, and PTO still shows.
- Q-SR3-3. "Created a story" counts only stories created through FocusTime (the write log). Counting stories created in DevOps itself would need `System.CreatedBy` on the stories Status already reads (one more field, no new request). Is that wanted?
- Q-SR3-4. Should Needs your update also count time on the focus timer against a to-do on the feature? It isn't counted now, since a to-do already counts.
- Q-SR3-5. Flaky candidate: `e2e/client-boundary.test.ts` (GD-2's held list, the tag and Close the loop's flag) timed out on a `waitFor` once in SR-3's full local run (Nov 8, 11 workers, Chromium) and passed when run again alone. It doesn't touch Status.

