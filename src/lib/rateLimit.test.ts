import { describe, expect, it } from "vitest"

import { checkRateLimit } from "@/src/lib/rateLimit"
import { FixedClock } from "@/src/lib/clock"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const clock = new FixedClock(new Date("2026-07-22T10:00:00.000Z"))
const input = { key: "generation:u1", windowSeconds: 3600, limit: 5 }

describe("checkRateLimit", () => {
  it("reports an allowed action", async () => {
    const db = createFakeDb()
    db.onRpc("bump_rate_limit", () => ({ data: [{ allowed: true, retry_after: 0 }], error: null }))
    expect(await checkRateLimit(db, clock, input)).toEqual({
      ok: true,
      value: { allowed: true, retryAfterSeconds: 0 },
    })
  })

  it("reports a denied action with a retry-after", async () => {
    const db = createFakeDb()
    db.onRpc("bump_rate_limit", () => ({ data: [{ allowed: false, retry_after: 1800 }], error: null }))
    const result = await checkRateLimit(db, clock, input)
    expect(result.ok && result.value).toEqual({ allowed: false, retryAfterSeconds: 1800 })
  })

  it("passes the right arguments to the SQL function", async () => {
    const db = createFakeDb()
    let captured: Record<string, unknown> = {}
    db.onRpc("bump_rate_limit", (args) => {
      captured = args
      return { data: [{ allowed: true, retry_after: 0 }], error: null }
    })
    await checkRateLimit(db, clock, input)
    expect(captured).toEqual({
      p_key: "generation:u1",
      p_window_seconds: 3600,
      p_limit: 5,
      p_now: "2026-07-22T10:00:00.000Z",
    })
  })

  it("errors when the rpc fails", async () => {
    const db = createFakeDb()
    db.failNext({ message: "rpc down" })
    const result = await checkRateLimit(db, clock, input)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("errors when the rpc returns no row", async () => {
    const db = createFakeDb()
    db.onRpc("bump_rate_limit", () => ({ data: null, error: null }))
    const result = await checkRateLimit(db, clock, input)
    expect(!result.ok && result.error.code).toBe("internal")
  })
})
