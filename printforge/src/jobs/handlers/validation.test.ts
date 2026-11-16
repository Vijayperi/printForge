import { describe, expect, it } from "vitest"

import { DEFAULT_PRINTER_PROFILE_ID } from "@/src/config/profiles"
import type { AssetStorage } from "@/src/adapters/storage"
import { handleValidationRun, type ValidationDeps } from "@/src/jobs/handlers/validation"
import type { EnqueueInput, JobQueue } from "@/src/jobs/queue"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { binaryStl, box } from "@/tests/helpers/geometry"
import { cubeWithHole } from "@/tests/fixtures/models/generators"
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

function queueStub(over: Partial<JobQueue> = {}): { queue: JobQueue; enqueued: EnqueueInput[] } {
  const enqueued: EnqueueInput[] = []
  const queue: JobQueue = {
    enqueue:
      over.enqueue ??
      (async (input) => {
        enqueued.push(input)
        return ok({ jobId: "job_1", deduped: false })
      }),
    claimNext: async () => ok(null),
    complete: async () => ok(undefined),
    fail: async () => ok(undefined),
    heartbeat: async () => ok(undefined),
    reapStale: async () => ok(0),
  }
  return { queue, enqueued }
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
  queue?: JobQueue
}): { db: ReturnType<typeof createFakeDb>; deps: ValidationDeps } {
  const db = createFakeDb({
    design_versions: { rows: opts.dvRows ?? [dvRow()], unique: ["id"] },
    assets: { rows: opts.assetRows ?? [stlAsset], unique: ["id"] },
    validation_reports: { rows: opts.reportRows ?? [], unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
  return { db, deps: { db, storage: opts.storage ?? storageStub(), queue: opts.queue ?? queueStub().queue } }
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

describe("handleValidationRun — verdicts", () => {
  it("persists a passing report with measurements for a clean cube", async () => {
    const { deps, db } = makeDeps({})
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(true)

    const report = db.rows("validation_reports")[0]!
    expect(report["status"]).toBe("pass")
    expect(report["printer_profile_id"]).toBe(DEFAULT_PRINTER_PROFILE_ID)
    expect(report["findings_json"]).toEqual([])
    expect((report["measurements_json"] as { volumeCm3: number }).volumeCm3).toBeCloseTo(1, 6)
  })

  it("fails an unreadable STL (blocking empty_mesh, null measurements)", async () => {
    const { deps, db } = makeDeps({ storage: storageStub(new Uint8Array([1, 2, 3])) })
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
    expect(db.rows("validation_reports")[0]!["status"]).toBe("fail")
  })

  it("manual-reviews a holed cube: flags an audit event and enqueues ops notification", async () => {
    const { queue, enqueued } = queueStub()
    const { deps, db } = makeDeps({ storage: storageStub(binaryStl(cubeWithHole())), queue })
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(true)

    const report = db.rows("validation_reports")[0]!
    expect(report["status"]).toBe("manual_review")
    expect((report["findings_json"] as { kind: string }[]).map((f) => f.kind)).toContain("boundary_holes")

    const audit = db.rows("audit_events")
    expect(audit).toHaveLength(1)
    expect(audit[0]!["action"]).toBe("manual_review_flagged")
    expect(audit[0]!["entity_type"]).toBe("validation_report")

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.type).toBe("notification.send")
    expect(enqueued[0]!.idempotencyKey).toBe(`ops_manual_review:${report["id"]}`)
  })

  it("propagates an audit-flag failure on manual_review", async () => {
    const { deps, db } = makeDeps({ storage: storageStub(binaryStl(cubeWithHole())) })
    // op1 dv, op2 asset, op3 report lookup, op4 report insert, op5 audit insert
    db.failCall(5, { message: "audit boom" })
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(false)
  })

  it("propagates an ops-notification enqueue failure on manual_review", async () => {
    const queue = queueStub({ enqueue: async () => err(appError("internal", "enqueue boom")) }).queue
    const { deps } = makeDeps({ storage: storageStub(binaryStl(cubeWithHole())), queue })
    const result = await handleValidationRun(deps, payload)
    expect(!result.ok && result.error.code).toBe("internal")
  })

  it("threads scaleFactor + scaleHash + profile + material from the payload (S11)", async () => {
    const { deps, db } = makeDeps({})
    // A 10 mm cube scaled ×30 → 300 mm exceeds the 220×220×250 build volume → fail.
    const result = await handleValidationRun(deps, {
      designVersionId: "dv_1",
      scaleFactor: 30,
      scaleHash: "s30",
      printerProfileId: "generic-fdm",
      materialId: "petg",
    })
    expect(result.ok).toBe(true)

    const report = db.rows("validation_reports")[0]!
    expect(report["scale_hash"]).toBe("s30")
    expect(report["printer_profile_id"]).toBe("generic-fdm")
    expect(report["status"]).toBe("fail")
    expect((report["findings_json"] as { kind: string }[]).map((f) => f.kind)).toContain(
      "exceeds_build_volume"
    )
  })

  it("keys a re-validation at a new scale as a separate report (does not overwrite scale-1)", async () => {
    const { deps, db } = makeDeps({
      reportRows: [
        {
          id: "vr_base",
          design_version_id: "dv_1",
          printer_profile_id: DEFAULT_PRINTER_PROFILE_ID,
          scale_hash: "",
          status: "pass",
          findings_json: [],
          measurements_json: { boundingMm: { x: 10, y: 10, z: 10 } },
        },
      ],
    })
    await handleValidationRun(deps, { designVersionId: "dv_1", scaleFactor: 1.5, scaleHash: "s1.5" })
    const reports = db.rows("validation_reports")
    expect(reports).toHaveLength(2)
    expect(reports.map((r) => r["scale_hash"]).sort()).toEqual(["", "s1.5"])
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
    expect(reports[0]!["status"]).toBe("pass")
  })

  it("propagates an upsert failure", async () => {
    const { deps, db } = makeDeps({})
    db.failCall(4, { message: "insert boom" }) // op4 = report insert
    const result = await handleValidationRun(deps, payload)
    expect(result.ok).toBe(false)
  })
})
