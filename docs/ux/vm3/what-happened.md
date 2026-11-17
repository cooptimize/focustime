# VM-3: what happened on Nov 17

Read from production's Log Analytics workspace (`ft-prod-log`, the App* tables), read only, on Nov 17, the way
`infra/scripts/smoke.sh` reads it. Only the log's own fields are used here (time, source, op, kind, count, status):
no names and no ids of people. Times are UTC, with Eastern in brackets. The person's planned start was 8:55 AM
Eastern (13:55 UTC): a 9:00 working day, 5 minutes before.

## The replica

| When | Line |
|---|---|
| Nov 16 21:55:11 (4:55 PM) | `plan background_policy production`: the replica that ran the morning started |
| Nov 17 15:44:48 (10:44 AM) | `plan background_policy production`, `plan scheduler idle_start`: the next one (a deploy, after the morning) |

Replicas started on Nov 14 (12:48, 14:42, 22:50) and Nov 15 (21:22) too; one ran at a time.

## The scheduler, Nov 17

Each `scheduler idle` line is written after the passes finish, with `count` the minutes until the next wake.

| When | Line | Reading |
|---|---|---|
| 00:00:02 (7:00 PM Nov 16) | `idle` 301 | sleep until 05:01 |
| 05:01:05, 06:01:05 | `idle` 60, 60 | woke, passes ran, slept |
| 07:01:06 (2:01 AM) | `idle` 389 | sleep until 13:30 |
| 13:30:03 (8:30 AM) | `idle` 25 | woke, passes ran in about 3 s, sleep until 13:55 |
| 13:55:03 (8:55 AM) | `idle` 5 | woke at the planned start, both passes ran and finished in about 3 s, sleep until 14:00 |
| 14:00:51 to 14:00:52 (9:00 AM) | `requests_poll cycle`, `notify plan_day`, `notify vm` twice, `idle` 0 | the 9:00 pass: the chats job took about 50 s, then people's parts; the VM-is-off notice went out |
| 14:01 to 14:06 | `idle` 1 or 0 | passes every minute or so |
| 14:07:05 (9:07 AM) | `auth sign_in signed_in` | someone signed in; from here the passes ran every 30 s while in use (no `idle` lines until 14:29) |
| 14:07:50 | `azure start` 202 (a dependency) | a VM started by a person (no `vm_autostart` line) |
| 14:08:37 | `notify_closed vm` | a VM notice closed |
| 14:45:29 (9:45 AM) | `azure start` 202 | a VM started by a person |
| 14:46:32 | `notify_closed vm` | a VM notice closed |

## What is missing

- **No `vm_autostart` line at all**, on any day from Nov 14 to Nov 17: not `started`, not `failed`, not `sign_in`,
  not `no_vm`, not `paused`. The start writes one of these whenever it tries; it writes nothing when it decides "not
  due".
- **No `slow_failed`, `fast_failed` or job failure line** from Nov 14 on. The only `kind failed` lines are
  `promises_kept_reopened` (16, from Nov 16 14:52 on), which is not in the start's path.
- **No Dataverse `holidays` read for a single day** (count 0) at any time from Nov 14 on: 1,137 holidays reads, every
  one with count 1 or 4 (a week or two weeks ahead, which include Thanksgiving). The start reads PTO and then holidays
  for today alone once its time has come; a working day has no holiday, so its read would show count 0. The PTO reads
  around it (`pto_trackers`, every few minutes all morning) all answered 200.
- No Dataverse `pto` line with kind `unexpected` and no Dataverse failure lines on Nov 17.

## Answers

- **Was the scheduler awake at 8:55 AM Eastern on Nov 17?** Yes. At 8:30 it planned its next wake for 25 minutes
  later, and the 13:55:03 line shows it woke then. A wake at exactly the planned start is what the start's own wake
  asks for, and it asks only in production with the setting on.
- **Did a slow pass run then, and did it finish?** Yes: both passes ran and finished within about 3 seconds
  (13:55:03).
- **Did the VM start's turn come?** Yes, as far as the log can show: the pass finished with no failure line, and the
  parts before the start (the Teams rhythm, the day's reminders, the workday notices) were quick.
- **What did it return?** Something it doesn't log: "not due". It never read today's holidays, so it stopped at or
  before the PTO read. With the setting on, production, the time come and Settings still showing that morning's time
  (so the day was chosen, not skipped, not paused and not tried), the one path left is the PTO read: in the
  background the person's settings carry no Dataverse user (a hosted person's comes from the sign-in, which every
  request adds and the background parts didn't), so PTO is "unknown", and unknown PTO leaves the VM off without a
  word. The same thing happened on every pass until the late limit at 10:00 AM. `server/ticks-vm3.test.ts` reproduces
  it and fails on main.
- **When did slow passes last finish before and after?** Before: 13:30:03 (8:30 AM). After: 13:55:03 (8:55 AM),
  14:00:52 (9:00 AM), then every minute or so and every 30 seconds from 14:07.

## What the log leaves open

- The log names no one, so that the 8:55 wake was this person's start is read from the time (it matches the planned
  time to the minute), not from a field.
- The log can't show the person's stored settings; that they carry no Dataverse user is what the code does for a
  person who signed in on the hosted app (the user is kept with the sign-in), not something read from production.
  Nothing else was read from production.
- Which person started a VM at 14:07:50 is not in the log; the product owner started theirs by hand about 48 minutes
  after 8:55, which matches the start at 14:45:29.
