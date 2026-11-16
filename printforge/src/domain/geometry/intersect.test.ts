import { describe, expect, it } from "vitest"

import { analyzeIntersections, SELF_INTERSECTION_CAP } from "@/src/domain/geometry/intersect"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import type { Finding } from "@/src/domain/types"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

function analyze(triangles: number[][]): Finding[] {
  return analyzeIntersections(buildIndexedMesh(rawFromTriangles(triangles)))
}

describe("analyzeIntersections — clean meshes", () => {
  it("reports nothing for an empty mesh", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    expect(analyzeIntersections(mesh)).toEqual([])
  })

  it("reports nothing for a closed cube (adjacent faces are skipped)", () => {
    expect(analyze(box([10, 10, 10]))).toEqual([])
  })

  // Elongated boxes (>8 triangles) exercise the BVH split along each axis.
  it("reports nothing for boxes elongated along X, Y and Z", () => {
    expect(analyze(box([20, 1, 1]))).toEqual([])
    expect(analyze(box([1, 20, 1]))).toEqual([])
    expect(analyze(box([1, 1, 20]))).toEqual([])
  })

  // Two well-separated cubes force the BVH query to prune whole subtrees
  // (AABB non-overlap) and skip non-overlapping candidate boxes within leaves.
  it("reports nothing for two far-apart cubes", () => {
    expect(analyze([...box([10, 10, 10]), ...box([10, 10, 10], [1000, 0, 0])])).toEqual([])
  })
})

describe("analyzeIntersections — non-intersecting candidate pairs", () => {
  it("skips a candidate pair whose AABBs do not overlap in the same leaf", () => {
    // Triangle 0 lies entirely to the right (min x) of triangle 1 (max x), so
    // their boxes are disjoint even though both share one BVH leaf.
    const right = [10, 0, 0, 20, 0, 0, 10, 10, 0]
    const left = [0, 0, 0, 5, 0, 0, 0, 5, 0]
    expect(analyze([right, left])).toEqual([])
  })

  it("does not flag coplanar triangles whose AABBs overlap but faces do not", () => {
    // A sits below the diagonal x+y=10; B sits above x+y=14. Their AABBs
    // overlap in [2,10]² but an in-plane axis separates them.
    const a = [0, 0, 0, 10, 0, 0, 0, 10, 0]
    const b = [12, 12, 0, 2, 12, 0, 12, 2, 0]
    expect(analyze([a, b])).toEqual([])
  })
})

describe("analyzeIntersections — self-intersections", () => {
  it("flags two skew triangles that cross through each other", () => {
    const flat = [0, 0, 0, 10, 0, 0, 0, 10, 0] // z = 0 plane
    const upright = [2, 2, -5, 2, 2, 5, 8, 2, 0] // y = 2 plane, pierces the flat one
    const findings = analyze([flat, upright])
    expect(findings).toHaveLength(1)
    const finding = findings[0] as Finding
    expect(finding.kind).toBe("self_intersections")
    expect(finding.severity).toBe("blocking")
    expect(finding.count).toBe(1)
    expect(finding.detail).toContain("1 self-intersecting")
  })

  it("caps the count and flags the early exit past the limit", () => {
    // 15 heavily-overlapping coplanar triangles → 105 intersecting pairs.
    const tris: number[][] = []
    for (let i = 0; i < 15; i += 1) {
      const e = i * 0.02
      tris.push([e, e, 0, 10 + e, e, 0, e, 10 + e, 0])
    }
    const findings = analyze(tris)
    const finding = findings[0] as Finding
    expect(finding.count).toBe(SELF_INTERSECTION_CAP)
    expect(finding.detail).toContain("capped")
  })
})
