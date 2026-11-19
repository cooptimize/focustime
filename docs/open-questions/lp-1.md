## LP-1

- Q-LP1-1: the assistant opens the promise's draft but doesn't carry its own words over ("Tell Dana the counts match" opens Dana's promise with FocusTime's draft, not "the counts match"). Prefilling would mean the model's text lands in the draft box; it is still only sent after the preview. Worth it?
- Q-LP1-2: the Comment channel @mentions the recipient only when they are on the item (assignee, creator or last changer). Mentioning anyone else needs their DevOps identity id, which comes from the identity API on `vssps.dev.azure.com`, a host the PAT rule doesn't allow. Allow that host for this one lookup, or keep the mention where it is known?
- Q-LP1-3: an email draft waits for "I sent it". FocusTime could notice the draft moved to Sent Items on its own (reading that one message when the promise is opened, or on a schedule), but only with `Mail.ReadWrite` granted. Do that, or keep it a tap?
- Q-LP1-4: the preview lists outside people by name (the brief's decision 2), which D485 otherwise forbids. Names are shown, not stored. Should the inside people be listed too when the chat is small (it shows only their count now)?
- Q-LP1-5: Outlook on the web's compose deep link is the fallback for email, as in IN-1 (Q-IN1-3). If it changes, switch to `mailto:`.
- Q-LP1-6: the brief's IB-1 mockups (docs/ux/ib1) weren't in the repo; LP-1 follows the IB-1 Inbox as built (the detail pane's main button, the phone sheet).

