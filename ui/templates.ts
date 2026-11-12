// TP-1: the team's work templates in the page: read once and shared by the New form, the draft editor, Settings and
// Admin; an admin's save replaces the copy everywhere at once.
import { useEffect, useState } from "react";
import type { TemplatesView } from "../actions/template-actions.ts";
import { call } from "./api.ts";

let current: Promise<TemplatesView> | null = null;
const listeners = new Set<(v: TemplatesView) => void>();

function load(fresh = false): Promise<TemplatesView> {
  if (!current || fresh) {
    current = call<TemplatesView>("templates.load", {});
    current.then((v) => listeners.forEach((f) => f(v)), () => (current = null));
  }
  return current;
}

/** An admin saved: every open form and page uses the new templates. */
export function templatesSaved(v: TemplatesView): void {
  current = Promise.resolve(v);
  listeners.forEach((f) => f(v));
}

/** The templates, or null while reading (and when they can't be read: the form works without the four lines). */
export function useTemplates(fresh = false): { view: TemplatesView | null; error: string | null; reload: () => Promise<void> } {
  const [view, setView] = useState<TemplatesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const on = (v: TemplatesView) => live && setView(v);
    listeners.add(on);
    load(fresh).then(on, (e: unknown) => live && setError(e instanceof Error ? e.message : "Couldn't read the work templates"));
    return () => {
      live = false;
      listeners.delete(on);
    };
  }, [fresh]);
  return { view, error, reload: async () => void (await load(true).catch(() => null)) };
}
