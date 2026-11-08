# The assistant's interface (AS-1)

One service, `assistant/service.ts`, answers the in-app panel and the Teams bot (TB-1). The types are in
`assistant/types.ts`; this page says how to use them. The shape is locked: a change is listed under Changes at the
end, with the date.

## Calls

| Call | Input | Output |
|---|---|---|
| `handle` | `{ person, channel, text, context?, answer? }` | `{ turnId, status, reply, cards, proposals, links }` |
| `confirm` | `{ person, proposalId, edits? }` | `{ ok: true, result, undo?, message }` or `{ ok: false, reason, message, proposal? }` |
| `cancel` | `{ person, proposalId }` | `{ ok: true }` |
| `undo` | `{ person, proposalId }` | `{ ok: true, message, notBack }` or `{ ok: false, message }` (AS-2: a confirmed move) |
| `transcribe` | `{ person, audio, mime, seconds, context? }` | `{ ok: true, text }` or `{ ok: false, reason, message }` |
| `history` | `{ person, limit? }` | `Turn[]`, newest last |
| `clear` | `{ person }` | `{ ok: true, removed }` |

- `person` is `{ userId }`, the Entra object id. The server builds everything else (clients, write PATs, settings)
  from it. TB-1 maps the Teams user to the oid itself and passes nothing else about the person.
- `channel` is `"panel"` or `"teams"`. In `"teams"`, every `Link.href` is absolute (the app's public URL plus the
  address); in `"panel"` it is the address only (`#/ahead?item=4417`).
- `context` is what the person is looking at: `screen`, `clientKey`, `itemId`, `block { date, half }`, `date`.
  Teams usually sends none, or `{ screen: "teams" }`.

## Statuses

`ok`, `off` (AI for FocusTime is off), `client_off` ("The assistant is off for <client>"), `not_set_up` (no
provider key), `over_budget` (a cap reached or set to $0), `refused` (the guard refused it: another client's data,
a secret, an outside address), `which_client` (two clients named; nothing sent). Every status but `ok` has a plain
`reply` and a link to the command menu (`#/commands`).

## Proposals

- Every write is a proposal; nothing is written by `handle`.
- A proposal expires 15 minutes after it was made (`expiresAt`). `confirm` after that returns `expired`.
- `confirm` re-checks, in order: the proposal is the person's and open; the action is still allowlisted; the client
  is still one of theirs and matches the proposal's; then it re-runs the preview fresh (DevOps: the item's revision
  and before-values; FocusTime: the pick or row as it was). If anything changed it returns `changed` with the fresh
  `proposal` to confirm again. Then it dispatches the same action the button calls, which does its own permission
  check (`canEdit`, SW-1's rules, the write PAT).
- `edits` may change only the fields in `proposal.editable` (a comment's `text`, a description's `after`, a pick's
  `date` and `half`). An edit makes `confirm` re-preview; it still writes in the same call.
- `undo` on a confirmed DevOps write is the write log entry (`devops.preview { kind: "undo", writeId }` in the app);
  a plan undo is the reverse action, offered as a new proposal by asking ("move it back").

## Proposals from a button (TB-2)

`propose({ person, tool, args })` makes a proposal without an AI call, for a front end's own button (the Teams
rhythm's Confirm today, Move…, Move the rest and Close out, and PK-1's Done and Undo). Only `PROPOSE_TOOLS` in
`assistant/allowlist.ts`: FocusTime's plan tools `move_pick`, `keep_pick`, `drop_pick`, `confirm_day`, `move_picks`,
`close_day`, and PK-1's `item_done` and `item_undo`; anything else returns `{ ok: false, message }`. The args are the tool's own, as the model would give them. The proposal is built,
stored, expires and is confirmed exactly like a typed request's, with the same checks (the person's own picks, the
allowlist, a fresh preview). It returns `{ ok: true, proposal }` or `{ ok: false, message }`.

- `move_picks { moves: [{ pickId, date, half }] }` (1 to 12): one row per pick, one Confirm, each through `pick.move`.
- `close_day { date, donePickIds }` (today or earlier): the chosen picks done (`pick.mark_done`), every other planned
  pick moved to its client's next block this week (UI-B's `nextBlockFor`) or left on the unfinished list when there's
  none, then the day closed out (`closeout.commit`). The preview shows every step; a move that fails is skipped and
  named, and the proposal fails if the close out does.
- `item_done { pickId, state }` (PK-1, button only): a to-do checked done; its DevOps item set to `state` (one of its
  type's done states, or null for the Completed one) through the existing state write, only when `devops.done_offer`
  offers it (my write PAT, the shared canEdit, not done or removed already). The write names the pick, so Undo finds it.
- `item_undo { pickId }` (PK-1, button only): a to-do unchecked after `item_done` wrote; that write's own undo, while it
  is still the newest write on the item (`devops.undo_offer`).

## Cards

`item`, `block`, `pick`, `send`, `promise` and `note`, each with a `link`. A front end that can't show a card shows
its title and link.

## Questions with choices (AS-2)

When a choice is missing (which client, which to-dos, which item, which block), `handle` answers with a `question`
card instead of giving up: `{ kind: "question", text, choices: [{ label, value }], expiresAt }`. The server builds the
choices from my own data only (client names, dates, blocks and counts, item ids and titles of my own items), never
from chat text; "or just type it" is always allowed.

- The panel shows the choices as chips on the last answer while it is open; Teams shows one button per choice
  (`verb: "answer"`, `{ questionId: "q<turn id>", value, label }`), claimed once in `teams_bot_cards`.
- A tap sends `handle({ text: label, answer: value })`; typed words answer it too (a number, "the second", "all", or
  words that match one choice). The question is kept on its assistant turn (`assistant_turns.pending_json`) and
  waits 10 minutes (`QUESTION_MINUTES`). After that, or when my next message clearly asks something new, the request
  starts fresh.
- Nothing from any client goes to the AI until a client is chosen. After a question, the reply is never the list
  of what the assistant can do: it asks again ("I still need to know: …") or says why in one sentence.

## Moves the server builds (AS-2)

`move_plan` takes only what the model read from my words: `fromDate`, `fromHalf`, `toDate`, `toHalf` and `which`
(`named` or `all`). The server finds the to-dos (`assistant/resolve.ts`: titles, `#ids` and parent features across my
clients, never guessing between two), checks each target with the Board's own `dropCheck`, and builds one proposal,
grouped and labelled by client when there are several. A proposal across clients is built by the server, and no
client's text passes through the AI for it. To-dos that can't move are listed with why; the rest move. `confirm`
returns `undo: { kind: "moves", id }`; `undo` puts each back (`pick.uncarry` for a copy on another day, `pick.move`
within the same day) and lists any that can't go back with the reason.

## Compound updates (AS-2)

`item_update` is one card for one item with up to three parts: its done state (from the item's process, through
`devops.done_offer`'s item mode; never a hard-coded state name), a comment in my words, and a target date (into
Ahead's change set). Only items `canEdit` allows; GD-1's scan applies to the comment. One Confirm writes each part
through the write framework (a fresh preview, test /rev, read back, audit log); `confirm` returns
`parts: [{ label, ok, message, undo? }]`. A part that fails says which and why, and the others stay done, each with
its own undo in Settings › Data. More than three changes: the assistant asks to split it.

## Voice

`transcribe` is the panel's. Audio up to 60 seconds and 2 MB, `audio/webm` or `audio/mp4`; never stored or logged.
It needs AI for FocusTime on and, when a client is in focus (`context.clientKey` or the selected item's client),
that client's Allow AI ("Voice is off while <client> is in focus"). The text comes back to the person to edit; it is
sent only by a `handle` call.

## For the Teams bot

`server/main.ts` exports `assistants` (`server/assistant.ts` `createAssistantHub`): this interface by the person's
`userId`, channel `"teams"` by default (absolute links), `forChannel("panel")` for the panel's. TB-1's bot keeps its
own small types and reaches it through `teamsAssistant()` in `server/teams/assistant.ts`.

## Changes

- Nov 7 (AS-3): additions only. Two card kinds: `section` (`{ title, lines: { text, link? }[] }`, one part of an
  answer to a question, a client's name or "Your days" as its title) and `suggest` (`{ text, choices, expiresAt }`:
  up to 3 suggested steps or up to 6 example questions; a tap sends the choice's value as `answer`, which builds the
  usual proposal or asks the example; nothing runs from the tap). `CONVERSATION_MINUTES` (30): how long a follow-up
  resolves against the last answer and its taps work. `RUNS` adds `status.load` and `meeting.mine` (reads).

- Nov 6 (PK-1): additions only. The tools `item_done` and `item_undo`, in `PROPOSE_TOOLS` and `BUTTON_ONLY`: never
  given to the model (not in the intent enum, the tool list or the allowed list). `ProposeInput["tool"]` adds both.

- Nov 5 (TB-2): additions only. `propose(tool, args)` (above), and the tools `move_picks` and `close_day`, which the
  model may also propose from a typed request. `RUNS` adds `pick.mark_done` and `closeout.commit`; `NEVER` adds
  `teams.` (the assistant can't send Teams messages or tests).

- Nov 5: no change to the shape TB-1 coded against (handle, confirm, cancel, the statuses, 15-minute expiry,
  absolute links in Teams). Additions only:
  - The panel's `assistant.history` action also takes `context` and returns `gate`
    (`{ assistant: "ok" | "off" | "not_set_up", voice: { on, message } }`), so the mic is off before anything is sent.
    This is the panel's action, not part of `Assistant`.
  - Ids are numbers in this interface; TB-1's bot holds them as strings and the adapter converts.
  - A `#/commands` link is the command menu: the panel opens it; Teams shows it as a link into the app.

- Nov 6 (AS-2): additions only. `handle` takes `answer` (a tapped choice's value) and may return a `question` card;
  `undo` (a confirmed move); `confirm`'s ok result may carry `parts` (a compound update) and `undo.kind: "moves"`.
  The tools `move_plan`, `item_update`, `inbox`, `link_search`, `unlink`, `link_comment`, `inbox_seen` and `snooze`;
  every tool has 3 to 5 example phrasings in the fixed instructions, with the glossary. `RUNS` adds `pick.uncarry`,
  `inbox.list`, `inbox.count`, `inbox.seen`, `inbox.snooze`, `conversations.search_items`, `conversations.unlink`
  and `my_promises.unlink`. Teams cards add the verbs `answer` and `undo`.
