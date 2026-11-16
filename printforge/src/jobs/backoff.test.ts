import { describe, expect, it } from "vitest"

import { nextRunAt, shouldDeadLetter } from "@/src/jobs/backoff"

const NOW = new Date("2026-07-22T10:00:00.000Z")

describe("nextRunAt", () => {
  it("doubles the delay per attempt", () => {
    expect(nextRunAt(0, NOW).toISOString()).toBe("2026-07-22T10:01:00.000Z") // 1 min
    expect(nextRunAt(1, NOW).toISOString()).toBe("2026-07-22T10:02:00.000Z") // 2 min
    expect(nextRunAt(2, NOW).toISOString()).toBe("2026-07-22T10:04:00.000Z") // 4 min
    expect(nextRunAt(3, NOW).toISOString()).toBe("2026-07-22T10:08:00.000Z") // 8 min
  })

  it("caps the delay at 60 minutes", () => {
    // 2^6 = 64 > 60, so anything from attempt 6 up is capped.
    expect(nextRunAt(6, NOW).toISOString()).toBe("2026-07-22T11:00:00.000Z")
    expect(nextRunAt(20, NOW).toISOString()).toBe("2026-07-22T11:00:00.000Z")
  })
})

describe("shouldDeadLetter", () => {
  it("is false while attempts remain", () => {
    expect(shouldDeadLetter(0, 5)).toBe(false)
    expect(shouldDeadLetter(4, 5)).toBe(false)
  })

  it("is true once attempts reach the maximum", () => {
    expect(shouldDeadLetter(5, 5)).toBe(true)
    expect(shouldDeadLetter(6, 5)).toBe(true)
  })
})
