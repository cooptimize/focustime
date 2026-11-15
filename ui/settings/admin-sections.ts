// NM-2: Admin's sections, in rail order, as [address id, name]. Its own file (pure, no React) so the pointer check
// (scripts/words-guard.ts) can read the names; Admin.tsx re-exports it. The ids are addresses (#/settings/<id>) and never change.
export const ADMIN_UI_SECTIONS = [
  ["admin-clients", "Clients"],
  ["admin-ai", "AI"],
  ["admin-conversations", "Conversations"],
  ["admin-people", "People"],
  ["admin-organization", "Organization"],
  ["admin-standards", "Standards"],
  ["admin-status", "Status"],
  ["admin-audit", "Audit"],
] as const;
