import { describe, expect, it } from "vitest";
import { scopeSql, ScopeError } from "./scope.ts";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const scoped = (s: string) => norm(scopeSql(s));

describe("scopeSql (A2)", () => {
  it("puts the person first in an INSERT and in its ON CONFLICT key", () => {
    expect(scoped("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")).toBe(
      "INSERT INTO kv (user_id, key, value) VALUES ($uid, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
    );
    expect(scoped("INSERT OR IGNORE INTO markers (kind, date) VALUES (?, ?)")).toBe("INSERT OR IGNORE INTO markers (user_id, kind, date) VALUES ($uid, ?, ?)");
  });

  it("wraps an UPDATE's or DELETE's own condition, or adds one", () => {
    expect(scoped("UPDATE picks SET status = ? WHERE id = ? OR id = ?")).toBe("UPDATE picks SET status = ? WHERE user_id = $uid AND (id = ? OR id = ?)");
    expect(scoped("DELETE FROM kv WHERE key = ?")).toBe("DELETE FROM kv WHERE user_id = $uid AND (key = ?)");
    expect(scoped("DELETE FROM day_plans")).toBe("DELETE FROM day_plans WHERE user_id = $uid");
    expect(scoped("UPDATE outlook_events SET timebox_id = NULL")).toBe("UPDATE outlook_events SET timebox_id = NULL WHERE user_id = $uid");
    expect(scoped("UPDATE picks SET position = ? WHERE id = ? RETURNING id")).toBe("UPDATE picks SET position = ? WHERE user_id = $uid AND (id = ?) RETURNING id");
  });

  it("scopes a SELECT's table by its alias, and every joined table in its ON", () => {
    expect(scoped("SELECT * FROM picks WHERE date = ? ORDER BY position")).toBe("SELECT * FROM picks WHERE picks.user_id = $uid AND (date = ?) ORDER BY position");
    expect(scoped("SELECT count(*) AS n FROM captures")).toBe("SELECT count(*) AS n FROM captures WHERE captures.user_id = $uid");
    expect(scoped("SELECT s.* FROM week_feature_slots s JOIN week_features f ON f.id = s.feature_id WHERE f.week_start = ? ORDER BY s.date")).toBe(
      "SELECT s.* FROM week_feature_slots s JOIN week_features f ON (f.id = s.feature_id) AND f.user_id = $uid WHERE s.user_id = $uid AND (f.week_start = ?) ORDER BY s.date",
    );
    expect(scoped("SELECT p.*, o.title AS o_title FROM picks p LEFT JOIN picks o ON o.id = p.moved_from WHERE p.id = ?")).toBe(
      "SELECT p.*, o.title AS o_title FROM picks p LEFT JOIN picks o ON (o.id = p.moved_from) AND o.user_id = $uid WHERE p.user_id = $uid AND (p.id = ?)",
    );
  });

  it("keeps quoted text and parentheses inside conditions intact", () => {
    expect(scoped("SELECT * FROM follow_ups WHERE closed_at IS NULL AND (due IS NULL OR due <= ?) AND kind <> 'where' LIMIT 5")).toBe(
      "SELECT * FROM follow_ups WHERE follow_ups.user_id = $uid AND (closed_at IS NULL AND (due IS NULL OR due <= ?) AND kind <> 'where') LIMIT 5",
    );
  });

  it("leaves app tables and transaction control alone", () => {
    expect(scoped("SELECT * FROM sessions WHERE id = ?")).toBe("SELECT * FROM sessions WHERE id = ?");
    expect(scoped("BEGIN IMMEDIATE")).toBe("BEGIN IMMEDIATE");
    expect(scoped("SELECT 1")).toBe("SELECT 1");
  });

  it("refuses what it can't scope instead of running it unscoped", () => {
    expect(() => scopeSql("SELECT * FROM picks WHERE id IN (SELECT pick_id FROM borrowed)")).toThrow(ScopeError);
    expect(() => scopeSql("INSERT INTO kv (user_id, key, value) VALUES (?, ?, ?)")).toThrow(ScopeError);
    expect(() => scopeSql("INSERT INTO kv SELECT * FROM kv")).toThrow(ScopeError);
    expect(() => scopeSql("WITH x AS (SELECT 1) SELECT * FROM picks")).toThrow(ScopeError);
    expect(() => scopeSql("DROP TABLE picks")).toThrow(ScopeError);
    expect(() => scopeSql("SELECT * FROM sessions s JOIN picks p ON p.id = s.id")).toThrow(ScopeError);
  });
});
