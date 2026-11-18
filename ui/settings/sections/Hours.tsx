// SA-2: Settings › Working hours, drawn with the parts (ui/settings/parts.tsx).
import { spanText, WEEKDAY_KEYS } from "../../../week/hours.ts";
import { userZone } from "../../../week/zone.ts";
import { shortDate } from "../../labels.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Choice, Group, List, ListItem, Page, Row, Select, Suggestions, Text } from "../parts.tsx";
import { readDay, readLunch } from "../hours-text.ts";
import { labelBy, markOf, ZONES } from "./shared.ts";
import type { BodyProps, FormProps } from "./types.ts";

/** "09:00-17:00, 20:00-22:00" ⇄ spans. */
const spansIn = (s: string) => s.split(/[,;]/).map((x) => x.replace(/\s+/g, "")).filter(Boolean);

export function HoursSection(p: BodyProps) {
  return (
    <Page>
      {p.data.hours && <HoursForm {...p} />}
      <Group>
        <StandingForm {...p} />
      </Group>
    </Page>
  );
}

type DayKey = (typeof WEEKDAY_KEYS)[number];
const HOURS_IDS = { tz: "time-zone", lunch: "lunch", ...Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, `hours-${k}`])) } as Record<"tz" | "lunch" | DayKey, string>;

function HoursForm(p: FormProps & { reload: () => Promise<void> }) {
  const h = p.data.hours!;
  const a = useAutoSave({
    section: "hours",
    initial: { tz: userZone(h), lunch: h.lunch ? spanText(h.lunch) : "", ...(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, h.weekdays[k].map(spanText).join(", ")])) as Record<DayKey, string>) },
    payload: (v) => ({ timeZone: v.tz, lunch: v.lunch.replace(/\s+/g, ""), weekdays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, spansIn(v[k] ?? "")])) }),
    onSaved: p.onSavedData,
    label: labelBy(HOURS_IDS),
    // SA-2: "9:00 to 13:00", "9:00-13:00" and "09:00–13:00" save as 09:00-13:00; anything else is refused with an example.
    read: (k, x) => (k === "lunch" ? readLunch(String(x), h.lunch ? spanText(h.lunch) : "") : k === "tz" ? null : readDay(String(x))),
  });
  return (
    <>
      <Group sid="weekdays" intro="Like 09:00-17:00; a second span is an evening. Empty is a day off.">
        {WEEKDAY_KEYS.map((k) => (
          <Row key={k} id={`hours-${k}`} mark={markOf(a, k)}>
            <Text value={a.v[k]} placeholder="day off" onChange={(s) => a.set(k, s)} bind={a.text(k)} />
          </Row>
        ))}
        <Row id="lunch" help="Like 12:00-12:30. Empty splits the day in the middle." mark={markOf(a, "lunch")}>
          <Text value={a.v.lunch} placeholder="none" onChange={(s) => a.set("lunch", s)} bind={a.text("lunch")} />
        </Row>
        <Row id="time-zone" help="Where you work, as a Region/City name from the list." mark={markOf(a, "tz")}>
          <Text value={a.v.tz} list="set-zones" onChange={(s) => a.set("tz", s)} bind={a.text("tz")} />
          <Suggestions id="set-zones" values={ZONES} />
        </Row>
      </Group>
      <Group>
        <Row id="one-day-changes" wide help={h.overrides.length ? undefined : "None. Set a day's own hours from its Actions menu on Week."}>
          {h.overrides.length > 0 && (
            <List>
              {h.overrides.map((o) => (
                <ListItem key={o.date} removeText="Use usual hours" removeLabel={`Use usual hours on ${shortDate(o.date)}`} onRemove={() => void p.runTime("hours.clear_day", { date: o.date }).then(() => p.reload())}>
                  {shortDate(o.date)} · {o.segments ? (o.segments.length ? o.segments.map(spanText).join(" + ") : "no working hours") : "usual hours"}
                  {o.lunch !== undefined && ` · lunch ${o.lunch ? spanText(o.lunch) : "none"}`}
                </ListItem>
              ))}
            </List>
          )}
        </Row>
      </Group>
    </>
  );
}

type StandingRow = { day: string; half: string; client: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu"].map((d) => ({ value: d, label: d }));
const HALVES = ["AM", "PM"].map((x) => ({ value: x, label: x }));

function StandingForm(p: FormProps) {
  const a = useAutoSave({
    section: "standing",
    initial: { rows: p.data.standingBlocks.map((b): StandingRow => ({ day: b.day as string, half: b.half as string, client: b.clientKey })) },
    payload: (v) => ({ blocks: v.rows }),
    onSaved: p.onSavedData,
    label: labelBy({ rows: "standing-blocks" }),
  });
  const rows = a.v.rows;
  const keys = p.data.clients.map((c) => c.key);
  const edit = (i: number, patch: Partial<StandingRow>) => a.change("rows", rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Row id="standing-blocks" wide help="Shown when Dataverse has no focus block there." mark={markOf(a, "rows")}>
      <List add={<Button onClick={() => a.change("rows", [...rows, { day: "Mon", half: "AM", client: keys[0] ?? "Internal" }])}>Add a standing block</Button>}>
        {rows.map((r, i) => (
          <ListItem key={i} onRemove={() => a.change("rows", rows.filter((_, j) => j !== i))} removeLabel={`Remove ${r.day} ${r.half} ${r.client}`}>
            <Choice label="Day" options={DAYS} value={r.day} onChange={(day) => edit(i, { day })} />
            <Choice label="Half" options={HALVES} value={r.half} onChange={(half) => edit(i, { half })} />
            <Select label="Client" options={[...new Set([r.client, ...keys])].map((k) => ({ value: k, label: k }))} value={r.client} onChange={(client) => edit(i, { client })} />
          </ListItem>
        ))}
      </List>
    </Row>
  );
}
