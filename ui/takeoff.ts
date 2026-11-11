// WD-2: Take off the plan, from a drop on the block panel, a to-do's ⋯ or the keyboard. One action (pick.take_off): the
// to-do leaves its block and its work is "not placed" again; it is never marked dropped. Undo puts it back where it
// was: a to-do kept off the plan (it had time on it) is planned again; any other is added again, and a plain to-do's
// kept draft is removed.
import { takenOffWords } from "../plan/blockpanel.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { call } from "./api.ts";

type TakeOff = { result: string; kind: string; title: string; timeboxes: number; draftId: number | null; undo: { add: { date: IsoDate; half: Half } & Record<string, unknown>; draftId?: number; carriedFrom?: number } };

/** Takes the to-do off, tells the screen to read again, and says what happened with Undo. A refusal is said plainly. */
export async function takeOffPick(pickId: number, at: { date: IsoDate; half: Half } | null, o: { changed: () => void; note: (text: string, undo: (() => Promise<void>) | null) => void }): Promise<boolean> {
  try {
    const r = await call<TakeOff>("pick.take_off", { id: pickId });
    o.changed();
    const u = r.undo;
    let ran = false;
    const back = async () => {
      // Once: a second press would add it twice.
      if (ran) return;
      ran = true;
      await call("pick.put_back", { undo: u });
      o.changed();
    };
    const where = at ?? { date: u.add.date, half: u.add.half };
    o.note(where ? takenOffWords(r.title, where.date, where.half, r) : `Taken off the plan: ${r.title}`, back);
    return true;
  } catch (e) {
    o.note(e instanceof Error ? e.message : "That didn't work", null);
    return false;
  }
}
