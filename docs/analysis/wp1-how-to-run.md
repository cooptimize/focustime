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

**Estimate** shows per client: items in scope to classify, the answers to ask for (labels on the list in use, and the agreement sample's second answers), the cost and a rough time. Since WP-3 there is one pass against the list in use: an item whose label already carries to that list costs nothing, so a rerun prices only new or changed items, items whose type was removed or added since, and the sample's missing second answers. **Run classification** starts it; it stops on its own at 1.5 times the estimate.

If it stops (a restart, a cap, the AI failing twice), Estimate again, then **Resume classification**.

## 5. Read the results

- **Coverage** first: for each client, read = outside scope + in scope; in scope = left out by kind + to classify; to classify = labeled + AI not allowed + the answer failed its check + not reached. If "not reached" isn't 0, the run didn't finish.
- **Build work** (inventory and classification) is the default view: how features are written and broken down. **Tickets and support** is shown short.
- **Too few to read (n)** replaces any share, median or shape built on fewer than 20 items. It isn't zero: the number is just too small to mean anything. Read the count beside it, and don't compare clients on it.
- **Agreement** comes first under the classification, so you know which findings to trust. The sample line is as it is: "99 of 100 (1 answer failed its check)"; the next run tops it up. Request type, readiness and confidence are compared whole. What is missing and layers are compared per fact: for "business rule", of the pairs where either answer said it was missing, the share where both did (37 in either answer, 31 in both: 84%). Under 20 such pairs a fact says "too few to read"; under 70% it says "not reliable yet", and so does that fact in "What is missing most". The disagreements line names the request types the two answers split on ("small change and new report: 6"): two types that are often confused may really be one.
- **By client**: request types, readiness and layers each have a table with a column per client, All clients, and Without the largest client, as counts and shares of that column. Read the "other" and "can't tell" rows here to see which client they sit in.
- **Check by hand**: 30 labeled items of a client you're on, with links, to judge the labels yourself.

## 6. The request types list

**Request types** shows the list in use (version 1 is the list WP-3 starts with) with each type's meaning, made-up example and how many items carry it. Classification runs against it and never changes it; only a person does, here. Rename, Edit, Merge and Remove on a type, + Add a type below; "can't tell" and "other" are fixed, and a name about how unclear an item is, or naming a client, is refused.

Each change asks for one line of why, then **What it costs**, then **Save as a new version**:

- *Rename* or *Edit*: free. Labels follow the type, not its wording.
- *Merge*: free. The merged type's labels count as the type it went into.
- *Remove*: its items need labeling again; until then they show as "<type> (removed)". Estimate prices them.
- *Add*: choose "only the items now labeled other or can't tell" (the smaller number, shown) or every labeled item. Those need labeling again; Estimate prices them.

If someone else saved first, the page says the list changed; look again and redo yours. A change during a run applies to the next run; the running one keeps the list it started with, and its labels carry over.

**Suggested for "other"**: the names the AI gave items it labeled "other", with counts overall and per client. **Add as a type** opens Add with the name filled in; **Ignore** hides a name (Show again brings it back). Nothing changes without the press.

Labels made on WP-2's AI-written list carry to the list in use where that list's changes show which starting type a type came from; a type with no counterpart counts as "other", with its old name as a suggestion, and needs labeling again. The classification says how many labels were carried, and how many need a rerun. If nothing can be carried safely, the labels show on their own list with a note, and a run is needed.

## 7. Bring back

**Download summary**: what was covered (scope, kinds, counts, which list the labels are on, how many were carried, the agreement sample), then Build work, then Tickets and support, with a column per client, All clients and Without the largest. No titles, item text or people; area and team names only for clients you're on. **Download request types**: the list in use first, then every earlier list, each under its own heading (an AI-written one marked "written by AI, not in use"). Bring those two files and anything Check by hand made you doubt.
