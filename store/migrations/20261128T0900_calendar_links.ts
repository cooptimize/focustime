// CAL-1: calendars added by a subscription link (ICS). Only adds (D468). Both are user tables, left out of the export
// (store/user-data.ts NOT_EXPORTED): the link is sealed and the events are rebuilt by the next fetch.
//   calendar_links         one row per link: its name, color, how events show (busy: no titles; titles), personal or
//                          work, the host to show ("calendar.google.com"), the sealed URL (store/user-secrets.ts' seal,
//                          bound to the person and the link id), ETag and Last-Modified for the next fetch, and the last
//                          check's outcome (a failure kind, never a message from the server).
//   calendar_link_events   the instances inside the kept window: start and end as shown, their UTC bounds for range
//                          reads, all day, show as, and a title only when the link shows titles (NULL otherwise).
import type { NamedMigration } from "./named.ts";

export const calendarLinks: NamedMigration = {
  name: "20261128T0900_calendar_links",
  sqlite: `CREATE TABLE calendar_links (
     user_id TEXT NOT NULL,
     id TEXT NOT NULL,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     mode TEXT NOT NULL CHECK (mode IN ('busy', 'titles')),
     kind TEXT NOT NULL CHECK (kind IN ('personal', 'work')),
     host TEXT NOT NULL,
     sealed TEXT NOT NULL,
     etag TEXT,
     last_modified TEXT,
     checked_at TEXT,
     fetched_at TEXT,
     failure TEXT,
     event_count INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, id)
   );
   CREATE TABLE calendar_link_events (
     user_id TEXT NOT NULL,
     link_id TEXT NOT NULL,
     instance_key TEXT NOT NULL,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     start_utc TEXT NOT NULL,
     end_utc TEXT NOT NULL,
     all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
     show_as TEXT NOT NULL,
     title TEXT,
     PRIMARY KEY (user_id, link_id, instance_key)
   );
   CREATE INDEX calendar_link_events_range ON calendar_link_events (user_id, start_utc);`,
  sqlserver: `CREATE TABLE calendar_links (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id nvarchar(32) NOT NULL,
  name nvarchar(60) NOT NULL,
  color nvarchar(16) NOT NULL,
  mode nvarchar(8) NOT NULL CONSTRAINT calendar_links_mode CHECK (mode IN ('busy', 'titles')),
  kind nvarchar(10) NOT NULL CONSTRAINT calendar_links_kind CHECK (kind IN ('personal', 'work')),
  host nvarchar(255) NOT NULL,
  sealed nvarchar(max) NOT NULL,
  etag nvarchar(300) NULL,
  last_modified nvarchar(100) NULL,
  checked_at nvarchar(40) NULL,
  fetched_at nvarchar(40) NULL,
  failure nvarchar(40) NULL,
  event_count int NOT NULL DEFAULT 0,
  created_at nvarchar(40) NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE calendar_link_events (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  link_id nvarchar(32) NOT NULL,
  instance_key nvarchar(64) NOT NULL,
  start_at nvarchar(40) NOT NULL,
  end_at nvarchar(40) NOT NULL,
  start_utc nvarchar(40) NOT NULL,
  end_utc nvarchar(40) NOT NULL,
  all_day bit NOT NULL,
  show_as nvarchar(16) NOT NULL,
  title nvarchar(200) NULL,
  PRIMARY KEY (user_id, link_id, instance_key)
);
CREATE INDEX calendar_link_events_range ON calendar_link_events (user_id, start_utc);`,
};
