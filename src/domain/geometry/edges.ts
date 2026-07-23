import type { IndexedMesh } from "@/src/domain/geometry/mesh"

/** One triangle's use of an undirected edge, keeping its directed traversal. */
export interface EdgeUse {
  tri: number
  from: number
  to: number
}

/** Undirected edge key for a welded vertex pair (order-independent). */
export function edgeKey(u: number, v: number, vertexCount: number): number {
  const lo = u < v ? u : v
  const hi = u < v ? v : u
  return lo * vertexCount + hi
}

/**
 * Map every undirected edge (sorted welded vertex pair) to the triangle uses
 * incident on it, preserving each use's directed traversal. Shared by the
 * manifold check (incidence counts, boundary edges) and the winding check
 * (opposite-direction traversal across a shared edge = consistent normals).
 */
export function buildEdgeMap(mesh: IndexedMesh): Map<number, EdgeUse[]> {
  const map = new Map<number, EdgeUse[]>()
  const v = mesh.vertexCount
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const i0 = mesh.indices[t * 3] as number
    const i1 = mesh.indices[t * 3 + 1] as number
    const i2 = mesh.indices[t * 3 + 2] as number
    addEdge(map, i0, i1, t, v)
    addEdge(map, i1, i2, t, v)
    addEdge(map, i2, i0, t, v)
  }
  return map
}

function addEdge(
  map: Map<number, EdgeUse[]>,
  from: number,
  to: number,
  tri: number,
  vertexCount: number
): void {
  const key = edgeKey(from, to, vertexCount)
  const uses = map.get(key)
  const use: EdgeUse = { tri, from, to }
  if (uses === undefined) map.set(key, [use])
  else uses.push(use)
}
