// SA-2: an autosaved setting as one row, for the common kinds: a number with its unit, and a switch.
import type { ReactNode } from "react";
import type { AutoSave } from "../autosave.tsx";
import { Num, Row, Switch } from "../parts.tsx";
import { markOf } from "./shared.ts";

type Common<V> = { a: AutoSave<V>; id: string; help?: ReactNode; more?: ReactNode; team?: ReactNode };

export function NumRow<V, K extends keyof V & string>({ a, k, id, help, more, team, min = 0, max = 480, step = 5 }: Common<V> & { k: K; min?: number; max?: number; step?: number }) {
  return (
    <Row id={id} help={help} more={more} team={team} mark={markOf(a, k)}>
      <Num min={min} max={max} step={step} value={a.v[k] as number} onChange={(n) => a.set(k, n as V[K])} bind={a.text(k)} />
    </Row>
  );
}

export function SwitchRow<V, K extends keyof V & string>({ a, k, id, help, more, team, checked, onChange }: Common<V> & { k: K; checked?: boolean; onChange?: (on: boolean) => void }) {
  return (
    <Row id={id} help={help} more={more} team={team} mark={markOf(a, k)}>
      <Switch checked={checked ?? (a.v[k] as boolean)} onChange={onChange ?? ((on) => a.change(k, on as V[K]))} />
    </Row>
  );
}
