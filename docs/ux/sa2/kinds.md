# SA-2: every Settings setting, its kind of choice and its control

From `ui/settings/registry.ts` (STEP 0.4). The page draws each kind with its one control (`e2e/settings/sa2.test.ts` checks it).

| Section | Setting | Kind of choice | Control |
|---|---|---|---|
| Profile | Signed in | An action | Button, its result said on the row |
| Profile | Profile photos | Read only | A value or a status line |
| Profile | Email | Read only | A value or a status line |
| Profile | Dataverse user | Read only | A value or a status line |
| Profile | Dataverse environment | Read only | A value or a status line |
| Profile | Setup | An action | Button, its result said on the row |
| Working hours | Hours per day | Text | Text box |
| Working hours | Lunch | Text | Text box |
| Working hours | Time zone | Text | Text box |
| Working hours | One-day changes | A list | Rows with Remove, one Add at the foot |
| Working hours | Standing blocks | A list | Rows with Remove, one Add at the foot |
| Notifications | Send me reminders and Teams messages from this test site | On or off | Switch |
| Notifications | What to notify me about | On or off | Switch |
| Notifications | Status report times | A time | The app's time field |
| Notifications | Let urgent requests through during focus | On or off | Switch |
| Notifications | Quiet hours | One of two to four | Segmented control |
| Notifications | Quiet on days off | On or off | Switch |
| Notifications | Send a test notification | An action | Button, its result said on the row |
| Notifications | Devices that get notifications | A list | Rows with Remove, one Add at the foot |
| Notifications | Show details in notifications | On or off | Switch |
| Notifications | Let FocusTime message me in Teams | On or off | Switch |
| Notifications | What FocusTime sends in Teams | On or off | Switch |
| Display | Theme | One of two to four | Segmented control |
| Display | Text size | One of two to four | Segmented control |
| Display | Timelines | One of two to four | Segmented control |
| Display | Show personal events | On or off | Switch |
| Display | Days on Week | On or off | Switch |
| Display | Reduce motion | On or off | Switch |
| Day and Week | Your level | Read only | A value or a status line |
| Day and Week | Offer Break down on features that need stories | On or off | Switch |
| Day and Week | Show Needs attention nudges | On or off | Switch |
| Day and Week | Count unsized work as | One of two to four | Segmented control |
| Day and Week | Shortest useful time per size | A number | Number with its unit beside it |
| Day and Week | Carry over unfinished to-dos from the last (days) | A number | Number with its unit beside it |
| Day and Week | Suggest work for empty blocks | On or off | Switch |
| Day and Week | When I tick a story | One of two to four | Segmented control |
| Day and Week | Offer DevOps updates at the end of the day | On or off | Switch |
| Day and Week | Add work reminder (minutes after the day starts) | A number | Number with its unit beside it |
| Day and Week | Midday check-in reminder (minutes after lunch) | A number | Number with its unit beside it |
| Day and Week | Close out reminder (minutes before the day ends) | A number | Number with its unit beside it |
| Day and Week | Week nudges | A time | The app's time field |
| Day and Week | Look-ahead rituals | Read only | A value or a status line |
| Day and Week | Use timeboxing | On or off | Switch |
| Day and Week | Put new timeboxes on Outlook | On or off | Switch |
| Day and Week | Ask before changing my own timebox events | On or off | Switch |
| Day and Week | Help session length | One of more | Select |
| Day and Week | Add a Teams meeting to help sessions | On or off | Switch |
| Day and Week | Days to search for help (days) | A number | Number with its unit beside it |
| Day and Week | Never suggested, for everyone | Read only | A value or a status line |
| Day and Week | People I exclude | A list | Rows with Remove, one Add at the foot |
| Day and Week | Invites go only to | Read only | A value or a status line |
| Day and Week | At-risk blocks | A number | Number with its unit beside it |
| Focus | Focus length (minutes) | A number | Number with its unit beside it |
| Focus | Break length (minutes) | A number | Number with its unit beside it |
| Focus | Play a sound when focus or a break ends | On or off | Switch |
| Focus | Set my Teams status while I focus | On or off | Switch |
| Focus | Plain focus sets my status to | One of two to four | Segmented control |
| Focus | Default sound | One of more | Select |
| Focus | Volume | A number | Number with its unit beside it |
| Focus | Fade in and out (seconds) | A number | Number with its unit beside it |
| Focus | When a break starts | One of two to four | Segmented control |
| Focus | Pause music when focus ends | On or off | Switch |
| Focus | Playlists | A list | Rows with Remove, one Add at the foot |
| Backlog | Stale after (weeks) | A number | Number with its unit beside it |
| Backlog | Stalled after (days) | A number | Number with its unit beside it |
| Backlog | Watch within (weeks) | A number | Number with its unit beside it |
| Clients | Keep following after focus time ends (days) | A number | Number with its unit beside it |
| Clients | Your clients | A list | Rows with Remove, one Add at the foot |
| Client chats | Team phrases | Read only | A value or a status line |
| Client chats | My asking phrases | Text | Text box |
| Client chats | My acknowledgements | Text | Text box |
| Client chats | My promise phrases | Text | Text box |
| Client chats | Client chats FocusTime reads | Read only | A value or a status line |
| Accounts and calendars | Sources | Read only | A value or a status line |
| Accounts and calendars | Calendars added by link | A list | Rows with Remove, one Add at the foot |
| Accounts and calendars | Pocket recorder | An action | Button, its result said on the row |
| Accounts and calendars | Outlook calendar changes | Read only | A value or a status line |
| Accounts and calendars | Microsoft permissions | Read only | A value or a status line |
| Accounts and calendars | My VM | An action | Button, its result said on the row |
| Accounts and calendars | Start without a preview | On or off | Switch |
| Accounts and calendars | Start my VM before my day | On or off | Switch |
| Accounts and calendars | FocusTime in Teams | Read only | A value or a status line |
| Accounts and calendars | Send feedback | Read only | A value or a status line |
| DevOps | DevOps per client | Read only | A value or a status line |
| DevOps | DevOps write access | An action | Button, its result said on the row |
| DevOps | Find an item | An action | Button, its result said on the row |
| AI and assistant | AI for FocusTime | Read only | A value or a status line |
| AI and assistant | This month's AI spend | Read only | A value or a status line |
| AI and assistant | Break down looks back (months) | A number | Number with its unit beside it |
| AI and assistant | Test AI | An action | Button, its result said on the row |
| AI and assistant | What is sent to AI | Read only | A value or a status line |
| AI and assistant | Last 20 AI requests | Read only | A value or a status line |
| AI and assistant | Assistant history | An action | Button, its result said on the row |
| Activity | Outlook write log | Read only | A value or a status line |
| Activity | DevOps write log | Read only | A value or a status line |
| Activity | Azure write log | Read only | A value or a status line |
| Activity | Teams status log | Read only | A value or a status line |
| Activity | Close the loop sends | Read only | A value or a status line |
| Your data | Export my data | An action | Button, its result said on the row |
| Your data | Reset my plan | An action | Button, its result said on the row |
| Your data | Delete my data | An action | Button, its result said on the row |
| Your data | Diagnostics | An action | Button, its result said on the row |
| Your data | Show demo data | On or off | Switch |
| Your data | Reset demo | An action | Button, its result said on the row |
| Your data | Use the demo as | One of more | Select |
| About | Version | Read only | A value or a status line |
| About | Guide | An action | Button, its result said on the row |
| About | Style guide | An action | Button, its result said on the row |

And 59 rows that are a setting's own parts (a weekday's hours, one notice kind, one Teams kind, one risk number), each drawn by its kind the same way.
