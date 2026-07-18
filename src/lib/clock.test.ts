import { describe, expect, it } from "vitest"

import { FixedClock, SystemClock } from "@/src/lib/clock"

describe("SystemClock", () => {
  it("returns the current time", () => {
    const before = Date.now()
    const now = new SystemClock().now().getTime()
    const after = Date.now()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(after)
  })
})

describe("FixedClock", () => {
  it("returns the fixed time", () => {
    const at = new Date("2026-07-19T12:00:00.000Z")
    const clock = new FixedClock(at)
    expect(clock.now().toISOString()).toBe("2026-07-19T12:00:00.000Z")
  })

  it("returns a defensive copy", () => {
    const clock = new FixedClock(new Date("2026-07-19T12:00:00.000Z"))
    clock.now().setFullYear(1999)
    expect(clock.now().getUTCFullYear()).toBe(2026)
  })

  it("can be set to a new time", () => {
    const clock = new FixedClock(new Date("2026-07-19T12:00:00.000Z"))
    clock.set(new Date("2026-08-01T00:00:00.000Z"))
    expect(clock.now().toISOString()).toBe("2026-08-01T00:00:00.000Z")
  })

  it("can advance by milliseconds", () => {
    const clock = new FixedClock(new Date("2026-07-19T12:00:00.000Z"))
    clock.advance(90_000)
    expect(clock.now().toISOString()).toBe("2026-07-19T12:01:30.000Z")
  })
})
