# VM-6: why Azure refused the VM's state now and then

Read from production's logs on Nov 18, read only (Log Analytics `ft-prod-log`, the queries in [operations](../../technical/operations.md#the-vm-6-queries)). Times are UTC. Only the logs' own fields: calls, statuses, Azure's code word, durations, revisions and times. No names, ids, addresses or text.

## In two sentences

Azure refused the VM's state to one copy of the app at a time: every read from revision 34 (Nov 18, 15:29 to 19:17) and about one in five from revision 29 (Nov 17, 21:11 to Nov 18, 01:11), whatever the token, the sign-in or the page, while every other revision since Nov 16 was never refused. The refusals carried no Azure error code and came back in about 25 to 110 ms, so they were not a missing role (Azure says `AuthorizationFailed` for that) and not FocusTime's code (nothing on the VM path changed between a refusing revision and the next working one); what on Azure's side refused that one copy isn't in the logs.

## Every Azure call since VM-4 reached production

VM-4 (Azure's code word in the log) reached production with revision 30 on Nov 18 at 02:06. From then to midnight:

| Call | Yes | No |
|---|---|---|
| The VM's state (`instanceView`) | 882 | 466 |
| The auto-shutdown time (`scheduleRead`) | 865 | 0 |
| Start | 4 | 0 |
| Stop (`deallocate`) | 1 | 0 |
| A start's or stop's progress (`operation`) | 9 | 0 |

No other call was made (no find by tag, no VM read).

Per hour on Nov 18 (state yes / no; auto-shutdown yes / no; starts, stops and progress yes / no):

| Hour | State | Auto-shutdown | Writes |
|---|---|---|---|
| 02 | 69 / 0 | 65 / 0 | 3 / 0 |
| 03 to 06 | 59 or 60 / 0 each hour | 59 or 60 / 0 | 0 |
| 07 | 66 / 0 | 62 / 0 | 3 / 0 |
| 08 to 12 | 10 to 20 / 0 each hour | 10 to 20 / 0 | 0 |
| 13 | 23 / 0 | 20 / 0 | 3 / 0 |
| 14 | 86 / 0 | 83 / 0 | 3 / 0 |
| 15 | 88 / 70 | 85 / 0 | 2 / 0 |
| 16 | 0 / 123 | none | 0 |
| 17 | 0 / 118 | none | 0 |
| 18 | 0 / 119 | none | 0 |
| 19 | 42 / 36 | 42 / 0 | 0 |
| 20 to 23 | 30 to 59 / 0 each hour | 30 to 59 / 0 | 0 |

The auto-shutdown time is read only after the state is read, so in the refused hours it wasn't asked for at all; whenever it was asked for, it was answered.

## Each no

| When | Revision | Status | Azure's code word | How many | Time to answer (median) |
|---|---|---|---|---|---|
| Nov 17, 21:11 to Nov 18, 01:11 | 29 | 403 | not logged yet (before VM-4) | 33 of 175 | 66 ms |
| Nov 18, 15:29:02 to 19:17:41 | 34 | 403 | `none`: no error code in Azure's answer | 466 of 466 | 48 ms |

An answered read takes about 150 to 500 ms (median 220 ms). The refused ones came back in a fifth of that, so Azure said no before it looked at the VM.

## By revision

Every read of the VM's state since Nov 17, by the copy of the app that made it (the console log names the revision):

| Revision | Started | State reads answered | Refused |
|---|---|---|---|
| 26 | before Nov 17 | 974 | 0 |
| 27 | Nov 17, 15:44 | 171 | 0 |
| 28 | Nov 17, 18:38 | 541 | 1 network failure |
| 29 | Nov 17, 21:08 | 142 | 33 |
| 30 | Nov 18, 02:06 | 255 | 0 |
| 31 | Nov 18, 06:13 | 95 | 0 |
| 32 | Nov 18, 07:49 | 111 | 0 |
| 33 | Nov 18, 14:00 | 171 | 0 |
| 34 | Nov 18, 15:28 | 0 | 466 |
| 35 | Nov 18, 19:17 | 155 | 0 |
| 36 | Nov 18, 21:55 | 88 | 0 |

## Timeline of the Nov 18 refusal

| Time | What the logs show |
|---|---|
| 13:55 | The day's automatic starts: one "skipped", one "started" (start answered 202). |
| 14:00 | Revision 33 starts. Reads answered. |
| 14:50 | Another automatic start, "started" (202). |
| 15:19 | A start from the chip's menu (preview, confirm, start, progress, all answered). |
| 15:28:20 | Revision 34 starts (a deploy). Revision 33 keeps answering until it stops. |
| 15:29:00 | Revision 33's last state read: answered (200). |
| 15:29:02 | Revision 34's first: a new Azure token is fetched (200), then the read is refused (403, no code, 78 ms). Every read after it on revision 34 is refused. |
| 15:34 | Sign out and sign in: new tokens (200). Still refused. |
| 15:50 to 15:56 | A sign-in, and six renewals of the token from the chip that answered 400; then renewals answer again. Still refused. |
| 16:40 | Revision 34's container stops and starts again (a failed health probe): a new process with new tokens (16:41, 200). Still refused. |
| 17:37, 18:33 | The hourly token renewals (200). Still refused. |
| 19:17:07 | Revision 35 ready (a deploy). |
| 19:17:41 | The last refused read (revision 34). |
| 19:18:12 | Revision 35's first read: a new token (200), then answered (200). No refusal since. |

## What sits beside a burst

- **A new revision, every time.** Both bursts began with a new revision (29 at 21:08 on Nov 17, 34 at 15:28 on Nov 18). Revision 34's refusals ended the moment revision 35 took over; revision 29's ended by themselves at 01:11, 55 minutes before revision 30.
- **Not a token.** On Nov 17 one token answered 200 and 403 a minute apart with no renewal between (21:13 to 21:39). On Nov 18 revision 34 used at least five different tokens (15:29, 15:34, 16:41, 17:37, 18:33) and every one was refused; revision 35's first was answered. The tokens of revision 33, two seconds before, were answered.
- **Not a sign-in.** Sign-ins at 15:34 and 15:50 didn't change it.
- **Not a process.** Revision 34's container started again at 16:40 with nothing kept in memory, and was still refused.
- **The hour of the day.** 21:11 and 15:29 UTC, both in the working day, neither at a planned automatic start.
- **One call.** Only the state read was ever refused. The auto-shutdown read, starts, stops and progress were never refused; in the refusing hours only the state was asked for, because the rest waits on it.

## Starts and stops

Never refused. Since Nov 16: 7 starts (5 from the chip's menu, 2 automatic) and 1 stop; since Nov 17, 13 progress reads. All answered.

## More than one person

The Azure lines carry no field that says whose read it was, so this can't be counted from the logs. The refused reads came at the pace of one open page (every 10 seconds for 2 minutes, then every 30 seconds), and in revision 34 no read was answered at all, so anyone whose page was open then was refused too.

## The automatic start each morning

| Day | What the logs show |
|---|---|
| Nov 17 | Three automatic starts (one line each): "FocusTime wasn't running" (`not_running`) at 18:38, when VM-3's revision came up after the planned times. |
| Nov 18 | 13:55 one "skipped" and one "started" (202); 14:50 one "started" (202). None refused, none retried: both refusing stretches came hours after the planned starts. |

## Is the morning start at risk?

Yes, on a day a refusing revision is running at someone's planned time. A refused read isn't the day's try (VM-4): FocusTime reads again on each pass until the late limit, an hour into the working day, and then leaves the VM off and says "couldn't read your VM's state". Revision 34 refused for 3 hours 48 minutes, so a start planned in that time would have been left off. A new revision is what started both refusals and what ended one; deploys to production are made by hand at any hour (four on Nov 18 before 14:00 UTC).

## Each lead

| Lead | What the logs say | The test |
|---|---|---|
| One of several calls refused, shown as the whole state refused | Ruled out: only the state read was refused, and the chip makes only the state and auto-shutdown reads (no list at a subscription or resource group). | `actions/vm6-refused.test.ts`: the chip asks Azure for exactly those two; a refused auto-shutdown read leaves the state shown and says the time couldn't be read (that part was missing: fixed, D). |
| A token for the wrong resource or tenant on some reads | Ruled out: one token got both answers; five tokens were all refused in one revision; the next revision's first was answered. | `sources/oauth/oauth.test.ts`: the Azure token asks only for Azure, is kept apart from the others, and a sign-in drops it. |
| Azure asking for the sign-in again, read as refused | Not this time: a sign-in ask from Azure comes as a 401 or with a challenge naming the token; these 403s carried no code. But a 403 with such a challenge was read as refused. | `sources/azure/client.test.ts`: a 403 with a challenge naming the token is a sign-in problem (that was wrong: fixed, C). |
| The person's access coming and going | Not supported: a missing role comes back as `AuthorizationFailed`; these had no code, and the refusals started and stopped with revisions to the second. Only Azure's code can show it next time, and the chip now says so in plain words. | `actions/vm6-refused.test.ts`: `AuthorizationFailed` says "not allowed right now" with what to do. |

## Left open

What on Azure's side refuses one copy of the app with a 403 and no code. The things that are per copy are its network address going out and its connections to Azure; FocusTime's logs record neither, and the refused answer's headers aren't logged. The next thing to look at, while a refusal is happening: the refused answer's `x-ms-failure-cause` and `WWW-Authenticate` headers and whether its body is Azure's JSON at all, and the revision's outbound address against any network rule on the subscription (in `docs/open-questions.md`).
