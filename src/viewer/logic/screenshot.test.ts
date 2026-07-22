import { describe, expect, it } from "vitest"

import { FixedClock } from "@/src/lib/clock"
import { screenshotFileName, slugify } from "@/src/viewer/logic/screenshot"

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Desk Tidy")).toBe("desk-tidy")
    expect(slugify("  A B  ")).toBe("a-b")
    expect(slugify("Café #1!")).toBe("caf-1")
  })

  it("falls back to 'model' for empty input", () => {
    expect(slugify("")).toBe("model")
    expect(slugify("!!!")).toBe("model")
  })
})

describe("screenshotFileName", () => {
  it("builds a deterministic, file-safe name", () => {
    const clock = new FixedClock(new Date("2026-07-22T10:00:00.000Z"))
    expect(screenshotFileName("Desk Tidy", clock)).toBe("printforge-desk-tidy-20260722T100000Z.png")
  })
})
