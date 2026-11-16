/**
 * Retry scheduling for the job queue (plan §6-S5). Pure functions so the
 * backoff schedule is unit-testable with an injected Clock.
 */

const MAX_BACKOFF_MINUTES = 60

/**
 * Exponential backoff: min(2^attempts, 60) minutes after `now`. `attempts` is
 * the number of attempts already made (0-based on the first retry).
 */
export function nextRunAt(attempts: number, now: Date): Date {
  const minutes = Math.min(2 ** attempts, MAX_BACKOFF_MINUTES)
  return new Date(now.getTime() + minutes * 60_000)
}

/** A job is dead-lettered once its attempts reach the configured maximum. */
export function shouldDeadLetter(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts
}
