## VM-2

- Azure refusing the start with 403 (no deallocate or start permission on the VM) is treated as a failure ("couldn't start your VM"), not as a sign-in problem: Allow Azure access wouldn't fix it. Is that the right word for it?
- PTO is read fresh from Dataverse for each start (a cached snapshot isn't trusted: PTO entered this morning must count). Someone without a Dataverse user id, or on a day Dataverse can't be read, gets no automatic start. Is a cached snapshot good enough on a Dataverse outage?
- A start Azure accepts and later fails (the operation ends Failed or times out) is said as "is starting" and the write log has the failure, but no second notice. Add a "couldn't start" notice from the follow?
- Once a day is claimed the attempt is spent, even when the VM turned out to be running already or the start failed. A second try later the same morning would need a retry rule; none for now.
- PTO or holidays that can't be read leave the VM off that day (the safer reading). Should it say so?
- In the demo the environment comes only from `FOCUSTIME_DEMO_AUTOSTART_ENV` (tests); the hosted demo sessions never set it, so they show "production only". Fine?
- The auto-start uses each person's stored sign-in (their refresh token) while they're away. If Entra's token lifetime or a conditional access policy ends it, the start is skipped with "couldn't sign in". Worth watching on prod for a week.
- The demo's working week is Monday to Thursday, so its pause takes a calendar week; on prod it depends on each person's hours.

