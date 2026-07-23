import { describe, expect, it } from "vitest"

import { analyzeGeometry } from "@/src/domain/geometry/analyze"
import { parseStl } from "@/src/domain/geometry/stlParse"
import type { FindingKind } from "@/src/domain/types"
import {
  cubeWithHole,
  cubeWithSliver,
  flippedNormalsCube,
  selfIntersectingPair,
  twoCubes,
  unitCube,
  uvSphere,
  uvTorus,
} from "@/tests/fixtures/models/generators"
import { binaryStl, rawFromTriangles } from "@/tests/helpers/geometry"

function kindsOf(triangles: number[][]): FindingKind[] {
  return analyzeGeometry(rawFromTriangles(triangles)).findings.map((f) => f.kind)
}

describe("fixture: unit cube (via binary STL parse → analyze)", () => {
  it("parses clean and reports 1 cm³, 6 cm², no findings", () => {
    const parsed = parseStl(binaryStl(unitCube()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const { measurements, findings } = analyzeGeometry(parsed.value)
    expect(findings).toEqual([])
    expect(measurements.boundingMm).toEqual({ x: 10, y: 10, z: 10 })
    expect(measurements.volumeCm3).toBeCloseTo(1, 6)
    expect(measurements.surfaceAreaCm2).toBeCloseTo(6, 6)
    expect(measurements.triangleCount).toBe(12)
    expect(measurements.componentCount).toBe(1)
  })
})

describe("fixture: two cubes", () => {
  it("reports two components", () => {
    const { measurements, findings } = analyzeGeometry(rawFromTriangles(twoCubes()))
    expect(findings.map((f) => f.kind)).toEqual(["multiple_components"])
    expect(measurements.componentCount).toBe(2)
    expect(measurements.volumeCm3).toBeCloseTo(2, 6)
  })
})

describe("fixture: cube with a hole", () => {
  it("reports one boundary loop of four open edges", () => {
    const { findings } = analyzeGeometry(rawFromTriangles(cubeWithHole()))
    expect(findings.map((f) => f.kind)).toEqual(["boundary_holes"])
    expect(findings[0]?.count).toBe(4)
  })
})

describe("fixture: flipped-normals cube", () => {
  it("reports inconsistent winding", () => {
    expect(kindsOf(flippedNormalsCube())).toContain("inverted_normals")
  })
})

describe("fixture: self-intersecting pair", () => {
  it("reports a self-intersection", () => {
    expect(kindsOf(selfIntersectingPair())).toContain("self_intersections")
  })
})

describe("fixture: cube with a degenerate sliver", () => {
  it("reports degenerate_geometry and excludes the sliver from the count", () => {
    const { measurements, findings } = analyzeGeometry(rawFromTriangles(cubeWithSliver()))
    expect(findings.map((f) => f.kind)).toEqual(["degenerate_geometry"])
    expect(measurements.triangleCount).toBe(12)
  })
})

describe("fixture: empty file", () => {
  it("reports empty_mesh", () => {
    const { findings } = analyzeGeometry({ positions: new Float32Array(0), triangleCount: 0 })
    expect(findings.map((f) => f.kind)).toEqual(["empty_mesh"])
  })
})

describe("fixture: UV sphere (r = 10 mm)", () => {
  it("is a clean closed solid approximating (4/3)πr³", () => {
    const { measurements, findings } = analyzeGeometry(rawFromTriangles(uvSphere()))
    expect(findings).toEqual([])
    expect(measurements.boundingMm.x).toBeCloseTo(20, 4)
    expect(measurements.boundingMm.z).toBeCloseTo(20, 4)
    // Ideal 4.18879 cm³; the inscribed tessellation is slightly under.
    expect(measurements.volumeCm3).toBeGreaterThan(4.0)
    expect(measurements.volumeCm3).toBeLessThan(4.19)
  })
})

describe("fixture: 100k-triangle torus (perf)", () => {
  it("analyzes a clean ~100k-triangle mesh under the perf bound", () => {
    const torus = uvTorus()
    const raw = rawFromTriangles(torus)
    expect(raw.triangleCount).toBeGreaterThanOrEqual(100_000)

    const start = performance.now()
    const { findings, measurements } = analyzeGeometry(raw)
    const elapsedMs = performance.now() - start

    expect(findings).toEqual([])
    expect(measurements.triangleCount).toBe(raw.triangleCount)
    // Budget 5 s with a generous ×3 CI margin (plan §6-S9).
    expect(elapsedMs).toBeLessThan(15_000)
  })
})
