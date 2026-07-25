import { describe, expect, it, vi } from "vitest"

import { MockGlbConverter } from "@/src/adapters/conversion/mock"
import type { GenerationProvider, GenerationStatus } from "@/src/adapters/generation"
import { MockPrinterGateway } from "@/src/adapters/printerGateway/mock"
import { MockSlicer } from "@/src/adapters/slicer/mock"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import type { ClaimedJob, JobQueue } from "@/src/jobs/queue"
import {
  dispatch,
  HANDLED_TYPES,
  retryableFromError,
  runLoop,
  runOnce,
  type WorkerDeps,
} from "@/src/jobs/worker"
import { FixedClock } from "@/src/lib/clock"
import { appError, type ErrorCode } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-22T10:00:00.000Z")

function stubProvider(over: Partial<GenerationProvider> = {}): GenerationProvider {
  return {
    submit: vi.fn(async () => ok({ providerTaskId: "task_1" })),
    poll: vi.fn(async () => ok<GenerationStatus>({ state: "creating" })),
    ...over,
  }
}

function fakeQueue(over: Partial<JobQueue> = {}): JobQueue {
  return {
    enqueue: vi.fn(async () => ok({ jobId: "j", deduped: false })),
    claimNext: vi.fn(async () => ok(null)),
    complete: vi.fn(async () => ok(undefined)),
    fail: vi.fn(async () => ok(undefined)),
    heartbeat: vi.fn(async () => ok(undefined)),
    reapStale: vi.fn(async () => ok(0)),
    ...over,
  }
}

function makeDeps(over: { queue?: JobQueue; provider?: GenerationProvider; rows?: Record<string, unknown>[] } = {}): WorkerDeps {
  const db = createFakeDb({
    design_versions: { rows: over.rows ?? [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
  const storage = new InMemoryStorage()
  return {
    db,
    queue: over.queue ?? fakeQueue(),
    provider: over.provider ?? stubProvider(),
    clock: new FixedClock(NOW),
    workerId: "w1",
    storage,
    converter: new MockGlbConverter(),
    slicer: new MockSlicer(storage),
    gateway: new MockPrinterGateway(),
    appUrl: "http://localhost:3000",
  }
}

const claimed = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  jobId: "job_1",
  type: "generation.submit",
  payload: { designVersionId: "dv_1" },
  attempts: 0,
  ...over,
})

describe("retryableFromError", () => {
  const cases: Array<[ErrorCode, boolean]> = [
    ["validation", false],
    ["not_found", false],
    ["forbidden", false],
    ["conflict", false],
    ["provider_error", true],
    ["internal", true],
    ["rate_limited", true],
    ["precondition_failed", true],
    ["unauthorized", true],
  ]
  it.each(cases)("%s → retryable %s", (code, expected) => {
    expect(retryableFromError({ code })).toBe(expected)
  })
})

describe("dispatch", () => {
  it("routes generation.submit to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "generation.submit", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation") // invalid payload reached the handler
  })

  it("routes generation.poll to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "generation.poll", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("routes asset.ingest to its handler", async () => {
    // No design version seeded → the handler reaches a not_found for that dv.
    const result = await dispatch(makeDeps(), claimed({ type: "asset.ingest", payload: { designVersionId: "dv_x", glbUrl: "/x.glb" } }))
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("routes validation.run to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "validation.run", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation") // invalid payload reached the handler
  })

  it("routes slicing.run to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "slicing.run", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation") // invalid payload reached the handler
  })

  it("routes print.dispatch to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "print.dispatch", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation") // invalid payload reached the handler
  })

  it("routes print.poll to its handler", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "print.poll", payload: {} }))
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("claims every job type it can handle", () => {
    expect(HANDLED_TYPES).toContain("print.dispatch")
    expect(HANDLED_TYPES).toContain("print.poll")
    expect(HANDLED_TYPES).not.toContain("notification.send")
  })

  it("has no handler for unregistered job types", async () => {
    const result = await dispatch(makeDeps(), claimed({ type: "notification.send", payload: {} }))
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("runOnce", () => {
  it("reports an error when claiming fails", async () => {
    const queue = fakeQueue({ claimNext: vi.fn(async () => err(appError("provider_error", "db down"))) })
    expect(await runOnce(makeDeps({ queue }))).toEqual({ outcome: "error", message: "db down" })
  })

  it("is idle when there is no job", async () => {
    expect(await runOnce(makeDeps())).toEqual({ outcome: "idle" })
  })

  it("completes a successfully handled job", async () => {
    const queue = fakeQueue({ claimNext: vi.fn(async () => ok(claimed())) })
    // A ready design version makes generation.submit a no-op success.
    const deps = makeDeps({ queue, rows: [{ id: "dv_1", project_id: "p", source: "generated", version_no: 1, generation_status: "ready" }] })
    const result = await runOnce(deps)
    expect(result).toEqual({ outcome: "completed", jobId: "job_1" })
    expect(queue.complete).toHaveBeenCalledWith("job_1")
  })

  it("fails a job permanently on a non-retryable handler error", async () => {
    const queue = fakeQueue({ claimNext: vi.fn(async () => ok(claimed({ payload: {} }))) }) // invalid payload → validation
    const result = await runOnce(makeDeps({ queue }))
    expect(result).toEqual({ outcome: "failed", jobId: "job_1", retryable: false })
    expect(queue.fail).toHaveBeenCalledWith("job_1", expect.any(String), { retryable: false })
  })

  it("fails a job retryably when the handler throws", async () => {
    const provider = stubProvider({
      submit: vi.fn(async () => {
        throw new Error("kaboom")
      }),
    })
    const queue = fakeQueue({ claimNext: vi.fn(async () => ok(claimed())) })
    const deps = makeDeps({ queue, provider, rows: [{ id: "dv_1", project_id: "p", source: "generated", version_no: 1, generation_status: "queued", brief_json: { rawPrompt: "x" }, provider_task_id: null }] })
    const result = await runOnce(deps)
    expect(result).toEqual({ outcome: "failed", jobId: "job_1", retryable: true })
    expect(queue.fail).toHaveBeenCalledWith("job_1", "kaboom", { retryable: true })
  })

  it("uses a generic message when a non-Error is thrown", async () => {
    const provider = stubProvider({
      submit: vi.fn(async () => {
        throw "just a string"
      }),
    })
    const queue = fakeQueue({ claimNext: vi.fn(async () => ok(claimed())) })
    const deps = makeDeps({ queue, provider, rows: [{ id: "dv_1", project_id: "p", source: "generated", version_no: 1, generation_status: "queued", brief_json: { rawPrompt: "x" }, provider_task_id: null }] })
    await runOnce(deps)
    expect(queue.fail).toHaveBeenCalledWith("job_1", "handler threw", { retryable: true })
  })
})

describe("runLoop", () => {
  it("reaps, processes, and sleeps while idle until stopped", async () => {
    let ticks = 0
    const keepRunning = () => ticks++ < 2
    const sleep = vi.fn(async () => {})
    const queue = fakeQueue()
    const deps = makeDeps({ queue })
    await runLoop(deps, { intervalMs: 100, reapThresholdSeconds: 600, keepRunning, sleep })
    expect(queue.reapStale).toHaveBeenCalledTimes(2)
    expect(queue.reapStale).toHaveBeenCalledWith(600)
    expect(sleep).toHaveBeenCalledTimes(2) // idle both iterations
    expect(sleep).toHaveBeenCalledWith(100)
  })

  it("does not sleep when a job was handled", async () => {
    let ticks = 0
    const keepRunning = () => ticks++ < 1
    const sleep = vi.fn(async () => {})
    const queue = fakeQueue({ claimNext: vi.fn(async () => ok(claimed())) })
    const deps = makeDeps({ queue, rows: [{ id: "dv_1", project_id: "p", source: "generated", version_no: 1, generation_status: "ready" }] })
    await runLoop(deps, { intervalMs: 100, reapThresholdSeconds: 600, keepRunning, sleep })
    expect(sleep).not.toHaveBeenCalled()
  })
})
