// A3: the store is async, so `expect(store.thing())` without `await` would compare a Promise and could pass by
// accident (`not.toBeNull()` holds for any Promise). Every matcher here fails on a Promise unless it is used through
// `.resolves` or `.rejects`.
import { chai } from "vitest";

chai.use((c, utils) => {
  const proto = c.Assertion.prototype as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!/^to[A-Z]/.test(name) || name === "toThrow" || name === "toThrowError" || name === "toThrowErrorMatchingInlineSnapshot" || name === "toThrowErrorMatchingSnapshot") continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function") continue;
    utils.overwriteMethod(c.Assertion.prototype, name, (orig: (...a: unknown[]) => unknown) =>
      function (this: object, ...args: unknown[]) {
        const obj = utils.flag(this, "object") as { then?: unknown } | null | undefined;
        if (obj && typeof obj.then === "function" && !utils.flag(this, "promise")) throw new Error(`expect() was given a Promise for ${name}: await it first, or use .resolves / .rejects`);
        return orig.apply(this, args);
      },
    );
  }
});
