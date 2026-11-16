import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three"
import { describe, expect, it } from "vitest"

import { boundsFromBox3, computeSceneStats } from "@/src/viewer/canvas/sceneStats"

describe("computeSceneStats", () => {
  it("counts triangles of an indexed box and bounds it", () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial())
    const group = new Group()
    group.add(mesh)
    const { box, triangleCount } = computeSceneStats(group)
    expect(triangleCount).toBe(12) // a box is 12 triangles
    expect(box.isEmpty()).toBe(false)
    expect(box.max.x).toBeCloseTo(1)
  })

  it("counts triangles of a non-indexed geometry from its positions", () => {
    const geometry = new BufferGeometry()
    // 3 vertices → 1 triangle.
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    const mesh = new Mesh(geometry, new MeshStandardMaterial())
    expect(computeSceneStats(mesh).triangleCount).toBe(1)
  })

  it("returns zero triangles for an empty group", () => {
    expect(computeSceneStats(new Group()).triangleCount).toBe(0)
  })

  it("ignores a mesh whose geometry has neither index nor positions", () => {
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial())
    expect(computeSceneStats(mesh).triangleCount).toBe(0)
  })
})

describe("boundsFromBox3", () => {
  it("maps a non-empty box to bounds", () => {
    const box = new Box3().setFromCenterAndSize({ x: 0, y: 0, z: 0 } as never, { x: 2, y: 4, z: 6 } as never)
    const bounds = boundsFromBox3(box)
    expect(bounds.min).toEqual({ x: -1, y: -2, z: -3 })
    expect(bounds.max).toEqual({ x: 1, y: 2, z: 3 })
  })

  it("collapses an empty box to the origin", () => {
    expect(boundsFromBox3(new Box3())).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    })
  })
})
