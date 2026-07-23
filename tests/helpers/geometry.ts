import type { RawTriangles } from "@/src/domain/geometry/stlParse"

/** A triangle as 9 interleaved floats: ax,ay,az, bx,by,bz, cx,cy,cz. */
export type Tri = readonly number[]

/** Pack a list of 9-float triangles into {@link RawTriangles}. */
export function rawFromTriangles(triangles: readonly Tri[]): RawTriangles {
  const positions = new Float32Array(triangles.length * 9)
  triangles.forEach((tri, i) => {
    for (let k = 0; k < 9; k += 1) positions[i * 9 + k] = tri[k] as number
  })
  return { positions, triangleCount: triangles.length }
}

/** Encode 9-float triangles as a binary STL (80-byte header + count + records). */
export function binaryStl(triangles: readonly Tri[]): Uint8Array {
  const count = triangles.length
  const bytes = new Uint8Array(84 + 50 * count)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, count, true)
  triangles.forEach((tri, i) => {
    const base = 84 + 50 * i + 12 // skip the per-facet normal
    for (let v = 0; v < 9; v += 1) view.setFloat32(base + v * 4, tri[v] as number, true)
  })
  return bytes
}

/** Reverse a triangle's winding by swapping its 2nd and 3rd vertices. */
export function flip(tri: Tri): number[] {
  return [tri[0]!, tri[1]!, tri[2]!, tri[6]!, tri[7]!, tri[8]!, tri[3]!, tri[4]!, tri[5]!]
}

/**
 * 12 outward-wound (CCW) triangles of an axis-aligned box. Closed, 2-manifold,
 * consistent winding, positive signed volume = dx·dy·dz. Winding verified by
 * hand against per-face outward normals.
 */
export function box(
  size: readonly [number, number, number],
  origin: readonly [number, number, number] = [0, 0, 0]
): number[][] {
  const [sx, sy, sz] = size
  const [x0, y0, z0] = origin
  const x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz
  const v0 = [x0, y0, z0], v1 = [x1, y0, z0], v2 = [x1, y1, z0], v3 = [x0, y1, z0]
  const v4 = [x0, y0, z1], v5 = [x1, y0, z1], v6 = [x1, y1, z1], v7 = [x0, y1, z1]
  const face = (a: number[], b: number[], c: number[]): number[] => [...a, ...b, ...c]
  return [
    face(v0, v2, v1), face(v0, v3, v2), // bottom −Z
    face(v4, v5, v6), face(v4, v6, v7), // top +Z
    face(v0, v1, v5), face(v0, v5, v4), // front −Y
    face(v3, v7, v6), face(v3, v6, v2), // back +Y
    face(v0, v4, v7), face(v0, v7, v3), // left −X
    face(v1, v2, v6), face(v1, v6, v5), // right +X
  ]
}
