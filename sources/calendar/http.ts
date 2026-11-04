// One authorized GET for calendar APIs. Errors carry only a kind and an HTTP status, never bodies.
export class HttpError extends Error {
  readonly status: number;
  /** AP-1: seconds from a Retry-After header (429 or 503), when there was one. */
  readonly retryAfter: number | null;
  constructor(status: number, retryAfter: number | null = null) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export class NetworkError extends Error {}
export class PartialError extends Error {}
export class ForeignLinkError extends Error {}

export async function getJson(
  fetchFn: typeof fetch,
  url: string,
  token: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ json: unknown; status: number }> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { accept: "application/json", authorization: `Bearer ${token}`, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new NetworkError("network");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status);
  }
  return { json: await res.json(), status: res.status };
}
