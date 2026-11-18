// SA-2: Settings › Backlog (was Ahead, was Roadmap; step 17, BL-1, BH-1), drawn with the parts. Whole numbers.
import { useAutoSave } from "../autosave.tsx";
import { Group, Num, Page, Row } from "../parts.tsx";
import { labelBy, markOf } from "./shared.ts";
import type { FormProps } from "./types.ts";

export function BacklogSection(p: FormProps) {
  const r = p.data.roadmap;
  const a = useAutoSave({ section: "roadmap", initial: { stalledDays: r.stalledDays, watchWeeks: r.watchWeeks }, payload: (v) => v, onSaved: p.onSavedData, label: labelBy({ stalledDays: "stalled-days", watchWeeks: "watch-weeks" }) });
  const b = useAutoSave({ section: "ahead", initial: { staleWeeks: p.data.ahead?.staleWeeks ?? 6 }, payload: (v) => v, onSaved: p.onSavedData, label: labelBy({ staleWeeks: "stale-weeks" }) });
  return (
    <Page>
      <Group>
        <Row id="stale-weeks" help="Open items with no change in DevOps for this long. 1 to 26." mark={markOf(b, "staleWeeks")}>
          <Num min={1} max={26} value={b.v.staleWeeks} onChange={(n) => b.set("staleWeeks", Math.round(n))} bind={b.text("staleWeeks")} />
        </Row>
        <Row id="stalled-days" help="Days with no story change. 3 to 60." mark={markOf(a, "stalledDays")}>
          <Num min={3} max={60} value={a.v.stalledDays} onChange={(n) => a.set("stalledDays", Math.round(n))} bind={a.text("stalledDays")} />
        </Row>
        <Row id="watch-weeks" help="Forecast this close to the target. 0 to 4; 0 is never." mark={markOf(a, "watchWeeks")}>
          <Num min={0} max={4} value={a.v.watchWeeks} onChange={(n) => a.set("watchWeeks", Math.round(n))} bind={a.text("watchWeeks")} />
        </Row>
      </Group>
    </Page>
  );
}
