// UI-5: the Guide on ST-1's panel shell (ui/PanelShell.tsx): the rail of sections with search at its top, the title,
// ×, Esc, focus on the title. On a phone or a narrow window the rail is its own list page (#/guide/contents) and each
// section opens as a page with Back. Signed out it fills the window over the sign-in screen.
import type { ReactNode } from "react";
import { PanelShell, useNarrow, type RailGroup } from "../PanelShell.tsx";
import { usePhone } from "../viewport.ts";
import { CONTENTS, SECTION_GROUPS, SECTIONS, type SectionId } from "./sections.ts";

/** Whether the rail is its own list page (a phone or a narrow window). */
export function useGuideList(): boolean {
  const phone = usePhone();
  return useNarrow() || phone;
}

export function GuideFrame(p: {
  /** The open section; null is the phone's list. */
  current: SectionId | null;
  title: string;
  description?: string | undefined;
  onPick: (id: string) => void;
  onClose: () => void;
  standalone: boolean;
  /** Search box, and its results in place of the rail while typing. */
  railTop?: ReactNode;
  railOverride?: ReactNode;
  children: ReactNode;
}) {
  const list = useGuideList();
  const current = p.current;
  const groups: RailGroup[] = SECTION_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    items: SECTIONS.filter((s) => s.group === g.id).map((s) => ({ id: s.id, label: s.name, href: `#/guide/${s.id}` })),
  }));
  return (
    <PanelShell
      name="Guide"
      className={`guide gf${p.standalone ? " standalone" : ""}`}
      groups={groups}
      current={current}
      onPick={p.onPick}
      onClose={p.onClose}
      onBack={list && current !== null ? () => p.onPick(CONTENTS) : null}
      backLabel="Guide"
      title={p.title}
      description={p.description}
      railTop={p.railTop}
      railOverride={p.railOverride}
      phone={list}
      pageKey={current ?? CONTENTS}
    >
      {p.children}
    </PanelShell>
  );
}
