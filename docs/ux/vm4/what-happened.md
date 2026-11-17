# VM-4: what happened on Nov 17

Read from production's logs (Log Analytics `ft-prod-log`, read only, the queries in [operations](../../technical/operations.md#the-vm-4-queries)). Times are UTC. Only kinds, counts, statuses and times: no names, ids or text.

## In two sentences

The "bad request" was a real database failure: a check-in answer in a long time zone name wrote a 43-character time into a 40-character column on SQL Server, and the server called every unexpected failure a bad request. The Unknown chip was Azure refusing about one read in four of the VM's state after the 21:08 restart and the person's sign-ins, which FocusTime showed at once as Unknown and kept for a minute; why Azure refused isn't in the logs, because its error code wasn't logged until now.

## Timeline

| Time | What the logs show |
|---|---|
| Nov 16, all day | Reads of the VM's state: 727, every one answered 200 (median 263 ms). |
| Nov 17, 15:41 | Deploy (an earlier change). |
| Nov 17, 18:34 | Deploy of VM-3. Revision 28 runs from 18:38. Background reads of the VM begin (3 at a time, about every 65 s). |
| Nov 17, 20:17:39 | One network failure from the background (one state read, two schedule reads). The only Azure failure in 30 days before 21:11. |
| Nov 17, 21:05 | Deploy (MC-1e and PH-1: meetings and DevOps code only, nothing on the VM path). Revision 29 from 21:08:32, background policy production at 21:08:53. Revision 28's last line 21:09:32: one replica at a time, never two. |
| Nov 17, 21:10:05 to 21:13:15 | Sign out, sign in (token exchange 200), sign out, sign in. One browser. |
| Nov 17, 21:10 | The background reads of the VM stop. |
| Nov 17, 21:11:13 on | Reads of the VM's state from the chip (about one a minute) answer 403 about one time in four, in about 60 ms, the same token answering 200 a minute before and after with no refresh between. Per 15 minutes from 21:00: 4, 4, 4, 6, 3, 4, 1, 3 failures of about 15. 31 by 22:58. |
| Nov 17, 21:59:50 | One meeting write failed (unrelated). |
| Nov 17, 22:17:16 and 22:17:20 | `checkin.answer` answered 400 twice. The exception (masked): the database would have truncated a value. The screen said "bad request". |
| Nov 17, 22:23:59 | A 409 on `code.repos`: a normal refusal. |

## What was ruled out

- **Two replicas or two schedulers at once:** one replica at a time.
- **Token refresh:** every refresh after the deploy answered 200 (outlook 30, dataverse 12); no stored sign-in read failed.
- **Azure busy or slow:** no 429, no time-out; the slowest read took 6 s of 20.
- **A stuck background pass:** no over_limit, slow, finished_late or tick_part failure lines on Nov 16 or 17.
- **The deploy's code:** nothing on the VM path changed.

## What FocusTime did wrong

- **The chip:** any failed read showed Unknown at once and asked again only after a minute; after a failed request the page never asked again until the tab was hidden and shown.
- **The automatic start:** the day was claimed before the state was read, so a failed read at the planned time ended the day as "Azure refused the start". With one read in four failing, tomorrow's start could have been lost this way.
- **Unexpected failures:** the action route turned every thrown error into 400 "bad request".
- **The check-in answer:** `timeboxes.settled_at` is `nvarchar(40)` and got a zoned time (`…-05:00[America/New_York]`, 43 characters). SQLite doesn't check lengths, so the tests didn't see it.

## Left open

Why Azure answered 403 for some reads and 200 for others with the same token. Its error code is now logged as `kind` on `azure instanceView` lines, so the next time says which (an `AuthorizationFailed` would point at a role assignment changing; a policy code at a policy). Worth checking the subscription's activity log for role assignment changes on Nov 17 around 21:00 UTC.
