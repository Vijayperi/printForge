import { describe, expect, it } from "vitest"

import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { analyzeOverhang } from "@/src/domain/geometry/overhang"
import type { Finding } from "@/src/domain/types"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

function analyze(triangles: number[][]): Finding[] {
  return analyzeOverhang(buildIndexedMesh(rawFromTriangles(triangles)))
}

describe("analyzeOverhang", () => {
  it("reports nothing for an empty mesh", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    expect(analyzeOverhang(mesh)).toEqual([])
  })

  it("does not flag a flat-bottomed cube (its underside rests on the plate)", () => {
    expect(analyze(box([10, 10, 10]))).toEqual([])
  })

  it("flags a large downward-facing face elevated above the base", () => {
    const base = [0, 0, 0, 10, 0, 0, 0, 10, 0] // on the plate (z = min) → excluded
    const ceiling = [0, 0, 5, 0, 10, 5, 10, 0, 5] // downward normal, above the base
    const findings = analyze([base, ceiling])
    expect(findings).toHaveLength(1)
    const finding = findings[0] as Finding
    expect(finding.kind).toBe("unsupported_overhang")
    expect(finding.severity).toBe("warning")
    expect(finding.count).toBe(50) // 100 of 200 double-area units
  })

  it("does not flag a near-vertical downward face below the angle threshold", () => {
    const base = [0, 0, 0, 10, 0, 0, 0, 10, 0]
    // Almost-vertical overhanging wall (normal (10,0,-1) → only ~5.7° past
    // vertical, below the 55° threshold), elevated above the base.
    const wall = [2, 0, 2, 2, 10, 2, 2.1, 0, 3]
    expect(analyze([base, wall])).toEqual([])
  })

  it("does not flag purely upward-facing geometry above the base", () => {
    const base = [0, 0, 0, 10, 0, 0, 0, 10, 0]
    const up = [0, 0, 5, 10, 0, 5, 0, 10, 5] // normal +Z, faces up
    expect(analyze([base, up])).toEqual([])
  })
})
