import type { IndexedMesh } from "@/src/domain/geometry/mesh"
import { UnionFind } from "@/src/domain/geometry/unionFind"
import type { Finding } from "@/src/domain/types"

/**
 * Connected-component analysis (plan §6-S9 step 2, components). Vertices sharing
 * a triangle are unioned; the number of disjoint sets over all welded vertices
 * is the component count. More than one component → `multiple_components`.
 *
 * Severity is `info` at S9 (non-blocking): S10 promotes to manual_review when a
 * component is small (< 5% volume) and warning otherwise. `count` carries the
 * component count.
 */
export function analyzeComponents(mesh: IndexedMesh): {
  componentCount: number
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

  return { componentCount, findings }
}
