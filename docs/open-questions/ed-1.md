## ED-1

- Should a moved item take its new parent's area and iteration? ED-1 changes only the link (the reading that changes less in DevOps); DevOps doesn't do it either.
- Should tables and images become editable? Today a description with either gets Add to the end; a table editor is a bigger step, and images need attachment uploads outside a create.
- Should the assistant offer these edits (a title fix or a move as a proposal)? Not in ED-1: the assistant keeps its own `description_edit` and offers neither `item_edit` nor `reparent`.
- What should ED-2 carry into the Backlog grid first: an inline title edit, Move… by drag, or bulk move of selected rows?
- The revision guard counts any revision, a comment included, so a comment while I type means Save again. Narrow it to the fields being edited (as `fields` does per field), or keep the whole-item guard?
- Markdown fields rely on API 7.2-preview.3's `multilineFieldsFormat`; when it leaves preview, move to the released version and check the format op's casing again.
- The DevOps docs don't state that a remove and an add on relations can go in one patch, nor the one-parent rule; ED-1 relies on the patch being applied all or nothing (as the docs say for a test failure). Recheck if DevOps ever returns a partial result.
- The not-allowed note on the card says "Harbor's leads" with the client key where Backlog says the client's name; the write framework's rights note uses the key. Use the name everywhere?
- From review 2, accepted for now: runs of non-breaking spaces used for indenting collapse to one space, a line break inside bold or a heading becomes a space, and an edit that only adds or removes blank lines saves nothing. Refuse those fields too, or keep editing them?
- A Markdown field's live look and preview use FocusTime's light look, not a full Markdown renderer: `_x_`, code, quotes and `1)` lists may show differently from DevOps, though the text written is exactly what was typed.

