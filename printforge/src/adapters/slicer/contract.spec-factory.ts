import { describe, expect, it } from "vitest"

import type { SliceInput, Slicer } from "@/src/adapters/slicer"

const INPUT: SliceInput = {
  meshStorageKey: "", // filled per impl by the factory below
  scaleFactor: 1,
  printerProfileId: "generic-fdm",
  materialId: "pla",
  qualityId: "standard",
  strengthId: "everyday",
}

/**
 * Shared contract every Slicer must satisfy (plan §4.4), so the mock and the real
 * PrusaSlicer CLI can never drift. `make` seeds a mesh in the slicer's storage and
 * returns the slicer plus the key to slice.
 */
export function slicerContract(
  make: () => Promise<{ slicer: Slicer; meshStorageKey: string }>
): void {
  describe("Slicer contract", () => {
    it("produces a positive, self-consistent estimate with a stored gcode asset", async () => {
      const { slicer, meshStorageKey } = await make()
      const result = await slicer.slice({ ...INPUT, meshStorageKey })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const r = result.value
      expect(r.materialGrams).toBeGreaterThan(0)
      expect(r.durationMinutes).toBeGreaterThan(0)
      expect(r.materialMeters).toBeGreaterThan(0)
      expect(r.gcodeStorageKey.length).toBeGreaterThan(0)
      expect(r.slicerVersion.length).toBeGreaterThan(0)
      expect(r.profileVersion.length).toBeGreaterThan(0)
      expect(typeof r.supportsUsed).toBe("boolean")
      expect(r.orientation).toEqual({ rx: 0, ry: 0, rz: 0 })
    })
  })
}
