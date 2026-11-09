# FocusTime in Teams: setting up the bot (TB-1)

For the Teams and Azure admin. The bot is "FocusTime" in a 1:1 chat in Teams: the same assistant as the in-app panel (AS-1, TB-3). Help and
open FocusTime always work, and what's next and today work without AI, as they do in the panel. Anything that would change something
shows a preview card and needs a tap on Confirm. It never messages anyone on its own in TB-1.

What exists per environment (all from Bicep, through the normal deploy; nothing by hand):

| Resource | Name | What it is | Cost |
|---|---|---|---|
| Managed identity | `ft-<env>-bot-id` | The bot's identity. Its client id is the bot's Microsoft App ID. No secret. | $0 |
| Azure Bot | `ft-<env>-bot` | Free tier (F0), single tenant (user-assigned managed identity), global, local auth off | $0 |
| Teams channel | `ft-<env>-bot/MsTeamsChannel` | Teams only; no other channel | $0 (Teams is a standard channel: unlimited messages) |
| Setting on the app | `FOCUSTIME_BOT_APP_ID` | The bot identity's client id; the app replies with that identity's token | none |

The bot calls `https://<app>/teams/messages` on the existing Container App. There is no new app registration and no
client secret: the "FocusTime" registration stays for sign-in only.

## 1. Once per subscription: register the Bot Service provider

The deploy identity can't register a resource provider (it only has its resource group), so bootstrap does it. It is
idempotent; the rest of what it checks is already in place and stays as it is.

```
cd ~/Code/focustime
az account set --subscription 65be698f-0695-48f4-b322-1aa1c387d5e2
infra/scripts/bootstrap.sh --env dev --member <your upn> --dry-run   # shows "dry-run: az provider register -n Microsoft.BotService ..."
infra/scripts/bootstrap.sh --env dev --member <your upn>
```

Registering is a subscription setting; it creates nothing and costs nothing. Prod uses the same subscription, so this
runs once.

## 2. Deploy dev

Merge the PR; `deploy-dev.yml` runs. Its what-if shows three creates (`ft-dev-bot-id`, `ft-dev-bot`,
`MsTeamsChannel`) and the app's identity and `FOCUSTIME_BOT_APP_ID`. Then get the bot's id:

```
az deployment group show -g FocusTime-dev -n ft-dev --query properties.outputs.botAppId.value -o tsv
az containerapp show -g FocusTime-dev -n ft-dev-app --query properties.configuration.ingress.fqdn -o tsv
```

## 3. Build the Teams app package

```
node scripts/teams-package.ts --env dev --bot-id <botAppId> --url https://<dev fqdn>
# dist/teams/focustime-dev-1.0.0.zip
```

The package has the manifest (schema 1.30, the bot in the personal scope only, no tabs, files or sign-in), the
192 px color icon and the 32 px outline. Its privacy and terms links go to the app's own page,
`https://<app>/legal.html#privacy` and `#terms` (`public/legal.html`, open without signing in); read it once before the
prod upload, since it speaks for Cooptimize. Each environment has its own fixed Teams app id, so a new upload replaces
the app rather than adding a second one.

## 4. Dev: testers only

Dev stays out of the org's app catalog. Let the testers upload it themselves:

1. Teams admin center (https://admin.teams.microsoft.com) › Teams apps › Setup policies › Add.
2. Name it "FocusTime testers", turn on **Upload custom apps**, Save.
3. Open the policy › Assign users › add the testers. It can take a few hours to apply.
4. Each tester: Teams › Apps › Manage your apps › Upload an app › Upload a custom app › `focustime-dev-1.0.0.zip`
   › Add. FocusTime (dev) opens as a chat.

**Dev sleeps.** Dev scales to zero and takes about 30 seconds to wake; Teams gives a bot 10 to 15 seconds. So the
first message after dev sleeps may be late or lost: send it again. Prod always runs, so it doesn't happen there.

## 5. Prod: the whole org

After `deploy-prod.yml` has run with this change (same steps 2 and 3 with `-g FocusTime -n ft-prod` and
`--env prod`):

1. Teams admin center › Teams apps › Manage apps › **Actions › Upload new app** › Upload ›
   `focustime-prod-1.0.0.zip`.
2. Find FocusTime in Manage apps and check its status is **Allowed**. If your permission policies block custom
   apps, allow FocusTime in Teams apps › Permission policies (or org-wide app settings).
3. It reaches people in a few hours. They find it in Teams › Apps › Built for your org › FocusTime › Add.
4. Optional: pin it for everyone in Setup policies › Global › Installed apps and Pinned apps.

No admin consent is needed: the bot asks for no Graph permissions.

## Updating the app

Change what you need, bump the version and build again:

```
node scripts/teams-package.ts --env prod --bot-id <botAppId> --url https://<prod fqdn> --version 1.0.1
```

Admin center › Teams apps › Manage apps › FocusTime › **Upload file** (top right) › the new zip. Dev testers upload it
again from Manage your apps. A code change to the bot needs no new package; only a change to the manifest (name,
commands, icons) does.

## Credentials and rotation

Nothing to rotate. The bot has no secret: Teams' service signs what it sends (FocusTime checks it on every message),
and FocusTime replies with a token for the bot's managed identity that Azure issues on demand. If the identity ever
had to be replaced, deleting `ft-<env>-bot-id` and deploying again makes a new one with a new client id; then build
and upload the package again with the new `--bot-id` (people keep their chat).

## Testing the daily rhythm on dev (TB-2)

Dev scales to zero, and there is no scheduled wake-up for it, so a morning brief, check-in or close out goes on dev
only if the app happens to be awake inside that kind's window. To see each one:

1. In Teams, send FocusTime (dev) any message once, so it knows where your chat is.
2. In dev's FocusTime: Settings › Notifications › In Teams. The line at the top should not say "Message FocusTime in
   Teams once…" (it does until step 1 reaches it).
3. Turn on Let FocusTime message me in Teams, then Send me a test now beside a kind. The card comes at once, marked
   "(test)", whatever the switches, the time, quiet hours or focus say. Nudges use a sample when nothing is due.
4. Tap through it: Done and Undo change your plan at once (look at Today); Move…, Confirm today and Close out show a
   proposal in the card that changes nothing until Confirm. Reply to a Close out card in your own words ("all but 2").
   Send "capture: something" and look in Inbox › Captures.

In prod (always at one replica) each kind goes at its time for people who turned it on. If Teams says a person
blocked the bot or removed the app, their switch turns off and Settings says "FocusTime can't message you in Teams.
Add the app again."; their next message to the bot clears that.

## Who can use it

Only Cooptimizers who have signed in to FocusTime once: their Teams sign-in (Entra object id) is their FocusTime user.
Guests, automation accounts and addresses outside the Cooptimize domains get "FocusTime is for Cooptimize accounts."
and nothing else. Someone who hasn't signed in yet gets a link to sign in once. In a group chat or channel it only
says it works in 1:1 chats (the manifest's personal scope already keeps it out of those).

## Removing it

Admin center › Manage apps › FocusTime › Block (or Delete). To remove the Azure side, take the bot out of Bicep and
deploy; deleting `ft-<env>-bot` by hand would only come back on the next deploy.
