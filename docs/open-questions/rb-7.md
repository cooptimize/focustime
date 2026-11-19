## RB-7: Code on a branch you choose (Nov 19)

Each is the reading that changes less, taken so the step could run to the end without asking.

- **Over 1000 branches.** One page of `$top=1000`; the picker says "Showing the first 1,000 branches." Paging would need the continuation token, which Microsoft's Refs page names but doesn't say where it comes back (other pages say the `x-ms-continuationtoken` header). A repo past 1000 can still be opened on a branch by its address.
- **An admin who isn't on a team-only client** gets Code's own refusal on its Code tab's branch list, so they can see the Rule's value and clear it, but not choose from its branch names. Choosing would need an admin path around Its team only, which the brief rules out.
- **Reading the branch list isn't logged** in Code views: it is branch names, not code, and logging every picker open would bury the opens. A row for it is one line if wanted.
- **Where the log says the branch.** No new column: the repo field holds "<repo> on <branch>" (the brief's "in the place it says the repo"). Filtering Code views by branch would want a column, which needs a migration.
- **A search inside files is logged before anything is read**, so its row can't name the repo on screen (the repo list isn't read yet): it says "the one on screen on <branch>".
- **"DevOps doesn't search this branch" is inferred per repo:** when no hit names that branch and some name the default. A branch DevOps does search but where the words aren't found shows nothing and no line, as before. Asking DevOps which branches it searches would be another read.
- **A search's address carries no branch.** Search names and Search inside files use the branch on screen from where browsing was, held in Code's memory while it is open; a results address opened fresh reads each repo on its opening branch.
- **By kind with a branch chosen** lists the repo on screen on that branch and the others on their usual one; opening a thing in another repo opens it on that repo's usual branch, so the list is read again for it. Keeping a choice per repo would mean several branches in the address.
- **A chosen branch that is the usual one** isn't put in the address (the picker drops it); an address that names the usual branch by hand still works and shows no line.
- **The hard rule's next sentence** still says the browser sends "only a client key, a repo id from that client's own list and a path"; it now also sends a branch name (checked against the repo's own list). The brief allowed one sentence changed in the Hard rules, so it is left; worth a line there next time.
- **Branch names that git allows but Code doesn't** (control characters, spaces, `~ ^ : ? * [ \`, `..`, `@{`, a name ending `.lock` or `/`) can't be chosen or set; git refuses most of them too.
- **A branch DevOps lists that the default isn't in** (a repo whose default was deleted) still lists the default first, as DevOps names it.
- **From the first review: an admin not on a team-only client still sees that client's opening branch name** (the Rule's value, in Admin's Code tab and in Audit), though none of its repos or branch names. Every client Rule is shown to every admin today; hiding one Rule's value per team would be a new kind of Rule.
- **From the walkthrough (a consultant told "the work is on dev"), left for later:**
  - Choosing another repo and coming back opens the usual branch: a choice belongs to the repo on screen and lives only in the address (the brief's rule). Remembering it per repo while Code is open would be one map in memory.
  - Nothing marks what a branch changed. Finding the work means opening it or searching; comparing branches is outside this step.
  - The picker shows only once a repo is chosen, and a repo with only main lists "main · opens here" with no word that dev is elsewhere.
  - By kind with a branch chosen names its groups by repo only; the branch shows in the header's line, not per item.
  - Copy link's "Copied" doesn't name the branch, though the link carries it.
  - After "isn't on main, so this is <folder>", the tree is open at that folder but the right side says "Choose a file", and the address has no folder (a folder has no address in Code).
  - Fixed from it: Search inside files names the branch on a repo's results ("sales-analytics on dev"), and its footer no longer says only the default branch is searched.
