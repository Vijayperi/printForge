import { dbErrorToAppError, type Db } from "@/src/data/db"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
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
