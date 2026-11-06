// MC-1: meeting capture in the demo. Northwind Foods' weekly status call, with a short fictional transcript (as a
// reviewer would upload it) and the demo's AI sample for it: one gap (a monthly statement nobody has a story for),
// three commitments (mine, Priya's, and one from the client) and two comments (a decision and a status). Everything
// here is fictional; nothing is read from Teams or Graph in the demo.

/** The call's speakers: me and Priya from Cooptimize, Dana from the (fictional) client. */
export const DEMO_MEETING = { clientKey: "Northwind", name: "Northwind weekly status call", start: "10:00", minutes: 30, joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ademo-northwind-weekly%40thread.v2/0" } as const;

const CUES: [string, string][] = [
  ["Alex Rivera", "Morning everyone. Quick round on the order history export first."],
  ["Dana Brooks", "The CSV export works well for us. We decided CSV only for now, Excel can wait until next quarter."],
  ["Priya Shah", "The Export button is on the order page in the test site, ready for a look."],
  ["Dana Brooks", "Great. One more thing: our accountants need a monthly statement as a PDF from the same page. Nothing like that exists yet."],
  ["Alex Rivera", "I'll send you the date range filter for review by Thursday."],
  ["Dana Brooks", "And I'll share three sample statements from last year so you can match the layout."],
  ["Priya Shah", "Next step on the export: I'll add the row limit warning before we ship it."],
  ["Alex Rivera", "Thanks all, see you next week."],
];

const at = (s: number) => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;

/** The transcript as Teams' recap downloads it (WebVTT with voice tags). */
export function demoMeetingVtt(): string {
  return ["WEBVTT", "", ...CUES.flatMap(([who, words], i) => [`${at(5 + i * 20)} --> ${at(5 + i * 20 + 18)}`, `<v ${who}>${words}</v>`, ""])].join("\n");
}

/** The demo's answer for the meeting capture task, built from the numbered transcript it was given. */
export function demoMeetingAnswer(input: string): unknown {
  const lines = [...input.matchAll(/^L(\d+) \[[^\]]*\] ([^:]+): (.*)$/gm)].map((m) => ({ n: Number(m[1]), who: m[2]!, text: m[3]! }));
  const find = (words: string) => lines.filter((l) => l.text.toLowerCase().includes(words)).map((l) => l.n).slice(0, 1);
  const date = /\), (\d{4}-\d{2}-\d{2}) \(/.exec(input)?.[1] ?? null;
  // "by Thursday": the next Thursday on or after the meeting.
  const thursday = date ? (() => { const d = Temporal.PlainDate.from(date); return d.add({ days: (4 - d.dayOfWeek + 7) % 7 }).toString(); })() : null;
  const keep = <T extends { lines: number[] }>(xs: T[]) => xs.filter((x) => x.lines.length);
  return {
    gaps: keep([{ type: "User Story", parentId: 1110, title: "Monthly statement as a PDF", description: "Northwind's accountants want a monthly statement as a PDF from the order history page. Nothing covers it yet; Dana is sharing last year's statements to match the layout.", lines: find("monthly statement") }]),
    commitments: keep([
      { who: "Alex Rivera", what: "Send the date range filter for review", toName: "Dana Brooks", due: thursday, lines: find("date range filter") },
      { who: "Dana Brooks", what: "Share three sample statements from last year", toName: null, due: null, lines: find("sample statements") },
      { who: "Priya Shah", what: "Add the row limit warning before the export ships", toName: null, due: null, lines: find("row limit") },
    ]),
    comments: keep([
      { itemId: 1110, note: "decision", text: "Decided with Northwind: CSV only for now; an Excel export waits until next quarter.", lines: find("csv only") },
      { itemId: 1113, note: "status", text: "The Export button is on the order page in the test site, ready for Northwind to try.", lines: find("export button") },
    ]),
  };
}
