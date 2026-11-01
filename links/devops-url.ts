// A work item link must be on the client's own DevOps organization (pure; used by link.open).
/** Returns the normalized URL or why not. */
export function checkDevOpsUrl(url: unknown, org: string | null): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof url !== "string" || url.length > 2000) return { ok: false, error: "url must be text" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: "Not a valid link" };
  }
  if (u.protocol !== "https:" || u.hostname !== "dev.azure.com" || u.port || u.username || u.password) return { ok: false, error: "Only Azure DevOps links (https://dev.azure.com/...) can be opened" };
  if (!org) return { ok: false, error: "This client's DevOps organization is not known yet. Refresh and try again" };
  const first = decodeURIComponent(u.pathname.split("/")[1] ?? "");
  if (first.toLowerCase() !== org.toLowerCase()) return { ok: false, error: "That link is not in this client's DevOps organization" };
  return { ok: true, url: u.href };
}
