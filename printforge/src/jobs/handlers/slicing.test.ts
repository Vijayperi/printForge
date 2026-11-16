import { describe, expect, it } from "vitest"

import type { SliceResult, Slicer } from "@/src/adapters/slicer"
import { pricingRules } from "@/src/config/pricingRules"
import { price } from "@/src/domain/pricing/engine"
import { handleSlicingRun, type SlicingDeps } from "@/src/jobs/handlers/slicing"
import { FixedClock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const NOW = new Date("2026-07-24T00:00:00.000Z")
const CONFIG_HASH = "1|pla|standard|everyday|standard"

const SLICE: SliceResult = {
  durationMinutes: 60,
  materialGrams: 20,
  materialMeters: 6.71,
  supportsUsed: false,
  gcodeStorageKey: "gcode/x",
  slicerVersion: "mock-slicer/1.0.0",
  profileVersion: "1.0.0",
  orientation: { rx: 0, ry: 0, rz: 0 },
}

function slicerStub(over: Partial<Slicer> = {}): Slicer {
  return { slice: over.slice ?? (async () => ok(SLICE)) }
}

function configRow(over: Record<string, unknown> = {}) {
  return {
    id: "cfg_1",
    design_version_id: "dv_1",
    material_id: "pla",
    color_id: "pla-white",
    dimensions_mm: { x: 10, y: 10, z: 10 },
    scale_factor: 1,
    quality_id: "standard",
    strength_id: "everyday",
    shipping_speed: "standard",
    special_instructions: "",
    created_at: "2026-01-01",
    ...over,
  }
}

const reportRow = { id: "vr_1", design_version_id: "dv_1", status: "pass", measurements_json: { volumeCm3: 1 }, created_at: "2026-01-02" }
const dvRow = { id: "dv_1", project_id: "proj_1", generation_status: "ready", stl_asset_id: "ast_stl" }
const assetRow = { id: "ast_stl", type: "model_stl", storage_key: "models/dv_1/stl" }

function makeDeps(opts: {
  configRows?: Record<string, unknown>[]
  quoteRows?: Record<string, unknown>[]
  reportRows?: Record<string, unknown>[]
  dvRows?: Record<string, unknown>[]
  assetRows?: Record<string, unknown>[]
  slicer?: Slicer
}): { db: ReturnType<typeof createFakeDb>; deps: SlicingDeps } {
  const db = createFakeDb({
    print_configurations: { rows: opts.configRows ?? [configRow()], unique: ["id"] },
    quotes: { rows: opts.quoteRows ?? [], unique: ["id"] },
    validation_reports: { rows: opts.reportRows ?? [reportRow], unique: ["id"] },
    design_versions: { rows: opts.dvRows ?? [dvRow], unique: ["id"] },
    assets: { rows: opts.assetRows ?? [assetRow], unique: ["id"] },
  })
  return { db, deps: { db, slicer: opts.slicer ?? slicerStub(), clock: new FixedClock(NOW) } }
}

const payload = { designVersionId: "dv_1", configHash: CONFIG_HASH }

describe("handleSlicingRun — guards & no-ops", () => {
  it("rejects an invalid payload", async () => {
    const { deps } = makeDeps({})
    const r = await handleSlicingRun(deps, { nope: true })
    expect(!r.ok && r.error.code).toBe("validation")
  })

  it("fails a precondition when there is no configuration", async () => {
    const { deps } = makeDeps({ configRows: [] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("precondition_failed")
  })

  it("is a no-op when the config changed since enqueue (hash mismatch)", async () => {
    const { deps, db } = makeDeps({})
    const r = await handleSlicingRun(deps, { designVersionId: "dv_1", configHash: "stale" })
    expect(r.ok).toBe(true)
    expect(db.rows("quotes")).toHaveLength(0)
  })

  it("is a no-op when an active quote already exists for the hash", async () => {
    const { deps, db } = makeDeps({
      quoteRows: [{ id: "qt_1", configuration_id: "cfg_1", config_hash: CONFIG_HASH, status: "active", created_at: "1" }],
    })
    const r = await handleSlicingRun(deps, payload)
    expect(r.ok).toBe(true)
    expect(db.rows("quotes")).toHaveLength(1)
  })

  it("fails a precondition when the verdict is not printable", async () => {
    const { deps } = makeDeps({ reportRows: [{ ...reportRow, status: "fail" }] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("precondition_failed")
  })

  it("fails a precondition when there is no validation report", async () => {
    const { deps } = makeDeps({ reportRows: [] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("precondition_failed")
  })

  it("fails a precondition when the design version has no STL asset", async () => {
    const { deps } = makeDeps({ dvRows: [{ ...dvRow, stl_asset_id: null }] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("precondition_failed")
  })

  it("fails when the design version is missing", async () => {
    const { deps } = makeDeps({ dvRows: [] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("not_found")
  })

  it("fails when the STL asset row is missing", async () => {
    const { deps } = makeDeps({ assetRows: [] })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("not_found")
  })

  it("propagates a slicer error", async () => {
    const { deps } = makeDeps({ slicer: slicerStub({ slice: async () => err(appError("provider_error", "slicer boom")) }) })
    const r = await handleSlicingRun(deps, payload)
    expect(!r.ok && r.error.code).toBe("provider_error")
  })
})

describe("handleSlicingRun — quote creation", () => {
  it("slices, prices and creates a fresh 24h quote", async () => {
    const { deps, db } = makeDeps({})
    const r = await handleSlicingRun(deps, payload)
    expect(r.ok).toBe(true)

    const quotes = db.rows("quotes")
    expect(quotes).toHaveLength(1)
    const quote = quotes[0]!
    const expected = price(SLICE, { materialId: "pla", shippingSpeed: "standard" }, pricingRules)
    expect(quote["amount_minor"]).toBe(expected.total.amountMinor)
    expect(quote["breakdown_json"]).toEqual(expected.lines)
    expect(quote["config_hash"]).toBe(CONFIG_HASH)
    expect(quote["status"]).toBe("active")
    expect((quote["slice_json"] as SliceResult).materialGrams).toBe(20)
    expect(quote["expires_at"]).toBe("2026-07-25T00:00:00.000Z") // now + 24h
  })

  it("supersedes a stale active quote for the same configuration", async () => {
    const { deps, db } = makeDeps({
      quoteRows: [{ id: "qt_old", configuration_id: "cfg_1", config_hash: "0.5|pla|standard|everyday|standard", status: "active", created_at: "1" }],
    })
    const r = await handleSlicingRun(deps, payload)
    expect(r.ok).toBe(true)

    const quotes = db.rows("quotes")
    expect(quotes).toHaveLength(2)
    expect(quotes.find((q) => q["id"] === "qt_old")!["status"]).toBe("superseded")
    expect(quotes.find((q) => q["config_hash"] === CONFIG_HASH)!["status"]).toBe("active")
  })

  it("leaves already-terminal quotes untouched when superseding", async () => {
    const { deps, db } = makeDeps({
      quoteRows: [{ id: "qt_expired", configuration_id: "cfg_1", config_hash: "old", status: "expired", created_at: "1" }],
    })
    const r = await handleSlicingRun(deps, payload)
    expect(r.ok).toBe(true)
    expect(db.rows("quotes").find((q) => q["id"] === "qt_expired")!["status"]).toBe("expired")
  })
})

describe("handleSlicingRun — error propagation", () => {
  const at = (n: number, seed: Parameters<typeof makeDeps>[0] = {}) => async () => {
    const { deps, db } = makeDeps(seed)
    db.failCall(n, { message: `boom ${n}` })
    return handleSlicingRun(deps, payload)
  }

  it("propagates a config read error", async () => {
    const { deps, db } = makeDeps({})
    db.failNext({ message: "config boom" })
    expect((await handleSlicingRun(deps, payload)).ok).toBe(false)
  })
  it("propagates a quote-lookup error", async () => expect((await at(2)()).ok).toBe(false))
  it("propagates a report read error", async () => expect((await at(3)()).ok).toBe(false))
  it("propagates a design-version read error", async () => expect((await at(4)()).ok).toBe(false))
  it("propagates an asset read error", async () => expect((await at(5)()).ok).toBe(false))
  it("propagates a supersede-list error", async () => expect((await at(6)()).ok).toBe(false))
  it("propagates an insert error", async () => expect((await at(7)()).ok).toBe(false))
  it("propagates a supersede-update error", async () => {
    const run = at(7, {
      quoteRows: [{ id: "qt_old", configuration_id: "cfg_1", config_hash: "other", status: "active", created_at: "1" }],
    })
    expect((await run()).ok).toBe(false)
  })
})
