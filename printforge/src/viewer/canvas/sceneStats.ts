import { Box3, Mesh, type Object3D } from "three"

import type { Bounds } from "@/src/viewer/logic/types"

export interface SceneStats {
  box: Box3
  triangleCount: number
}

/** Bounding box and triangle count of every mesh under an object. Pure. */
export function computeSceneStats(object: Object3D): SceneStats {
  const box = new Box3().setFromObject(object)
  let triangleCount = 0
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry
      const index = geometry.getIndex()
      const position = geometry.getAttribute("position")
      if (index !== null) {
        triangleCount += index.count / 3
      } else if (position !== undefined) {
        triangleCount += position.count / 3
      }
    }
  })
  return { box, triangleCount: Math.round(triangleCount) }
}

/** Convert a THREE Box3 into a plain Bounds. Empty boxes collapse to the origin. */
export function boundsFromBox3(box: Box3): Bounds {
  if (box.isEmpty()) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  }
}
