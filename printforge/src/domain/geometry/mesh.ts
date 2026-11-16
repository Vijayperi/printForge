import { EPS, quantize } from "@/src/domain/geometry/eps"
import type { RawTriangles } from "@/src/domain/geometry/stlParse"

/**
 * A welded, indexed triangle mesh (plan §6-S9 step 1). Vertices coincident
 * within the weld tolerance collapse to one index, so topology checks
 * (manifold edges, components, winding) can reason about shared vertices.
 * Degenerate triangles (zero-area or NaN) are filtered out but *counted* — the
 * count surfaces as a `degenerate_geometry` finding rather than being silently
 * dropped.
 */
export interface IndexedMesh {
  /** Unique welded vertex positions, xyz interleaved (mm). */
  positions: Float32Array
  vertexCount: number
  /** Triangle vertex indices into `positions`, 3 per triangle. */
  indices: Uint32Array
  triangleCount: number
  /** Triangles dropped as degenerate (zero-area under EPS.area, or NaN). */
  degenerateCount: number
}

/** Read welded vertex `i` into a fixed 3-tuple. */
export function vertex(mesh: IndexedMesh, i: number): [number, number, number] {
  const base = i * 3
  return [mesh.positions[base] as number, mesh.positions[base + 1] as number, mesh.positions[base + 2] as number]
}

function weldKey(x: number, y: number, z: number): string {
  return `${quantize(x)},${quantize(y)},${quantize(z)}`
}

/** Twice the triangle area = ‖(b−a) × (c−a)‖. NaN inputs yield NaN. */
function doubleArea(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
  const nx = e1y * e2z - e1z * e2y
  const ny = e1z * e2x - e1x * e2z
  const nz = e1x * e2y - e1y * e2x
  return Math.sqrt(nx * nx + ny * ny + nz * nz)
}

/**
 * Build an {@link IndexedMesh} from raw interleaved triangles. Welding is by
 * quantized position; a triangle whose welded double-area is below `2·EPS.area`
 * (or NaN — the `< …` comparison is false, so it falls through to the explicit
 * NaN branch) is recorded as degenerate and excluded from the index.
 */
export function buildIndexedMesh(raw: RawTriangles): IndexedMesh {
  const p = raw.positions
  const welded: number[] = []
  const indices: number[] = []
  const lookup = new Map<string, number>()
  let degenerateCount = 0

  function weldVertex(x: number, y: number, z: number): number {
    const key = weldKey(x, y, z)
    const existing = lookup.get(key)
    if (existing !== undefined) return existing
    const index = welded.length / 3
    welded.push(x, y, z)
    lookup.set(key, index)
    return index
  }

  for (let t = 0; t < raw.triangleCount; t += 1) {
    const o = t * 9
    const ax = p[o] as number, ay = p[o + 1] as number, az = p[o + 2] as number
    const bx = p[o + 3] as number, by = p[o + 4] as number, bz = p[o + 5] as number
    const cx = p[o + 6] as number, cy = p[o + 7] as number, cz = p[o + 8] as number

    const area2 = doubleArea(ax, ay, az, bx, by, bz, cx, cy, cz)
    if (!(area2 >= 2 * EPS.area)) {
      // Zero-area (collapsed / sliver) or NaN — count, don't index.
      degenerateCount += 1
      continue
    }
    indices.push(weldVertex(ax, ay, az), weldVertex(bx, by, bz), weldVertex(cx, cy, cz))
  }

  return {
    positions: Float32Array.from(welded),
    vertexCount: welded.length / 3,
    indices: Uint32Array.from(indices),
    triangleCount: indices.length / 3,
    degenerateCount,
  }
}
