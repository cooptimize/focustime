## Conversations fixes (CV-2, Nov 5)

- Q-CV2-1: Resolved by CV-4: chat images are no longer stored at all (read from Teams on view, for the AI, or for a DevOps create), so there is nothing to move to Blob storage. The bytes CV-2 kept were cleared by `20261107T1400_images_no_bytes`; the column is dropped in a later release.
- Q-CV2-2: Resolved by CV-3 (D648): rules-only grouping for clients with AI off, behind the client Rule "Group messages without AI".
- Q-CV2-3: Resolved by CV-3 (D645): Capture's Who is the PersonPicker.
- Q-CV2-4: Resolved by CV-3 (D646): Link existing… suggests likely items with or without a conversation (rules only); Link doesn't start a conversation (Create still does, D628).
- Q-CV2-5: A promise that implies an item shows only Create the DevOps item? (Create, Link existing…, Not needed), as in CV-1: Make it a follow-up, Done and ⋯ come once it's linked. Past its due, should Make it a follow-up or Done be offered there too?
- Q-CV2-6: Resolved by CV-3 (D647): the Board rail shows "was due …" in amber, and carries earlier or untimed overdue promises to now on today's block.

