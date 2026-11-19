## WP-1

- A monthly inventory, production only, could keep the numbers fresh. Not built: nothing in this step runs on its own.
- The prompt asked for e2e tests "in the demo". The demo has no app-level DevOps reader, and a demo reader would mean a demo source for every client's history; the e2e runs in the live harness (real sessions, fake DevOps and the stub AI, fictional data) instead. Say if a demo seed is wanted.
- DP-2's `data_platform` client rule overlaps the page's Platform. The page keeps its own (Azure, Fabric, Both) and shows DP-2's as a hint when not set. Should one feed the other?
- The Flex tier isn't used: a classification runs on the standard tier so the estimate and the cost stop mean the same thing. Flex could halve the cost.
- The person's monthly AI cap applies to a classification, like any request they start. A large first run may need a raised cap for that person (Admin › AI).
- Dev scales to zero: a run lives only while the replica does. The page asks for status every 5 seconds while open, which keeps it up; a closed tab can let it scale down, and the run then shows Stopped with Resume. Fine for a preview?
- Only the inventory's own reads are paced against the poller; the estimate reads only the store. A Resume of a classification needs a fresh estimate (the cost may have changed).
- The history sample (200 closed items per client) reads one request per item. With 30 clients that is up to 6,000 requests on a first run, paced; later runs read it again (history isn't kept between runs). Keep it, or keep the booleans per item and revision?
- The shared `htmlToText` (`sources/devops/normalize.ts`) throws on a numeric entity past U+10FFFF; the patterns page guards itself, the rest of FocusTime (screens, the poller's normalizing) doesn't. Fixing it is outside this step's scope; worth a one-line fix.
- After a restart the page shows a run as running until its heartbeat is 3 minutes old, then Stopped. Shorter risks stopping a live run that is waiting out a DevOps delay. Fine?
- An item's history over 200 updates is read in up to 5 pages back to back (one item's request). Rare; pace them too?
- The AI's "other" names are kept with client names and emails replaced; a person's name in them can't be recognized. The instructions forbid names, and the list is made from names and meanings only.

