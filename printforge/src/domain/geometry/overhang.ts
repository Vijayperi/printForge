import { type IndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import type { Finding } from "@/src/domain/types"

/**
 * Overhang analysis (plan §6-S10: unsupported_overhang heuristic). This is a
 * print-orientation heuristic, not a mesh-validity check, so it lives outside
 * the S9 `analyzeGeometry` engine and is merged in at the printability stage.
 *
 * Assumes the model prints as-oriented with +Z up. A downward-facing triangle
 * (outward normal with a negative Z component) tilted more than
 * {@link OVERHANG_ANGLE_DEG} from vertical needs support — unless it rests on the
 * base plane (the first layer sits on the plate). When such faces exceed
 * {@link OVERHANG_AREA_SHARE} of the surface, we warn.
 */
export const OVERHANG_ANGLE_DEG = 55
export const OVERHANG_AREA_SHARE = 0.15
const BASE_EPS_MM = 1e-3

const OVERHANG_SIN = Math.sin((OVERHANG_ANGLE_DEG * Math.PI) / 180)

export function analyzeOverhang(mesh: IndexedMesh): Finding[] {
  if (mesh.triangleCount === 0) return []
  const minZ = minVertexZ(mesh)

  let overhangArea = 0
  let totalArea = 0
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const a = vertex(mesh, mesh.indices[t * 3] as number)
    const b = vertex(mesh, mesh.indices[t * 3 + 1] as number)
    const c = vertex(mesh, mesh.indices[t * 3 + 2] as number)
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const doubleArea = Math.sqrt(nx * nx + ny * ny + nz * nz)
    totalArea += doubleArea

    // Faces resting flat on the plate carry the first layer — not overhangs.
    const onBase = Math.max(a[2], b[2], c[2]) <= minZ + BASE_EPS_MM
    // Downward-facing and steeper than the threshold from vertical.
    if (!onBase && nz < 0 && -nz / doubleArea > OVERHANG_SIN) overhangArea += doubleArea
  }

  // triangleCount > 0 and every indexed triangle is non-degenerate, so
  // totalArea is always positive here.
  if (overhangArea / totalArea <= OVERHANG_AREA_SHARE) return []
  const share = Math.round((overhangArea / totalArea) * 100)
  return [
    {
      kind: "unsupported_overhang",
      severity: "warning",
      detail: `${share}% of the surface is steep overhang (needs supports)`,
      count: share,
    },
  ]
}

function minVertexZ(mesh: IndexedMesh): number {
  let minZ = Infinity
  for (let i = 0; i < mesh.vertexCount; i += 1) {
    const z = mesh.positions[i * 3 + 2] as number
    if (z < minZ) minZ = z
  }
  return minZ
}
