/** The subset of `Headers` this module needs, so tests need no fetch globals. */
export interface HeaderReader {
  get(name: string): string | null
}

/** Reported when no proxy header names the caller — everyone anonymous shares it. */
export const UNKNOWN_CLIENT_IP = "unknown"

/**
 * The caller's IP as the proxy chain reports it (plan §6-S16 step 2), used to
 * key the auth rate limit.
 *
 * The left-most `x-forwarded-for` entry is the original client; the rest are
 * the proxies it passed through. A caller can forge this header, so it is only
 * ever used to *throttle* — never to authorize or to identify anyone.
 */
export function clientIpFrom(headers: HeaderReader): string {
  const forwarded = headers.get("x-forwarded-for")
  const first = forwarded?.split(",")[0]?.trim()
  if (first !== undefined && first.length > 0) return first

  const real = headers.get("x-real-ip")?.trim()
  return real !== undefined && real.length > 0 ? real : UNKNOWN_CLIENT_IP
}
