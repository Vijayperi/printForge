import { describe, expect, it } from "vitest"

import type { AssetStorage } from "@/src/adapters/storage"
import {
  DEFAULT_PRINTER_PROFILE_ID,
  handleValidationRun,
  type ValidationDeps,
} from "@/src/jobs/handlers/validation"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { binaryStl, box } from "@/tests/helpers/geometry"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const CUBE_STL = binaryStl(box([10, 10, 10]))

function storageStub(bytes: Uint8Array = CUBE_STL, over: Partial<AssetStorage> = {}): AssetStorage {
  return {
    ingestFromUrl: async () => ok({ storageKey: "k", checksumSha256: "a", bytes: 0, mime: "x" }),
    put: async (_b, o) => ok({ storageKey: `${o.keyPrefix}/x`, checksumSha256: "a", bytes: 0, mime: o.mime }),
    getSignedUrl: async () => ok("signed://x"),
    read: over.read ?? (async () => ok(bytes)),
  }
}

function dvRow(over: Record<string, unknown> = {}) {
  return {
    id: "dv_1",
    project_id: "proj_1",
    source: "uploaded",
    version_no: 1,
    generation_status: "ready",
    glb_asset_id: "ast_glb",
    stl_asset_id: "ast_stl",
    thumbnail_asset_id: "ast_thumb",
    ...over,
  }
}

const stlAsset = { id: "ast_stl", type: "model_stl", storage_key: "models/dv_1/stl", checksum_sha256: "a", bytes: 84, mime: "model/stl" }

function makeDeps(opts: {
  dvRows?: Record<string, unknown>[]
  assetRows?: Record<string, unknown>[]
  reportRows?: Record<string, unknown>[]
  storage?: AssetStorage
}): { db: ReturnType<typeof createFakeDb>; deps: ValidationDeps } {
  const db = createFakeDb({
    design_versions: { rows: opts.dvRows ?? [dvRow()], unique: ["id"] },
    assets: { rows: opts.assetRows ?? [stlAsset], unique: ["id"] },
    validation_reports: { rows: opts.reportRows ?? [], unique: ["id"] },
  })
  return { db, deps: { db, storage: opts.storage ?? storageStub() } }
}

const payload = { designVersionId: "dv_1" }

describe("handleValidationRun — guards", () => {
  it("rejects an invalid payload", async () => {
    const { deps } = makeDeps({})
    const result = await handleValidationRun(deps, { nope: true })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("fails when the design version is missing", async () => {
    const { deps } = makeDeps({ dvRows: [] })
    const result = await handleValidationRun(deps, payload)
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("propagates a design-version read error", async () => {
    const { deps, db } = makeDeps({})
    db.failNext({ message: "read boom" })
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(false)
  })

  it("fails a precondition when the design version has no STL asset", async () => {
    const { deps } = makeDeps({ dvRows: [dvRow({ stl_asset_id: null })] })
    const result = await handleValidationRun(deps, payload)
    expect(!result.ok && result.error.code).toBe("precondition_failed")
  })

  it("fails when the STL asset row is missing", async () => {
    const { deps } = makeDeps({ assetRows: [] })
    const result = await handleValidationRun(deps, payload)
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("propagates an asset read error", async () => {
    const { deps, db } = makeDeps({})
    db.failCall(2, { message: "asset boom" }) // op1 = dv select, op2 = asset select
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(false)
  })

  it("propagates a storage read failure", async () => {
    const { deps } = makeDeps({ storage: storageStub(CUBE_STL, { read: async () => err(appError("not_found", "gone")) }) })
    const result = await handleValidationRun(deps, payload)
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("handleValidationRun — analysis + persistence", () => {
  it("persists a passing report with measurements for a clean cube", async () => {
    const { deps, db } = makeDeps({})
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(true)

    const report = db.rows("validation_reports")[0]!
    expect(report["status"]).toBe("pass")
    expect(report["design_version_id"]).toBe("dv_1")
    expect(report["printer_profile_id"]).toBe(DEFAULT_PRINTER_PROFILE_ID)
    expect(report["findings_json"]).toEqual([])
    expect((report["measurements_json"] as { volumeCm3: number }).volumeCm3).toBeCloseTo(1, 6)
  })

  it("persists a failing report for an unreadable STL (blocking empty_mesh)", async () => {
    const garbage = new Uint8Array([1, 2, 3])
    const { deps, db } = makeDeps({ storage: storageStub(garbage) })
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(true)
    const report = db.rows("validation_reports")[0]!
    expect(report["status"]).toBe("fail")
    expect((report["findings_json"] as { kind: string }[])[0]?.kind).toBe("empty_mesh")
    expect(report["measurements_json"]).toBeNull()
  })

  it("fails on a blocking self-intersection", async () => {
    const flat = [0, 0, 0, 10, 0, 0, 0, 10, 0]
    const upright = [2, 2, -5, 2, 2, 5, 8, 2, 0]
    const { deps, db } = makeDeps({ storage: storageStub(binaryStl([flat, upright])) })
    await handleValidationRun(deps, payload)
    const report = db.rows("validation_reports")[0]!
    expect(report["status"]).toBe("fail")
  })

  it("replaces an existing report on re-run (idempotent)", async () => {
    const { deps, db } = makeDeps({
      reportRows: [
        {
          id: "vr_old",
          design_version_id: "dv_1",
          printer_profile_id: DEFAULT_PRINTER_PROFILE_ID,
          scale_hash: "",
          status: "fail",
          findings_json: [{ kind: "empty_mesh" }],
          measurements_json: null,
        },
      ],
    })
    await handleValidationRun(deps, payload)
    const reports = db.rows("validation_reports")
    expect(reports).toHaveLength(1)
    expect(reports[0]!["id"]).toBe("vr_old")
    expect(reports[0]!["status"]).toBe("pass") // overwritten by the fresh clean analysis
  })

  it("propagates an upsert failure", async () => {
    const { deps, db } = makeDeps({})
    // op1 dv select, op2 asset select, op3 report lookup, op4 report insert
    db.failCall(4, { message: "insert boom" })
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(false)
  })
})
