// RB-7: one small rule, in its own file so Code's address (ui/nav.ts, in the first download) can use it alone.
/**
 * RB-7: a name a branch can have, as far as Code needs (git's own rules: no control characters, spaces, ~ ^ : ? * [ or
 * backslash, no "..", no empty part, not ending in ".lock" or "/"). Every branch Code reads by name passes this.
 */
export const isBranchName = (n: unknown): n is string =>
  // eslint-disable-next-line no-control-regex
  typeof n === "string" && /^[^\u0000-\u001f\u007f\s~^:?*[\\]{1,250}$/.test(n) && !n.startsWith("/") && !n.endsWith("/") && !n.includes("//") && !n.includes("..") && !n.endsWith(".lock") && n !== "@" && !n.includes("@{");
