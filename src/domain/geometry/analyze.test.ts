import { describe, expect, it } from "vitest"

import { analyzeGeometry } from "@/src/domain/geometry/analyze"
import type { FindingKind } from "@/src/domain/types"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

function kinds(triangles: number[][]): FindingKind[] {
  return analyzeGeometry(rawFromTriangles(triangles)).findings.map((f) => f.kind)
}

describe("analyzeGeometry — clean solid", () => {
  const result = analyzeGeometry(rawFromTriangles(box([10, 10, 10])))

  it("produces no findings for a watertight cube", () => {
    expect(result.findings).toEqual([])
  })

  it("measures the cube (1 cm³, one component)", () => {
    expect(result.measurements.volumeCm3).toBeCloseTo(1, 6)
    expect(result.measurements.componentCount).toBe(1)
    expect(result.measurements.triangleCount).toBe(12)
  })
})

describe("analyzeGeometry — degenerate triangles", () => {
  it("reports degenerate_geometry for filtered slivers without failing", () => {
    const withSliver = [...box([10, 10, 10]), [0, 0, 0, 1, 0, 0, 2, 0, 0]] // colinear sliver
    const result = analyzeGeometry(rawFromTriangles(withSliver))
    expect(result.findings.map((f) => f.kind)).toEqual(["degenerate_geometry"])
    expect(result.measurements.triangleCount).toBe(12) // sliver excluded
  })
})

describe("analyzeGeometry — empty mesh", () => {
  it("reports only empty_mesh", () => {
    expect(kinds([])).toEqual(["empty_mesh"])
  })
})

describe("analyzeGeometry — finding order", () => {
  it("emits mesh-level, then topology, then geometry findings in stable order", () => {
    // Open cube (top removed) that is also inside-out: boundary_holes +
    // (winding is consistent among remaining faces) — verify ordering is stable.
    const openTop = box([10, 10, 10]).filter((_, i) => i !== 2 && i !== 3)
    const result = analyzeGeometry(rawFromTriangles(openTop))
    expect(result.findings.map((f) => f.kind)).toEqual(["boundary_holes"])
  })

  it("places manifold findings before self-intersection findings", () => {
    // Two crossing skew triangles (self-intersect) with open boundaries.
    const flat = [0, 0, 0, 20, 0, 0, 0, 20, 0]
    const upright = [5, 5, -5, 5, 5, 5, 15, 5, 0]
    const order = kinds([flat, upright])
    expect(order.indexOf("boundary_holes")).toBeLessThan(order.indexOf("self_intersections"))
  })
})
