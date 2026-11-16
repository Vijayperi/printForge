/**
 * Print configuration domain (plan §6-S11 step 1). Pure — no I/O, no clock.
 *
 * `applyScale` turns a target longest-edge into a uniform scale factor + scaled
 * dimensions; `scaleHash` is its stable key for the validation report / job
 * idempotency; `validateConfiguration` is the constraint matrix the Configure UI
 * and the POST route both enforce against the §4.5 profiles.
 */

import type {
  MaterialProfile,
  PrinterProfile,
  QualityPreset,
  StrengthPreset,
} from "@/src/config/profiles"
import { err, ok, type Result } from "@/src/lib/result"

export interface Dimensions {
  x: number
  y: number
  z: number
}

export interface PrintConfigInput {
  materialId: string
  colorId: string
  dimensionsMm: Dimensions
  scaleFactor: number
  qualityId: string
  strengthId: string
  shippingSpeed: string
  specialInstructions: string
}

/** Smallest longest-edge we will print (mm). Below this the model is too fiddly. */
export const MIN_LONGEST_MM = 10
/** Special-instructions character cap (plan §6-S11 step 2). */
export const MAX_INSTRUCTIONS = 500

export function longestDim(d: Dimensions): number {
  return Math.max(d.x, d.y, d.z)
}

/**
 * Uniform scale so the model's longest dimension becomes `targetLongestMm`. A
 * degenerate (zero-size) base yields scaleFactor 0 rather than dividing by zero.
 */
export function applyScale(
  baseDimsMm: Dimensions,
  targetLongestMm: number
): { dims: Dimensions; scaleFactor: number } {
  const base = longestDim(baseDimsMm)
  const scaleFactor = base > 0 ? targetLongestMm / base : 0
  return {
    scaleFactor,
    dims: {
      x: baseDimsMm.x * scaleFactor,
      y: baseDimsMm.y * scaleFactor,
      z: baseDimsMm.z * scaleFactor,
    },
  }
}

/**
 * Stable, non-empty key for a scale factor — used as the validation report's
 * `scaleHash` and as the re-validation job's idempotency suffix so re-running the
 * same scale de-dupes (and caches) instead of re-analysing. Rounded to 6 dp so
 * float noise never forks the key.
 */
export function scaleHash(scaleFactor: number): string {
  return `s${Math.round(scaleFactor * 1e6) / 1e6}`
}

export type ConfigViolationCode =
  | "invalid_scale"
  | "unknown_material"
  | "unknown_color"
  | "color_out_of_stock"
  | "unknown_quality"
  | "unknown_strength"
  | "unknown_shipping"
  | "too_small"
  | "exceeds_build_volume"
  | "instructions_too_long"

/** One failed constraint. `field` names the UI control it belongs to. */
export interface ConfigViolation {
  field: "size" | "material" | "color" | "quality" | "strength" | "shipping" | "instructions"
  code: ConfigViolationCode
  message: string
}

export interface ConfigCatalog {
  profile: PrinterProfile
  materials: readonly MaterialProfile[]
  qualities: readonly QualityPreset[]
  strengths: readonly StrengthPreset[]
  shippingSpeeds: readonly string[]
}

/**
 * Validate a submitted configuration against the catalog, collecting **every**
 * violation (not just the first) so the form can mark all offending controls at
 * once. Returns the input unchanged on success.
 */
export function validateConfiguration(
  input: PrintConfigInput,
  catalog: ConfigCatalog
): Result<PrintConfigInput, ConfigViolation[]> {
  const violations: ConfigViolation[] = []

  if (!Number.isFinite(input.scaleFactor) || input.scaleFactor <= 0) {
    violations.push({ field: "size", code: "invalid_scale", message: "Scale must be a positive number." })
  }

  const material = catalog.materials.find((m) => m.id === input.materialId)
  if (material === undefined) {
    violations.push({ field: "material", code: "unknown_material", message: "Choose a material." })
  } else {
    const color = material.colors.find((c) => c.id === input.colorId)
    if (color === undefined) {
      violations.push({ field: "color", code: "unknown_color", message: "Choose a colour for this material." })
    } else if (!color.inStock) {
      violations.push({ field: "color", code: "color_out_of_stock", message: `${color.name} is out of stock.` })
    }
  }

  if (catalog.qualities.find((q) => q.id === input.qualityId) === undefined) {
    violations.push({ field: "quality", code: "unknown_quality", message: "Choose a print quality." })
  }
  if (catalog.strengths.find((s) => s.id === input.strengthId) === undefined) {
    violations.push({ field: "strength", code: "unknown_strength", message: "Choose a strength." })
  }
  if (!catalog.shippingSpeeds.includes(input.shippingSpeed)) {
    violations.push({ field: "shipping", code: "unknown_shipping", message: "Choose a shipping speed." })
  }

  const { x, y, z } = input.dimensionsMm
  if (longestDim(input.dimensionsMm) < MIN_LONGEST_MM) {
    violations.push({
      field: "size",
      code: "too_small",
      message: `Longest side must be at least ${MIN_LONGEST_MM} mm.`,
    })
  }
  const build = catalog.profile.buildVolumeMm
  if (x > build.x || y > build.y || z > build.z) {
    violations.push({
      field: "size",
      code: "exceeds_build_volume",
      message: `Too large for the ${build.x}×${build.y}×${build.z} mm build volume.`,
    })
  }

  if (input.specialInstructions.length > MAX_INSTRUCTIONS) {
    violations.push({
      field: "instructions",
      code: "instructions_too_long",
      message: `Instructions must be ${MAX_INSTRUCTIONS} characters or fewer.`,
    })
  }

  return violations.length === 0 ? ok(input) : err(violations)
}
