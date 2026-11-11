// QC-1: "New under this" on an Ahead row (Grid, Gantt, Backlog): the New form with this row as the parent and the next
// level down chosen. Only on a row that has a level under it (never a story: its children are tasks), never on the
// phone (Ahead is read only there). Shift+N on a focused row does the same.
import { useAhead } from "./Ahead.tsx";
import { tierOf } from "./model.ts";

export function NewUnder({ clientKey, item }: { clientKey: string; item: { id: number; type: string; title: string; level?: string | null } }) {
  const a = useAhead();
  if (a.readOnly || !a.newUnder || tierOf(item as Parameters<typeof tierOf>[0]) === "story" || item.id <= 0) return null;
  return (
    <button type="button" className="mini quiet ah-new-under" tabIndex={-1} aria-label={`New under ${item.title}`} title="New under this (Shift N)" onClick={(e) => (e.stopPropagation(), a.newUnder!({ clientKey, id: item.id, type: item.type, title: item.title }))}>
      + New under
    </button>
  );
}
