# The assistant's interface (AS-1)

One service, `assistant/service.ts`, answers the in-app panel and the Teams bot (TB-1). The types are in
`assistant/types.ts`; this page says how to use them. The shape is locked: a change is listed under Changes at the
end, with the date.

## Calls

| Call | Input | Output |
|---|---|---|
| `handle` | `{ person, channel, text, context? }` | `{ turnId, status, reply, cards, proposals, links }` |
| `confirm` | `{ person, proposalId, edits? }` | `{ ok: true, result, undo?, message }` or `{ ok: false, reason, message, proposal? }` |
| `cancel` | `{ person, proposalId }` | `{ ok: true }` |
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
rhythm's Confirm today, Move…, Move the rest and Close out). Only FocusTime's plan tools (`PROPOSE_TOOLS` in
`assistant/allowlist.ts`): `move_pick`, `keep_pick`, `drop_pick`, `confirm_day`, `move_picks`, `close_day`; anything
else returns `{ ok: false, message }`. The args are the tool's own, as the model would give them. The proposal is built,
stored, expires and is confirmed exactly like a typed request's, with the same checks (the person's own picks, the
allowlist, a fresh preview). It returns `{ ok: true, proposal }` or `{ ok: false, message }`.

- `move_picks { moves: [{ pickId, date, half }] }` (1 to 12): one row per pick, one Confirm, each through `pick.move`.
- `close_day { date, donePickIds }` (today or earlier): the chosen picks done (`pick.mark_done`), every other planned
  pick moved to its client's next block this week (UI-B's `nextBlockFor`) or left on the unfinished list when there's
  none, then the day closed out (`closeout.commit`). The preview shows every step; a move that fails is skipped and
  named, and the proposal fails if the close out does.

## Cards

`item`, `block`, `pick`, `send`, `promise` and `note`, each with a `link`. A front end that can't show a card shows
its title and link.

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
