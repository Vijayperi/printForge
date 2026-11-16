import { describe, expect, it, vi } from "vitest"

import type { GenerationProvider, GenerationStatus } from "@/src/adapters/generation"
import { handleGenerationPoll, handleGenerationSubmit, POLL_DELAY_MS } from "@/src/jobs/handlers/generation"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { FixedClock } from "@/src/lib/clock"
import { ok, err } from "@/src/lib/result"
import { appError } from "@/src/lib/errors"
import type { StructuredBrief } from "@/src/domain/types"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-22T10:00:00.000Z")
const brief: StructuredBrief = {
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "cute",
  durability: "display",
  rawPrompt: "a friendly dinosaur",
}

function dvRow(over: Record<string, unknown> = {}) {
  return {
    id: "dv_1",
    project_id: "proj_1",
    source: "generated",
    version_no: 1,
    prompt: "a friendly dinosaur",
    brief_json: brief,
    provider_task_id: null,
    generation_status: "queued",
    ...over,
  }
}

function stubProvider(over: Partial<GenerationProvider> = {}): GenerationProvider {
  return {
    submit: vi.fn(async () => ok({ providerTaskId: "task_1" })),
    poll: vi.fn(async () => ok<GenerationStatus>({ state: "creating" })),
    ...over,
  }
}

function makeDeps(rows: Record<string, unknown>[], provider = stubProvider()) {
  const clock = new FixedClock(NOW)
  const db = createFakeDb({
    design_versions: { rows, unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
  const queue = new PostgresJobQueue(db, clock)
  return { clock, db, provider, queue, deps: { db, queue, provider, clock } }
}

describe("handleGenerationSubmit", () => {
  it("rejects an invalid payload", async () => {
    const { deps } = makeDeps([])
    const result = await handleGenerationSubmit(deps, { nope: true })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("fails when the design version is missing", async () => {
    const { deps } = makeDeps([])
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_x" })
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("submits the brief, records the task, and enqueues the first poll", async () => {
    const { deps, db, provider } = makeDeps([dvRow()])
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(result.ok).toBe(true)
    expect(provider.submit).toHaveBeenCalledWith(brief)

    const dv = db.rows("design_versions")[0]!
    expect(dv["generation_status"]).toBe("creating")
    expect(dv["provider_task_id"]).toBe("task_1")

    const job = db.rows("jobs")[0]!
    expect(job["type"]).toBe("generation.poll")
    expect(job["idempotency_key"]).toBe("poll:dv_1:1")
    expect(job["run_at"]).toBe(new Date(NOW.getTime() + POLL_DELAY_MS).toISOString())
  })

  it("fails when a queued version has no brief", async () => {
    const { deps } = makeDeps([dvRow({ brief_json: null })])
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("propagates a provider submit failure (retryable)", async () => {
    const provider = stubProvider({ submit: vi.fn(async () => err(appError("provider_error", "meshy down"))) })
    const { deps } = makeDeps([dvRow()], provider)
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("is idempotent when already creating: re-enqueues the poll without resubmitting", async () => {
    const provider = stubProvider()
    const { deps, db } = makeDeps([dvRow({ generation_status: "creating", provider_task_id: "task_1" })], provider)
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(result.ok).toBe(true)
    expect(provider.submit).not.toHaveBeenCalled()
    expect(db.rows("jobs")[0]!["type"]).toBe("generation.poll")
  })

  it("is a no-op for a terminal design version", async () => {
    const { deps, db, provider } = makeDeps([dvRow({ generation_status: "ready" })])
    expect((await handleGenerationSubmit(deps, { designVersionId: "dv_1" })).ok).toBe(true)
    expect(provider.submit).not.toHaveBeenCalled()
    expect(db.rows("jobs")).toHaveLength(0)
  })

  it("propagates a setProviderTask write error", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(2, { message: "update boom" }) // op1 select, op2 setProviderTask update
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates an enqueue error", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(3, { message: "enqueue boom" }) // op3 = poll enqueue insert
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates a design-version read error", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failNext({ message: "read boom" })
    const result = await handleGenerationSubmit(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("handleGenerationPoll", () => {
  const creatingDv = dvRow({ generation_status: "creating", provider_task_id: "task_1" })

  it("rejects an invalid payload", async () => {
    const { deps } = makeDeps([])
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1" })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("fails when the design version is missing", async () => {
    const { deps } = makeDeps([])
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_x", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("is a no-op re-poll for a terminal version", async () => {
    const { deps } = makeDeps([dvRow({ generation_status: "ready", provider_task_id: "task_1" })])
    expect((await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 3 })).ok).toBe(true)
  })

  it("fails when there is no provider task", async () => {
    const { deps } = makeDeps([dvRow({ generation_status: "creating", provider_task_id: null })])
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("reschedules the next poll while the provider is still working", async () => {
    const provider = stubProvider({ poll: vi.fn(async () => ok<GenerationStatus>({ state: "creating" })) })
    const { deps, db } = makeDeps([creatingDv], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(result.ok).toBe(true)
    const job = db.rows("jobs")[0]!
    expect(job["idempotency_key"]).toBe("poll:dv_1:2")
  })

  it("reschedules while the provider is still queued", async () => {
    const provider = stubProvider({ poll: vi.fn(async () => ok<GenerationStatus>({ state: "queued" })) })
    const { deps, db } = makeDeps([creatingDv], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(result.ok).toBe(true)
    expect(db.rows("jobs")[0]!["idempotency_key"]).toBe("poll:dv_1:2")
  })

  it("propagates a design-version read error", async () => {
    const { deps, db } = makeDeps([creatingDv])
    db.failNext({ message: "read boom" })
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("finalizes to ready and enqueues asset ingestion", async () => {
    const provider = stubProvider({
      poll: vi.fn(async () => ok<GenerationStatus>({ state: "ready", assets: { glbUrl: "/g.glb", stlUrl: "/s.stl" } })),
    })
    const { deps, db } = makeDeps([creatingDv], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 2 })
    expect(result.ok).toBe(true)
    expect(db.rows("design_versions")[0]!["generation_status"]).toBe("ready")
    const job = db.rows("jobs")[0]!
    expect(job["type"]).toBe("asset.ingest")
    expect(job["idempotency_key"]).toBe("ingest:dv_1")
    expect((job["payload"] as Record<string, unknown>)["glbUrl"]).toBe("/g.glb")
  })

  it("defaults a missing stlUrl to null in the ingest payload", async () => {
    const provider = stubProvider({
      poll: vi.fn(async () => ok<GenerationStatus>({ state: "ready", assets: { glbUrl: "/g.glb" } })),
    })
    const { deps, db } = makeDeps([creatingDv], provider)
    await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 2 })
    expect((db.rows("jobs")[0]!["payload"] as Record<string, unknown>)["stlUrl"]).toBeNull()
  })

  it("marks the version failed when the provider reports failure", async () => {
    const provider = stubProvider({ poll: vi.fn(async () => ok<GenerationStatus>({ state: "failed", reason: "bad mesh" })) })
    const { deps, db } = makeDeps([creatingDv], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(result.ok).toBe(true)
    expect(db.rows("design_versions")[0]!["generation_status"]).toBe("failed")
  })

  it("propagates a provider poll failure (retryable)", async () => {
    const provider = stubProvider({ poll: vi.fn(async () => err(appError("provider_error", "timeout"))) })
    const { deps } = makeDeps([creatingDv], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("returns a conflict for an illegal transition (ready reported for a queued version)", async () => {
    const provider = stubProvider({
      poll: vi.fn(async () => ok<GenerationStatus>({ state: "ready", assets: { glbUrl: "/g.glb" } })),
    })
    // queued + provider task set (unusual) → PROVIDER_COMPLETED is illegal from queued.
    const { deps } = makeDeps([dvRow({ generation_status: "queued", provider_task_id: "task_1" })], provider)
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it("propagates a status write error on ready", async () => {
    const provider = stubProvider({
      poll: vi.fn(async () => ok<GenerationStatus>({ state: "ready", assets: { glbUrl: "/g.glb" } })),
    })
    const { deps, db } = makeDeps([creatingDv], provider)
    db.failCall(2, { message: "update boom" }) // op1 select, op2 status update
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates an ingest enqueue error", async () => {
    const provider = stubProvider({
      poll: vi.fn(async () => ok<GenerationStatus>({ state: "ready", assets: { glbUrl: "/g.glb" } })),
    })
    const { deps, db } = makeDeps([creatingDv], provider)
    db.failCall(3, { message: "enqueue boom" }) // op3 = asset.ingest enqueue
    const result = await handleGenerationPoll(deps, { designVersionId: "dv_1", pollCount: 1 })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("FakeDb type export", () => {
  it("is constructible", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
