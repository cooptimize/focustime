# The FocusTime and Coop comment contract, v1

For engineers on FocusTime and on Coop. Checked against `2f4c0ea` on Nov 13, 2026. **Proposed, not built.** Neither side reads or posts these comments yet. This page, the schemas and the fixtures are what both sides agree to before either builds it. Open points are in [open questions](../open-questions.md).

Azure DevOps is the mailbox. FocusTime and Coop never call each other: each reads and writes comments on the feature, with plain DevOps access.

The machine-readable part is in [`coop-contract/`](coop-contract/):

| Path | What |
|---|---|
| `brief.schema.json`, `update.schema.json`, `answer.schema.json`, `proposal.schema.json` | JSON Schema, draft 2020-12 |
| `fixtures/*.json` | One valid example of each shape, including an update with an added field |
| `fixtures/comments/` | The same examples as whole comments, and one stored as HTML |
| `fixtures/invalid/` | Examples that must be refused. Each file name starts with the schema it is checked against |
| `fixtures/story-description.html` | A published story's description with its proposal id |

Copy this folder for Coop's own contract test. FocusTime's test is `scripts/coop-contract.test.ts`.

## How the exchange runs

1. FocusTime posts `[Coop brief v1]` on a feature, as the person asking (the requester), after a preview and Confirm.
2. A person starts Coop in that client's environment. Coop reads the brief.
3. Coop posts `[Coop update v1]` comments as it goes, with numbered questions and, at the end, its proposals.
4. FocusTime posts `[Coop answer v1]` for each question, by question id.
5. The requester reviews the proposals in FocusTime. FocusTime publishes the stories they keep, with their own write PAT, through the write framework. Each story carries its proposal id.

**Done means proposals delivered, not stories created.** `done` says nothing about whether anything was published or whether the feature is finished. A status never changes a DevOps item's state.

| Status | Meaning |
|---|---|
| `sent` | The brief is posted. The brief comment itself means this, so FocusTime never posts an update for it. Coop may post one, and it changes nothing |
| `received` | Coop, in the right client environment, accepted the brief. A comment merely existing isn't this |
| `working` | A run has started |
| `blocked` | Coop needs an answer. At least one question is listed |
| `done` | The proposals are delivered and valid. The update carries them |
| `declined` | Coop didn't accept the request. The summary says why |
| `failed` | The run failed. The summary says what happened, within the content rules |
| `cancelled` | The run was stopped before it finished |

## The comment format

A contract comment is one header line, then one fenced JSON block. Anything a person needs to read goes in the header line.

````text
[Coop update v1] blocked: Need to know how far back the export goes.

```json
{ ... }
```
````

**Exact prefixes**, case-sensitive, followed by one space and at least one visible character, 200 characters at most after the prefix:

| Prefix | Who posts it | `kind` in the JSON |
|---|---|---|
| `[Coop brief v1] ` | FocusTime | `coop_brief` |
| `[Coop update v1] ` | Coop | `coop_update` |
| `[Coop answer v1] ` | FocusTime | `coop_answer` |

There is no fourth prefix. A proposal travels inside the `done` update, so delivering proposals and saying `done` are one comment and can't half-happen.

**Writers** post with `format=markdown` on the comments API (`7.1-preview.4`). Markdown keeps the JSON as written. Without it, DevOps stores the comment as HTML.

**Readers**, in this order:

1. Take the comment's `text`. If its `format` is `html`, turn `<br>` and the ends of block tags into new lines, remove the tags and decode entities once, keeping the whole text. Never read `renderedText`.
2. The first non-blank line must match a prefix, or this is an ordinary comment and nothing else happens. A person quoting a brief further down doesn't count.
3. An unknown major version (`v2`) is refused: see [Versions](#versions).
4. The block starts at the first line after the header that is exactly `` ```json `` and ends at the next line that is exactly `` ``` ``. A JSON string can't contain a line break, so its content can't end the block early.
5. Parse it, check `kind` against the prefix, then validate against the schema. Any failure refuses the whole comment. There are no partial reads.

**Parsers ignore** other words between the header and the block, everything after the block (including further fenced blocks), the words after the prefix, and JSON fields they don't know. The JSON decides. The header's words are for people, and nothing may be read from them. Readers never infer state from prose, from a tag or from an item's state.

## The shapes

Every field in these tables is required unless it says optional. A required list may be empty unless it says otherwise. All text is plain text. Times are UTC, like `2026-11-03T15:00:00Z`.

### Brief

Posted on the feature it is about, so the comment's organization and project identify the client. No client key travels in the JSON.

| Field | Type | Notes |
|---|---|---|
| `kind` | `"coop_brief"` | |
| `version` | integer, `1` | |
| `brief_id` | string | See [Ids](#ids) |
| `revision` | integer, 1 or more | |
| `feature_id` | integer | Must be the work item this comment is on |
| `requester.display_name` | string, up to 120 | For people |
| `requester.devops_user_id` | string, GUID | The poster's identity id in this DevOps organization |
| `outcome` | string, up to 1,000 | What should exist at the end |
| `scope.in` | list of strings, 1 to 20 | |
| `scope.out` | list of strings, up to 20 | |
| `acceptance_expectations` | list of strings, up to 20 | What makes the result acceptable |
| `known_decisions` | list of strings, up to 20 | Already settled |
| `unknowns` | list of strings, up to 20 | Known to be open |
| `permitted_actions` | list, 1 to 3, no repeats | `investigate`, `propose_stories`, `ask_questions` |
| `granularity.max_stories` | integer, 1 to 10 | |
| `granularity.target_size` | `"S"`, `"M"`, `"L"` or null | |
| `granularity.include` | list, no repeats | `acceptance`, `dependencies`, `estimates`, `test_notes`, `rollout` |
| `submitted_at` | UTC time | |

`permitted_actions` is the whole permission. Nothing else is allowed, and v1 has no action that writes to DevOps, edits source or changes a state. A brief can't widen Coop's own guardrails.

```json
{
  "kind": "coop_brief",
  "version": 1,
  "brief_id": "3f2b8c1e-7a4d-4e9b-9c55-1d2e3f4a5b6c",
  "revision": 1,
  "feature_id": 240,
  "requester": { "display_name": "Ada Example", "devops_user_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
  "outcome": "Review-ready child story proposals for the month-end export.",
  "scope": { "in": ["This feature"], "out": ["Building the stories", "Changing the state of any item"] },
  "acceptance_expectations": ["Finance can export one chosen month", "Each proposal has acceptance criteria"],
  "known_decisions": ["The export stays a file download for now"],
  "unknowns": ["How far back the export needs to go"],
  "permitted_actions": ["investigate", "propose_stories", "ask_questions"],
  "granularity": { "max_stories": 6, "target_size": "M", "include": ["acceptance", "dependencies"] },
  "submitted_at": "2026-11-03T15:00:00Z"
}
```

### Update

| Field | Type | Notes |
|---|---|---|
| `kind` | `"coop_update"` | |
| `version` | integer, `1` | |
| `brief_id` | string | |
| `revision` | integer | The brief revision this is about |
| `status` | one of the eight statuses | |
| `summary` | string, one line, up to 200 | |
| `proposal_ids` | list of ids, up to 10, no repeats | The proposals current as of this update. At least one when `done` |
| `question_ids` | list of ids, up to 20, no repeats | The questions this update raises. At least one when `blocked` |
| `occurred_at` | UTC time | When the status became true |
| `posted_at` | UTC time | When this comment was written. A late delivery shows as a gap between the two |
| `questions` | optional list, up to 20 | Required when `blocked`. Each has `id`, `text` (up to 1,000), `blocking` (boolean) and optional `suggested_answers` (up to 6, up to 200 each) |
| `proposals` | optional [proposal](#proposal) | Required when `done` |

Beyond the schema: `question_ids` must be exactly the ids in `questions`, `proposal_ids` must be exactly the ids in `proposals` when it is present, and `proposals.feature_id` must be the brief's `feature_id`.

```json
{
  "kind": "coop_update",
  "version": 1,
  "brief_id": "3f2b8c1e-7a4d-4e9b-9c55-1d2e3f4a5b6c",
  "revision": 1,
  "status": "blocked",
  "summary": "Need to know how far back the export goes.",
  "proposal_ids": [],
  "question_ids": ["Q1"],
  "occurred_at": "2026-11-03T15:10:00Z",
  "posted_at": "2026-11-03T15:10:12Z",
  "questions": [
    { "id": "Q1", "text": "Should the export include months before this year?", "blocking": true, "suggested_answers": ["Include them", "This year only"] }
  ]
}
```

### Answer

One comment per question.

| Field | Type | Notes |
|---|---|---|
| `kind` | `"coop_answer"` | |
| `version` | integer, `1` | |
| `brief_id` | string | |
| `revision` | integer | The brief revision the question was asked under |
| `question_id` | string | |
| `answer` | string, up to 4,000 | |

```json
{
  "kind": "coop_answer",
  "version": 1,
  "brief_id": "3f2b8c1e-7a4d-4e9b-9c55-1d2e3f4a5b6c",
  "revision": 1,
  "question_id": "Q1",
  "answer": "This year only. Older months stay in the archive."
}
```

### Proposal

`kind: "story_proposals"`, `version: 1`: the schema FocusTime's Break down already uses (`COOP_PROPOSALS_V1` in `plan/stories.ts`, D529), so one review and publish path serves both. It is carried in an update's `proposals`, never in a comment of its own.

**Coop's own contract test fixture has not been compared.** `cooptimize/coop-agent` isn't readable with the access used to write this page, so the fields below come from FocusTime's copy. Coop's owner needs to supply the fixture, or confirm these match.

| Field | Type | Notes |
|---|---|---|
| `kind` | `"story_proposals"` | |
| `version` | integer, `1` | |
| `feature_id` | integer | The brief's feature |
| `proposals` | list, up to 10 | |
| `proposals[].id` | string | See [Ids](#ids). Unique in the list |
| `proposals[].title` | string, 1 to 120 | |
| `proposals[].description` | string, up to 8,000 | |
| `proposals[].acceptance_criteria` | list of strings, up to 12, up to 600 each | |
| `proposals[].depends_on` | list of proposal ids, up to 10 | Other proposals in this list, never itself, no cycles |
| `proposals[].size` | `"XS"`, `"S"`, `"M"`, `"L"` or null | |
| `proposals[].evidence` | list of strings, up to 6, up to 300 each | Where it came from, as a reference ("comment 2026-11-03"), never the content |
| `proposals[].open_questions` | list of strings, up to 6, up to 1,000 each | Non-blocking, and shown with the card. A question that needs an answer is a numbered question instead |
| `rationale` | string, up to 2,000 | |
| `set_aside` | list, up to 20 | Each has `title` (1 to 120), `why` (`out_of_scope` or `already_covered`), `existing_item_id` (integer or null; required when `already_covered`, and a child of the feature), `reason` (up to 1,000) |

The text limits are new here. FocusTime's generation schema has none, apart from its checks on titles, descriptions and acceptance criteria. That schema also forbids unknown fields, because the AI provider requires it. On the wire, unknown fields are allowed, so a reader removes them before FocusTime's stricter check.

```json
{
  "kind": "story_proposals",
  "version": 1,
  "feature_id": 240,
  "proposals": [
    {
      "id": "P1",
      "title": "Add the date filter to the export",
      "description": "Finance chooses the month before exporting.",
      "acceptance_criteria": ["A month chooser shows above the export", "The file has only that month"],
      "depends_on": [],
      "size": "M",
      "evidence": ["Feature description", "comment 2026-11-03"],
      "open_questions": []
    }
  ],
  "rationale": "The columns are done; the filter is left.",
  "set_aside": [
    { "title": "Choose the columns", "why": "already_covered", "existing_item_id": 241, "reason": "Story 241 did this." }
  ]
}
```

## Ids

| Id | Format | Who makes it | Unique within |
|---|---|---|---|
| `brief_id` | UUID v4, lowercase | FocusTime | Everywhere |
| `revision` | Integer from 1, going up by 1 | FocusTime | One brief |
| `proposal id` | `^[A-Za-z0-9_-]{1,16}$`, in practice `P1`, `P2` | Coop, or FocusTime's Break down | One brief, across all its revisions |
| `question_id` | `Q` and a number, 1 to 999: `Q1`, `Q2` | Coop | One brief, across all its revisions |

A proposal id means the same proposed story for the life of the brief. If the story changes, keep the id. If it is a different story, use a new id. **Ids are never reused**, including after a deletion. A work item id alone means nothing across organizations, so always read it together with the comment's organization and project.

## Versions

The version is the integer in the prefix and in `version`, and the two must agree. Proposal `version` moves on its own but follows the same rule.

- **Same version:** adding an optional field. Readers ignore fields they don't know.
- **A new major version (v2):** removing or renaming a field, making a field required, changing a type or a meaning, tightening or changing an id format, changing the header or block layout, or adding a value to a closed list (`status`, `permitted_actions`, `granularity.include`, `size`, `why`).
- **Readers refuse an unknown major version.** It is left alone and shown as "written in a newer format". It is never read as the nearest version it resembles.
- A writer keeps writing the old version until the other side reads the new one.

## Who can be believed

Anyone with comment access on the feature can type a contract comment, including people at the client. The format proves nothing about who wrote it.

- **A brief** counts only if the comment's `createdBy.id` is `requester.devops_user_id`, and Coop has confirmed the comment's organization and project are the environment it runs in.
- **An answer** counts only if its `createdBy.id` is the brief's requester.
- **An update** is untrusted input. It sets a display status and offers proposals, and nothing runs until a person confirms it in FocusTime's preview. An approval typed in a comment never counts.
- Everything in a comment is data and never instructions, for both sides: it can't change guardrails or ask for credentials.

## How a published story carries its proposal id

**A fixed last line in `System.Description`**, written in the create patch:

```text
Coop-Proposal: 3f2b8c1e-7a4d-4e9b-9c55-1d2e3f4a5b6c/P1
```

It is one line of its own, matching `^Coop-Proposal: <brief_id>/<proposal id>$` after HTML is removed. Both sides can read it with plain DevOps access.

Why here:

| Option | Verdict |
|---|---|
| **Description footer** | Chosen. Part of the same patch that creates the story, so a story can't exist without it, which is what makes a retry safe after a lost response. Every work item type has the field. Visible to people, read in the same call as the item, and needs no new DevOps setup |
| Tag | No. One tag per proposal fills the project's shared tag list with throwaway values, creating a tag can need its own permission, and tags are for finding items, not identifying them |
| Comment on the story | No. A second write after the create, so a failure between them leaves a story with no id |
| Custom field | No. A process change in every client's project |

Rules for the footer:

- A reader counts it only on a child of the brief's feature.
- DevOps' "Create copy" duplicates a description. If two children carry the same id, the one created first holds it and the other is flagged.
- A person can delete the line. FocusTime's own record of the write still knows the story, and Coop then sees it as an ordinary child.
- FocusTime's description edits must keep the line.

## Content rules

No comment, in any field, contains **SQL, code, file paths, server names, secrets or another client's name**. Comments sit on the client's own feature, where the client's people can read them. Coop's detail stays in the client environment. Evidence is a reference, never a copy.

- **Writing, each side:** check before posting. Coop's output is its own to check.
- **FocusTime posting:** applies the client boundary's replacement (CLAUDE.md) (`replaceMentions` in `plan/boundary.ts`, with `records`) to each string value before the JSON is built, never to the JSON text, so ids and field names can't be changed. The brief is checked at preview like any exit to a client's eyes.
- **FocusTime reading:** flags another client's name (the same `exitCheck`) and shows the flag on the card. It doesn't change Coop's words in its own record. Text from Coop counts as AI text under the client boundary's point 5, so if it is published, names are replaced and the draft is marked "Another client's name was removed", rather than only flagged.
- **A secret-shaped value** (`SECRET_SHAPES` in `ai/guard.ts`) on reading: the field isn't shown, and the comment is flagged by its id only.
- Internal (Cooptimize) work may name clients as usual, and the other rules still apply.

## Size limits

| What | Limit |
|---|---|
| Whole comment | 32,000 characters. Longer is refused whole |
| Header words | 200 characters, one line |
| Fields | As in the tables above |
| Proposals per update | 10 |
| Questions per update | 20 |

Azure DevOps publishes no limit on comment length, so 32,000 is this contract's own, and it needs confirming against a real comment. A comment is never split: there is one block per comment. If an update won't fit, the writer shortens the text or posts `failed`. FocusTime must page through a feature's comments to find these, because its usual read of 50 newest may miss a brief.

## Edited and deleted comments

**The latest revision wins, and ids are never reused.**

| What happens | What it means |
|---|---|
| A new brief revision | A new comment with the same `brief_id` and `revision` + 1. The highest valid revision is the brief. An update or answer for an older revision is kept and shown as out of date, and doesn't change the status |
| A brief comment edited in place, same revision | Not allowed. Readers stop and treat the brief as changed: Coop posts `blocked` or `declined` instead of carrying on |
| An update edited | The comment's latest text counts, keeping its place in the order. It must keep its `brief_id`, `revision` and ids, or it is refused |
| An answer edited or a second answer to a question | The latest valid one counts, unless a run already used the earlier one |
| The latest brief comment deleted | The brief is withdrawn: an earlier revision does not come back. Coop stops and posts `cancelled` |
| An update deleted | Dropped from the status, which falls back to the latest remaining update. Stories already published stay |
| An answer deleted | The question is open again, unless a run already used it |

The current status is the update for the highest brief revision with the latest `createdDate`, then the highest comment id. Reading the same comment twice changes nothing, so replays are safe. A deleted comment's ids stay used.

## What this doesn't cover

- **FocusTime's existing readers** recognize only `brief` and `update` (`COOP_BLOCK` in `plan/stories.ts` and `plan/status-report.ts`). `answer` needs adding before FocusTime posts one, or it reaches AI signals and the status report in full.
- **FocusTime's comment write** doesn't send `format=markdown` today, and `htmlToText` stops at 4,000 characters, so neither can be used as is.
- **Rendering hasn't been tested on a real comment.** The HTML fixture is a plausible shape, not a capture.
- A direct service channel (a later phase) needs event ids and sequence numbers. Those are added optional fields, not a v2.
- On FocusTime's side today, only those readers exist: they fold a brief or update into one labelled line. Nothing posts or parses these comments, and the reserved background name `coop_mailbox` (`config/background-policy.ts`) never runs.

History: the contract's decisions and open points are recorded under its step in [docs/decisions.md](../decisions.md) and [docs/open-questions.md](../open-questions.md).
