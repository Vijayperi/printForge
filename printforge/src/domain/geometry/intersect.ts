import { EPS } from "@/src/domain/geometry/eps"
import { type IndexedMesh, vertex } from "@/src/domain/geometry/mesh"
import type { Finding } from "@/src/domain/types"

/** Maximum self-intersecting pairs reported before early exit (plan §6-S9). */
export const SELF_INTERSECTION_CAP = 100
const LEAF_SIZE = 8

type Vec3 = readonly [number, number, number]

/**
 * Self-intersection analysis (plan §6-S9 step 2, intersect). Candidate triangle
 * pairs are narrowed by an AABB BVH (median split, leaves ≤ 8), then confirmed
 * with a Separating-Axis triangle–triangle test that handles coplanar and
 * skew triangles uniformly. Triangles sharing a welded vertex are adjacent and
 * skipped (they legitimately touch). The count is capped at
 * {@link SELF_INTERSECTION_CAP}; hitting the cap sets an early-exit flag.
 */
export function analyzeIntersections(mesh: IndexedMesh): Finding[] {
  const n = mesh.triangleCount
  if (n === 0) return []

  const boxes = buildTriangleBoxes(mesh)
  const root = buildBvh(
    Array.from({ length: n }, (_, i) => i),
    boxes
  )

  let count = 0
  let capped = false
  const stack: BvhNode[] = []

  outer: for (let i = 0; i < n; i += 1) {
    stack.length = 0
    stack.push(root)
    while (stack.length > 0) {
      const node = stack.pop() as BvhNode
      if (!aabbOverlap(boxes, i, node)) continue
      if (node.tris === undefined) {
        stack.push(node.left as BvhNode, node.right as BvhNode)
        continue
      }
      for (const j of node.tris) {
        if (j <= i) continue // test each unordered pair once
        if (sharesVertex(mesh, i, j)) continue // adjacent triangles legitimately touch
        if (!boxesOverlap(boxes, i, j)) continue
        if (!trianglesIntersect(triangle(mesh, i), triangle(mesh, j))) continue
        count += 1
        if (count >= SELF_INTERSECTION_CAP) {
          capped = true
          break outer
        }
      }
    }
  }

  if (count === 0) return []
  return [
    {
      kind: "self_intersections",
      severity: "blocking",
      detail: capped
        ? `at least ${count} self-intersecting triangle pairs (capped)`
        : `${count} self-intersecting triangle pair(s)`,
      count,
    },
  ]
}

// ------------------------------------------------------------- triangle access
function triangle(mesh: IndexedMesh, t: number): [Vec3, Vec3, Vec3] {
  return [
    vertex(mesh, mesh.indices[t * 3] as number),
    vertex(mesh, mesh.indices[t * 3 + 1] as number),
    vertex(mesh, mesh.indices[t * 3 + 2] as number),
  ]
}

function sharesVertex(mesh: IndexedMesh, i: number, j: number): boolean {
  const ai = mesh.indices[i * 3] as number
  const bi = mesh.indices[i * 3 + 1] as number
  const ci = mesh.indices[i * 3 + 2] as number
  for (let k = 0; k < 3; k += 1) {
    const vj = mesh.indices[j * 3 + k] as number
    if (vj === ai || vj === bi || vj === ci) return true
  }
  return false
}

// -------------------------------------------------------------- triangle AABBs
/** Flat [minX,minY,minZ,maxX,maxY,maxZ] per triangle. */
function buildTriangleBoxes(mesh: IndexedMesh): Float64Array {
  const boxes = new Float64Array(mesh.triangleCount * 6)
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const [a, b, c] = triangle(mesh, t)
    for (let axis = 0; axis < 3; axis += 1) {
      const va = a[axis] as number
      const vb = b[axis] as number
      const vc = c[axis] as number
      boxes[t * 6 + axis] = Math.min(va, vb, vc)
      boxes[t * 6 + 3 + axis] = Math.max(va, vb, vc)
    }
  }
  return boxes
}

function boxesOverlap(boxes: Float64Array, i: number, j: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if ((boxes[i * 6 + axis] as number) > (boxes[j * 6 + 3 + axis] as number)) return false
    if ((boxes[j * 6 + axis] as number) > (boxes[i * 6 + 3 + axis] as number)) return false
  }
  return true
}

// -------------------------------------------------------------------- the BVH
interface BvhNode {
  min: [number, number, number]
  max: [number, number, number]
  left?: BvhNode
  right?: BvhNode
  tris?: number[]
}

function buildBvh(tris: number[], boxes: Float64Array): BvhNode {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const t of tris) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] as number, boxes[t * 6 + axis] as number)
      max[axis] = Math.max(max[axis] as number, boxes[t * 6 + 3 + axis] as number)
    }
  }

  if (tris.length <= LEAF_SIZE) return { min, max, tris }

  const axis = longestAxis(min, max)
  const center = (t: number): number =>
    ((boxes[t * 6 + axis] as number) + (boxes[t * 6 + 3 + axis] as number)) / 2
  const sorted = [...tris].sort((p, q) => center(p) - center(q))
  const mid = sorted.length >> 1
  return {
    min,
    max,
    left: buildBvh(sorted.slice(0, mid), boxes),
    right: buildBvh(sorted.slice(mid), boxes),
  }
}

function longestAxis(min: Vec3, max: Vec3): number {
  const dx = (max[0] as number) - (min[0] as number)
  const dy = (max[1] as number) - (min[1] as number)
  const dz = (max[2] as number) - (min[2] as number)
  if (dx >= dy && dx >= dz) return 0
  if (dy >= dz) return 1
  return 2
}

function aabbOverlap(boxes: Float64Array, i: number, node: BvhNode): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    if ((boxes[i * 6 + axis] as number) > (node.max[axis] as number)) return false
    if ((node.min[axis] as number) > (boxes[i * 6 + 3 + axis] as number)) return false
  }
  return true
}

// -------------------------------------------------- SAT triangle–triangle test
function sub(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number)]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ]
}

function dot(a: Vec3, b: Vec3): number {
  return (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number)
}

/** True iff the two (non-degenerate) triangles overlap in 3-space. */
function trianglesIntersect(t1: [Vec3, Vec3, Vec3], t2: [Vec3, Vec3, Vec3]): boolean {
  const [v0, v1, v2] = t1
  const [u0, u1, u2] = t2
  const e1: Vec3[] = [sub(v1, v0), sub(v2, v1), sub(v0, v2)]
  const e2: Vec3[] = [sub(u1, u0), sub(u2, u1), sub(u0, u2)]
  const n1 = cross(e1[0] as Vec3, e1[1] as Vec3)
  const n2 = cross(e2[0] as Vec3, e2[1] as Vec3)

  // Face normals + 9 edge-edge crosses (general case) + 6 in-plane edge normals
  // (n × edge). The last six give in-plane separating axes that the edge-edge
  // crosses collapse to zero for when the triangles are coplanar.
  const axes: Vec3[] = [n1, n2]
  for (const a of e1) for (const b of e2) axes.push(cross(a, b))
  for (const a of e1) axes.push(cross(n1, a))
  for (const b of e2) axes.push(cross(n2, b))

  for (const axis of axes) {
    const len = Math.sqrt(dot(axis, axis))
    if (len < EPS.axis) continue // parallel edges / degenerate axis — cannot separate
    const unit: Vec3 = [(axis[0] as number) / len, (axis[1] as number) / len, (axis[2] as number) / len]
    const p1 = project(t1, unit)
    const p2 = project(t2, unit)
    if (p1.max < p2.min - EPS.gap || p2.max < p1.min - EPS.gap) return false
  }
  return true
}

function project(tri: [Vec3, Vec3, Vec3], axis: Vec3): { min: number; max: number } {
  const d0 = dot(tri[0], axis)
  const d1 = dot(tri[1], axis)
  const d2 = dot(tri[2], axis)
  return { min: Math.min(d0, d1, d2), max: Math.max(d0, d1, d2) }
}
