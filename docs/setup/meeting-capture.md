# Meeting capture: setting it up (MC-1)

For the Entra and Teams admin, then a FocusTime admin. Meeting capture reads the transcript of a client's registered
weekly call and turns it into proposals (drafts, promises, DevOps comments) that the call's reviewers confirm in
FocusTime. Nothing is written anywhere until a reviewer confirms.

FocusTime reads only the meetings registered in Admin › Clients › <client> › Meetings, and meetings FocusTime scheduled
itself. Everything is delegated: a person's own access, the registrant's first, then the other reviewers'. No
application permission, no application access policy, no change notifications.

## 1. Entra: two delegated permissions and admin consent

On the "FocusTime" app registration (not "Coopilot Desktop"), API permissions, Microsoft Graph, Delegated:

| Permission | Why | Admin consent |
|---|---|---|
| `OnlineMeetings.Read` | Find the registered meeting's online meeting from its join link | Yes |
| `OnlineMeetingTranscript.Read.All` | Read that meeting's transcript after each call | Yes (required) |

Then Grant admin consent for Cooptimize. People are asked for nothing new: FocusTime asks for these as a separate
token kind (`meetings`) only when a registered call's transcript is due. Settings › Connections lists both under
Permissions.

`infra/scripts/app-registration.sh` lists both scopes so a later run keeps them; running it is not needed for this
step, and the portal steps above are enough.

## 2. Teams: transcripts with speaker names

In the Teams admin center, Meetings › Meeting policies, for the people who organize client calls:

- Transcription: On.
- Speaker attribution for transcriptions (attributed transcripts): on, so each line names its speaker. Without it,
  proposals can't say who committed to what.

On each registered series (in the meeting's options, by its organizer): Record and transcribe automatically, so every
occurrence has a transcript without anyone remembering to start one.

## 3. FocusTime: register the call

A FocusTime admin opens Admin › Clients › <client> › Meetings › Register a meeting. Any client in Admin › Clients'
list can have calls registered, whoever the admin is (MC-1c); the admin needs to be on the call's invite, as organizer
or attendee, for it to be on their calendar.

- **From my calendar**: the admin's recurring Teams meetings with someone from outside Cooptimize, whoever organizes
  them (a Cooptimize teammate's call shows "<name> organizes it at Cooptimize"); pick the series.
- **Paste a Teams link**: the join link; for a link FocusTime can't find on the admin's calendar, give its weekday,
  time and length.

Then a name and a role (Weekly status call or Planning). The reviewers start as the registrant and the client's leads;
add or remove them on the card. The transcript source is detected from the organizer:

- **Automatic**: Cooptimize organizes it. FocusTime reads the transcript after each call (every 15 minutes for 3
  hours, then hourly to 12 hours; then it asks the reviewers to upload it).
- **Upload**: the client organizes it, or FocusTime can't tell. FocusTime keeps only the calendar fields (name, time,
  the link) and never asks Teams for its transcript. A reviewer uploads it after each call.

An admin can switch a call to Upload at any time. Stop reading removes the registration; stored transcripts go at 30
days as usual and everything already confirmed stays.

A call a Cooptimize teammate organizes is Automatic like one the admin organizes: Microsoft lets the people on a
meeting's calendar invite read its transcript, so the registrant's sign-in reads it, then the other reviewers' (MC-1c).

When something goes wrong the form says why beside the control, and keeps what was typed:

| It says | What to do |
|---|---|
| Sign in with Microsoft again to see your calendar's meetings | Sign in again (the button beside it), then Register |
| Microsoft refused FocusTime access to your calendar (Calendars.ReadWrite) | A Cooptimize admin grants it once for everyone in the Entra admin center (section 1) |
| Microsoft didn't accept that request | Paste the meeting's Teams join link instead |
| Microsoft isn't answering right now | Try again in a minute; for a pasted link, give its weekday, time and length to register it now as Upload |
| That isn't one of FocusTime's clients | The account isn't a client in Admin › Clients (Customers); treat it as one there first |
| That meeting is already registered | Another admin registered it (any copy of its link counts); it's on the client's card |

Each registered call shows its last read under its name: "Transcript read Nov 9, 2:15 PM through <name>'s sign-in",
or why not ("waiting for the call to end", "<name> needs to sign in with Microsoft again", "Microsoft didn't find this
call for <name>", "no transcript was recorded"). "A former teammate's sign-in was the one to read it" means a reviewer
left: change the reviewers.

## 4. Upload calls (client-hosted)

After the call, an attendee opens the meeting's recap in Teams (the chat or the calendar event, Recap, Transcript)
and downloads the transcript as .vtt or .docx. Then, in FocusTime: the call's mark on Week, or ⋯ › Client calls,
Upload a transcript. When the organizer's policy doesn't allow attendees to download it, ask the organizer to send it.

"No transcript this week" dismisses the call's nudge when there was no transcript, for every reviewer.

## 5. Nudges

- In the app: Settings › Notifications › Client calls to review (on by default), one per call, to its reviewers.
- In Teams: Settings › Notifications › In Teams › Client calls to review (off by default), with "Let FocusTime message
  me in Teams" on. Not during focus, quiet hours, weekends or PTO days.

## 6. AI

The proposals come from one AI request per call, only with AI for FocusTime and the client's Allow AI on (Admin › AI),
under the person's and the app's monthly caps. Other clients' names, projects and item ids are masked as
"[another client]" and spoken email addresses as "[email]" before anything is sent. Background reads run on Flex;
an upload or Propose again runs on standard, because someone is waiting.

## What is kept

| What | How long | Who sees it |
|---|---|---|
| Transcript lines | 30 days | The call's reviewers and attendees |
| Quotes on proposals | 30 days (with the transcript) | The same |
| Proposals, their states, what Confirm made | Kept | The same |
| Registrations (no transcript) | Until Stop reading | FocusTime admins (Admin › Clients) |

Never in logs, Application Insights, error messages or Export: counts and outcomes only.

## Rollback

The migration only adds tables (`20261116T0900_meetings`); an older build ignores them. Removing the two Graph
permissions stops automatic reads (the job moves to asking for uploads); uploads keep working.
