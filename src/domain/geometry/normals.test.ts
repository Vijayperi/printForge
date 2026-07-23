import { describe, expect, it } from "vitest"

import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { analyzeNormals } from "@/src/domain/geometry/normals"
import type { Finding } from "@/src/domain/types"
import { box, flip, rawFromTriangles } from "@/tests/helpers/geometry"

function analyze(triangles: number[][]): Finding[] {
  return analyzeNormals(buildIndexedMesh(rawFromTriangles(triangles)))
}

describe("analyzeNormals — consistent outward mesh", () => {
  it("reports nothing for a correctly wound cube", () => {
    expect(analyze(box([10, 10, 10]))).toEqual([])
  })
})

describe("analyzeNormals — inconsistent winding", () => {
  it("flags a cube with a single face flipped", () => {
    const tris = box([10, 10, 10])
    tris[2] = flip(tris[2] as number[]) // top face, triangle 1
    tris[3] = flip(tris[3] as number[]) // top face, triangle 2
    const findings = analyze(tris)
    expect(findings).toHaveLength(1)
    const finding = findings[0] as Finding
    expect(finding.kind).toBe("inverted_normals")
    expect(finding.count).toBe(4) // top face shares 4 edges with the sides
    expect(finding.detail).toContain("inconsistent winding")
  })
})

describe("analyzeNormals — global inversion (flip-all proposal)", () => {
  it("flags a fully inward-wound closed cube and proposes a flip", () => {
    const inward = box([10, 10, 10]).map(flip)
    const findings = analyze(inward)
    expect(findings).toHaveLength(1)
    const finding = findings[0] as Finding
    expect(finding.kind).toBe("inverted_normals")
    expect(finding.count).toBe(12)
    expect(finding.detail).toContain("flip-all")
  })

  it("does not propose a flip for an open (non-closed) mesh", () => {
    // A single inward triangle far from origin has negative signed volume but
    // is not closed, so no flip-all is proposed.
    expect(analyze([flip([0, 0, 0, 10, 0, 0, 0, 10, 0])])).toEqual([])
  })
})

describe("analyzeNormals — empty mesh", () => {
  it("reports nothing", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    expect(analyzeNormals(mesh)).toEqual([])
  })
})
