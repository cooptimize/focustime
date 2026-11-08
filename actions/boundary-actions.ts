// GD-2 point 6: the exit check as an action, for editors that show the flag while I type (the status report's lines)
// before any preview. The same check the write framework and Close the loop run (plan/boundary.ts exitCheck); reads
// only. The other client's name goes back only to me, about my own text; nothing is logged but a count.
import type { ClientEntry } from "../ai/guard.ts";
import { exitCheck } from "../plan/boundary.ts";
import type { ActionResponse } from "./types.ts";

export type BoundaryContext = {
  boundary: (clientKey: string) => Promise<{ internal: boolean; directory: ClientEntry[] }>;
  isMine: (clientKey: string) => Promise<boolean>;
};
export type BoundaryCheck = { names: string[]; replaced: string[] };

export async function boundaryCheck(ctx: BoundaryContext, input: unknown): Promise<ActionResponse> {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const ok = o && Object.keys(o).every((k) => k === "clientKey" || k === "texts") && typeof o.clientKey === "string" && o.clientKey.length > 0 && o.clientKey.length <= 100
    && Array.isArray(o.texts) && o.texts.length >= 1 && o.texts.length <= 20 && o.texts.every((t) => typeof t === "string" && t.length <= 8000);
  if (!ok) return { ok: false, status: 400, error: "boundary.check takes { clientKey, texts: [text, ...] }" };
  const clientKey = o.clientKey as string;
  const texts = o.texts as string[];
  if (!(await ctx.isMine(clientKey))) return { ok: false, status: 404, error: "That isn't one of your clients" };
  const b = await ctx.boundary(clientKey);
  const flag = exitCheck(texts, clientKey, b.directory, { internal: b.internal });
  return { ok: true, data: (flag ?? { names: [], replaced: texts }) satisfies BoundaryCheck };
}
