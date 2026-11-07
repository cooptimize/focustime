# FocusTime demo script (about 15 minutes)

For Monday Nov 9, 2026, 11:00 ET, on dev or prod, signed out: **Try the demo**. Everything you see is fictional
demo data. Writes to DevOps and Outlook run their real preview, confirm and undo against the session's own memory,
and nothing leaves FocusTime. `e2e/demo-script.test.ts` walks these same steps in this order. Run it with
`DEMO_SHOTS=<folder>` to get every step's screenshot, dark and light, at 1920; the current set is in
[script-shots/](script-shots/).

## Before you start

- **Don't merge or deploy on Monday morning.** A deploy restarts the app, and so does dev scaling to zero after
  5 minutes without use. Either one throws away the in-memory demo and its Reset.
- **Warm it a few minutes before.** Open the site, then run the preflight:
  `npm run demo:check -- --url https://<host> --sha <commit>`. Every line should say PASS. The AI line says whether
  answers come from real AI or from the stored samples. Both are fine for the script.
- **Start clean.** Try the demo, then Settings › Demo › **Reset demo** (also in Ctrl+K). It takes under a second.
- **Voice goes to transcription.** With AI on, push-to-talk audio goes to the real transcription service. Say only
  the script's words, never a real client or person.
- **Window**: 1920 wide, default text size. The theme is your choice; the screenshots exist in both.

## Dry-run checklist (Friday)

- [ ] `npm run demo:check -- --url <dev> --sha <sha>` passes.
- [ ] Walk every step below once, then Reset demo, then walk Today again: it looks as it did the first time.
- [ ] **Eyeball every screen for a colleague's or a client's real name.** `e2e/demo-names.test.ts` checks the
      names guard's list, but a name that isn't on that list only a person can spot.
- [ ] Friday differs from Monday. Friday is the catch-up day (no blocks), and the unfinished to-dos show as
      suggested cards in each client's next block instead of Monday's "From last week" list. Dates like "was due Wed"
      move with the day. The script below is written for Monday Nov 9; the e2e and its screenshots run on Monday Nov 2,
  so their dates are a week earlier.

## The script

Each step: **Click** what to do · **Say** one line · **Expect** what appears · **If not** the fallback.

### 1. Today (1 min)

- **Click**: nothing. You open on Today.
- **Say**: "Today is one screen: what's next, what's urgent, and the one thing to do now."
- **Expect**: the Now card; the urgent strip with **Needs you now** "Warehouse sign-in fails since the 9:00 release"
  (Atlas Freight, with **Start focus**), the late promise "was due Wed, Nov 4 · Send Marcus the updated export spec",
  two **Sent to you** lines (the Must first) and "… need you in the Inbox" (the badge's number); the **Plan today**
  card; the Cooptimize and Northwind blocks with "At risk · Dentist 12:00".
- **If not**: Settings › Demo › Reset demo, which brings you back to Today.

### 2. Plan today (1.5 min)

- **Click**: **Plan today** (or P). Pick the Northwind block, then drag **Filter orders by date range** from
  "Add to Northwind afternoon" onto it. Then **Confirm today**.
- **Say**: "Planning is dragging this week's stories into today's real free time. From last week sits at the top."
- **Expect**: the to-do lands in Northwind's block with its size and the fit ("Fits · 30m spare"). From last week
  lists three unfinished to-dos.
- **If not**: use the row's **+** instead of dragging.

### 3. Week (1.5 min)

- **Click**: **Week**.
- **Say**: "The week is half-day blocks with meetings on the rail. Risk always says why."
- **Expect**: "From last week · 2 to plan · 3 unfinished to-dos from last week". Wednesday afternoon "At risk · Out:
  school event 1:30". Thursday is a hatched **PTO** day, Friday a dashed **Catch-up** column. (Neither is ever today:
  on a Wednesday the afternoon out is Tuesday's, and on a Thursday Friday is the PTO day.) The now line sits on
  today with its time.
- **If not**: the arrows in the header bring the week back to this week.

### 4. Ahead: Grid, Gantt, Fix next (2 min)

- **Click**: **Ahead** (Grid), then **Gantt**, then **Fix next · 7**.
- **Say**: "Ahead is the next weeks and months: dates, owners and sizes, changed here and saved to DevOps together."
- **Expect**: Grid shows "3 changes to save" (one a conflict); Gantt the bars with free time per week and "about 5h
  over" for Northwind; Fix next lists items missing stories, dates, owners or sizes.
- **If not**: the **Refresh** button beside the title.

### 5. Break down (1.5 min)

- **Click**: in Fix next, **Break down** on **Supplier onboarding**, then **Run**, then **Preview 5 items…**, then
  **Create all**, then **Done**.
- **Say**: "AI proposes the stories from the feature and the client's past work. Nothing is written until Create all."
- **Expect**: five cards (sign-up form, certificates, payment terms, purchasing review, notify purchasing), then
  "Created 5 items under #1120".
- **If not**: with real AI the cards differ in wording and number, which is fine. If it's slow, the stored sample
  answers after about 6 seconds.

### 6. Inbox: what needs you (2 min)

- **Click**: **Inbox**. It opens on **Needs you**: the rail on the left (clients, then the views with their counts),
  the list in the middle, the open item on the right. Click **Delivery fee missing from the order export**, then
  **Create DevOps item**, then **Preview in DevOps**, then **Create in DevOps**.
- **Say**: "One list of what needs a decision, each with why. Client chats become conversations; this one needs me,
  so I turn it into a DevOps item."
- **Expect**: each row says why it needs you ("Priya asked you by name", "Work request, no item yet", "You promised
  it, … days late", "Priya sent it as a Must"); the Needs you count is the badge's. The form is drafted (title, what's
  asked, acceptance criteria, parent #1110); the preview shows the messages and who can see it; the item moves to
  **In progress** with "Tracked #…".
- **If not**: fill the title by hand ("Add the delivery fee as its own column in the order export").

### 7. Inbox: promises, waiting on, done (0.5 min)

- **Click**: **Promises** in the rail, then **Waiting on**, then **Done**.
- **Say**: "What I said I'd do in chat becomes a promise with a due date. This one is late. What others owe me waits
  in its own view."
- **Expect**: Promises: "Send Marcus the updated export spec" (amber, late) and "Confirm the intake form go-live date
  · Due Fri, Nov 13". Waiting on: Priya's "Send Alex three test accounts with points balances" and the send to Sam.
  Done: "Reminder text wording" (resolved) and "Send Lena the new reminder text" (closed the loop on Teams).
- **If not**: nothing else needed. Move on.

### 8. Capture (1 min)

- **Click**: **Today**, press **N**, type "Ask Dana which columns the export needs @northwind", Enter (picks
  Northwind), Enter (saves). Close it. Then **Inbox** › **Captures**, **Create in DevOps** on **Reorder from a past
  order**.
- **Say**: "Capture anything in one line. A draft gets an AI-prepared DevOps version beside my own words."
- **Expect**: "Saved" with the client. In Captures, the draft opens with **Yours** and **AI version** side by side.
  Click **Not now** to close.
- **If not**: the Capture button in the top bar opens the same box.

### 9. Assistant: a lookup, a move, a dictated comment (2 min)

- **Click**: **Ask** in the top bar. Type **What's #1110?** and press Enter. Then type **Move Northwind's date
  filter to Wednesday afternoon**, press Enter, then **Confirm**. Then hold the mic and say **"Comment on #1112
  saying the date filter works for orders and the export screen is next"**. Release, check the words, press
  **Send**, then **Confirm**.
- **Say**: "The assistant calls the same actions as the buttons. Every change is a proposal I confirm."
- **Expect**: the #1110 card with its stories; a proposal "Move Filter orders by date range to Wed, Nov 11
  afternoon", then Moved; the transcript in the box (not sent until Send); a DevOps comment proposal on #1112, then
  done.
- **If not**: type the comment sentence instead of saying it. With AI off, the assistant answers these script
  sentences only, so use the exact words.

### 10. Send to someone's week (1 min)

- **Click**: **Week** › **Plan**. On **Supplier onboarding**, open ⋯ › **Send to…**, choose **Sam Ortiz**, **Must**,
  **Send**, **Done**.
- **Say**: "A lead sends work to someone's week. They accept it in their own plan."
- **Expect**: the send dialog, then it closes and You sent shows it as waiting.
- **If not**: the row's ⋯ appears on hover over the title.

### 11. Close out (0.5 min)

- **Click**: **Today**, then the Close out card (or E).
- **Say**: "Close out is the day's numbers, where I left off, and what I owe."
- **Expect**: the panel with done, carried and dropped counts, the resume notes and the follow-ups due.
- **If not**: Ctrl+K › Close out.

Afterwards: Settings › Demo › **Reset demo** for the next run.

## What doesn't work in the demo

- **The Teams bot** can't reach a demo session. Show it separately, if at all.
- **Two people in one demo** (the shared run with Priya Shah) was cut from DM-1. Each Try the demo is its own
  session; two real accounts would show real data.
- **Connecting, signing in, secrets and export** stay refused in the demo, with "Demo data: nothing leaves FocusTime".
- **Real AI varies**: with AI on, Break down and the drafts differ from the stored samples. AI off or slow: the
  samples. The assistant with AI off understands only the script's sentences and a few others (what's next, an
  item by #id, gaps, sends, confirm today).
- **A restart** (deploy, dev scale-to-zero) loses the demo's changes and starts a fresh one at the next Try the demo.
