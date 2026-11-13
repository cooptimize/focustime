// RB-1: Prism must never highlight the page on its own. Set before its core loads (Prism reads window.Prism.manual
// then), so it never runs highlightAll over the app's DOM. Imported first by ui/code/highlight.ts.
const w = globalThis as { Prism?: { manual?: boolean } };
w.Prism = { ...(w.Prism ?? {}), manual: true };
export {};
