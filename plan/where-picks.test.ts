// RB-3b: the remembered picks. A pick stays a pick only while its words are in the box as written; a client change
// takes out the other client's picks and keeps the typed words; Undo puts them back; a second change does the same.
import { describe, expect, it } from "vitest";
import { picksAfterEdit, PICKS_TEXT, putBack, spotAfterEdit, takeOut, type WherePick } from "./where-picks.ts";

const N = (start: number, text: string): WherePick => ({ start, text, client: "Northwind", clientName: "Northwind" });
const A = (start: number, text: string): WherePick => ({ start, text, client: "Atlas", clientName: "Atlas" });
const T1 = "fact.SalesLine (table, Gold warehouse)";
const T2 = "dim.Store (table, Gold warehouse)";
/** "The <T1> totals and <T2>" with both picks where they are. */
const two = () => {
  const text = `The ${T1} totals and ${T2}`;
  return { text, picks: [N(4, T1), N(text.indexOf(T2), T2)] };
};

describe("a pick stays a pick only as written", () => {
  it("moves with typing before it and stays with typing after it", () => {
    const { text, picks } = two();
    const typed = `Fix: ${text}`;
    expect(picksAfterEdit(picks, text, typed).map((p) => typed.slice(p.start, p.start + p.text.length))).toEqual([T1, T2]);
    const after = `${text}, please`;
    expect(picksAfterEdit(picks, text, after)).toEqual(picks);
  });
  it("an edit inside a pick makes it typed text", () => {
    const { text, picks } = two();
    const edited = text.replace("Gold warehouse)", "Gold warehous)");
    expect(picksAfterEdit(picks, text, edited).map((p) => p.text)).toEqual([T2]);
    // Backspace at the pick's end takes its last character: no longer the pick.
    const short = text.slice(0, -1);
    expect(picksAfterEdit(picks, text, short).map((p) => p.text)).toEqual([T1]);
  });
  it("a repeated letter typed next to a pick doesn't break it", () => {
    // "S" typed right before "Sales (report)": read as beside the pick, not inside it.
    expect(picksAfterEdit([N(1, "Sales (report)")], " Sales (report)", " SSales (report)")).toEqual([N(2, "Sales (report)")]);
    expect(picksAfterEdit([N(0, "Sales (report)")], "Sales (report)", "Sales (report))")).toEqual([N(0, "Sales (report)")]);
  });
  it("review 1: a deletion that could be read either way never re-points a pick at typed words", () => {
    const w = "fact.SalesLine";
    // Typed "fact.SalesLine", then the same picked: deleting the picked one leaves only typed words.
    const now = picksAfterEdit([N(w.length + 1, w)], `${w} ${w}`, w);
    expect(now).toEqual([]);
    expect(takeOut(w, now, "Atlas")).toBeNull();
    // A typed S deleted before a pick that starts with S: the pick is read as edited, and its words stay as typed.
    expect(picksAfterEdit([N(1, "Sales (report)")], "SSales (report)", "Sales (report)")).toEqual([]);
  });
  it("a paste over a pick replaces it", () => {
    const { text, picks } = two();
    const pasted = text.replace(T2, "the store table");
    expect(picksAfterEdit(picks, text, pasted).map((p) => p.text)).toEqual([T1]);
  });
});

describe("a client change", () => {
  it("takes out the other client's picks and keeps the typed words with one space between", () => {
    const { text, picks } = two();
    const r = takeOut(text, picks, "Atlas")!;
    expect(r.text).toBe("The totals and");
    expect(r.kept).toEqual([]);
    expect(r.taken.map((x) => x.pick.text)).toEqual([T1, T2]);
  });
  it("keeps this client's picks, and an edited pick stays as typed", () => {
    const text = `Load ${T1}, then pl_load_orders (pipeline)`;
    const picks = [N(5, T1), A(text.indexOf("pl_load"), "pl_load_orders (pipeline)")];
    const edited = text.replace("Gold warehouse", "Gold  warehouse");
    const now = picksAfterEdit(picks, text, edited);
    expect(now.map((p) => p.client)).toEqual(["Atlas"]);
    expect(takeOut(edited, now, "Atlas")).toBeNull();
    const r = takeOut(text, picks, "Atlas")!;
    expect(r.text).toBe("Load, then pl_load_orders (pipeline)");
    expect(r.kept).toEqual([A(r.text.indexOf("pl_load"), "pl_load_orders (pipeline)")]);
  });
  it("a pick alone, at the start, at the end, before a comma, on its own line", () => {
    expect(takeOut(T1, [N(0, T1)], "Atlas")!.text).toBe("");
    expect(takeOut(`${T1} is slow`, [N(0, T1)], "Atlas")!.text).toBe("is slow");
    expect(takeOut(`Slow: ${T1}`, [N(6, T1)], "Atlas")!.text).toBe("Slow:");
    expect(takeOut(`On ${T1}, the totals`, [N(3, T1)], "Atlas")!.text).toBe("On, the totals");
    expect(takeOut(`First line\n${T1}\nthird`, [N(11, T1)], "Atlas")!.text).toBe("First line\n\nthird");
  });
  it("Undo puts them back exactly, as picks, even after typing elsewhere", () => {
    const { text, picks } = two();
    const r = takeOut(text, picks, "Atlas")!;
    expect(putBack(r.text, r.kept, r.taken)).toEqual({ text, picks });
    // Typed after the take-out, at the end: the places move with the text.
    // Two edits, one at a time as typing makes them.
    const first = `Now: ${r.text}`;
    const typed = `${first} more`;
    const taken = r.taken.map((x) => ({ ...x, at: spotAfterEdit(spotAfterEdit(x.at, r.text, first), first, typed) }));
    const back = putBack(typed, [], taken);
    expect(back.text).toBe(`Now: The ${T1} totals and ${T2} more`);
    expect(back.picks.map((p) => back.text.slice(p.start, p.start + p.text.length))).toEqual([T1, T2]);
    expect(back.picks.every((p) => p.client === "Northwind")).toBe(true);
  });
  it("a second change behaves the same; changing back puts nothing back by itself", () => {
    const { text, picks } = two();
    const r = takeOut(text, picks, "Atlas")!;
    // Back to Northwind: nothing left to take out, and nothing returns.
    expect(takeOut(r.text, r.kept, "Northwind")).toBeNull();
    // Undo, then another client: the same names go again.
    const back = putBack(r.text, r.kept, r.taken);
    const again = takeOut(back.text, back.picks, "Fabrikam")!;
    expect(again.text).toBe("The totals and");
  });
  it("review 1: picks side by side go back in their order", () => {
    const P1 = "Sales (report)";
    const P2 = "dim.Store (table, Gold warehouse)";
    for (const [text, picks] of [
      [`${P1} ${P2}`, [N(0, P1), N(P1.length + 1, P2)]],
      [`${P1} ${P2} rest`, [N(0, P1), N(P1.length + 1, P2)]],
      [`x ${P1} ${P2}`, [N(2, P1), N(P1.length + 3, P2)]],
    ] as const) {
      const r = takeOut(text, picks, "Atlas")!;
      expect(putBack(r.text, r.kept, r.taken).text).toBe(text);
    }
  });
    it("no client at all takes out every pick", () => {
    expect(takeOut(T1, [N(0, T1)], null)!.text).toBe("");
  });
});

describe("the words", () => {
  it("say how many and from whose code", () => {
    expect(PICKS_TEXT.takenOut(2, ["Northwind", "Northwind"])).toBe("Took out 2 names picked from Northwind's code.");
    expect(PICKS_TEXT.takenOut(1, ["Northwind"])).toBe("Took out 1 name picked from Northwind's code.");
    expect(PICKS_TEXT.putBack(2, ["Northwind"], "Atlas")).toBe("Put back 2 names. They're from Northwind's code, not Atlas's.");
    expect(PICKS_TEXT.putBack(1, ["Northwind"], "Atlas")).toBe("Put back 1 name. It's from Northwind's code, not Atlas's.");
  });
});

// UC-3 item 8: when Undo puts the client back too, its words say so.
describe("PICKS_TEXT with the client put back (UC-3)", () => {
  it("names the client that came back", () => {
    expect(PICKS_TEXT.putBackWithClient(2, "Northwind")).toBe("Put back 2 names and the client, Northwind.");
    expect(PICKS_TEXT.putBackWithClient(1, "Northwind")).toBe("Put back 1 name and the client, Northwind.");
    expect(PICKS_TEXT.undoWithClient(2)).toBe("Undo: put back the 2 names and the client");
  });
});
