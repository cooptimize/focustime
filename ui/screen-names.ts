// PF-1: the names of the screens that load when first opened (ui/screens.ts holds their loaders). Names only, so
// ui/nav.ts, which the server's code also reads, can say which screens a place needs without importing any screen.
export const SCREENS = ["ahead", "status", "inbox", "code", "card", "capture", "assistant", "checkin", "closeout", "focus", "newItem", "draft", "settings", "guide", "tour", "docs", "phone"] as const;
export type ScreenName = (typeof SCREENS)[number];
