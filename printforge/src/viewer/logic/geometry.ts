import type { Bounds, Vec3 } from "@/src/viewer/logic/types"

export function boundsCenter(bounds: Bounds): Vec3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  }
}

export function boundsSize(bounds: Bounds): Vec3 {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  }
}

/**
 * Camera position and target that frame the model's bounding sphere for the
 * given vertical field of view (degrees). The camera looks along +Z/+Y toward
 * the model center from a distance that fits the whole sphere with margin.
 */
export function fitCameraToBounds(
  bounds: Bounds,
  fovDeg: number,
  margin = 1.2
): { position: Vec3; target: Vec3 } {
  const center = boundsCenter(bounds)
  const size = boundsSize(bounds)
  const radius = Math.max(Math.hypot(size.x, size.y, size.z) / 2, 1e-6)
  const fovRad = (fovDeg * Math.PI) / 180
  const distance = (radius / Math.sin(fovRad / 2)) * margin
  // Offset along a diagonal so the model reads as three-dimensional.
  const dir = 1 / Math.sqrt(3)
  return {
    target: center,
    position: {
      x: center.x + distance * dir,
      y: center.y + distance * dir,
      z: center.z + distance * dir,
    },
  }
}

/** Physical dimensions in millimetres (bounds are model units × scaleFactor). */
export function computeDimensionsMm(bounds: Bounds, scaleFactor: number): Vec3 {
  const size = boundsSize(bounds)
  return {
    x: size.x * scaleFactor,
    y: size.y * scaleFactor,
    z: size.z * scaleFactor,
  }
}
