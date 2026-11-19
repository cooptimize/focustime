## RF-1

- The week model always treats Friday as the catch-up day (`week/build.ts`), and Dataverse focus blocks are Monday to Thursday only, so a "Monday to Friday" week behaves like Monday to Thursday: amber Wednesday, red Thursday. If someone's catch-up day is ever another day, `dotDays` already reads the day's kind, not its name.
- Late in Kolkata or Tokyo, Monday's working day ends before the 7:00 AM ET send, so Monday is red for them (their last day before the report). Right?
- "Start of the day" for the dot is the start of that day's working hours, not midnight. Amber Wednesday means from Wednesday's first working hour. Right, or should it be midnight?
- The dot uses Kat's fixed schedule (Monday 7:00 AM ET) for the send, not each client's watermark. If Kat sends late, the dot goes at 7:00 anyway. Fine?
- With no focus blocks at all the working days stand in. Should such a person get no dot instead?
- If Kat sends a client's report late, the dot still goes at 7:00 AM ET while the "3 to update" hint (counted against Kat's real last send) can stay until the next read. Worth reading Kat's send per client for the dot?
- The brief said the command menu's Status entry keeps its hint "3 to update". The Ctrl+K entry's hint is its key (now 4); "3 to update" is the phone ⋯ menu's, which keeps it. Should Ctrl+K show "3 to update" too?
- Setup's Done screen still offers "Plan your week" (a setup screen, not Day). Rename it to "Add work to your week" with WD-1's words?

