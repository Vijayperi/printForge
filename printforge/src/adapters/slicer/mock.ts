import "server-only"

import type { Slicer, SliceInput, SliceResult } from "@/src/adapters/slicer"
import type { AssetStorage } from "@/src/adapters/storage"
import {
  getMaterialProfile,
  getPrinterProfile,
  getQualityPreset,
  getStrengthPreset,
} from "@/src/config/profiles"
import { analyzeGeometry } from "@/src/domain/geometry/analyze"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { analyzeOverhang } from "@/src/domain/geometry/overhang"
import { parseStl } from "@/src/domain/geometry/stlParse"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export const MOCK_SLICER_VERSION = "mock-slicer/1.0.0"
/** Filament linear density: 1 m of 1.75 mm filament ≈ 2.98 g (PLA-ish). */
const GRAMS_PER_METER = 2.98

/**
 * Deterministic in-repo slicer (plan §6-S12 step 1). It reads the stored mesh,
 * derives volume from the geometry engine (so it needs no external binary),
 * scales it, and applies simple physically-plausible formulas so quotes are
 * stable and testable. Support usage reuses the S10 overhang heuristic. It writes
 * a stub gcode asset (a text header carrying the estimate) to storage.
 */
export class MockSlicer implements Slicer {
  constructor(private readonly storage: AssetStorage) {}

  async slice(input: SliceInput): Promise<Result<SliceResult>> {
    const material = getMaterialProfile(input.materialId)
    const quality = getQualityPreset(input.qualityId)
    const strength = getStrengthPreset(input.strengthId)
    if (quality === undefined || strength === undefined) {
      return err(appError("validation", "unknown quality or strength preset for slicing"))
    }
    if (!Number.isFinite(input.scaleFactor) || input.scaleFactor <= 0) {
      return err(appError("validation", `invalid scale factor ${input.scaleFactor}`))
    }

    const bytes = await this.storage.read(input.meshStorageKey)
    if (!bytes.ok) return bytes
    const parsed = parseStl(bytes.value)
    if (!parsed.ok) return err(appError("validation", `unsliceable mesh (${parsed.error.kind})`))

    const raw = parsed.value
    const baseVolumeCm3 = analyzeGeometry(raw).measurements.volumeCm3
    const volumeCm3 = baseVolumeCm3 * input.scaleFactor ** 3
    const supportsUsed = analyzeOverhang(buildIndexedMesh(raw)).length > 0

    const infillFraction = strength.infillPct / 100
    const materialGrams = volumeCm3 * material.densityGCm3 * (0.3 + 0.7 * infillFraction)
    const durationMinutes = Math.ceil(volumeCm3 * 6 * quality.timeFactor)
    const materialMeters = materialGrams / GRAMS_PER_METER

    const gcode = renderGcode({ input, materialGrams, durationMinutes, materialMeters, supportsUsed })
    const stored = await this.storage.put(new TextEncoder().encode(gcode), {
      keyPrefix: "gcode",
      mime: "text/x.gcode",
    })
    if (!stored.ok) return stored

    return ok({
      durationMinutes,
      materialGrams,
      materialMeters,
      supportsUsed,
      gcodeStorageKey: stored.value.storageKey,
      slicerVersion: MOCK_SLICER_VERSION,
      profileVersion: getPrinterProfile(input.printerProfileId).version,
      orientation: { rx: 0, ry: 0, rz: 0 },
    })
  }
}

function renderGcode(args: {
  input: SliceInput
  materialGrams: number
  durationMinutes: number
  materialMeters: number
  supportsUsed: boolean
}): string {
  const { input, materialGrams, durationMinutes, materialMeters, supportsUsed } = args
  return [
    `; ${MOCK_SLICER_VERSION}`,
    `; printer_profile = ${input.printerProfileId}`,
    `; material = ${input.materialId}`,
    `; quality = ${input.qualityId}`,
    `; strength = ${input.strengthId}`,
    `; scale_factor = ${input.scaleFactor}`,
    `; estimated printing time (normal mode) = ${durationMinutes}m`,
    `; filament used [g] = ${materialGrams.toFixed(2)}`,
    `; filament used [mm] = ${(materialMeters * 1000).toFixed(1)}`,
    `; supports = ${supportsUsed ? "yes" : "no"}`,
    "; PrintForge stub gcode — not a real toolpath",
    "",
  ].join("\n")
}
