## Invite to FocusTime (IN-1, Nov 7)

- Q-IN1-1: Teams app added is known only from the bot's 1:1 chat (a person who installed the app but never opened its chat, or whose install event didn't arrive, reads No). Knowing it for certain needs Graph's installed apps for a user (`TeamsAppInstallation.ReadForUser.All`), a new permission, so IN-1 doesn't. Worth it?
- Q-IN1-2: DevOps connected means a write PAT for any client. A person who only reads DevOps (the company read PAT) reads No, though FocusTime shows them DevOps. Is "has write access somewhere" the right signal, or should it be "has a write PAT for every client they work on" (a count per person, still without naming clients)?
- Q-IN1-3: Outlook on the web's compose deep link (`/mail/deeplink/compose`) isn't a documented, versioned API; it works today. If Microsoft changes it, "Use my mail app instead" still works. Switch the main button to `mailto:` if it breaks?
- Q-IN1-4: the brief's tests list was cut off after "Non-admins get 403 from the People and". IN-1 checks 403 on the People section, Who's set up and recording an invite. Anything else meant?

