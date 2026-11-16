# PF-2: after (perf/pf2-compress, Nov 16)

The same measurements as `before.md`, on the same built UI (nothing in the UI changed), with the server compressing:
`node scripts/first-screen-times.ts` (as PF-1 ran it, and with `--first-visit`), `--bytes`, and
`node scripts/data-sizes.ts`. Ten runs for times, three for bytes, the middle value.

## Bytes on the wire

| | Files before | Files after | Data before | Data after |
|---|---|---|---|---|
| First screen usable | 1,630.3 kB | 440.3 kB | 112.1 kB | 52.0 kB |
| Background, after the first screen | 735.8 kB | 211.9 kB | 0.7 kB | 0.6 kB |
| Week | 0 | 0 | 11.1 kB | 11.0 kB |
| Backlog | 0 | 0 | 74.8 kB | 5.0 kB |
| Status | 0 | 0 | 8.5 kB | 5.2 kB |
| Inbox | 0 | 0 | 10.5 kB | 3.2 kB |
| Code | 0 | 0 | 11.4 kB | 8.6 kB |

The first screen downloads 492 kB where it downloaded 1,742 kB: 28% of it. Its files are 27% of what they were.
What is left: the fonts (100.6 kB, compressed already), the styles (85 kB compressed, 472 kB raw) and `main`'s
script (about 270 kB compressed). Week's 11 kB is many small reads under 1 kB (people's photos, the week's plan),
which go plain.

## Times

### As PF-1 ran them

| | Unslowed before | Unslowed after | Slowed before | Slowed after |
|---|---|---|---|---|
| First screen usable | 250 ms | 251 ms | 10.1 s | 3.8 s |
| Week | 58 ms | 59 ms | 185 ms | 234 ms |
| Backlog | 99 ms | 101 ms | 838 ms | 341 ms |
| Status | 36 ms | 34 ms | 802 ms | 485 ms |
| Inbox | 38 ms | 30 ms | 1.3 s | 802 ms |
| Code | 31 ms | 32 ms | 814 ms | 337 ms |

### A true first visit (`--first-visit`)

| | Unslowed before | Unslowed after | Slowed before | Slowed after |
|---|---|---|---|---|
| First screen usable | 257 ms | 250 ms | 10.1 s | 3.8 s |
| Week | 68 ms | 58 ms | 179 ms | 232 ms |
| Backlog | 134 ms | 105 ms | 841 ms | 359 ms |
| Status | 61 ms | 37 ms | 886 ms | 456 ms |
| Inbox | 40 ms | 37 ms | 1.1 s | 800 ms |
| Code | 36 ms | 33 ms | 813 ms | 355 ms |

What the numbers say:

- On the slowed connection the first screen is usable in 3.8 s where it took 10.1 s. Unslowed it was a quarter of a
  second and still is: on a fast connection the download was never the wait.
- A tab pressed the moment the app opens waits for its file and its data: 0.3 to 0.8 s where it was 0.8 to 1.3 s.
  Week, which is in the first download, is within noise (its reads are small and go plain).
- The server's time: the files are compressed once at start (about 0.2 s for this build, before it listens); a
  request does no compression work. The largest read, a 1 MB file in Code, takes about 11 ms to compress (Brotli 4);
  the demo's largest, the week (61.6 kB), well under 1 ms.

## Data reads, after

| Action | Largest | On the wire before | On the wire after | Sent as |
|---|---|---|---|---|
| `week.load` | 61.6 kB | 62.2 kB | 7.7 kB | br |
| `ahead.load` | 35.5 kB | 36.2 kB | 4.4 kB | br |
| `roadmap.load` | 22.6 kB | 23.3 kB | 3.6 kB | br |
| `code.kinds` | 22.3 kB | 22.9 kB | 3.7 kB | br |
| `status.load` | 7.0 kB | 7.6 kB | 2.5 kB | br |
| `inbox.list` | 5.3 kB | 5.9 kB | 1.9 kB | br |
| `followups.list` | 2.6 kB | 3.2 kB | 1.3 kB | br |
| `my_promises.list` | 2.3 kB | 3.0 kB | 1.5 kB | br |
| `settings.load` | 7.9 kB | 8.5 kB | 8.5 kB | plain (never: settings) |
| `planday.start`, `roadmap.ahead`, `team.commit`, `inbox.today` | 2.6 to 6.0 kB | | the same | plain (not on the list) |

Every other read is under 2 kB and plain. `code.file` and `code.folder` are on the list but under 1 kB on the demo.
