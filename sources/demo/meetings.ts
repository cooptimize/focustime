// MC-1: meeting capture in the demo. Northwind Foods' weekly status call, with a short fictional transcript (as a
// reviewer would upload it) and the demo's AI sample for it: three gaps (a monthly statement nobody has a story for, an
// epic Northwind's process needs a target date on, and a story with no feature named), four commitments (mine, Priya's,
// and the client's) and three comments on stories (a decision and two statuses). Everything here is fictional; nothing
// is read from Teams or Graph in the demo.

/** The call's speakers: me and Priya from Cooptimize, Dana from the (fictional) client. */
export const DEMO_MEETING = { clientKey: "Northwind", name: "Northwind weekly status call", start: "13:00", minutes: 30, weekday: 1, joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ademo-northwind-weekly%40thread.v2/0" } as const;

const CUES: [string, string][] = [
  ["Alex Rivera", "Morning everyone. Quick round on the order history export first."],
  ["Dana Brooks", "The CSV export works well for us. We decided CSV only for now, Excel can wait until next quarter."],
  ["Priya Shah", "The Export button is on the order page in the test site, ready for a look."],
  ["Dana Brooks", "Great. One more thing: our accountants need a monthly statement as a PDF from the same page. Nothing like that exists yet."],
  ["Alex Rivera", "I'll send you the date range filter for review by Thursday."],
  ["Dana Brooks", "And I'll share three sample statements from last year so you can match the layout."],
  ["Priya Shah", "Next step on the export: I'll add the row limit warning before we ship it."],
  // MC-1e: an epic nobody has yet (Northwind's process requires a target date on a new Epic), a story with no feature
  // named, a promise, and a status said about a feature that lands on the story under it.
  ["Dana Brooks", "Longer term we want one reporting area for the accountants, statements and exports in one place."],
  ["Priya Shah", "Small one: the export file name should carry the date range, so files don't overwrite each other."],
  ["Alex Rivera", "I'll book a session with your accountants next week to walk through the statements."],
  ["Dana Brooks", "The CSV part of the export is on track from our side, no blockers."],
  ["Alex Rivera", "Thanks all, see you next week."],
];

const at = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;

/** The transcript as Teams' recap downloads it (WebVTT with voice tags). */
export function demoMeetingVtt(): string {
  return ["WEBVTT", "", ...CUES.flatMap(([who, words], i) => [`${at(5 + i * 20)} --> ${at(5 + i * 20 + 18)}`, `<v ${who}>${words}</v>`, ""])].join("\n");
}

/** The demo's answer for the meeting capture task, built from the numbered transcript it was given. */
export function demoMeetingAnswer(input: string): unknown {
  // PK-1: a line from a Pocket export has no time ("L4 Speaker 2: words").
  const lines = [...input.matchAll(/^L(\d+)(?: \[[^\]]*\])? ([^:]+): (.*)$/gm)].map((m) => ({ n: Number(m[1]), who: m[2]!, text: m[3]! }));
  const find = (words: string) => lines.filter((l) => l.text.toLowerCase().includes(words)).map((l) => l.n).slice(0, 1);
  // MC-2: "Meeting: <name> (<role>), <date> (<weekday>)", or with no role for a call that isn't registered.
  const date = /, (\d{4}-\d{2}-\d{2}) \(/.exec(input)?.[1] ?? null;
  // "by Thursday": the next Thursday on or after the meeting.
  const thursday = date ? (() => { const d = Temporal.PlainDate.from(date); return d.add({ days: (4 - d.dayOfWeek + 7) % 7 }).toString(); })() : null;
  const keep = <T extends { lines: number[] }>(xs: T[]) => xs.filter((x) => x.lines.length);
  return {
    gaps: keep([
      { type: "User Story", parentId: 1110, title: "Monthly statement as a PDF", description: "Northwind's accountants want a monthly statement as a PDF from the order history page. Nothing covers it yet; Dana is sharing last year's statements to match the layout.", lines: find("monthly statement") },
      { type: "Epic", parentId: null, title: "Accountant reporting area", description: "Northwind wants one reporting area for its accountants, with statements and exports in one place. A longer term ask; no feature covers it yet.", lines: find("reporting area") },
      { type: "User Story", parentId: null, title: "Date range in the export file name", description: "The export's file name should carry the date range so files don't overwrite each other.", lines: find("file name") },
    ]),
    commitments: keep([
      { who: "Alex Rivera", what: "Send the date range filter for review", toName: "Dana Brooks", due: thursday, lines: find("date range filter") },
      { who: "Dana Brooks", what: "Share three sample statements from last year", toName: null, due: null, lines: find("sample statements") },
      { who: "Priya Shah", what: "Add the row limit warning before the export ships", toName: null, due: null, lines: find("row limit") },
      { who: "Alex Rivera", what: "Book a session with Northwind's accountants to walk through the statements", toName: "Dana Brooks", due: null, lines: find("book a session") },
    ]),
    // MC-2: what was discussed and decided, from the lines this part of the call has.
    summary: [
      ...(find("csv only").length ? ["Northwind decided on CSV only for the order history export; Excel waits until next quarter."] : []),
      ...(find("monthly statement").length ? ["Northwind's accountants asked for a monthly statement as a PDF, which nothing covers yet."] : []),
      ...(find("history table").length ? ["The team agreed the statement reads from the same order history table, with no second copy."] : []),
      ...(find("file name").length ? ["The export's file name should carry the date range."] : []),
      ...(find("row limit").length ? ["Priya adds a row limit warning to the export before it ships."] : []),
      ...(find("on track").length ? ["The CSV export is on track on Northwind's side, with no blockers."] : []),
    ].slice(0, 5),
    // MC-1e: comments on stories only. The status said about the export (a feature) goes on the story under it.
    comments: keep([
      { itemId: 1111, note: "decision", text: "Decided with Northwind: CSV only for now; an Excel export waits until next quarter.", lines: find("csv only") },
      { itemId: 1113, note: "status", text: "The Export button is on the order page in the test site, ready for Northwind to try.", lines: find("export button") },
      { itemId: 1111, note: "status", text: "Northwind says the CSV export is on track from their side, with no blockers.", lines: find("on track") },
    ]),
  };
}
