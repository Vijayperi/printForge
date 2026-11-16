import { describe, expect, it } from "vitest"

import { EPS } from "@/src/domain/geometry/eps"
import { buildIndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import { box, rawFromTriangles } from "@/tests/helpers/geometry"

describe("buildIndexedMesh — welding", () => {
  it("welds a closed box to 8 unique vertices and 12 triangles", () => {
    const mesh = buildIndexedMesh(rawFromTriangles(box([10, 10, 10])))
    expect(mesh.vertexCount).toBe(8)
    expect(mesh.triangleCount).toBe(12)
    expect(mesh.indices).toHaveLength(36)
    expect(mesh.degenerateCount).toBe(0)
  })

  it("merges vertices coincident within the weld tolerance", () => {
    const tris = [
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      // shares the (0,0,0) corner, nudged below half a grid cell
      [EPS.weld / 4, 0, 0, 0, 0, 1, 1, 0, 0],
    ]
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    // (0,0,0) and the nudged copy collapse; (1,0,0) is shared exactly.
    expect(mesh.vertexCount).toBe(4)
  })

  it("keeps vertices further apart than half a grid cell distinct", () => {
    const tris = [
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      [EPS.weld, 0, 0, 0, 0, 1, 1, 0, 0],
    ]
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    expect(mesh.vertexCount).toBe(5)
  })
})

describe("buildIndexedMesh — degenerate filtering", () => {
  it("drops and counts a zero-area (collapsed) triangle", () => {
    const tris = [[0, 0, 0, 1, 0, 0, 1, 0, 0]] // all colinear → zero area
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    expect(mesh.triangleCount).toBe(0)
    expect(mesh.degenerateCount).toBe(1)
  })

  it("drops and counts a sub-tolerance sliver", () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0.5, EPS.area, 0]]
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    expect(mesh.degenerateCount).toBe(1)
    expect(mesh.triangleCount).toBe(0)
  })

  it("treats a NaN vertex as degenerate rather than throwing", () => {
    const tris = [[0, 0, 0, 1, 0, 0, NaN, 1, 0]]
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    expect(mesh.degenerateCount).toBe(1)
    expect(mesh.triangleCount).toBe(0)
  })

  it("keeps a valid triangle whose area is just above tolerance", () => {
    const tris = [[0, 0, 0, 1, 0, 0, 0, 1, 0]] // area 0.5
    const mesh = buildIndexedMesh(rawFromTriangles(tris))
    expect(mesh.triangleCount).toBe(1)
    expect(mesh.degenerateCount).toBe(0)
  })
})

describe("vertex", () => {
  it("reads a welded vertex position by index", () => {
    const mesh = buildIndexedMesh(rawFromTriangles([[2, 3, 4, 5, 6, 7, 8, 9, 1]]))
    expect(vertex(mesh, 0)).toEqual([2, 3, 4])
    expect(vertex(mesh, 1)).toEqual([5, 6, 7])
  })
})

describe("buildIndexedMesh — empty", () => {
  it("produces an empty mesh from zero triangles", () => {
    const mesh = buildIndexedMesh({ positions: new Float32Array(0), triangleCount: 0 })
    expect(mesh.vertexCount).toBe(0)
    expect(mesh.triangleCount).toBe(0)
    expect(mesh.degenerateCount).toBe(0)
  })
})
