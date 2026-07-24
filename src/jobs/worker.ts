import "server-only"

import type { GlbConverter } from "@/src/adapters/conversion"
import type { Slicer } from "@/src/adapters/slicer"
import type { AssetStorage } from "@/src/adapters/storage"
import {
  handleGenerationPoll,
  handleGenerationSubmit,
  type GenerationDeps,
} from "@/src/jobs/handlers/generation"
import { handleAssetIngest } from "@/src/jobs/handlers/ingestion"
import { handleSlicingRun } from "@/src/jobs/handlers/slicing"
import { handleValidationRun } from "@/src/jobs/handlers/validation"
import type { ClaimedJob, JobType } from "@/src/jobs/queue"
import { appError, type ErrorCode } from "@/src/lib/errors"
import { err, type Result } from "@/src/lib/result"

export interface WorkerDeps extends GenerationDeps {
  workerId: string
  storage: AssetStorage
  converter: GlbConverter
  slicer: Slicer
  appUrl: string
}

/** Job types this worker claims and can dispatch. */
export const HANDLED_TYPES: JobType[] = [
  "generation.submit",
  "generation.poll",
  "asset.ingest",
  "validation.run",
  "slicing.run",
]

const PERMANENT_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "validation",
  "not_found",
  "forbidden",
  "conflict",
])

/** A failed job is retried unless its error is permanent. */
export function retryableFromError(error: { code: ErrorCode }): boolean {
  return !PERMANENT_CODES.has(error.code)
}

/** Route a claimed job to its handler. */
export function dispatch(deps: WorkerDeps, job: ClaimedJob): Promise<Result<void>> {
  switch (job.type) {
    case "generation.submit":
      return handleGenerationSubmit(deps, job.payload)
    case "generation.poll":
      return handleGenerationPoll(deps, job.payload)
    case "asset.ingest":
      return handleAssetIngest(
        {
          db: deps.db,
          storage: deps.storage,
          converter: deps.converter,
          appUrl: deps.appUrl,
          queue: deps.queue,
        },
        job.payload
      )
    case "validation.run":
      return handleValidationRun(
        { db: deps.db, storage: deps.storage, queue: deps.queue },
        job.payload
      )
    case "slicing.run":
      return handleSlicingRun({ db: deps.db, slicer: deps.slicer, clock: deps.clock }, job.payload)
    default:
      return Promise.resolve(err(appError("not_found", `no handler for job type ${job.type}`)))
  }
}

export type RunOutcome =
  | { outcome: "idle" }
  | { outcome: "error"; message: string }
  | { outcome: "completed"; jobId: string }
  | { outcome: "failed"; jobId: string; retryable: boolean }

/** Claim and process at most one job. */
export async function runOnce(deps: WorkerDeps): Promise<RunOutcome> {
  const claim = await deps.queue.claimNext(deps.workerId, HANDLED_TYPES)
  if (!claim.ok) return { outcome: "error", message: claim.error.message }
  if (claim.value === null) return { outcome: "idle" }
  const job = claim.value

  let result: Result<void>
  try {
    result = await dispatch(deps, job)
  } catch (thrown) {
    result = err(appError("internal", thrown instanceof Error ? thrown.message : "handler threw"))
  }

  if (result.ok) {
    await deps.queue.complete(job.jobId)
    return { outcome: "completed", jobId: job.jobId }
  }
  const retryable = retryableFromError(result.error)
  await deps.queue.fail(job.jobId, result.error.message, { retryable })
  return { outcome: "failed", jobId: job.jobId, retryable }
}

export interface LoopOptions {
  intervalMs: number
  reapThresholdSeconds: number
  keepRunning: () => boolean
  sleep: (ms: number) => Promise<void>
}

/** Reap stale locks then process jobs until `keepRunning` turns false. */
export async function runLoop(deps: WorkerDeps, opts: LoopOptions): Promise<void> {
  while (opts.keepRunning()) {
    await deps.queue.reapStale(opts.reapThresholdSeconds)
    const result = await runOnce(deps)
    if (result.outcome === "idle") await opts.sleep(opts.intervalMs)
  }
}
