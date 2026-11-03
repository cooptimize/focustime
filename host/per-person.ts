// A2: things the host keeps per person (their snapshot cache), named by a hash of their id.
import { createHash } from "node:crypto";
/**
 * One thing per person, made once, named by a hash of their id (so no id shows in a folder name). The hash is
 * sha256("focustime-person:" + id), first 16 hex digits.
 */
export function perPerson<T>(make: (hash: string) => T): (userId: string) => T {
  const made = new Map<string, T>();
  return (userId) => {
    if (!userId) throw new Error("A person is needed");
    let t = made.get(userId);
    if (!t) made.set(userId, (t = make(createHash("sha256").update(`focustime-person:${userId}`).digest("hex").slice(0, 16))));
    return t;
  };
}
