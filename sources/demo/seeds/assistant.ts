// AS-2's seed: the assistant's own demo data (history, saved prompts, anything AS-2 adds). AS-2 owns this file
// (docs/demo/README.md); the scripted answers for the demo script live in sources/demo/assistant.ts.
import type { DemoSeed } from "./types.ts";

export const assistantSeed: DemoSeed = {
  name: "assistant",
  owner: "AS-2",
  seed: async () => {},
};
