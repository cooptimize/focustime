// IB-4: a slim Inbox. Only adds (D468); nothing is dropped and no row is deleted.
//   conversations.item_needed_json  app table column: the sorting step's judgment that a conversation asks for a DevOps
//                                   item no one has made yet (why, a proposed title, a level in the client's process),
//                                   written in the request the sorting step already makes. Null: no suggestion. An
//                                   older build ignores it.
//   inbox_marks, five columns       user table: my own marks on an Inbox item (by item key):
//     suggested_at  when a conversation first showed to me as a suggestion (for Diagnostics' counts)
//     outcome, outcome_at  what I did with a suggestion: created, linked or dismissed (dismissed hides it for me)
//     touched_at    the last time I touched a promise found in a chat (its due or who, a note, my week or day, an item,
//                   Close the loop): a touched promise never expires
//     cleared       how a promise cleared on its own: item (its linked item was finished) or expired (found in a chat,
//                   never touched, 7 days past its due date, or 7 days after it was found without one); null: open
//     cleared_at    when it cleared; put_back_at: when I put it back (a touch; an item finished before it can't clear it
//                   again)
//   An older build ignores the columns: a cleared promise shows there as it did before, nothing it reads breaks.
import type { NamedMigration } from "./named.ts";

export const slimInbox: NamedMigration = {
  name: "20261204T0900_slim_inbox",
  sqlite: `ALTER TABLE conversations ADD COLUMN item_needed_json TEXT;
   ALTER TABLE inbox_marks ADD COLUMN suggested_at TEXT;
   ALTER TABLE inbox_marks ADD COLUMN outcome TEXT;
   ALTER TABLE inbox_marks ADD COLUMN outcome_at TEXT;
   ALTER TABLE inbox_marks ADD COLUMN touched_at TEXT;
   ALTER TABLE inbox_marks ADD COLUMN cleared TEXT;
   ALTER TABLE inbox_marks ADD COLUMN cleared_at TEXT;
   ALTER TABLE inbox_marks ADD COLUMN put_back_at TEXT;`,
  sqlserver: `ALTER TABLE conversations ADD item_needed_json nvarchar(max) NULL;
ALTER TABLE inbox_marks ADD suggested_at nvarchar(40) NULL, outcome nvarchar(20) NULL, outcome_at nvarchar(40) NULL, touched_at nvarchar(40) NULL, cleared nvarchar(20) NULL, cleared_at nvarchar(40) NULL, put_back_at nvarchar(40) NULL;`,
};
