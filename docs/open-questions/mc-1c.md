## MC-1c

- Microsoft's docs say an invitee can read a meeting's transcript (calltranscript-get) and list `GET /me/onlineMeetings?$filter=JoinWebUrl eq …` for delegated OnlineMeetings.Read with no organizer-only rule, but this hasn't been tried against real Graph for a call someone else organizes. If the lookup or the transcript list comes back empty or 404 for an attendee, Admin's line will say "Microsoft didn't find this call for <name>". The fallback then (organizer as first reader, as the brief described) needs the organizer to be a FocusTime user and a reviewer. Try it on dev with the reported call first.
- The brief named `actions/meetings.ts`, which doesn't exist; the meeting rules are `plan/meetings.ts` (and the store `store/meeting-store.ts`), which this step changed. Read that way.
- The candidates list now shows only weekly calls with an occurrence in the next 5 weeks (from the calendar view). A call paused for longer has to be pasted. Fine?
- "Diagnostics can count them": the failures are logged by kind (`meeting_graph_failed`, `meeting_action_failed`, the job's `meeting_check` and `meeting_layout`), but Settings › Data › Diagnostics (DX-1) counts only chat sorting and shows no meeting counts yet. Add a meeting section there, or is the log enough?
- The demo has a fictional calendar link that always answers "Microsoft isn't answering", to show the failure. Keep it in the demo, or test-only?
- The organizer notice ("<name> organizes this call. FocusTime reads its transcript through their sign-in") wasn't built, because the docs say attendees can read it. If the dev check above fails, build it then.

