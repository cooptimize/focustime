// PL-1: rolling into a new week. Only adds (D468).
//   week_carry   one row per decision on a "From last week" proposal row (user, week, client, item): kept, dropped
//                or watching, with the kind it was proposed as. A decided row isn't proposed again that week; nothing
//                is added to the plan until a row is accepted.
//   week_watch   a feature I'm keeping moving without doing its stories (Watching), per week: why (owner, lead or
//                chosen) and its 30-minute check-in reservation (target half-day and minutes; null minutes: removed).
//                The reservation counts in the week budget at once; it becomes a pick (checkin_pick_id) only when
//                that day is planned or opened. Never a title of anyone else's item, never a person.
//   picks.minutes  a pick's own minutes instead of its size (the check-in's 30); null: its size.
import type { NamedMigration } from "./named.ts";

export const weekCarry: NamedMigration = {
  name: "20261106T0900_week_carry",
  sqlite: `CREATE TABLE week_carry (
     user_id TEXT NOT NULL,
     week_start TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('finished', 'carry', 'watch', 'part_done', 'not_yours', 'needs_stories')),
     decision TEXT NOT NULL CHECK (decision IN ('kept', 'dropped', 'watching')),
     decided_at TEXT NOT NULL,
     PRIMARY KEY (user_id, week_start, client_key, item_id)
   );
   CREATE TABLE week_watch (
     user_id TEXT NOT NULL,
     week_start TEXT NOT NULL,
     client_key TEXT NOT NULL,
     item_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     item_type TEXT,
     url TEXT,
     why TEXT NOT NULL CHECK (why IN ('owner', 'lead', 'chosen')),
     checkin_date TEXT,
     checkin_half TEXT CHECK (checkin_half IN ('AM', 'PM')),
     checkin_minutes INTEGER CHECK (checkin_minutes IS NULL OR (checkin_minutes BETWEEN 5 AND 240)),
     checkin_pick_id INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, week_start, client_key, item_id)
   );
   ALTER TABLE picks ADD COLUMN minutes INTEGER CHECK (minutes IS NULL OR (minutes BETWEEN 5 AND 480));`,
  sqlserver: `CREATE TABLE week_carry (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  week_start date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  kind nvarchar(16) NOT NULL CHECK (kind IN ('finished', 'carry', 'watch', 'part_done', 'not_yours', 'needs_stories')),
  decision nvarchar(12) NOT NULL CHECK (decision IN ('kept', 'dropped', 'watching')),
  decided_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, week_start, client_key, item_id)
);
CREATE TABLE week_watch (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  week_start date NOT NULL,
  client_key nvarchar(100) NOT NULL,
  item_id int NOT NULL,
  title nvarchar(max) NOT NULL,
  item_type nvarchar(100) NULL,
  url nvarchar(max) NULL,
  why nvarchar(8) NOT NULL CHECK (why IN ('owner', 'lead', 'chosen')),
  checkin_date date NULL,
  checkin_half nvarchar(3) NULL CHECK (checkin_half IN ('AM', 'PM')),
  checkin_minutes int NULL CHECK (checkin_minutes IS NULL OR (checkin_minutes BETWEEN 5 AND 240)),
  checkin_pick_id int NULL,
  created_at datetime2(7) NOT NULL,
  updated_at datetime2(7) NOT NULL,
  PRIMARY KEY (user_id, week_start, client_key, item_id)
);
ALTER TABLE picks ADD minutes int NULL CONSTRAINT picks_minutes_check CHECK (minutes IS NULL OR (minutes BETWEEN 5 AND 480));`,
};
