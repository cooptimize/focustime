## KB-1

- Q-KB1-1: the 6,000 token budget leaves SQL Conventions out of a Gold fact feature for a client on the defaults (both D365 systems and Fabric): the real matched set is about 9,100 tokens. Raise the budget (the cost is small), or treat the source articles as lower priority than the general SQL ones? Coop rides them on every task, and the brief said artifact, then layer, then agnostic, so they stay ahead for now.
- Q-KB1-2: a layer word pulls every article of that layer ("Gold" brings Dimension Tables, Stored Procedures and Views too), as in Coop. Fine for a planning prompt, or should drafts stop at the exact artifact when one matched?
- Q-KB1-3: should `meeting.capture`'s proposed DevOps items use the standards too? It wasn't in the brief's list, it runs in the background on Flex and its proposals are shaped from a transcript.
- Q-KB1-4: `AGENTS.md` in the standards repo has unresolved merge conflict markers in "Structure and routing" (`<<<<<<< Updated upstream`). FocusTime doesn't read that file, so nothing here depends on it; worth fixing in the repo.
- Q-KB1-5: GitHub allows 60 anonymous API requests an hour per IP. Two a check is well inside it, but the Container App shares an outbound IP. If that ever bites, a token goes through the Key Vault scripts.

- Q-GD3-1. Step 0's database counts (held by chat, audience and reason) weren't read: dev's database takes connections only from Azure services, and running a read inside the dev container was refused in this session. The re-check logs them when it first runs (`held_recheck`, `all:before:<audience>:<reason>`, `all:released`, `all:still_held`) and keeps them in `org_settings` `meta/held_recheck_v1`.
- Q-GD3-2. Should bulk Sort all and Mark all have an Undo? Neither single action has one today (This is work brings a message back from Chatter).
- Q-GD3-3. Should a chat with reading off still have its held messages re-checked? They are skipped for now, as nothing else works on such a chat, and may show "Reason unknown" until they expire.

