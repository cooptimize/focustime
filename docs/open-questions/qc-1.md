## QC-1

- DevOps' title limit: 255 characters is what FocusTime enforces (a String field). The pages read for this step (work items create, work item type fields list, 7.1) don't state it; confirm on dev with a 256-character title.
- Capture keeps plain Enter as "save" (Capture is saved at once, never a form); only Ctrl+Enter on a Draft story or Draft feature opens the New form. Should plain Enter on those two kinds open the form too?
- Save as draft keeps the type, parent, assignee, date and description, but not the More's size number (a draft keeps S, M or L). Worth a field?
- The step expected no migration; drafts at any level needed one additive column pair (`item_type`, `assign_to`). Fine?
- A new item assigned to someone else gets DevOps' own notice only, no FocusTime note. Should they get Ahead's quiet note too?
- A created feature from the block panel sits on the block as a to-do (the draft path), not as WD-1's week pin. Should it also go on the week's features list?
- "+ New" sits in Ahead's header beside Refresh rather than in the filter toolbar, so it is there in every mode. Right place?
- Review pass: closing the form after the panel's New feature keeps the draft on the block (with a line saying so) rather than removing it. Should Cancel remove it?
- Review pass: when a process has several types at a level, the form starts on the level above's default child type, else the first. A process rule can also make a field required only in some states; FocusTime checks only the always-required fields, so such a refusal comes back from DevOps at Confirm in its own words.
- Review pass: "the same create" is the same title, type and parent within 15 minutes. Two people making the same title on purpose in that time each make their own (it's per person); one person must change the title or wait. Fine?
- A level above epics shares the epic tier in Ahead (Show: Epics opens it too, named "Domains / Epics" once one is listed). Better as its own level in the control?

