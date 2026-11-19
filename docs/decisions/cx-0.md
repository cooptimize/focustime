## CX-0: the FocusTime and Coop comment contract v1

Unnumbered until merge. Proposed: nothing reads or posts these comments yet. [The contract](../technical/coop-contract.md), its schemas and fixtures.

| # | Status | Decision |
|---|---|---|
| - | Proposed | CX-0: DevOps comments are the mailbox (Phase 1 of the Nov 3 design). Each is a header line and one fenced JSON block, with exact case-sensitive prefixes `[Coop brief v1]`, `[Coop update v1]` and `[Coop answer v1]`. The JSON decides; the header's words are for people. |
| - | Proposed | CX-0: the header must be the comment's first non-blank line, so a person quoting a brief further down isn't read as one. |
| - | Proposed | CX-0: writers post with `format=markdown`, and readers still accept a comment stored as HTML. |
| - | Proposed | CX-0: no fourth prefix. Proposals travel inside the `done` update, so "proposals delivered" and `done` are one comment and can't half-happen. |
| - | Proposed | CX-0: proposal v1 is FocusTime's `COOP_PROPOSALS_V1` (D529), with text limits added. Unknown fields are allowed on the wire (the version rule), unlike the strict schema the AI provider needs. A test keeps the two in step. |
| - | Proposed | CX-0: a published story carries `Coop-Proposal: <brief_id>/<proposal id>` as the last line of `System.Description`, written in the create patch. It is atomic with the create, so a retry is safe; a tag would fill the shared tag list, a comment is a second write, and a custom field is a process change per client. |
| - | Proposed | CX-0: a brief or answer counts only if the comment's `createdBy.id` is the requester. An update is untrusted input that only sets a display status and offers proposals. An approval typed in a comment never counts. |
| - | Proposed | CX-0: the requester is a display name and a DevOps identity id. The Nov 3 draft's tenant id, object id and UPN are left out because comments are readable by the client. |
| - | Proposed | CX-0: v1 has no action that writes: `permitted_actions` is `investigate`, `propose_stories`, `ask_questions`. Adding a value to any closed list is a v2. |
| - | Proposed | CX-0: FocusTime applies GD-2's replacement per string value before building the JSON, and treats text from Coop as AI text under GD-2 point 5 if it is published. |
| - | Proposed | CX-0: 32,000 characters per comment, this contract's own limit (Azure DevOps publishes none). A comment is never split. |
| - | Proposed | CX-0: no JSON Schema library was added. `scripts/coop-contract.test.ts` carries a small validator that throws on any keyword it doesn't implement. |

