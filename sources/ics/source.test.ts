// CAL-1: calendar links end to end on the plan store (both drivers), with a stand-in getter: what is stored (Busy only
// keeps no titles), conditional refresh (304), the error state and Replace link, Remove, owner only, and the link
// never appearing in results, responses or logs.
import { expect, it } from "vitest";
import { calendarLinkAction } from "../../actions/calendar-link-actions.ts";
import type { LogRecord } from "../../log/logger.ts";
import { createCalendarLinks } from "../../store/calendar-links.ts";
import { fakeKeyProvider } from "../../store/user-secrets.ts";
import { addUsers, forEachDriver } from "../../test/db.ts";
import { anIcsCalendar, anIcsEvent } from "../../test/builders/ics.ts";
import { hidePersonal } from "../../week/personal.ts";
import { buildWeek } from "../../week/build.ts";
import { aWeekConfig } from "../../test/builders/index.ts";
import type { IcsGet, IcsResponse } from "./fetch.ts";
import { createLinkCalendars, LINK_REFRESH_MS } from "./source.ts";

const TZ = "America/New_York";
const MON = "2026-11-02";
const SECRET_PATH = "/calendar/ical/me%40example.com/private-SECRETTOKEN123/basic.ics";
const LINK = `webcal://calendar.example.com${SECRET_PATH}`;
const FEED = anIcsCalendar({
  events: [
    anIcsEvent({ uid: "a@example.com", tzid: TZ, start: "20261103T100000", end: "20261103T110000", summary: "SECRET-TITLE dentist", location: "SECRET-PLACE" }),
    anIcsEvent({ uid: "b@example.com", tzid: TZ, start: "20261104T150000", end: "20261104T153000", summary: "Pickup", rrule: "FREQ=WEEKLY;COUNT=3" }),
  ],
});

function world(conn: Parameters<typeof createCalendarLinks>[0]["db"], userId: string, keys = fakeKeyProvider()) {
  let now = Temporal.Instant.from("2026-11-02T14:30:00Z");
  const logs: LogRecord[] = [];
  const answers: IcsResponse[] = [];
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const get: IcsGet = async (url, headers) => {
    seen.push({ url: url.toString(), headers });
    return answers.length > 1 ? answers.shift()! : answers[0]!;
  };
  const store = createCalendarLinks({ db: conn, userId, keys, now: () => now });
  const links = createLinkCalendars({ store, get, log: (r) => logs.push(r), timeZone: () => TZ, now: () => now });
  return { links, store, logs, seen, keys, answer: (r: Partial<IcsResponse>) => answers.splice(0, answers.length, { status: 200, location: null, etag: '"v1"', lastModified: null, contentType: "text/calendar", body: FEED, ...r }), queue: (r: Partial<IcsResponse>) => answers.push({ status: 200, location: null, etag: null, lastModified: null, contentType: "text/calendar", body: FEED, ...r }), tick: (ms: number) => (now = now.add({ milliseconds: ms })) };
}

await forEachDriver("calendar links (CAL-1)", (d) => {
  it("adds a link Busy only: checks it first, stores no titles, shows events as Busy and personal", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    const preview = await w.links.preview(LINK);
    expect(preview).toEqual({ host: "calendar.example.com/…", upcoming: 4, total: 4 });
    expect(w.seen[0]!.url).toBe(`https://calendar.example.com${SECRET_PATH}`);
    const link = await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    const raw = await db.all("SELECT * FROM calendar_link_events WHERE user_id = ?", ["user-a"]);
    expect(raw).toHaveLength(4);
    expect(raw.every((r) => r.title === null)).toBe(true);
    expect(JSON.stringify(raw)).not.toMatch(/SECRET/);
    // The link is sealed: not in any column as text.
    expect(JSON.stringify(await db.all("SELECT * FROM calendar_links", []))).not.toContain("SECRETTOKEN123");
    const [r] = await w.links.load(MON);
    expect(r).toMatchObject({ source: "ics", status: "ok", link: { id: link.id, name: "Family", broken: false } });
    expect(r!.items.map((e) => [e.title, e.isPersonal, e.source])).toEqual([["Busy", true, "ics"], ["Busy", true, "ics"]]);
  });

  it("Show titles keeps titles; switching to Busy only deletes them at once", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    const link = await w.links.add({ url: LINK, name: "Work", color: "#0284c7", mode: "titles", kind: "work" });
    const [r] = await w.links.load(MON);
    expect(r!.items.map((e) => [e.title, e.isPersonal])).toEqual([["SECRET-TITLE dentist", false], ["Pickup", false]]);
    await w.links.update(link.id, { mode: "busy" });
    expect((await db.all("SELECT title FROM calendar_link_events", [])).every((x) => x.title === null)).toBe(true);
  });

  it("refreshes about every 15 minutes, conditionally, and keeps the events on 304", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({ etag: '"v1"' });
    await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    const n = w.seen.length;
    await w.links.load(MON);
    expect(w.seen.length).toBe(n);
    w.tick(LINK_REFRESH_MS);
    w.answer({ status: 304, body: null, etag: null });
    const [r] = await w.links.load(MON);
    expect(w.seen.length).toBe(n + 1);
    expect(w.seen.at(-1)!.headers["if-none-match"]).toBe('"v1"');
    expect(r!.status).toBe("ok");
    expect(r!.items).toHaveLength(2);
    // Refresh asks now, whatever the time.
    await w.links.load(MON, { refresh: true });
    expect(w.seen.length).toBe(n + 2);
  });

  it("a link that stops working: the last events with their age, Replace it, and Replace link brings it back", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    const link = await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    w.answer({ status: 404, body: null, contentType: "text/html" });
    const [r] = await w.links.load(MON, { refresh: true });
    expect(r).toMatchObject({ status: "error", fromCache: true, message: "The link stopped working. Replace it?", fixAction: "open_settings", link: { broken: true } });
    expect(r!.items).toHaveLength(2);
    const listed = await calendarLinkAction(w.links, "calendar_link.list", {});
    expect(listed).toMatchObject({ ok: true, data: { links: [{ broken: true, problem: "The link stopped working. Replace it?" }] } });
    // A replacement that isn't a calendar is refused and changes nothing.
    w.answer({ contentType: "text/html", body: "<html>Sign in</html>" });
    expect(await calendarLinkAction(w.links, "calendar_link.replace", { id: link.id, url: "https://calendar.example.com/other.ics" })).toMatchObject({ ok: false, status: 422, error: "That link doesn't return a calendar (an .ics file)" });
    w.answer({});
    expect(await calendarLinkAction(w.links, "calendar_link.replace", { id: link.id, url: "https://calendar.example.com/new-SECRET2.ics" })).toMatchObject({ ok: true, data: { link: { broken: false, failure: null } } });
    expect((await w.links.load(MON))[0]!.status).toBe("ok");
    expect(await w.store.url(link.id)).toBe("https://calendar.example.com/new-SECRET2.ics");
  });

  it("network trouble is a passing problem: Retry, not Replace", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    const failing: IcsGet = async () => {
      throw new (await import("./fetch.ts")).IcsFetchError("timeout");
    };
    const links = createLinkCalendars({ store: w.store, get: failing, log: () => {}, timeZone: () => TZ, now: () => Temporal.Instant.from("2026-11-02T15:30:00Z") });
    const [r] = await links.load(MON, { refresh: true });
    expect(r).toMatchObject({ status: "unreachable", fromCache: true, link: { broken: false } });
    expect(r!.fixAction).toBeUndefined();
  });

  it("Remove deletes the link and its events", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    const link = await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    expect(await calendarLinkAction(w.links, "calendar_link.remove", { id: link.id })).toEqual({ ok: true, data: { removed: true } });
    expect(await db.all("SELECT * FROM calendar_link_events", [])).toEqual([]);
    expect(await db.all("SELECT * FROM calendar_links", [])).toEqual([]);
    expect(await w.links.load(MON)).toEqual([]);
  });

  it("only the person who added a link sees, uses, changes or removes it", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a", "user-b");
    const keys = fakeKeyProvider();
    const a = world(db, "user-a", keys);
    const b = world(db, "user-b", keys);
    a.answer({});
    b.answer({});
    const link = await a.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    expect(await b.links.list()).toEqual([]);
    expect(await b.links.load(MON)).toEqual([]);
    expect(await b.store.get(link.id)).toBeNull();
    await expect(b.store.url(link.id)).rejects.toThrow();
    expect(await calendarLinkAction(b.links, "calendar_link.remove", { id: link.id })).toMatchObject({ ok: false, status: 404 });
    expect(await calendarLinkAction(b.links, "calendar_link.update", { id: link.id, name: "Mine now" })).toMatchObject({ ok: false, status: 404 });
    expect(await calendarLinkAction(b.links, "calendar_link.replace", { id: link.id, url: LINK })).toMatchObject({ ok: false, status: 422 });
    expect((await a.links.list())[0]).toMatchObject({ name: "Family" });
    // A sealed value moved to another person's row doesn't open.
    const sealed = (await db.get("SELECT sealed FROM calendar_links WHERE user_id = ?", ["user-a"]))!.sealed as string;
    a.answer({});
    const theirs = await b.links.add({ url: "https://calendar.example.com/b.ics", name: "B", color: "#0d9488", mode: "busy", kind: "personal" });
    await db.run("UPDATE calendar_links SET sealed = ? WHERE user_id = ? AND id = ?", [sealed, "user-b", theirs.id]);
    await expect(b.store.url(theirs.id)).rejects.toThrow();
  });

  it("the link never appears in a result, an action response or a log line", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    const out: unknown[] = [];
    out.push(await calendarLinkAction(w.links, "calendar_link.preview", { url: LINK }));
    const added = await calendarLinkAction(w.links, "calendar_link.add", { url: LINK, name: "Family", color: "#0D9488", mode: "busy", kind: "personal" });
    out.push(added);
    const id = (added as { data: { link: { id: string } } }).data.link.id;
    out.push(await calendarLinkAction(w.links, "calendar_link.list", {}));
    out.push(await calendarLinkAction(w.links, "calendar_link.update", { id, mode: "titles" }));
    w.answer({ status: 404, body: null });
    out.push(await w.links.load(MON, { refresh: true }));
    out.push(await calendarLinkAction(w.links, "calendar_link.list", {}));
    // Refusals too: a private address, a bad link.
    out.push(await calendarLinkAction(w.links, "calendar_link.preview", { url: "https://169.254.169.254/SECRETTOKEN123" }));
    w.answer({ status: 500, body: null });
    out.push(await calendarLinkAction(w.links, "calendar_link.add", { url: LINK, name: "Again", color: "#0d9488", mode: "busy", kind: "personal" }));
    const text = JSON.stringify([out, w.logs]);
    expect(text).not.toContain("SECRETTOKEN123");
    expect(text).not.toContain("private-");
    expect(text).toContain("calendar.example.com/…");
    expect(w.logs.length).toBeGreaterThan(3);
  });

  it("personal links follow Personal events hidden; work links stay", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    await w.links.add({ url: LINK, name: "Family", color: "#0d9488", mode: "busy", kind: "personal" });
    w.answer({ body: anIcsCalendar({ events: [anIcsEvent({ tzid: TZ, start: "20261103T130000", end: "20261103T140000", summary: "Standup" })] }) });
    await w.links.add({ url: "https://calendar.example.com/work.ics", name: "Work", color: "#0284c7", mode: "titles", kind: "work" });
    const events = (await w.links.load(MON)).flatMap((r) => r.items);
    const week = buildWeek({ weekStart: MON, patterns: [], events, config: aWeekConfig() });
    const shown = (wk: typeof week) => wk.days.flatMap((x) => [x.am, x.pm].flatMap((s) => s.events.map((p) => p.event.title)));
    expect(shown(week).sort()).toEqual(["Busy", "Busy", "Standup"]);
    expect(shown(hidePersonal(week))).toEqual(["Standup"]);
  });

  it("refuses bad input without fetching", async () => {
    const db = (await d.open()).conn;
    await addUsers(db, "user-a");
    const w = world(db, "user-a");
    w.answer({});
    expect(await calendarLinkAction(w.links, "calendar_link.add", { url: LINK, name: "", color: "#0d9488", mode: "busy", kind: "personal" })).toMatchObject({ ok: false, status: 400 });
    expect(await calendarLinkAction(w.links, "calendar_link.add", { url: LINK, name: "x", color: "red", mode: "busy", kind: "personal" })).toMatchObject({ ok: false, status: 400 });
    expect(await calendarLinkAction(w.links, "calendar_link.preview", { url: "http://calendar.example.com/a.ics" })).toMatchObject({ ok: false, status: 422, error: "Only https:// and webcal:// links work" });
    expect(await calendarLinkAction(w.links, "calendar_link.preview", { url: "https://localhost/a.ics" })).toMatchObject({ ok: false, status: 422 });
    expect(w.seen).toEqual([]);
  });
});
