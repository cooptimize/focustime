## VM-5: A Stop before the day (Nov 18)

- **A Stop before the planned time with auto-start off.** The rule looks only at the time, so a Stop at 2 AM followed by turning auto-start on at 7 AM still gets that morning's start. The reading that changes less; skipping when off would leave a skip nobody asked for.
- **A Stop between the preview and Confirm crossing the planned time.** The preview at 8:54 says "It will start again today at 8:55 AM."; a Confirm at 8:56 ends today's start, as the rule says, and the message after doesn't say it will start again. The preview isn't re-shown.
- **A day skipped two ways keeps its first reason** (Skip this one, then a Stop after the time, says "you pressed Skip this one"). The reading that changes less.
- **Don't skip on a day skipped by Not today** takes the skip back but doesn't bring Day's morning prompt back (it stays dismissed for the day).
- **"Stopped." while Azure is still stopping it.** The brief's words: the message after a Stop with a start to come says "Stopped. It will start again at 8:55 AM." though the chip shows Stopping… for a minute; the plain Stop's message still says "Stopping your VM".
- **Future days skipped** still say "Thu is skipped." in the line, without a reason; only today's skip says why (the brief's "Skipped today").
- **A Stop just before the planned time (from the review pass).** A Stop confirmed a minute or two before 8:55 is told "It will start again today at 8:55 AM.", but if Azure still shows the VM stopping at 8:55 the start claims the day, is refused ("now, so it wasn't started") and settles as Already on: the promised start doesn't happen, and the VM stays off (never the unsafe way). Waiting for a stopping VM before claiming the day changes when the start runs and its retries, which VM-5 leaves alone. Should the next step read again while it is stopping, or the preview leave out the line close to the time?

