# DevOps patterns: how to run it

For the person running the DevOps patterns page (`#/patterns`) on dev. The page is hidden: an admin turns it on for you in Admin › People ("DevOps patterns (preview)"). It reads DevOps and never writes to it. Nothing runs unless you press a button.

## Before you start

- **AI.** Admin › AI: AI for FocusTime on, and Allow AI on for every client you want classified. A client without it is counted as "AI not allowed" in Coverage.
- **Cap.** A full classification of about 4,000 items costs more than a small first run. Check your monthly cap in Admin › AI and raise it for the run if the estimate is close to it.
- **Keep the page open.** Dev scales to zero a few minutes after the last visit, and a merge to main redeploys it. Either stops a run; Resume carries on and never pays for an item twice.

## 1. Choose each client's scope

Open **Scope**. Each client shows what the next run reads and where that came from:

- *Set on this page*: your choice.
- *From Admin › Clients*: Admin › Clients names teams or area paths for the client.
- *The project has one area*: nothing to choose.
- In red: the project has more than one area and nothing is chosen. Run inventory once first so the page can show the layout, then choose.

Open a client to see its projects, areas (items in that area, and with the areas under it, by type) and teams. Choose whole projects, teams or area paths (with or without the areas under them), then **Save scope for this page**. The choice is the page's own: Admin › Clients, Ahead and Week are unchanged. **Use this in Admin › Clients too** only opens Admin › Clients; nothing is copied.

A team whose team field isn't the area path can't be chosen as a team; choose its areas instead.

## 2. Run the inventory

**Run inventory**. It reads each client's layout (cheap: id, area, type, date), then only the items in scope. A client with no scope stops at "Choose its scope"; choose it, then **Resume inventory**. The other clients carry on meanwhile.

Five clients take 30 to 45 minutes, most of it the history sample.

## 3. Check the kinds

Open **Kinds of work**. Each type in scope is Build work, Tickets and support, or Leave out, with the numbers behind the guess. Change any that is wrong; the page updates at once. Leave out removes a type from classification and from both views (Coverage counts it).

## 4. Estimate, then classify

**Estimate** shows per client: items in scope to classify, the answers to ask for (pass 1, pass 2 and the agreement sample), the cost and a rough time. About 4,000 items take 80 to 90 minutes. **Run classification** starts it; it stops on its own at 1.5 times the estimate.

If it stops (a restart, a cap, the AI failing twice), Estimate again, then **Resume classification**.

## 5. Read the results

- **Coverage** first: for each client, read = outside scope + in scope; in scope = left out by kind + to classify; to classify = labeled + AI not allowed + the answer failed its check + not reached. If "not reached" isn't 0, the run didn't finish.
- **Build work** (inventory and classification) is the default view: how features are written and broken down. **Tickets and support** is shown short.
- **Too few to read (n)** replaces any share, median or shape built on fewer than 20 items. It isn't zero: the number is just too small to mean anything. Read the count beside it, and don't compare clients on it.
- **Agreement**: on 100 or more items classified twice, how often the two answers matched. Under about 70% on request type, treat the request types as rough.
- **Check by hand**: 30 labeled items of a client you're on, with links, to judge the labels yourself.

## 6. Bring back

**Download summary**: what was covered (scope, kinds, counts), then Build work, then Tickets and support, with numbers across clients with and without the largest one. No titles, item text or people; area and team names only for clients you're on. Also the request types download if the list changed. Bring those two files and anything Check by hand made you doubt.
