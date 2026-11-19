## RB-1

- Languages people open that aren't colored yet: C#, JavaScript and TypeScript, Bicep and ARM templates, Scala and Spark SQL in notebooks, KQL, CSV. Each is one Prism grammar (a few hundred bytes) and one row in `ui/code/languages.ts`; add them once the view log shows which extensions people open (the log keeps paths, so counting extensions needs no new data).
- Notebooks stored as source show as Python with their `# COMMAND` and `# METADATA` lines; `.ipynb` shows as JSON. Should a notebook show as cells, and Markdown as a page? Both are out of this step, and a rendered page would need the same "never live content" care as the code view.
- A view by kind (reports, models, pipelines, SQL) across a client's repos, and picking a real report or model on a work item.
- Search across clients, and search inside files. Both mean reading many files per question, which the per-click, nothing-kept design doesn't do today.
- Is 12 months the right time to keep the Code views log? Long enough to answer "who looked at this client's code this year", short enough not to become a history of people. Taken as 12 months; the Rule could move to Admin if a client asks.
- Should an admin be able to switch a client's code off entirely (for a client whose contract says its code stays with its team, Its team only may not be enough if the team itself is large), or hide Code for one person?
- DevOps doesn't document what a token without Code (read) gets back; 401, 403, 203, a redirect and a sign-in page with 200 are all read as "needs Code (read)". Check against a real token without the scope once the product owner adds Code (read) to the first client, and narrow it if one of those means something else.
- The admin status line checks each client's repos when Admin › Clients opens (one request per client, through the limiter, remembered 5 minutes). With many clients that is many requests on open; check it on Check only if that turns out slow.
- Find matches file names; should it also match folder names (to jump to a folder)?
- Opening a repo's top folder counts as "Opened the repo" each time the repo's tree is read again after the 5 minute memory; a person who keeps the panel open reads it once. Fine as a signal of use, not a count of visits.
- A file's path is in Code's address, so it sits in the browser's history (never the file's text; the stored last place leaves Code out). Is a path in history acceptable, or should Code replace history entries instead of adding them? Taken as acceptable: Back and Copy link need it.

