import type { MaterialProfile, PrinterProfile } from "@/src/config/profiles"
import { PRINTABILITY_THRESHOLDS as T } from "@/src/domain/printability/thresholds"
import type { Finding, Measurements, Verdict } from "@/src/domain/types"

export interface PrintabilityReport {
  verdict: Verdict
  findings: Finding[]
}

/**
 * Map geometry findings + measurements to a customer-facing verdict against a
 * printer/material profile at a given scale (plan §6-S10 step 2). Pure — no I/O.
 *
 * It augments the incoming findings with the two scale/profile-derived ones it
 * can compute (`exceeds_build_volume`, `below_min_wall`) and then applies the
 * decision table with strict precedence: **fail > manual_review > warning > pass**.
 * Nothing is repaired — repair *proposals* (e.g. inverted_normals) are surfaced
 * as findings only. Plain-language copy for each finding/verdict lives in the UI
 * (`content.ts`); this returns the structured verdict + finding list.
 */
export function buildReport(
  findings: Finding[],
  measurements: Measurements,
  profile: PrinterProfile,
  material: MaterialProfile,
  scaleFactor: number
): PrintabilityReport {
  const scaled = {
    x: measurements.boundingMm.x * scaleFactor,
    y: measurements.boundingMm.y * scaleFactor,
    z: measurements.boundingMm.z * scaleFactor,
  }
  const derived: Finding[] = []

  if (
    scaled.x > profile.buildVolumeMm.x ||
    scaled.y > profile.buildVolumeMm.y ||
    scaled.z > profile.buildVolumeMm.z
  ) {
    derived.push({
      kind: "exceeds_build_volume",
      severity: "blocking",
      detail: `scaled size ${dims(scaled)} mm exceeds the ${dims(profile.buildVolumeMm)} mm build volume`,
    })
  }

  const minScaledDim = Math.min(scaled.x, scaled.y, scaled.z)
  if (measurements.triangleCount > 0 && minScaledDim < material.minWallMm) {
    derived.push({
      kind: "below_min_wall",
      severity: "warning",
      detail: `thinnest feature ~${minScaledDim.toFixed(2)} mm is below the ${material.minWallMm} mm minimum for ${material.name}`,
    })
  }

  const all = [...findings, ...derived]
  return { verdict: decide(all, measurements), findings: all }
}

function decide(all: Finding[], measurements: Measurements): Verdict {
  const has = (kind: Finding["kind"]): boolean => all.some((f) => f.kind === kind)
  const find = (kind: Finding["kind"]): Finding | undefined => all.find((f) => f.kind === kind)

  // ---- fail ----
  if (has("empty_mesh")) return "fail"
  if (has("exceeds_build_volume")) return "fail"
  const self = find("self_intersections")
  if (self !== undefined && self.severity === "blocking" && (self.count ?? 0) > 0) return "fail"
  const holes = find("boundary_holes")
  if (holes !== undefined && (holes.count ?? 0) > T.boundaryHoleFailEdges) return "fail"

  // ---- manual_review ----
  if (has("non_manifold_edges")) return "manual_review"
  if (has("inverted_normals")) return "manual_review"
  if (has("trapped_volume")) return "manual_review"
  if (has("multiple_components") && measurements.smallestComponentVolumeFraction < T.smallComponentVolumeFraction) {
    return "manual_review"
  }
  if (holes !== undefined) return "manual_review" // ≤ fail threshold (the > case failed above)
  if (has("below_min_wall")) return "manual_review"
  if (has("unstable_base")) return "manual_review"

  // ---- warning ----
  if (has("unsupported_overhang")) return "warning"
  if (has("multiple_components")) return "warning" // components all ≥ 5% volume
  if (has("degenerate_geometry")) return "warning"

  return "pass"
}

function dims(d: { x: number; y: number; z: number }): string {
  return `${round(d.x)}×${round(d.y)}×${round(d.z)}`
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
