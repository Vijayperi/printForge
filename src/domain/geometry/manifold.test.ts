import { describe, expect, it } from "vitest"

import { analyzeManifold } from "@/src/domain/geometry/manifold"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import type { Finding, FindingKind } from "@/src/domain/types"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

function findingsFor(triangles: number[][]): Finding[] {
  return analyzeManifold(buildIndexedMesh(rawFromTriangles(triangles)))
}

function kinds(findings: Finding[]): FindingKind[] {
  return findings.map((f) => f.kind)
}

describe("analyzeManifold — closed mesh", () => {
  it("reports nothing for a closed cube (every edge shared by two faces)", () => {
    expect(findingsFor(box([10, 10, 10]))).toEqual([])
  })
})

describe("analyzeManifold — boundary holes", () => {
  it("flags an open face as one boundary loop of four edges", () => {
    const openTop = box([10, 10, 10]).filter((_, i) => i !== 2 && i !== 3)
    const findings = findingsFor(openTop)
    expect(kinds(findings)).toEqual(["boundary_holes"])
    const hole = findings[0] as Finding
    expect(hole.count).toBe(4)
    expect(hole.severity).toBe("warning")
    expect(hole.detail).toContain("1 boundary loop")
  })

  it("flags a single open triangle as three boundary edges in one loop", () => {
    const findings = findingsFor([[0, 0, 0, 1, 0, 0, 0, 1, 0]])
    expect(kinds(findings)).toEqual(["boundary_holes"])
    expect((findings[0] as Finding).count).toBe(3)
  })
})

describe("analyzeManifold — non-manifold edges", () => {
  it("flags an edge shared by three triangles", () => {
    const fan = [
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 0, 1],
      [0, 0, 0, 1, 0, 0, 0, -1, 0],
    ]
    const findings = findingsFor(fan)
    expect(kinds(findings)).toContain("non_manifold_edges")
    const nm = findings.find((f) => f.kind === "non_manifold_edges") as Finding
    expect(nm.count).toBe(1)
    expect(nm.severity).toBe("warning")
    // The fan's free edges are also open boundaries.
    const bh = findings.find((f) => f.kind === "boundary_holes") as Finding
    expect(bh.count).toBe(6)
  })
})

describe("analyzeManifold — empty mesh", () => {
  it("reports nothing when there are no triangles", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    expect(analyzeManifold(mesh)).toEqual([])
  })
})
