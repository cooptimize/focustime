// P1 (phone): the in-app notification list and the devices a person turned push on for.
// notices: what the notifier delivered (after its gate: the switches, quiet hours, once per key, held during focus),
// newest first in ⋯ › Notifications with an unread dot. One row per notice key; closed when its occasion was handled.
// push_devices: one row per browser that tapped "Notify this device". The push subscription (endpoint and keys) is
// sealed with the app's data key like a person's other secrets, so it is never readable from the database, the export
// or the UI; only the device's own random id, a coarse label ("iPhone · Safari") and timestamps are plain.
import type { NamedMigration } from "./named.ts";

export const noticesPush: NamedMigration = {
  name: "20261103T2300_notices_push",
  sqlite: `CREATE TABLE notices (
     user_id TEXT NOT NULL,
     id INTEGER PRIMARY KEY,
     notice_key TEXT NOT NULL CHECK (length(notice_key) BETWEEN 1 AND 200),
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     route TEXT,
     at TEXT NOT NULL,
     read_at TEXT,
     closed_at TEXT
   );
   CREATE UNIQUE INDEX notices_key ON notices(user_id, notice_key);
   CREATE INDEX notices_at ON notices(user_id, at);
   CREATE TABLE push_devices (
     user_id TEXT NOT NULL,
     device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 16 AND 64),
     label TEXT NOT NULL,
     sealed TEXT NOT NULL,
     created_at TEXT NOT NULL,
     sent_at TEXT,
     failed_at TEXT,
     PRIMARY KEY (user_id, device_id)
   );`,
  sqlserver: `CREATE TABLE notices (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  id int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  notice_key nvarchar(200) NOT NULL CONSTRAINT notices_key_len CHECK (LEN(notice_key) >= 1),
  kind nvarchar(32) NOT NULL,
  title nvarchar(300) NOT NULL,
  body nvarchar(2000) NOT NULL,
  route nvarchar(200) NULL,
  at datetime2(7) NOT NULL,
  read_at datetime2(7) NULL,
  closed_at datetime2(7) NULL
);
CREATE UNIQUE INDEX notices_key ON notices(user_id, notice_key);
CREATE INDEX notices_at ON notices(user_id, at);
CREATE TABLE push_devices (
  user_id nvarchar(64) NOT NULL REFERENCES users(id),
  device_id nvarchar(64) NOT NULL CONSTRAINT push_devices_id_len CHECK (LEN(device_id) >= 16),
  label nvarchar(100) NOT NULL,
  sealed nvarchar(max) NOT NULL,
  created_at datetime2(7) NOT NULL,
  sent_at datetime2(7) NULL,
  failed_at datetime2(7) NULL,
  PRIMARY KEY (user_id, device_id)
);`,
};
