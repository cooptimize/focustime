// CAL-1: what Settings gets for a calendar link. Pure types (the UI reads them). Never the link itself: only its host.
export type CalendarLinkView = {
  id: string;
  name: string;
  color: string;
  mode: "busy" | "titles";
  kind: "personal" | "work";
  /** "calendar.google.com/…" */
  host: string;
  checkedAt: string | null;
  fetchedAt: string | null;
  failure: string | null;
  eventCount: number;
  createdAt: string;
  /** The last check's problem in a sentence; null when it worked. */
  problem: string | null;
  /** The link itself is bad (Replace it), not a passing problem. */
  broken: boolean;
};
