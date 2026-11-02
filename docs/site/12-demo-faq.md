# 12. Demo FAQ

Short answers for the questions teammates are likely to ask. Each links to the page with the detail.

### Is any client data sent anywhere?

Only to the systems it came from, and only what is needed to read it back or make a named write. Coopilot runs on the laptop; there is no Coopilot server, telemetry or AI provider. DevOps calls for a client go only to that client's org. Teammates' free/busy and presence are read for the screen and never stored. See [07 What data leaves the machine](07-security-and-privacy.md#what-data-leaves-the-machine-and-to-whom).

### What can it change in DevOps and Outlook? Can it delete anything?

DevOps: state (with an optional comment), add a comment, create a story or feature from a local draft, and set target and start dates on my own features and epics. Outlook: create, move and remove events it created (marked), move or change show as on my own events with no other attendees, send help invites to Cooptimize addresses, and RSVP to meetings others invited me to. Every write is a named action and is logged; most also have a preview, read back and undo. The exceptions (VM power has no undo, the morning Start and Teams status have no preview) are listed in 06. It never deletes a DevOps work item (undo of a create sets it to Removed). It deletes only its own marked Outlook events, cancels only help invites it sent, and on undo deletes a DevOps comment it added itself. It never edits or cancels a meeting someone else is on. See [06](06-write-framework.md#every-action-that-writes-outside-the-machine).

### Where are credentials stored?

In the Linux keyring (Secret Service), service `coopilot`: two app secrets, two refresh tokens and one DevOps write PAT per client. Access tokens are in memory only. Nothing secret is in config, cache, logs or the plan store. See [07 Secrets](07-security-and-privacy.md#secrets).

### What happens if a source is down?

Each source fails on its own. The last good snapshot shows with its time, the status bar names the cause once (for example a locked keyring affecting several sources), and the other sources keep working. A partial result is never shown as complete. See [03](03-sources-and-auth.md) and [09 Troubleshooting](09-operations.md#troubleshooting).

### Does it need admin consent?

Partly. Calendars and presence are delegated scopes a user can consent to, unless the tenant blocks user consent. Whether the Azure scope needs an admin was not verified. Profile photos (`ProfilePhoto.Read.All`) need admin consent. The Dataverse application user and its role are set up by an admin once. See [03 Scopes](03-sources-and-auth.md#microsoft-graph-outlook-teams-presence-photos).

### What does it cost to run?

Today, nothing beyond the laptop: no Azure resources, no hosting, no AI provider. It calls existing Microsoft, Google and DevOps APIs with the person's own access. The one cost it touches is the person's own VM: it can start it (billing starts) and delay auto-shutdown. A hosted version's cost has not been estimated yet ([docs/roadmap.md](../../docs/roadmap.md#direction-hosted-for-other-cooptimizers-later-needs-buy-in)).

### Is there AI in it today, and what will it send?

No. There is no AI code in the repo; every rule is deterministic. The plan is a chat panel and later AI that proposes follow-ups and summaries, always through the same named actions with preview and confirm, never acting on its own. What it would send, and to which provider, is an open item to settle first. See [01 Principles](01-product.md#principles) and [11 What is next](11-decisions-and-roadmap.md#what-is-next).

### Could this be hosted for the rest of Cooptimize? What would change?

That is the stated direction, pending buy-in. The groundwork is there: core modules avoid OS calls, identity and the VM are per signed-in person, Azure is delegated. What would change: the server moves to Azure with per-user Entra sign-in instead of a loopback token; secrets move from the keyring to Key Vault; SQLite per user becomes a per-user database; Dataverse moves from an app-only identity to delegated per-user reads (Q89); desktop notifications, Edge profile links, playerctl and the systemd service are replaced by browser equivalents or an optional local helper. See [11](11-decisions-and-roadmap.md#what-is-next) and [02 Module map](02-architecture.md#module-map).

### How is it tested?

About 1,450 test cases in 125 files: pure rules, source normalization from fixtures, the write framework against fake DevOps, Graph and Azure servers, the HTTP guard, and browser tests against a throwaway demo-mode server. No automated test touches a real system; live writes were checked by hand with approval. See [10](10-testing.md).

### How would I install it?

Today it is set up by hand on an Omarchy desktop: clone, `npm ci`, a systemd user service, a launcher script and two key bindings, plus a Microsoft app registration and a Dataverse app user. It is tailored to one person's machine; for someone else the service file paths need editing. See [09 Install](09-operations.md#install).

### What is the difference between Coopilot and Coop?

Coopilot is this planning app on a Cooptimizer's laptop. Coop is Cooptimize's coding agent inside client Azure VMs. Coopilot can copy a "Coop brief" (Markdown about one feature, DevOps fields only) for a person to paste to Coop. They share no code or data otherwise. See [README](README.md#glossary).

### Questions a data architect might ask

**Which Dataverse tables and columns does it read, and with what identity?** An application user with read on Focus Time, Account, User, Account Worker and the PTO tables; named columns only. See [03 Dataverse](03-sources-and-auth.md#dataverse).

**Does it write to Dataverse?** No. There is no write path to Dataverse.

**Where is the DevOps PAT kept, and who can read it?** The company read PAT stays in the Dataverse Account row; Coopilot reads it per fetch and drops it. Column security on that column is off today, which is a Dataverse risk worth fixing (Q16). Personal write PATs are in each person's keyring. See [07 Known gaps](07-security-and-privacy.md#known-gaps).

**What is the data model, and how does it migrate?** SQLite, schema version 20, 27 tables plus a migrations table; numbered migrations with a backup before each, and newer schemas refused. See [04](04-data-and-persistence.md#sqlite-plan-store).

**How long is data kept?** Plan data until reset; Roadmap daily counts 120 days; photos 7 days; presence and teammates' calendar details never. See [04 What is kept](04-data-and-persistence.md#what-is-kept-and-for-how-long).

**How does it avoid mixing clients?** Every client-scoped row carries a client key; DevOps calls are per client org and PAT; duplicate client keys in Dataverse are refused. See [07 Client isolation](07-security-and-privacy.md#client-isolation).

**How is the budget calculated?** A client's half-days in the week, minus PTO, minus half-days with under 2 hours free, minus borrowed time, in whole blocks. See [05 Client weekly budget](05-planning-model.md#client-weekly-budget).

**What if two people edit the same DevOps item?** Each write starts with a `test` on the item's revision; if it changed since the preview, the write fails and nothing is overwritten. Undo is refused if someone changed the item after Coopilot. See [06](06-write-framework.md#the-steps).

**Can it be audited?** Every outside write is in a local audit log with before and after values, and can be exported as JSON. See [04 Export](04-data-and-persistence.md#export-and-reset).

**What happens to an Azure VM it doesn't own?** It refuses. Only the one VM the person confirmed, read from the local store, is ever changed, and only start, deallocate and the auto-shutdown schedule's daily time and on/off status. See [06](06-write-framework.md#every-action-that-writes-outside-the-machine).
