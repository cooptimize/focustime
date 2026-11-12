// TP-1: the team's work templates. Everyone signed in reads them (the New form, the draft editor, the story card,
// Settings' read-only view); only a FocusTime admin saves them (the one server-side check, actions/admin.ts), with one
// line of why, from the version they opened (refused when another admin saved since). Admins also see, per type, how
// many items were created with it and how many of those had all four lines: counts only, never who, which client or
// which item.
import { BriefError, checkTemplates, templateChanges, type WorkTemplates } from "../plan/work-templates.ts";
import type { Actor } from "../store/admin-store.ts";
import type { TemplatesStore, TemplateUses } from "../store/work-templates-store.ts";
import type { ActionResponse } from "./types.ts";

export const TEMPLATE_ACTIONS = ["templates.load", "templates.save"] as const;
export type TemplateAction = (typeof TEMPLATE_ACTIONS)[number];

export type TemplatesContext = {
  store: TemplatesStore | null;
  /** The signed-in person when they are a FocusTime admin, else null. */
  admin: () => Promise<Actor | null>;
};

export type TemplatesView = { doc: WorkTemplates; version: number; updatedAt: string; updatedBy: string | null; admin: boolean; uses?: TemplateUses };

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const WHY_MAX = 200;

export async function templateAction(ctx: TemplatesContext, action: TemplateAction, input: unknown): Promise<ActionResponse> {
  if (!ctx.store) return bad("Work templates aren't available here", 503);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("input must be an object");
  const i = input as Record<string, unknown>;
  switch (action) {
    case "templates.load": {
      if (Object.keys(i).length) return bad("templates.load takes {}");
      const [row, me] = await Promise.all([ctx.store.read(), ctx.admin()]);
      const view: TemplatesView = { ...row, admin: !!me, ...(me ? { uses: await ctx.store.uses() } : {}) };
      return { ok: true, data: view };
    }
    case "templates.save": {
      for (const k of Object.keys(i)) if (!["doc", "version", "why"].includes(k)) return bad(`unknown input field ${k}`);
      const me = await ctx.admin();
      if (!me) return bad("Only a FocusTime admin can change the work templates", 403, "admin");
      if (typeof i.version !== "number" || !Number.isSafeInteger(i.version)) return bad("version must be the version you opened");
      const why = typeof i.why === "string" ? i.why.replace(/\s+/g, " ").trim() : "";
      if (!why) return bad("Say in one line why, for the audit", 400, "why");
      if (why.length > WHY_MAX) return bad(`Why is at most ${WHY_MAX} characters`, 400, "why");
      const was = await ctx.store.read();
      let next: WorkTemplates;
      try {
        next = checkTemplates(i.doc, was.doc);
      } catch (e) {
        if (e instanceof BriefError) return bad(e.message, 422, "invalid");
        throw e;
      }
      const r = await ctx.store.save(next, i.version, me, why, templateChanges(was.doc, next));
      if (r === "conflict") return bad("Another admin saved the templates since you opened them. Your edits are still here: reload theirs, then make yours again", 409, "conflict");
      return { ok: true, data: { ...r, admin: true, uses: await ctx.store.uses() } satisfies TemplatesView };
    }
  }
}
