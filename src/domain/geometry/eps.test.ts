import { describe, expect, it } from "vitest"

import { EPS, quantize } from "@/src/domain/geometry/eps"

describe("EPS", () => {
  it("exposes the documented tolerances", () => {
    expect(EPS.weld).toBe(1e-6)
    expect(EPS.area).toBe(1e-12)
    expect(EPS.volume).toBe(1e-9)
    expect(EPS.gap).toBe(1e-6)
    expect(EPS.axis).toBe(1e-12)
  })
})

describe("quantize", () => {
  it("snaps to the nearest weld grid cell", () => {
    expect(quantize(0)).toBe(0)
    expect(quantize(1)).toBe(1_000_000)
    expect(quantize(-1)).toBe(-1_000_000)
  })

  it("collapses coordinates within half a grid cell to the same index", () => {
    expect(quantize(1)).toBe(quantize(1 + EPS.weld / 4))
    expect(quantize(1)).toBe(quantize(1 - EPS.weld / 4))
  })

  it("separates coordinates more than half a grid cell apart", () => {
    expect(quantize(1)).not.toBe(quantize(1 + EPS.weld))
  })
})
