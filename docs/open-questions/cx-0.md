## CX-0

Open points on the [Coop comment contract](../technical/coop-contract.md), for Coop's owner to agree:

- Does Coop's own contract test fixture match proposal v1 here? `cooptimize/coop-agent` wasn't readable when this was written, so the fields are FocusTime's copy.
- `size` allows `XS` in the code (`COOP_PROPOSALS_V1`), while D529 and the glossary say S, M, L. Does Coop send `XS`?
- Are the new text limits on proposals acceptable to Coop?
- Which identity posts Coop's updates in Phase 1, and can Coop read `createdBy.id` on comments to check a brief's author?
- Does a `format=markdown` comment with a fenced block survive a real DevOps round trip, and is 32,000 characters safe?
- How does FocusTime tell Coop to stop? Today only deleting the brief does, and FocusTime's comment delete is limited to the status report window.
- The Nov 3 draft had `ask_type`, `due_at`, `priority`, `data_policy_id`, `event_id`, `run_id`, `sequence` and `work_item_changes`. None are in v1. Does Coop need any of them now?
- Is a brief edited in place, with no new revision, right to stop Coop?

