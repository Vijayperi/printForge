import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { slicerContract } from "@/src/adapters/slicer/contract.spec-factory"
import {
  buildPrusaArgs,
  parsePrintTimeMinutes,
  parsePrusaSliceStats,
  PrusaSlicerCli,
  type PrusaRuntime,
} from "@/src/adapters/slicer/prusa"
import type { SliceInput } from "@/src/adapters/slicer"
import type { AssetStorage } from "@/src/adapters/storage"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"

const SAMPLE = readFileSync(join(__dirname, "../../../tests/fixtures/prusa/sample.gcode"), "utf8")

const INPUT: SliceInput = {
  meshStorageKey: "models/x",
  scaleFactor: 1.5,
  printerProfileId: "generic-fdm",
  materialId: "pla",
  qualityId: "standard",
  strengthId: "everyday",
}

function fakeRuntime(over: Partial<PrusaRuntime> = {}): PrusaRuntime {
  return {
    writeTempMesh: over.writeTempMesh ?? (async () => ({ inputPath: "/tmp/in.stl", outputPath: "/tmp/out.gcode" })),
    run: over.run ?? (async () => ok(undefined)),
    readGcode: over.readGcode ?? (async () => ok(SAMPLE)),
    cleanup: over.cleanup ?? (async () => undefined),
  }
}

async function seededStorage(): Promise<{ storage: InMemoryStorage; key: string }> {
  const storage = new InMemoryStorage()
  const put = await storage.put(new Uint8Array([1, 2, 3]), { keyPrefix: "models", mime: "model/stl" })
  if (!put.ok) throw new Error("seed failed")
  return { storage, key: put.value.storageKey }
}

function makeCli(storage: AssetStorage, runtime: PrusaRuntime): PrusaSlicerCli {
  return new PrusaSlicerCli({ storage, runtime, slicerPath: "prusa-slicer", profileDir: "profiles" })
}

describe("buildPrusaArgs", () => {
  it("loads the profile, sets scale + fill density, and exports gcode", () => {
    const args = buildPrusaArgs(INPUT, { profilePath: "p.ini", inputPath: "in.stl", outputPath: "out.gcode" })
    expect(args).toEqual([
      "--load", "p.ini",
      "--scale", "1.5",
      "--fill-density", "25%",
      "--support-material",
      "--export-gcode",
      "--output", "out.gcode",
      "in.stl",
    ])
  })

  it("falls back to 20% fill for an unknown strength", () => {
    const args = buildPrusaArgs({ ...INPUT, strengthId: "titanium" }, { profilePath: "p", inputPath: "i", outputPath: "o" })
    expect(args).toContain("20%")
  })
})

describe("parsePrintTimeMinutes", () => {
  it("sums hours, minutes and seconds (rounding up)", () => {
    expect(parsePrintTimeMinutes("1h 23m 45s")).toBe(84) // ceil(5025/60)
    expect(parsePrintTimeMinutes("23m 5s")).toBe(24)
    expect(parsePrintTimeMinutes("45s")).toBe(1)
    expect(parsePrintTimeMinutes("2h")).toBe(120)
  })
})

describe("parsePrusaSliceStats", () => {
  it("extracts duration, filament and supports from a real gcode header", () => {
    const stats = parsePrusaSliceStats(SAMPLE)
    expect(stats.ok).toBe(true)
    if (!stats.ok) return
    expect(stats.value.durationMinutes).toBe(84)
    expect(stats.value.materialGrams).toBe(12.34)
    expect(stats.value.materialMeters).toBeCloseTo(4.1235, 4)
    expect(stats.value.supportsUsed).toBe(true)
    expect(stats.value.slicerVersion).toBe("prusa-slicer/2.7.0")
  })

  it("reports no supports and unknown version when those comments are absent", () => {
    const gcode = "; estimated printing time (normal mode) = 10m\n; filament used [g] = 1.0\n; filament used [mm] = 300.0\n"
    const stats = parsePrusaSliceStats(gcode)
    expect(stats.ok).toBe(true)
    if (!stats.ok) return
    expect(stats.value.supportsUsed).toBe(false)
    expect(stats.value.slicerVersion).toBe("prusa-slicer/unknown")
  })

  it("fails when the stats comments are missing", () => {
    const r = parsePrusaSliceStats("; not a real gcode\n")
    expect(!r.ok && r.error.code).toBe("provider_error")
  })
})

slicerContract(async () => {
  const { storage, key } = await seededStorage()
  return { slicer: makeCli(storage, fakeRuntime()), meshStorageKey: key }
})

describe("PrusaSlicerCli.slice", () => {
  it("reads the mesh, runs the slicer, parses gcode and stores it", async () => {
    const { storage, key } = await seededStorage()
    const result = await makeCli(storage, fakeRuntime()).slice({ ...INPUT, meshStorageKey: key })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.materialGrams).toBe(12.34)
    expect(result.value.durationMinutes).toBe(84)
    expect(result.value.supportsUsed).toBe(true)
    expect(result.value.gcodeStorageKey.length).toBeGreaterThan(0)
    expect(result.value.profileVersion).toBe("1.0.0")
  })

  it("propagates a storage read error", async () => {
    const storage = new InMemoryStorage()
    const r = await makeCli(storage, fakeRuntime()).slice({ ...INPUT, meshStorageKey: "missing" })
    expect(!r.ok && r.error.code).toBe("not_found")
  })

  it("propagates a slicer run failure (and cleans up)", async () => {
    const { storage, key } = await seededStorage()
    let cleaned = false
    const runtime = fakeRuntime({
      run: async () => err(appError("provider_error", "boom")),
      cleanup: async () => {
        cleaned = true
      },
    })
    const r = await makeCli(storage, runtime).slice({ ...INPUT, meshStorageKey: key })
    expect(!r.ok && r.error.code).toBe("provider_error")
    expect(cleaned).toBe(true)
  })

  it("propagates a gcode read failure", async () => {
    const { storage, key } = await seededStorage()
    const runtime = fakeRuntime({ readGcode: async () => err(appError("provider_error", "no output")) })
    const r = await makeCli(storage, runtime).slice({ ...INPUT, meshStorageKey: key })
    expect(!r.ok && r.error.code).toBe("provider_error")
  })

  it("fails on an unparseable gcode", async () => {
    const { storage, key } = await seededStorage()
    const runtime = fakeRuntime({ readGcode: async () => ok("; garbage\n") })
    const r = await makeCli(storage, runtime).slice({ ...INPUT, meshStorageKey: key })
    expect(!r.ok && r.error.code).toBe("provider_error")
  })

  it("propagates a gcode storage write failure", async () => {
    const { storage, key } = await seededStorage()
    const failing: AssetStorage = {
      ingestFromUrl: storage.ingestFromUrl.bind(storage),
      getSignedUrl: storage.getSignedUrl.bind(storage),
      read: storage.read.bind(storage),
      put: async () => err(appError("provider_error", "disk full")),
    }
    const r = await makeCli(failing, fakeRuntime()).slice({ ...INPUT, meshStorageKey: key })
    expect(!r.ok && r.error.code).toBe("provider_error")
  })
})

// Real-binary integration — runs only when a PrusaSlicer binary is configured.
describe.skipIf(process.env["PRUSA_SLICER_PATH"] === undefined)("PrusaSlicerCli (real binary)", () => {
  it("slices a real mesh end to end", async () => {
    const { nodePrusaRuntime } = await import("@/src/adapters/slicer/nodeRuntime")
    const { storage, key } = await seededStorage()
    const cli = new PrusaSlicerCli({
      storage,
      runtime: nodePrusaRuntime,
      slicerPath: process.env["PRUSA_SLICER_PATH"] as string,
      profileDir: "src/config/slicerProfiles",
    })
    const result = await cli.slice({ ...INPUT, meshStorageKey: key })
    expect(result.ok).toBe(true)
  })
})
