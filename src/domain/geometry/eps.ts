/**
 * Centralized float tolerances for the geometry engine (plan §6-S9 pitfall:
 * "centralize epsilons in one EPS module; never compare floats with === in
 * checks"). Every check imports from here — no magic numbers scattered across
 * the analysis modules.
 */
export const EPS = {
  /**
   * Vertex-weld quantization grid (millimetres). Two vertices within this
   * distance on each axis collapse to the same welded index. 1e-6 mm = 1 nm,
   * far below any real print feature, so it only merges numerically-equal
   * vertices emitted as distinct floats by an exporter.
   */
  weld: 1e-6,
  /**
   * Minimum triangle area (mm²) below which a triangle is degenerate. Compared
   * against ‖edge₁ × edge₂‖ / 2, so the raw cross-product magnitude threshold
   * is 2× this.
   */
  area: 1e-12,
  /**
   * Signed-volume magnitude (mm³) below which the mesh is treated as having no
   * net orientation, so the global winding (flip) proposal is suppressed rather
   * than decided by float noise.
   */
  volume: 1e-9,
  /**
   * Separation gap (mm) for the self-intersection SAT test: two triangles are
   * separated on a (unit-normalised) axis only when their projections leave a
   * gap wider than this, so sub-nanometre float noise never reads as a
   * penetration.
   */
  gap: 1e-6,
  /** Axis-length floor below which a SAT candidate axis is degenerate/skipped. */
  axis: 1e-12,
} as const

/** Snap a coordinate to the weld grid, returning an integer grid cell index. */
export function quantize(value: number): number {
  return Math.round(value / EPS.weld)
}
