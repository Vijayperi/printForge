import { analyzeComponents } from "@/src/domain/geometry/components"
import { analyzeIntersections } from "@/src/domain/geometry/intersect"
import { analyzeManifold } from "@/src/domain/geometry/manifold"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { measure } from "@/src/domain/geometry/measure"
import { analyzeNormals } from "@/src/domain/geometry/normals"
import type { RawTriangles } from "@/src/domain/geometry/stlParse"
import type { Finding, Measurements } from "@/src/domain/types"

export interface GeometryAnalysis {
  measurements: Measurements
  findings: Finding[]
}

/**
 * Run the full geometry analysis (plan §6-S9): weld → measure → manifold →
 * components → normals → self-intersection. Pure — no I/O — so the whole engine
 * is fixture-testable. Findings are returned in a stable order (empty/degenerate
 * mesh-level issues first, then topology, then geometry) so persisted reports
 * are deterministic. Connectivity is computed once and shared with `measure`.
 */
export function analyzeGeometry(raw: RawTriangles): GeometryAnalysis {
  const mesh = buildIndexedMesh(raw)
  const { componentCount, smallestVolumeFraction, findings: componentFindings } =
    analyzeComponents(mesh)
  const { measurements, findings: measureFindings } = measure(mesh, componentCount, smallestVolumeFraction)

  const degenerate: Finding[] =
    mesh.degenerateCount > 0
      ? [
          {
            kind: "degenerate_geometry",
            severity: "info",
            detail: `${mesh.degenerateCount} degenerate triangle(s) removed before analysis`,
            count: mesh.degenerateCount,
          },
        ]
      : []

  const findings: Finding[] = [
    ...measureFindings, // empty_mesh
    ...degenerate,
    ...analyzeManifold(mesh), // non_manifold_edges, boundary_holes
    ...componentFindings, // multiple_components
    ...analyzeNormals(mesh), // inverted_normals
    ...analyzeIntersections(mesh), // self_intersections
  ]

  return { measurements, findings }
}
