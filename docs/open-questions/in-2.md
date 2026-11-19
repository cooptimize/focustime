## Send invites from FocusTime (IN-2, Nov 7)

- Q-IN2-1: a Teams post that gets no answer at all (a timeout after Graph may have taken it) counts as not sent, so Retry posts again and could post twice. LP-1 has the same edge. Reading the chat's last few messages before a retry would need `Chat.Read` on a chat FocusTime didn't register; worth it?
- Q-IN2-2: a held send (for Retry) lives in the server's memory for 30 minutes, so Retry is gone after a restart or a scale-out to another instance. Persist it (an app table), or is "invite again" enough?
- Q-IN2-3: a draft counts as invited ("via Email (Outlook draft)") though the admin may never send it. Should a draft row read "Draft for <name>" until the admin says they sent it, as LP-1's "I sent it"?

