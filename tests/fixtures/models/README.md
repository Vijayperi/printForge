# Geometry analysis fixtures (Session 9)

Deterministic meshes for the FR-5 geometry engine (`src/domain/geometry/`).
Generated in code (`generators.ts`) rather than committed as binary `.stl`
blobs — the 100k-triangle perf fixture alone would be ~5 MB. Each generator
returns interleaved 9-float triangles; `tests/helpers/geometry.ts` turns them
into `RawTriangles` or a binary STL. Assertions live in
`tests/unit/geometryFixtures.test.ts`. (Deviation logged in `DECISIONS.md`.)

All linear dimensions are millimetres; volumes cm³; areas cm².

| Fixture | Generator | Expected findings | Hand-verified measurements |
|---|---|---|---|
| Unit cube | `unitCube()` | none | bbox 10×10×10; volume **1**; area **6**; 12 tris; 1 component |
| Two cubes | `twoCubes()` | `multiple_components` (count 2) | volume **2**; componentCount **2** |
| Cube with hole | `cubeWithHole()` | `boundary_holes` (count **4** open edges, 1 loop) | top face removed |
| Flipped-normals cube | `flippedNormalsCube()` | `inverted_normals` (top face flipped → 4 inconsistent edges) | — |
| Self-intersecting pair | `selfIntersectingPair()` | `self_intersections` (+ `boundary_holes`, open triangles) | two skew triangles crossing |
| Degenerate sliver | `cubeWithSliver()` | `degenerate_geometry` (count 1) | triangleCount **12** (sliver excluded) |
| Empty | `{ positions: [], triangleCount: 0 }` | `empty_mesh` | zeroed measurements |
| UV sphere (r=10) | `uvSphere()` | none | bbox ~20 each axis; volume ∈ (4.0, 4.19); ideal (4/3)πr³ = 4.18879 |
| Torus ~100k tris (perf) | `uvTorus()` | none | closed manifold; full analysis well under the 5 s budget (×3 CI margin) |

## Notes

- **Winding.** `box()` is outward-wound (CCW), verified by hand against per-face
  normals. `uvSphere`/`uvTorus` share vertices at seams/poles via welding, so they
  are closed 2-manifolds with consistent outward winding — a wrong winding would
  surface as an `inverted_normals` flip-all proposal.
- **Poles.** The sphere's pole rings are emitted as triangle fans (the degenerate
  half of each pole quad is skipped) so the "clean sphere" fixture has zero
  degenerate triangles.
- **Perf budget.** The torus asserts `< 15 s` (5 s budget × 3 for slow CI). Local
  runs complete in well under a second.
