## TP-1

- The request type tag is checked for its own shape only; the GD-2 client boundary check scans the text (description, acceptance), not System.Tags. Type names are the team's own words, but an admin could name a type after a client. Scan tags too, or refuse a client's name in a type name?
- Microsoft doesn't document the error a create gets when the person may not add a new tag. TP-1 treats a 400 that names tags, on a create that carries a `type:` tag, as that refusal; a 403 keeps its own message. Confirm against a real project where a Stakeholder creates an item.
- "One story" is a story kind, for types that are usually one story (Small change) or Discovery then one fix (Data anomaly). Break down should offer these as its starting proposals: when, and how much should it lean on them?
- A type removed after a draft was saved stays with the draft, and creating that draft writes its tag. Should a removed type's tag still be written, or dropped with a note?
- An item written under the studies' earlier names (Target, Change, Control, Boundary) counts its Boundary text as How far filled, since it had no choice to make. Keep that, or ask for Done when it is there too?
- Why each line matters is the team's to edit (Admin › Work templates). Should those four sentences be fixed like the names?
- A patterns page could read the request types from the templates (how many items of each type, how many Ready). Build it from `work_template_uses` and the tags in the central store?
- When a client's platform needs its own hints (a Fabric client's "where" is a workspace and lakehouse, a Power BI client's a dataset), should a type's hints vary by the client's data platform (Admin › Clients) or stay one set for everyone?
- The target for "items with all four lines": choose it from real counts (Admin's counts per type) and the models' and reports' items once a few weeks have run, rather than now.

