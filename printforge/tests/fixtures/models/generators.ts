/**
 * Deterministic geometry fixtures for the S9 analysis engine. Generated in code
 * rather than committed as binary STL blobs (the 100k-triangle perf fixture
 * alone would be ~5 MB) — see README.md for each fixture's documented expected
 * findings and hand-verified measurements, and DECISIONS.md for the deviation.
 *
 * Every generator returns interleaved 9-float triangles; `tests/helpers/geometry`
 * turns them into RawTriangles or a binary STL.
 */
import { box, flip, type Tri } from "@/tests/helpers/geometry"

/** Watertight 10 mm cube → 1 cm³, 6 cm², 1 component, no findings. */
export function unitCube(): number[][] {
  return box([10, 10, 10])
}

/** Two separated 10 mm cubes → 2 components (multiple_components). */
export function twoCubes(): number[][] {
  return [...box([10, 10, 10]), ...box([10, 10, 10], [100, 0, 0])]
}

/** 10 mm cube with the top face removed → one boundary loop of 4 open edges. */
export function cubeWithHole(): number[][] {
  return box([10, 10, 10]).filter((_, i) => i !== 2 && i !== 3)
}

/** 10 mm cube with the top face flipped → inconsistent winding (inverted_normals). */
export function flippedNormalsCube(): number[][] {
  const tris = box([10, 10, 10])
  tris[2] = flip(tris[2] as Tri)
  tris[3] = flip(tris[3] as Tri)
  return tris
}

/** Two skew triangles that pierce each other → self_intersections (+ open edges). */
export function selfIntersectingPair(): number[][] {
  return [
    [0, 0, 0, 10, 0, 0, 0, 10, 0],
    [2, 2, -5, 2, 2, 5, 8, 2, 0],
  ]
}

/** A watertight cube plus one colinear (zero-area) sliver → degenerate_geometry. */
export function cubeWithSliver(): number[][] {
  return [...box([10, 10, 10]), [0, 0, 0, 1, 0, 0, 2, 0, 0]]
}

/**
 * UV sphere of the given radius (mm). Poles collapse to single welded vertices
 * and the longitude seam welds shut, so the result is a closed 2-manifold with
 * consistent outward winding. Volume approaches (4/3)πr³ as tessellation rises.
 */
export function uvSphere(radius = 10, rings = 24, segments = 32): number[][] {
  const vertex = (i: number, j: number): number[] => {
    const theta = (Math.PI * i) / rings // 0 (north) .. π (south)
    const phi = (2 * Math.PI * j) / segments
    return [
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(theta),
    ]
  }
  const tris: number[][] = []
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i + 1, j + 1)
      const d = vertex(i, j + 1)
      // Pole rings collapse to a triangle fan (one degenerate half each); emit
      // only the non-degenerate triangle so the closed mesh stays clean.
      if (i === 0) {
        tris.push([...a, ...b, ...c])
      } else if (i === rings - 1) {
        tris.push([...a, ...c, ...d])
      } else {
        tris.push([...a, ...b, ...c], [...a, ...c, ...d])
      }
    }
  }
  return tris
}

/**
 * Torus (major radius R, minor r) with `major × minor × 2` triangles. Closed,
 * fully manifold (no poles), consistent outward winding. Used as the perf
 * fixture — `uvTorus(224, 224)` yields ~100k triangles.
 */
export function uvTorus(major = 224, minor = 224, R = 20, r = 6): number[][] {
  const vertex = (i: number, j: number): number[] => {
    const u = (2 * Math.PI * i) / major
    const v = (2 * Math.PI * j) / minor
    const ringX = R + r * Math.cos(v)
    return [ringX * Math.cos(u), ringX * Math.sin(u), r * Math.sin(v)]
  }
  const tris: number[][] = []
  for (let i = 0; i < major; i += 1) {
    for (let j = 0; j < minor; j += 1) {
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const c = vertex(i + 1, j + 1)
      const d = vertex(i, j + 1)
      tris.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  }
  return tris
}
