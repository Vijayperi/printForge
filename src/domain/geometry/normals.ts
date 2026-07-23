import { buildEdgeMap } from "@/src/domain/geometry/edges"
import { EPS } from "@/src/domain/geometry/eps"
import { type IndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import type { Finding } from "@/src/domain/types"

/**
 * Winding / normal-orientation analysis (plan §6-S9 step 2, normals).
 *
 * Two triangles sharing a manifold edge are consistently wound when they
 * traverse that edge in *opposite* directions. An edge traversed in the *same*
 * direction by both incident triangles marks a relative flip — equivalent to
 * the conflict an orientation-propagation BFS would surface. Any such edge →
 * `inverted_normals` (inconsistent winding).
 *
 * When winding is globally consistent but the mesh is inside-out (signed volume
 * < 0), we emit `inverted_normals` as a *flip-all proposal*. Per FR-5 nothing is
 * ever silently repaired — the finding proposes the flip; it is never applied.
 */
export function analyzeNormals(mesh: IndexedMesh): Finding[] {
  if (mesh.triangleCount === 0) return []

  const edges = buildEdgeMap(mesh)
  let inconsistentEdges = 0
  let closed = true
  for (const uses of edges.values()) {
    if (uses.length !== 2) {
      closed = false // boundary / non-manifold handled elsewhere
      continue
    }
    const a = uses[0] as { from: number }
    const b = uses[1] as { from: number }
    if (a.from === b.from) inconsistentEdges += 1 // same traversal direction
  }

  if (inconsistentEdges > 0) {
    return [
      {
        kind: "inverted_normals",
        severity: "warning",
        detail: `${inconsistentEdges} shared edge(s) with inconsistent winding`,
        count: inconsistentEdges,
      },
    ]
  }

  // The inside-out (flip-all) proposal only makes sense for a closed surface.
  if (closed && signedVolume6(mesh) < -EPS.volume) {
    return [
      {
        kind: "inverted_normals",
        severity: "warning",
        detail: "all normals point inward; flip-all recommended (not applied automatically)",
        count: mesh.triangleCount,
      },
    ]
  }

  return []
}

/** 6 × Σ signed tetrahedra volume; sign encodes global orientation. */
function signedVolume6(mesh: IndexedMesh): number {
  let sum = 0
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const a = vertex(mesh, mesh.indices[t * 3] as number)
    const b = vertex(mesh, mesh.indices[t * 3 + 1] as number)
    const c = vertex(mesh, mesh.indices[t * 3 + 2] as number)
    sum += a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  return sum
}
