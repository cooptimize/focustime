import { describe, expect, it } from "vitest";
import page1 from "./fixtures/events-page1.json" with { type: "json" };
import page2 from "./fixtures/events-page2.json" with { type: "json" };
import { normalizeGoogleEvents, type GoogleEvent } from "./normalize.ts";

const items = [...page1.items, ...page2.items] as GoogleEvent[];

describe("normalizeGoogleEvents (sanitized recorded events.list, two pages)", () => {
  const events = normalizeGoogleEvents(items, "primary");
  const byTitle = (t: string) => events.filter((e) => e.title === t);

  it("keeps a timed event with its offset, as personal", () => {
    expect(byTitle("Preschool drop-off")[0]).toEqual({
      id: "google:primary:fake0001",
      source: "google",
      title: "Preschool drop-off",
      start: "2026-11-02T08:30:00-05:00",
      end: "2026-11-02T08:50:00-05:00",
      allDay: false,
      showAs: "busy",
      isPersonal: true,
    });
  });

  it("keeps recurring instances (singleEvents=true) as separate events", () => {
    expect(byTitle("Preschool drop-off")).toHaveLength(2);
  });

  it("keeps another time zone's offset as given", () => {
    expect(byTitle("Call with Grandma")[0]?.start).toBe("2026-11-03T10:00:00-08:00");
  });

  it("turns all-day events into dates with an exclusive end", () => {
    expect(byTitle("Early release day")[0]).toMatchObject({ allDay: true, start: "2026-11-05", end: "2026-11-06" });
  });

  it("maps transparent to free and my tentative reply to tentative", () => {
    expect(byTitle("Trash day reminder")[0]?.showAs).toBe("free");
    expect(byTitle("Dentist (maybe)")[0]?.showAs).toBe("tentative");
  });

  it("drops events I declined and cancelled events", () => {
    expect(byTitle("Neighborhood meeting")).toEqual([]);
    expect(byTitle("Moved playdate")).toEqual([]);
  });

  it("labels an event with no title", () => {
    expect(byTitle("(No title)")).toHaveLength(1);
  });

  it("keeps calendars apart in event ids", () => {
    expect(normalizeGoogleEvents([items[0]!], "family@group.calendar.google.com")[0]?.id).toBe("google:family@group.calendar.google.com:fake0001");
  });
});
