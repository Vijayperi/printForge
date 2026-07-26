import "server-only"

import { dbErrorToAppError, type Db } from "@/src/data/db"
import type { JobRow } from "@/src/domain/types"
import { nextRunAt, shouldDeadLetter } from "@/src/jobs/backoff"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { newId } from "@/src/lib/ids"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * Every job type the system can queue (plan §4.4). A list rather than a bare
 * union so the worker's own test can assert it claims all of them — adding a
 * type without a handler then fails a test instead of dead-lettering in
 * production.
 */
export const JOB_TYPES = [
  "generation.submit",
  "generation.poll",
  "asset.ingest",
  "validation.run",
  "slicing.run",
  "print.dispatch",
  // Not in the plan's §4.4 list: the status poller needs its own type so the
  // worker can claim polls without re-running a dispatch (see DECISIONS.md).
  "print.poll",
  "notification.send",
] as const

export type JobType = (typeof JOB_TYPES)[number]

export interface ClaimedJob {
  jobId: string
  type: JobType
  payload: unknown
  attempts: number
}

export interface EnqueueInput {
  type: JobType
  payload: unknown
  idempotencyKey: string
  runAt?: Date
  maxAttempts?: number
}

export interface JobQueue {
  enqueue(input: EnqueueInput): Promise<Result<{ jobId: string; deduped: boolean }>>
  claimNext(workerId: string, types: JobType[]): Promise<Result<ClaimedJob | null>>
  complete(jobId: string): Promise<Result<void>>
  fail(jobId: string, error: string, opts: { retryable: boolean }): Promise<Result<void>>
  heartbeat(jobId: string): Promise<Result<void>>
  reapStale(thresholdSeconds: number): Promise<Result<number>>
}

const TABLE = "jobs"
const UNIQUE_VIOLATION = "23505"

export class PostgresJobQueue implements JobQueue {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock
  ) {}

  async enqueue(input: EnqueueInput): Promise<Result<{ jobId: string; deduped: boolean }>> {
    const now = this.clock.now()
    const id = newId("job")
    const row = {
      id,
      type: input.type,
      payload: input.payload,
      status: "pending",
      idempotency_key: input.idempotencyKey,
      attempts: 0,
      max_attempts: input.maxAttempts ?? 5,
      run_at: (input.runAt ?? now).toISOString(),
    }
    const { error } = await this.db.from<JobRow>(TABLE).insert(row as unknown as JobRow).select().single()
    if (error !== null) {
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await this.db
          .from<JobRow>(TABLE)
          .select()
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle()
        if (existing.error !== null) return err(dbErrorToAppError(existing.error))
        const existingId = existing.data?.id ?? id
        return ok({ jobId: existingId, deduped: true })
      }
      return err(dbErrorToAppError(error))
    }
    return ok({ jobId: id, deduped: false })
  }

  async claimNext(workerId: string, types: JobType[]): Promise<Result<ClaimedJob | null>> {
    const { data, error } = await this.db.rpc<JobRow[]>("claim_next_job", {
      p_worker_id: workerId,
      p_types: types,
      p_now: this.clock.now().toISOString(),
    })
    if (error !== null) return err(dbErrorToAppError(error))
    const row = (data ?? [])[0]
    if (row === undefined) return ok(null)
    return ok({
      jobId: row.id,
      type: row.type as JobType,
      payload: row.payload,
      attempts: row.attempts,
    })
  }

  async complete(jobId: string): Promise<Result<void>> {
    const { error } = await this.db
      .from<JobRow>(TABLE)
      .update({ status: "done", updated_at: this.clock.now().toISOString() })
      .eq("id", jobId)
    if (error !== null) return err(dbErrorToAppError(error))
    return ok(undefined)
  }

  async fail(jobId: string, message: string, opts: { retryable: boolean }): Promise<Result<void>> {
    const current = await this.db
      .from<JobRow>(TABLE)
      .select()
      .eq("id", jobId)
      .maybeSingle()
    if (current.error !== null) return err(dbErrorToAppError(current.error))
    if (current.data === null) return err(appError("not_found", `job ${jobId} not found`))

    const attempts = current.data.attempts + 1
    const now = this.clock.now()
    const deadLetter = !opts.retryable || shouldDeadLetter(attempts, current.data.max_attempts)
    const patch: Partial<JobRow> = {
      attempts,
      last_error: message,
      locked_by: null,
      locked_at: null,
      updated_at: now.toISOString(),
      status: deadLetter ? "dead" : "pending",
      run_at: deadLetter ? current.data.run_at : nextRunAt(attempts, now).toISOString(),
    }
    const { error } = await this.db.from<JobRow>(TABLE).update(patch).eq("id", jobId)
    if (error !== null) return err(dbErrorToAppError(error))
    return ok(undefined)
  }

  async heartbeat(jobId: string): Promise<Result<void>> {
    const { error } = await this.db
      .from<JobRow>(TABLE)
      .update({ locked_at: this.clock.now().toISOString() })
      .eq("id", jobId)
    if (error !== null) return err(dbErrorToAppError(error))
    return ok(undefined)
  }

  async reapStale(thresholdSeconds: number): Promise<Result<number>> {
    const { data, error } = await this.db.rpc<number>("reap_stale_jobs", {
      p_now: this.clock.now().toISOString(),
      p_threshold_seconds: thresholdSeconds,
    })
    if (error !== null) return err(dbErrorToAppError(error))
    return ok(data ?? 0)
  }
}
