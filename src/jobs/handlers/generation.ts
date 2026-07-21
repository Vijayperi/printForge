import "server-only"

import { z } from "zod"

import type { GenerationProvider } from "@/src/adapters/generation"
import type { Db } from "@/src/data/db"
import {
  getDesignVersion,
  setProviderTask,
  updateGenerationStatus,
} from "@/src/data/designVersions"
import {
  generationMachine,
  type GenerationEvent,
  type GenerationState,
} from "@/src/domain/stateMachines/generation"
import type { JobQueue } from "@/src/jobs/queue"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface GenerationDeps {
  db: Db
  queue: JobQueue
  provider: GenerationProvider
  clock: Clock
}

export const POLL_DELAY_MS = 10_000

const submitPayload = z.object({ designVersionId: z.string().min(1) })
const pollPayload = z.object({ designVersionId: z.string().min(1), pollCount: z.number().int().min(1) })

function toVoid<T>(r: Result<T>): Result<void> {
  return r.ok ? ok(undefined) : r
}

async function enqueuePoll(deps: GenerationDeps, dvId: string, pollCount: number): Promise<Result<void>> {
  return toVoid(
    await deps.queue.enqueue({
      type: "generation.poll",
      payload: { designVersionId: dvId, pollCount },
      idempotencyKey: `poll:${dvId}:${pollCount}`,
      runAt: new Date(deps.clock.now().getTime() + POLL_DELAY_MS),
    })
  )
}

/** Guarded generation-status write: routes through the state machine. */
async function applyGenerationEvent(
  deps: GenerationDeps,
  dvId: string,
  from: GenerationState,
  event: GenerationEvent
): Promise<Result<void>> {
  const next = generationMachine.next(from, event)
  if (!next.ok) return next
  return toVoid(await updateGenerationStatus(deps.db, dvId, next.value))
}

/** generation.submit: hand the brief to the provider and start polling. */
export async function handleGenerationSubmit(
  deps: GenerationDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = submitPayload.safeParse(rawPayload)
  if (!parsed.success) return { ok: false, error: appError("validation", "invalid generation.submit payload") }
  const dvId = parsed.data.designVersionId

  const dvResult = await getDesignVersion(deps.db, dvId)
  if (!dvResult.ok) return dvResult
  if (dvResult.value === null) return { ok: false, error: appError("not_found", `design version ${dvId} not found`) }
  const dv = dvResult.value
  const status = dv.generation_status as GenerationState

  // Terminal already: nothing to do (retry-safe no-op).
  if (status === "ready" || status === "failed") return ok(undefined)

  // Already submitted (a retry after a partial run): just ensure polling.
  const accepted = generationMachine.next(status, "PROVIDER_ACCEPTED")
  if (!accepted.ok) return enqueuePoll(deps, dvId, 1)

  if (dv.brief_json === null) return { ok: false, error: appError("validation", `design version ${dvId} has no brief`) }
  const submit = await deps.provider.submit(dv.brief_json)
  if (!submit.ok) return submit

  const updated = await setProviderTask(deps.db, dvId, submit.value.providerTaskId, accepted.value)
  if (!updated.ok) return updated

  return enqueuePoll(deps, dvId, 1)
}

/** generation.poll: advance the design version toward ready, or reschedule. */
export async function handleGenerationPoll(
  deps: GenerationDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = pollPayload.safeParse(rawPayload)
  if (!parsed.success) return { ok: false, error: appError("validation", "invalid generation.poll payload") }
  const { designVersionId: dvId, pollCount } = parsed.data

  const dvResult = await getDesignVersion(deps.db, dvId)
  if (!dvResult.ok) return dvResult
  if (dvResult.value === null) return { ok: false, error: appError("not_found", `design version ${dvId} not found`) }
  const dv = dvResult.value
  const status = dv.generation_status as GenerationState

  if (status === "ready" || status === "failed") return ok(undefined) // idempotent re-poll
  if (dv.provider_task_id === null) {
    return { ok: false, error: appError("validation", `design version ${dvId} has no provider task`) }
  }

  const poll = await deps.provider.poll(dv.provider_task_id)
  if (!poll.ok) return poll
  const providerStatus = poll.value

  switch (providerStatus.state) {
    case "queued":
    case "creating":
      return enqueuePoll(deps, dvId, pollCount + 1)
    case "failed":
      return applyGenerationEvent(deps, dvId, status, "PROVIDER_FAILED")
    case "ready": {
      // Finalize the status, then hand off to asset ingestion (S7).
      const completed = await applyGenerationEvent(deps, dvId, status, "PROVIDER_COMPLETED")
      if (!completed.ok) return completed
      return toVoid(
        await deps.queue.enqueue({
          type: "asset.ingest",
          payload: {
            designVersionId: dvId,
            glbUrl: providerStatus.assets.glbUrl,
            stlUrl: providerStatus.assets.stlUrl ?? null,
          },
          idempotencyKey: `ingest:${dvId}`,
        })
      )
    }
  }
}
