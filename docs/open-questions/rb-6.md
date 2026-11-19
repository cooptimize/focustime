## RB-6

- **What gave way in the top bar, and does it read well?** With the Code tab, at Large text up to 1500 px and at Larger up to 1800 px, Focus, Capture and Ask show their icons only (the words are in each title and read by screen readers), and the VM chip says its state in one word up to 1320 px at Default and 1500 px at Large. Three icon-only buttons in a row may be less clear than words for someone new; the alternative was to fold Capture and Ask into More, which takes a step.
- **Should Code be on the phone's bottom bar?** Not in this step: it stays in More. The bar holds five things now; Code would take one of their places.
- **Should the kind filter offer object types of its own** (tables, views, stored procedures) rather than Databases as a whole? Databases finds databases and every object inside them; a result says "Table in dim · …", so a person can read the type, but can't narrow to it.
- **What now takes more steps than before:**
  - Find a file (type part of a file's name in the left side) is gone. The same is done by Search code, which lists files by their own names, but it searches the client's whole set of repos, not just the open repo, and the results replace the tree until the box is cleared.
  - Switching between This client and All clients, or between Names and Inside files, needs the box focused first (one click) because the choices are hidden until then.
  - Group by Schema · Type is at the top of the Databases group only; with a long list above it, it is a scroll away from a database opened lower down.
- **The SQL project as a database row.** A SQL project outside any item is listed under Databases by its project name, and its file opens the `.sqlproj`. A project inside a warehouse or SQL database item stays part of that item. Should a project with no objects (only the file) still be listed as a database?
- **Esc on Code.** Esc in the search box leaves the search; elsewhere on Code it does nothing, as on the other tabs (the old panel closed). Someone used to Esc closing Code may expect it.
- **The choices stay open while the search's words are in the box** on a results page, so the kind and scope can be changed and run again. Once a result is opened the choices close until the box is focused again.
- **Review 1 (someone new, on the demo), left as they are, each from an earlier step or a choice this step didn't reopen:**
  - A names search for "Store" lists every stored procedure, because their folder is StoredProcedures and folder names count (RB-2). Should a folder match count only for whole words, or come after the name matches under its own heading?
  - A database's name opens its own file (`.platform` or the project file); only its caret opens what is inside (RB-4's rule for items). People expected the name to open it.
  - Group by Schema (the start, RB-5) shows no object types until a schema is opened; "where are the stored procedures" took switching to Type or the filter. Should Type be the start?
  - Inside a client, Files with "Choose a repo" and an empty right side is the first screen when the client has more than one repo. Should By kind be the start, or the first repo open?
  - The search keeps Names or Inside files from the last search. Someone may run the wrong one; the choice shows each time the box is used.
  - Inside files results: the long lines for clients that couldn't be searched (no code search, a token without Code (read)) take more room than the results. One short line with the reasons folded away?
  - A demo SQL project is named "Warehouse", which reads like a type beside "Gold · Warehouse". Demo data only.
  - On the phone the search row and its choices take about a third of the screen above the results.

