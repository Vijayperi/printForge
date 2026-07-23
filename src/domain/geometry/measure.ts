import { type IndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import type { Finding, Measurements } from "@/src/domain/types"

const MM3_PER_CM3 = 1000
const MM2_PER_CM2 = 100

/**
 * Bounding box (mm), volume (cm³), surface area (cm²) and counts for a mesh
 * (plan §6-S9 step 2, measure). Volume is |Σ signed tetrahedra| / 6 so it is
 * orientation-independent; area is Σ‖(b−a)×(c−a)‖/2. Emits `empty_mesh` when the
 * mesh has no valid triangles. Component count is supplied by the caller (the
 * orchestrator computes connectivity once and shares it).
 */
export function measure(
  mesh: IndexedMesh,
  componentCount: number,
  smallestComponentVolumeFraction: number
): { measurements: Measurements; findings: Finding[] } {
  const bounding = boundingBox(mesh)
  let signedVolume6 = 0 // 6 × Σ signed tetrahedra (mm³)
  let doubleAreaSum = 0 // 2 × Σ triangle area (mm²)

  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const a = vertex(mesh, mesh.indices[t * 3] as number)
    const b = vertex(mesh, mesh.indices[t * 3 + 1] as number)
    const c = vertex(mesh, mesh.indices[t * 3 + 2] as number)
    signedVolume6 += a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    doubleAreaSum += crossMagnitude(a, b, c)
  }

  const measurements: Measurements = {
    boundingMm: bounding,
    volumeCm3: Math.abs(signedVolume6) / 6 / MM3_PER_CM3,
    surfaceAreaCm2: doubleAreaSum / 2 / MM2_PER_CM2,
    triangleCount: mesh.triangleCount,
    componentCount,
    smallestComponentVolumeFraction,
  }

  const findings: Finding[] =
    mesh.triangleCount === 0
      ? [{ kind: "empty_mesh", severity: "blocking", detail: "mesh contains no valid triangles" }]
      : []

  return { measurements, findings }
}

function boundingBox(mesh: IndexedMesh): { x: number; y: number; z: number } {
  if (mesh.vertexCount === 0) return { x: 0, y: 0, z: 0 }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.vertexCount; i += 1) {
    const v = vertex(mesh, i)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = v[axis] as number
      if (value < (min[axis] as number)) min[axis] = value
      if (value > (max[axis] as number)) max[axis] = value
    }
  }
  return {
    x: (max[0] as number) - (min[0] as number),
    y: (max[1] as number) - (min[1] as number),
    z: (max[2] as number) - (min[2] as number),
  }
}

function crossMagnitude(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[]
): number {
  const e1x = (b[0] as number) - (a[0] as number)
  const e1y = (b[1] as number) - (a[1] as number)
  const e1z = (b[2] as number) - (a[2] as number)
  const e2x = (c[0] as number) - (a[0] as number)
  const e2y = (c[1] as number) - (a[1] as number)
  const e2z = (c[2] as number) - (a[2] as number)
  const nx = e1y * e2z - e1z * e2y
  const ny = e1z * e2x - e1x * e2z
  const nz = e1x * e2y - e1y * e2x
  return Math.sqrt(nx * nx + ny * ny + nz * nz)
}
