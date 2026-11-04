import { describe, expect, it } from "vitest";
import page1 from "./fixtures/calendarview-page1.json" with { type: "json" };
import page2 from "./fixtures/calendarview-page2.json" with { type: "json" };
import { normalizeGraphEvents, notMeetingOf, type GraphEvent } from "./normalize.ts";
import { MARKER_PROP } from "./write.ts";

const items = [...page1.value, ...page2.value] as GraphEvent[];
const NY = "America/New_York";

describe("normalizeGraphEvents (sanitized recorded calendarView, two pages)", () => {
  const { events, skipped } = normalizeGraphEvents(items, NY);
  const byTitle = (t: string) => events.filter((e) => e.title === t);

  it("drops declined and cancelled events", () => {
    expect(byTitle("Vendor webinar")).toEqual([]);
    expect(byTitle("Canceled: Adatum sync")).toEqual([]);
    expect(skipped).toBe(0);
  });

  it("converts local times from the Prefer time zone to offsets", () => {
    expect(byTitle("WC weekly status")[0]).toEqual({
      id: "outlook:AAMkAGFAKE001",
      source: "outlook",
      title: "WC weekly status",
      start: "2026-11-04T09:00:00-05:00",
      end: "2026-11-04T10:00:00-05:00",
      allDay: false,
      showAs: "busy",
      isPersonal: false,
      responseStatus: "accepted",
    });
  });

  it("handles an event that came back in UTC", () => {
    expect(byTitle("Proseware stakeholder sync")[0]).toMatchObject({ start: "2026-11-03T15:45:00-05:00", end: "2026-11-03T16:30:00-05:00", responseStatus: "notResponded" });
  });

  it("keeps each recurring instance as its own event", () => {
    expect(byTitle("Team standup").map((e) => e.start)).toEqual(["2026-11-02T09:00:00-05:00", "2026-11-03T09:00:00-05:00"]);
  });

  it("maps tentative responses and showAs", () => {
    expect(byTitle("Backlog refinement")[0]).toMatchObject({ showAs: "tentative", responseStatus: "tentative" });
  });

  it("turns all-day events into dates with an exclusive end", () => {
    expect(byTitle("Out of office")[0]).toMatchObject({ allDay: true, start: "2026-11-06", end: "2026-11-07", showAs: "oof" });
  });

  it("keeps working elsewhere as its own show-as (not busy, D103)", () => {
    expect(byTitle("Working from client site")[0]).toMatchObject({ allDay: true, showAs: "workingElsewhere" });
  });

  it("skips an event with an unknown time zone and counts it", () => {
    const bad = { ...items[0]!, id: "x", start: { dateTime: "2026-11-04T09:00:00.0000000", timeZone: "Eastern Standard Time" } } as GraphEvent;
    const r = normalizeGraphEvents([bad], NY);
    expect(r.events).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("labels an event with no subject", () => {
    const r = normalizeGraphEvents([{ ...items[0]!, subject: null } as GraphEvent], NY);
    expect(r.events[0]?.title).toBe("(No title)");
  });
});

describe("which events aren't meetings (the risk rules' notMeeting)", () => {
  const tb = { id: MARKER_PROP, value: "tb-6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" };
  it("FocusTime's time box, by its marker, whoever is on it", () => {
    expect(notMeetingOf({ singleValueExtendedProperties: [tb], isOrganizer: true, attendees: [] })).toBe("timebox");
    expect(notMeetingOf({ singleValueExtendedProperties: [{ ...tb, id: MARKER_PROP.toUpperCase() }] })).toBe("timebox");
  });
  it("my event with no attendees", () => {
    expect(notMeetingOf({ isOrganizer: true, attendees: [] })).toBe("solo");
  });
  it("a meeting otherwise: others on it, someone else organizes it, a help invite, or unknown", () => {
    expect(notMeetingOf({ isOrganizer: true, attendees: [{ emailAddress: { address: "a@contoso.example" } }] })).toBeUndefined();
    expect(notMeetingOf({ isOrganizer: false, attendees: [] })).toBeUndefined();
    expect(notMeetingOf({ isOrganizer: true, attendees: [{}], singleValueExtendedProperties: [{ id: MARKER_PROP, value: "inv-6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8" }] })).toBeUndefined();
    expect(notMeetingOf({})).toBeUndefined();
  });
  it("keeps only the word on the event, never attendees", () => {
    const [e] = normalizeGraphEvents([{ ...items[0]!, isOrganizer: true, attendees: [] }], NY).events;
    expect(e?.notMeeting).toBe("solo");
    expect(JSON.stringify(e)).not.toMatch(/attendees|isOrganizer/);
  });
});
