# Close the loop: sending updates from FocusTime (LP-1)

For the Entra admin, and for anyone wondering why FocusTime asks for these permissions.

Close the loop drafts the update you promised someone and sends it, as you, by Teams, email, a DevOps comment or a
call note. Nothing is sent until you press Send on the preview, which shows where it goes and who will see it (people
outside Cooptimize by name). Without the permissions below everything still works the old way: FocusTime opens Teams
or Outlook with the message prefilled, you send it there and press Mark sent.

## The permissions

IN-2 uses the same permissions, the same way, for an admin's invite from Admin › People › Who's set up (a Teams 1:1
message or an Outlook draft or email to Cooptimizers who haven't signed in). Nothing new is asked for.

All are **delegated** Microsoft Graph permissions on the existing "FocusTime" app registration: FocusTime acts as the
signed-in person, with what that person can already do in Teams and Outlook. None is application (app-only), and none
requires admin consent by default.

| Permission | Why | Asked for | Doc |
|---|---|---|---|
| `ChatMessage.Send` | Post your update in the client chat the promise came from, or in a 1:1 chat with someone at Cooptimize | The first time you choose Allow sending from FocusTime for Teams | [Send chatMessage in a chat](https://learn.microsoft.com/en-us/graph/api/chat-post-messages?view=graph-rest-1.0) |
| `Chat.Create` | Find or start that 1:1 chat (Graph returns the existing one) | With `ChatMessage.Send` | [Create chat](https://learn.microsoft.com/en-us/graph/api/chat-post?view=graph-rest-1.0) |
| `Chat.Read` | Read back the message you just posted (already granted per person for client chats, AP-1) | Already asked by AP-1; without it the post's own answer counts as confirmation | [Get chatMessage](https://learn.microsoft.com/en-us/graph/api/chatmessage-get?view=graph-rest-1.0) |
| `Mail.ReadWrite` | Create the Outlook draft of your update in your mailbox and read back that one message | The first time you choose Allow for an email draft | [Create message](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0) |
| `Mail.Send` | Send that draft when you chose Send now | The first time you choose Send now | [Send message](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0) |

Least privilege: these are the lowest permissions the calls accept (see each page's Permissions table and the
[permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)). `Mail.Send` alone can't
create a draft and `Mail.ReadWrite` alone can't send, so the default (an Outlook draft) needs only `Mail.ReadWrite`.
FocusTime reads the draft back by its immutable id (`Prefer: IdType="ImmutableId"`,
[Immutable identifiers](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)) so it can tell when it has moved
to Sent Items.

## How they are granted

**Incrementally, per person, like `Chat.Read`.** Each permission is asked for only when someone first needs it, from
the preview's "Allow sending from FocusTime" (`/auth/microsoft/login?consent=teams_send`, `mail_draft` or `mail_send`),
on the same refresh token. Nobody gets these permissions by signing in.

They are **not** added to `GRAPH_SCOPES` in `infra/scripts/app-registration.sh`, on purpose:

- Sign-in asks for Graph's `.default`, so anything in `GRAPH_SCOPES` would be granted to everyone at sign-in, not only
  to people who use Close the loop.
- Rerunning that script makes one tenant-wide grant of `GRAPH_SCOPES` and drops permissions consented later (its own
  comment says so for `Chat.Read`). Do not rerun it for LP-1.

## If your tenant needs admin approval

If user consent is restricted in the tenant, the consent screen says an admin must approve. Until then the preview
shows: "Sending from FocusTime needs an admin to approve access. Until then, open it prefilled and mark it sent."

To approve, an Entra admin (Cloud Application Administrator or higher), in the Entra admin center, not from FocusTime:

1. Enterprise applications › FocusTime › Permissions (or the pending request under Admin consent requests).
2. Review the requested delegated permissions: `ChatMessage.Send`, `Chat.Create`, `Mail.ReadWrite`, `Mail.Send`.
3. Grant admin consent for Cooptimize. This grants the delegated permissions for everyone; each person still sends only
   from their own preview, as themselves.

Leave the "Coopilot Desktop" registration alone.

## Check it

- Settings › Connections › Microsoft permissions lists each one as Allowed, Not allowed yet or Needs admin consent.
- Settings › Data › Close the loop sends lists every send: when, where, how many people outside Cooptimize, and
  whether it was read back.
- The demo never sends anything: its posts and drafts stay in memory, and its Send now shows the fallback.

## Turning it off

Remove the delegated permissions from the FocusTime enterprise application (or revoke a person's consent). Close the
loop then shows the fallback: open in Teams or Outlook prefilled, then Mark sent. Close without sending is unchanged.
