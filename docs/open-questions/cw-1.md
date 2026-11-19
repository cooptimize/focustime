## Co-working calls (CW-1, Nov 7)

- Q-CW1-1: "who's on it" while a call is live. Graph's chat messages list participants only in the call ended event; showing who is on a live call would need the calls or online meetings APIs (a new permission, likely application-level). Worth it, or is "started by" enough?
- Q-CW1-2: freshness is the shared poll's 5 minutes. If people want the indicator within a minute, the options are a shorter Rule for everyone (more reads of every chat all day) or Graph change notifications on registered chats (a new subscription and endpoint, which CLAUDE.md rules out today). Is 5 minutes fine in practice?
- Q-CW1-3: should a live call show on Today's block card too (not only the Now card), for a client whose block isn't the one under way?
- Q-CW1-4: a live call in a chat whose reading is off (D523) can't show. Should co-working calls be read even when an admin turned reading off for the messages, or is the switch meant to cover everything?
- Q-CW1-5: not tried against real Teams: that starting a call from a group chat's header gives `callEventType` call (or meeting for Meet now) with a callId the end event repeats, and how long the end event takes. Check on dev with a registered chat after deploy.

