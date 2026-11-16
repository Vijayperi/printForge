import { describe, expect, it } from "vitest"

import type { Db } from "@/src/data/db"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { FixedClock } from "@/src/lib/clock"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-22T10:00:00.000Z")

function setup() {
  const clock = new FixedClock(NOW)
  const db = createFakeDb({ jobs: { rows: [], unique: ["id", "idempotency_key"] } })
  const queue = new PostgresJobQueue(db, clock)
  return { clock, db, queue }
}

describe("enqueue", () => {
  it("inserts a pending job with defaults and reports not deduped", async () => {
    const { db, queue } = setup()
    const result = await queue.enqueue({ type: "generation.submit", payload: { a: 1 }, idempotencyKey: "k1" })
    expect(result.ok).toBe(true)
    const row = db.rows("jobs")[0]!
    expect(row["status"]).toBe("pending")
    expect(row["type"]).toBe("generation.submit")
    expect(row["idempotency_key"]).toBe("k1")
    expect(row["attempts"]).toBe(0)
    expect(row["max_attempts"]).toBe(5)
    expect(row["run_at"]).toBe(NOW.toISOString())
  })

  it("honors runAt and maxAttempts overrides", async () => {
    const { db, queue } = setup()
    const runAt = new Date("2026-07-22T10:05:00.000Z")
    await queue.enqueue({ type: "generation.poll", payload: {}, idempotencyKey: "k2", runAt, maxAttempts: 3 })
    const row = db.rows("jobs")[0]!
    expect(row["run_at"]).toBe(runAt.toISOString())
    expect(row["max_attempts"]).toBe(3)
  })

  it("dedupes on a duplicate idempotency key, returning the existing job id", async () => {
    const { db, queue } = setup()
    db.seed("jobs", { id: "job_existing", type: "generation.submit", idempotency_key: "dup", status: "pending" })
    const result = await queue.enqueue({ type: "generation.submit", payload: {}, idempotencyKey: "dup" })
    expect(result).toEqual({ ok: true, value: { jobId: "job_existing", deduped: true } })
    expect(db.rows("jobs")).toHaveLength(1)
  })

  // Inline Db where the insert reports a unique violation and the follow-up
  // lookup behaves per `lookup` — used to drive the two post-conflict branches.
  function conflictThenLookup(lookup: { data: unknown; error: { message: string } | null }): Db {
    return {
      from: () =>
        ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { message: "dup", code: "23505" } }),
            }),
          }),
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(lookup) }) }),
        }) as never,
      rpc: <T,>() => Promise.resolve({ data: null as T, error: null }),
    }
  }

  it("errors when the dedupe lookup fails", async () => {
    const queue = new PostgresJobQueue(
      conflictThenLookup({ data: null, error: { message: "lookup boom" } }),
      new FixedClock(NOW)
    )
    const result = await queue.enqueue({ type: "generation.submit", payload: {}, idempotencyKey: "dup" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("falls back to the new id when the conflicting row cannot be found", async () => {
    const queue = new PostgresJobQueue(
      conflictThenLookup({ data: null, error: null }),
      new FixedClock(NOW)
    )
    const result = await queue.enqueue({ type: "generation.submit", payload: {}, idempotencyKey: "dup" })
    expect(result.ok && result.value.deduped).toBe(true)
    if (result.ok) expect(result.value.jobId.startsWith("job_")).toBe(true)
  })

  it("maps a non-conflict insert error", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "insert boom" })
    const result = await queue.enqueue({ type: "generation.submit", payload: {}, idempotencyKey: "k" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("claimNext", () => {
  it("maps a claimed row into a ClaimedJob", async () => {
    const { db, queue } = setup()
    db.onRpc("claim_next_job", () => ({
      data: [{ id: "job_1", type: "generation.submit", payload: { x: 1 }, attempts: 2 }],
      error: null,
    }))
    const result = await queue.claimNext("w1", ["generation.submit"])
    expect(result).toEqual({
      ok: true,
      value: { jobId: "job_1", type: "generation.submit", payload: { x: 1 }, attempts: 2 },
    })
  })

  it("returns null when no job is available (empty array)", async () => {
    const { db, queue } = setup()
    db.onRpc("claim_next_job", () => ({ data: [], error: null }))
    expect(await queue.claimNext("w1", ["generation.submit"])).toEqual({ ok: true, value: null })
  })

  it("returns null when the rpc yields null data", async () => {
    const { db, queue } = setup()
    db.onRpc("claim_next_job", () => ({ data: null, error: null }))
    expect(await queue.claimNext("w1", ["generation.submit"])).toEqual({ ok: true, value: null })
  })

  it("maps rpc errors", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "rpc down" })
    const result = await queue.claimNext("w1", ["generation.submit"])
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("complete", () => {
  it("marks a job done", async () => {
    const { db, queue } = setup()
    db.seed("jobs", { id: "job_1", status: "running" })
    expect(await queue.complete("job_1")).toEqual({ ok: true, value: undefined })
    expect(db.rows("jobs")[0]!["status"]).toBe("done")
  })

  it("maps errors", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "boom" })
    const result = await queue.complete("job_1")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("fail", () => {
  function seedJob(db: ReturnType<typeof setup>["db"], over: Record<string, unknown> = {}) {
    db.seed("jobs", {
      id: "job_1",
      status: "running",
      attempts: 0,
      max_attempts: 5,
      run_at: NOW.toISOString(),
      locked_by: "w1",
      locked_at: NOW.toISOString(),
      ...over,
    })
  }

  it("reschedules a retryable failure with backoff", async () => {
    const { db, queue } = setup()
    seedJob(db, { attempts: 1 })
    const result = await queue.fail("job_1", "temporary", { retryable: true })
    expect(result.ok).toBe(true)
    const row = db.rows("jobs")[0]!
    expect(row["status"]).toBe("pending")
    expect(row["attempts"]).toBe(2)
    expect(row["last_error"]).toBe("temporary")
    expect(row["locked_by"]).toBeNull()
    // attempts=2 → 4 minute backoff
    expect(row["run_at"]).toBe("2026-07-22T10:04:00.000Z")
  })

  it("dead-letters when attempts reach the maximum", async () => {
    const { db, queue } = setup()
    seedJob(db, { attempts: 4, max_attempts: 5 })
    await queue.fail("job_1", "still failing", { retryable: true })
    expect(db.rows("jobs")[0]!["status"]).toBe("dead")
  })

  it("dead-letters immediately when not retryable", async () => {
    const { db, queue } = setup()
    seedJob(db, { attempts: 0 })
    await queue.fail("job_1", "permanent", { retryable: false })
    expect(db.rows("jobs")[0]!["status"]).toBe("dead")
  })

  it("returns not_found for a missing job", async () => {
    const { queue } = setup()
    const result = await queue.fail("nope", "x", { retryable: true })
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("maps a select error", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "select boom" })
    const result = await queue.fail("job_1", "x", { retryable: true })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("maps an update error", async () => {
    // Inline Db: select returns a job, update errors.
    const stub: Db = {
      from: () =>
        ({
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { attempts: 0, max_attempts: 5, run_at: NOW.toISOString() }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "update boom" } }) }),
        }) as never,
      rpc: <T,>() => Promise.resolve({ data: null as T, error: null }),
    }
    const queue = new PostgresJobQueue(stub, new FixedClock(NOW))
    const result = await queue.fail("job_1", "x", { retryable: true })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("heartbeat", () => {
  it("touches locked_at", async () => {
    const { db, queue } = setup()
    db.seed("jobs", { id: "job_1", status: "running", locked_at: "2026-07-22T09:00:00.000Z" })
    expect(await queue.heartbeat("job_1")).toEqual({ ok: true, value: undefined })
    expect(db.rows("jobs")[0]!["locked_at"]).toBe(NOW.toISOString())
  })

  it("maps errors", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "boom" })
    const result = await queue.heartbeat("job_1")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("reapStale", () => {
  it("returns the reaped count", async () => {
    const { db, queue } = setup()
    db.onRpc("reap_stale_jobs", () => ({ data: 3, error: null }))
    expect(await queue.reapStale(600)).toEqual({ ok: true, value: 3 })
  })

  it("treats null data as zero", async () => {
    const { db, queue } = setup()
    db.onRpc("reap_stale_jobs", () => ({ data: null, error: null }))
    expect(await queue.reapStale(600)).toEqual({ ok: true, value: 0 })
  })

  it("maps errors", async () => {
    const { db, queue } = setup()
    db.failNext({ message: "boom" })
    const result = await queue.reapStale(600)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})
