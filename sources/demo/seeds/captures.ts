// DM-1 (CP-1): captures and drafts. One line to sort later, and a draft story for Northwind captured from a client's
// ask, with its AI-prepared DevOps version beside my own words (the stored sample: seeds never call a real model).
import type { DemoSeed } from "./types.ts";

export const capturesSeed: DemoSeed = {
  name: "captures",
  owner: "DM-1 (CP-1)",
  seed: async ({ run }) => {
    await run("capture.add", { text: "Ask Harbor about single sign-on for the intake form", clientKey: "Harbor" });
    const c = (await run("capture.add", { text: "Northwind wants to reorder from a past order in one click, ask Dana which order types count", clientKey: "Northwind" })).capture as { id: number };
    const routed = (await run("capture.route", { id: c.id, as: "draft", clientKey: "Northwind", title: "Reorder from a past order", parentItemId: 1110 })).capture as { routedId: number };
    await run("draft.prepare", { id: routed.routedId });
  },
};
