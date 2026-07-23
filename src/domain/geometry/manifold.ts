import { buildEdgeMap } from "@/src/domain/geometry/edges"
import type { IndexedMesh } from "@/src/domain/geometry/mesh"
import { UnionFind } from "@/src/domain/geometry/unionFind"
import type { Finding } from "@/src/domain/types"

/**
 * Manifold analysis (plan §6-S9 step 2, manifold). A closed 2-manifold has
 * every edge shared by exactly two triangles. Edges incident on three or more
 * triangles are non-manifold; edges incident on exactly one triangle are open
 * boundary edges, which chain into boundary loops (holes).
 *
 * The `boundary_holes` finding's `count` is the **total boundary edge count**
 * (the number the S10 verdict thresholds on: > 100 → fail, ≤ 100 →
 * manual_review); the loop/hole count is reported in the detail string. See
 * DECISIONS.md.
 */
export function analyzeManifold(mesh: IndexedMesh): Finding[] {
  const edges = buildEdgeMap(mesh)
  const findings: Finding[] = []

  let nonManifoldEdges = 0
  let boundaryEdges = 0
  const boundaryVertices = new Set<number>()
  const uf = new UnionFind(mesh.vertexCount)

  for (const uses of edges.values()) {
    if (uses.length >= 3) {
      nonManifoldEdges += 1
    } else if (uses.length === 1) {
      boundaryEdges += 1
      const { from, to } = uses[0] as { from: number; to: number }
      boundaryVertices.add(from)
      boundaryVertices.add(to)
      uf.union(from, to)
    }
  }

  if (nonManifoldEdges > 0) {
    findings.push({
      kind: "non_manifold_edges",
      severity: "warning",
      detail: `${nonManifoldEdges} edge(s) shared by three or more triangles`,
      count: nonManifoldEdges,
    })
  }

  if (boundaryEdges > 0) {
    const loops = uf.countRoots(boundaryVertices)
    findings.push({
      kind: "boundary_holes",
      severity: "warning",
      detail: `${loops} boundary loop(s) across ${boundaryEdges} open edge(s)`,
      count: boundaryEdges,
    })
  }

  return findings
}
