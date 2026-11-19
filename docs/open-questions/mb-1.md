## Phone overhaul (MB-1, Nov 7)

- Q-MB1-1: Join on the Now card needs the meeting's link. Calendar events in FocusTime carry no online meeting link; reading Graph's `onlineMeeting.joinUrl` (and Google's `hangoutLink`) is a source change. Worth adding, phone only, opening Teams?
- Q-MB1-2: Snooze for a to-do is "Snooze to this afternoon" (a move to PM). Should Snooze instead hide it until a time (as promises do), which needs a new pick field?
- Q-MB1-3: Open anyway on Ahead lasts the browser session. Should it be remembered per device, or should the phone get a small read-only Ahead summary instead (this week's dated features)?
- Q-MB1-4: the VM chip moved from the phone header into the status sheet; Today's morning VM prompt still shows. Is the prompt enough on the phone, or should the dot turn amber while the VM is off during working hours?
- Q-MB1-5: Settings › Data › Diagnostics lists Unsorted reasons as "<reason> <count>" and now reads "held back because they mention another client 20". It is ST-1's screen, so it wasn't changed here; reword to "20 held back because they mention another client"? Answered in HK-7 (D1194): Diagnostics now reads "20 messages held back because they mention another client".
- Q-MB1-6: the phone's to-do sheet shows Done only on a confirmed day (as Today's checkboxes do). On an unconfirmed morning, should the sheet offer Confirm today first?
- Q-MB1-7: UI-9's late chip on the phone moved from the card header to the card's chips line (the status line) at the MB-1 merge. A card with no status now gets that line for the chip, so it is one line taller there; in the header it never was. Keep it on the chips line, or go back to the header for cards with no status? Answered in MB-1b (D1035): with no status pill it ends the title line (no extra line); beside a pill it stays on the chips line.

