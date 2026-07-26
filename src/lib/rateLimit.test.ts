import { describe, expect, it } from "vitest"

import { checkRateLimit, enforceRateLimit, rateLimitKey, RATE_LIMITS } from "@/src/lib/rateLimit"
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

describe("rateLimitKey", () => {
  it("namespaces the subject by scope, so one user's uploads and prompts count apart", () => {
    expect(rateLimitKey("upload", "u1")).toBe("upload:u1")
    expect(rateLimitKey("generation", "u1")).not.toBe(rateLimitKey("upload", "u1"))
  })
})

describe("enforceRateLimit", () => {
  it.each(["auth", "authNetwork", "generation", "upload"] as const)(
    "applies the configured window and limit for %s",
    async (scope) => {
      const db = createFakeDb()
      let captured: Record<string, unknown> = {}
      db.onRpc("bump_rate_limit", (args) => {
        captured = args
        return { data: [{ allowed: true, retry_after: 0 }], error: null }
      })

      await enforceRateLimit(db, clock, scope, "subject")
      expect(captured["p_key"]).toBe(`${scope}:subject`)
      expect(captured["p_limit"]).toBe(RATE_LIMITS[scope].limit)
      expect(captured["p_window_seconds"]).toBe(RATE_LIMITS[scope].windowSeconds)
    }
  )

  it("passes a refusal back to the caller with its retry-after", async () => {
    const db = createFakeDb()
    db.onRpc("bump_rate_limit", () => ({ data: [{ allowed: false, retry_after: 42 }], error: null }))
    const result = await enforceRateLimit(db, clock, "auth", "203.0.113.7")
    expect(result.ok && result.value).toEqual({ allowed: false, retryAfterSeconds: 42 })
  })

  it("propagates a limiter outage rather than allowing the action", async () => {
    const db = createFakeDb()
    db.onRpc("bump_rate_limit", () => ({ data: null, error: { message: "rl down" } }))
    expect((await enforceRateLimit(db, clock, "upload", "u1")).ok).toBe(false)
  })
})
