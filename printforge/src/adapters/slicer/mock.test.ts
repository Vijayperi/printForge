import { describe, expect, it } from "vitest"

import { MOCK_SLICER_VERSION, MockSlicer } from "@/src/adapters/slicer/mock"
import type { AssetStorage } from "@/src/adapters/storage"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { slicerContract } from "@/src/adapters/slicer/contract.spec-factory"
import { appError } from "@/src/lib/errors"
import { err } from "@/src/lib/result"
import { binaryStl, box } from "@/tests/helpers/geometry"

const CUBE = binaryStl(box([10, 10, 10]))
// A plate-resting base + a large downward-facing ceiling elevated above it → an
// unsupported overhang (mirrors src/domain/geometry/overhang.test.ts).
const OVERHANG = binaryStl([
  [0, 0, 0, 10, 0, 0, 0, 10, 0],
  [0, 0, 5, 0, 10, 5, 10, 0, 5],
])

async function seed(storage: AssetStorage, stl: Uint8Array): Promise<string> {
  const put = await storage.put(stl, { keyPrefix: "models", mime: "model/stl" })
  if (!put.ok) throw new Error("seed failed")
  return put.value.storageKey
}

const baseInput = {
  scaleFactor: 1,
  printerProfileId: "generic-fdm",
  materialId: "pla",
  qualityId: "standard",
  strengthId: "everyday",
}

slicerContract(async () => {
  const storage = new InMemoryStorage()
  const meshStorageKey = await seed(storage, CUBE)
  return { slicer: new MockSlicer(storage), meshStorageKey }
})

describe("MockSlicer", () => {
  it("estimates a clean cube deterministically (no supports)", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const result = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: key })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 1 cm³ × 1.24 g/cm³ × (0.3 + 0.7×0.25) = 1.24 × 0.475 = 0.589 g.
    expect(result.value.materialGrams).toBeCloseTo(0.589, 3)
    expect(result.value.durationMinutes).toBe(6) // ceil(1 × 6 × 1.0)
    expect(result.value.materialMeters).toBeCloseTo(0.589 / 2.98, 4)
    expect(result.value.supportsUsed).toBe(false)
    expect(result.value.slicerVersion).toBe(MOCK_SLICER_VERSION)
    expect(result.value.profileVersion).toBe("1.0.0")
  })

  it("scales material and time with the cube of the scale factor", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const slicer = new MockSlicer(storage)
    const one = await slicer.slice({ ...baseInput, meshStorageKey: key })
    const two = await slicer.slice({ ...baseInput, meshStorageKey: key, scaleFactor: 2 })
    expect(one.ok && two.ok).toBe(true)
    if (!one.ok || !two.ok) return
    expect(two.value.materialGrams / one.value.materialGrams).toBeCloseTo(8, 5) // 2³
  })

  it("flags supports for a mesh with steep overhangs", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, OVERHANG)
    const result = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: key })
    expect(result.ok && result.value.supportsUsed).toBe(true)
  })

  it("writes a stub gcode asset carrying the estimate", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const result = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: key })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const gcode = await storage.read(result.value.gcodeStorageKey)
    expect(gcode.ok).toBe(true)
    if (!gcode.ok) return
    expect(new TextDecoder().decode(gcode.value)).toContain(MOCK_SLICER_VERSION)
  })

  it("rejects an unknown quality or strength preset", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const slicer = new MockSlicer(storage)
    expect(
      !(await slicer.slice({ ...baseInput, meshStorageKey: key, qualityId: "ultra" })).ok
    ).toBe(true)
    const r = await slicer.slice({ ...baseInput, meshStorageKey: key, strengthId: "titanium" })
    expect(!r.ok && r.error.code).toBe("validation")
  })

  it("rejects an invalid scale factor", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const r = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: key, scaleFactor: 0 })
    expect(!r.ok && r.error.code).toBe("validation")
  })

  it("propagates a storage read error", async () => {
    const storage = new InMemoryStorage()
    const r = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: "missing/key" })
    expect(!r.ok && r.error.code).toBe("not_found")
  })

  it("rejects an unparseable mesh", async () => {
    const storage = new InMemoryStorage()
    const put = await storage.put(new Uint8Array([1, 2, 3]), { keyPrefix: "models", mime: "model/stl" })
    if (!put.ok) throw new Error("seed failed")
    const r = await new MockSlicer(storage).slice({ ...baseInput, meshStorageKey: put.value.storageKey })
    expect(!r.ok && r.error.code).toBe("validation")
  })

  it("propagates a gcode storage write error", async () => {
    const storage = new InMemoryStorage()
    const key = await seed(storage, CUBE)
    const failing: AssetStorage = {
      ingestFromUrl: storage.ingestFromUrl.bind(storage),
      getSignedUrl: storage.getSignedUrl.bind(storage),
      read: storage.read.bind(storage),
      put: async () => err(appError("provider_error", "disk full")),
    }
    const r = await new MockSlicer(failing).slice({ ...baseInput, meshStorageKey: key })
    expect(!r.ok && r.error.code).toBe("provider_error")
  })
})
