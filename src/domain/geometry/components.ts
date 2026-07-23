import { type IndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import { UnionFind } from "@/src/domain/geometry/unionFind"
import type { Finding } from "@/src/domain/types"

/**
 * Connected-component analysis (plan §6-S9 step 2, components + S10 component
 * volumes). Vertices sharing a triangle are unioned; the number of disjoint
 * sets over all welded vertices is the component count. More than one component
 * → `multiple_components`.
 *
 * Also returns the smallest component's share of total volume (1 for a single
 * body), which the S10 verdict uses to escalate a tiny stray shard to
 * manual_review. Severity is `info` at S9 (non-blocking); S10's verdict keys off
 * kind + the volume fraction, not severity.
 */
export function analyzeComponents(mesh: IndexedMesh): {
  componentCount: number
  smallestVolumeFraction: number
  findings: Finding[]
} {
  const uf = new UnionFind(mesh.vertexCount)
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const i0 = mesh.indices[t * 3] as number
    const i1 = mesh.indices[t * 3 + 1] as number
    const i2 = mesh.indices[t * 3 + 2] as number
    uf.union(i0, i1)
    uf.union(i1, i2)
  }

  const roots = new Set<number>()
  for (let i = 0; i < mesh.vertexCount; i += 1) roots.add(uf.find(i))
  const componentCount = roots.size

  const findings: Finding[] =
    componentCount > 1
      ? [
          {
            kind: "multiple_components",
            severity: "info",
            detail: `mesh has ${componentCount} disconnected components`,
            count: componentCount,
          },
        ]
      : []

  return { componentCount, smallestVolumeFraction: smallestFraction(mesh, uf), findings }
}

/** Smallest connected component's share of total volume (1 when ≤1 component). */
function smallestFraction(mesh: IndexedMesh, uf: UnionFind): number {
  if (mesh.triangleCount === 0) return 1
  const signed6 = new Map<number, number>() // root → 6·signed volume
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const root = uf.find(mesh.indices[t * 3] as number)
    const a = vertex(mesh, mesh.indices[t * 3] as number)
    const b = vertex(mesh, mesh.indices[t * 3 + 1] as number)
    const c = vertex(mesh, mesh.indices[t * 3 + 2] as number)
    const tet =
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    signed6.set(root, (signed6.get(root) ?? 0) + tet)
  }

  let total = 0
  let smallest = Infinity
  for (const v of signed6.values()) {
    const volume = Math.abs(v) / 6
    total += volume
    if (volume < smallest) smallest = volume
  }
  // Flat / zero-volume mesh: no meaningful fraction, treat as a single body.
  return total === 0 ? 1 : smallest / total
}
