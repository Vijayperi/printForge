import { dbErrorToAppError, type Db } from "@/src/data/db"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

/**
 * Every rate-limited surface, in one place (plan §6-S16 step 2 / PRD §10:
 * "rate-limit authentication, generation, and upload endpoints"). The webhook
 * is deliberately absent — its signature is the gate, and throttling a payment
 * provider's retries would lose money, not protect us.
 */
export const RATE_LIMITS = {
  /**
   * Per account. This is the limit that matters: it is the one that stops
   * someone guessing their way into a *particular* person's account.
   */
  auth: { limit: 10, windowSeconds: 15 * 60 },
  /**
   * Per network, and deliberately much looser. Keying the 10-per-quarter-hour
   * limit on IP instead would have throttled every household and office behind
   * one NAT — common enough in India to matter — while an attacker rotating
   * addresses walked past it. This bucket exists only to bound someone spraying
   * one password across thousands of different addresses.
   */
  authNetwork: { limit: 100, windowSeconds: 15 * 60 },
  generation: { limit: 5, windowSeconds: 60 * 60 },
  upload: { limit: 10, windowSeconds: 60 * 60 },
} as const

export type RateLimitScope = keyof typeof RATE_LIMITS

/** `scope:subject` — the namespaced key the limiter counts against. */
export function rateLimitKey(scope: RateLimitScope, subject: string): string {
  return `${scope}:${subject}`
}

/**
 * Apply the configured limit for a scope. Returns the `rate_limited` error
 * itself when the caller is over, so a route or action only has to decide how
 * to say so.
 */
export async function enforceRateLimit(
  db: Db,
  clock: Clock,
  scope: RateLimitScope,
  subject: string
): Promise<Result<RateLimitResult>> {
  const limit = RATE_LIMITS[scope]
  const result = await checkRateLimit(db, clock, {
    key: rateLimitKey(scope, subject),
    windowSeconds: limit.windowSeconds,
    limit: limit.limit,
  })
  return result
}

/**
 * Fixed-window rate limit via the atomic `bump_rate_limit` SQL function
 * (plan §6-S5). `key` should namespace the action and subject, e.g.
 * `generation:{userId}`.
 */
export async function checkRateLimit(
  db: Db,
  clock: Clock,
  input: { key: string; windowSeconds: number; limit: number }
): Promise<Result<RateLimitResult>> {
  const { data, error } = await db.rpc<Array<{ allowed: boolean; retry_after: number }>>(
    "bump_rate_limit",
    {
      p_key: input.key,
      p_window_seconds: input.windowSeconds,
      p_limit: input.limit,
      p_now: clock.now().toISOString(),
    }
  )
  if (error !== null) return err(dbErrorToAppError(error))
  const row = (data ?? [])[0]
  if (row === undefined) return err(appError("internal", "rate limiter returned no row"))
  return ok({ allowed: row.allowed, retryAfterSeconds: row.retry_after })
}
