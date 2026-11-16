import "server-only"

import { z } from "zod"

import { getMaterialProfile, getPrinterProfile } from "@/src/config/profiles"
import type { AssetStorage } from "@/src/adapters/storage"
import { getAsset } from "@/src/data/assets"
import { insertAuditEvent } from "@/src/data/auditEvents"
import type { Db } from "@/src/data/db"
import { getDesignVersion } from "@/src/data/designVersions"
import { upsertValidationReport, type ReportKey } from "@/src/data/validationReports"
import { analyzeGeometry } from "@/src/domain/geometry/analyze"
import { buildIndexedMesh } from "@/src/domain/geometry/mesh"
import { analyzeOverhang } from "@/src/domain/geometry/overhang"
import { parseStl } from "@/src/domain/geometry/stlParse"
import { buildReport } from "@/src/domain/printability/report"
import type { Finding, Measurements, Verdict } from "@/src/domain/types"
import type { JobQueue } from "@/src/jobs/queue"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface ValidationDeps {
  db: Db
  storage: AssetStorage
  queue: JobQueue
}

/**
 * S11 threads the configured scale + profile/material from the Configure route so
 * the report re-evaluates size/wall constraints at the chosen scale. The
 * generation/upload paths omit them, so the defaults reproduce the S9/S10
 * behaviour: scale 1, empty scale hash, default printer + material.
 */
const payloadSchema = z.object({
  designVersionId: z.string().min(1),
  scaleFactor: z.number().positive().optional(),
  scaleHash: z.string().optional(),
  printerProfileId: z.string().optional(),
  materialId: z.string().optional(),
})

/**
 * validation.run (plan §6-S9 step 4 + §6-S10 step 3): load the design version's
 * STL from storage, run the geometry + overhang analysis, map it to a
 * customer-facing verdict against the default printer/material profile, and
 * persist findings + measurements on `validation_reports`. Idempotent — a re-run
 * replaces the report for the same (design version, profile, scale).
 *
 * A `manual_review` verdict additionally records an `audit_events` flag and
 * enqueues an `ops_manual_review` notification. The verdict string is itself a
 * terminal `ValidationState`, so it is persisted directly (a fresh report is an
 * initial-state assignment); `validationMachine` governs the later
 * REVALIDATE / OPERATOR_* transitions.
 */
export async function handleValidationRun(
  deps: ValidationDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = payloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return { ok: false, error: appError("validation", "invalid validation.run payload") }
  }
  const dvId = parsed.data.designVersionId
  const scaleFactor = parsed.data.scaleFactor ?? 1
  const profile = getPrinterProfile(parsed.data.printerProfileId)
  const material = getMaterialProfile(parsed.data.materialId)
  const scaleHash = parsed.data.scaleHash ?? ""

  const dvResult = await getDesignVersion(deps.db, dvId)
  if (!dvResult.ok) return dvResult
  if (dvResult.value === null) {
    return { ok: false, error: appError("not_found", `design version ${dvId} not found`) }
  }
  const stlAssetId = dvResult.value.stl_asset_id
  if (stlAssetId === null) {
    return { ok: false, error: appError("precondition_failed", `design version ${dvId} has no STL asset`) }
  }

  const assetResult = await getAsset(deps.db, stlAssetId)
  if (!assetResult.ok) return assetResult
  if (assetResult.value === null) {
    return { ok: false, error: appError("not_found", `STL asset ${stlAssetId} not found`) }
  }

  const bytes = await deps.storage.read(assetResult.value.storage_key)
  if (!bytes.ok) return bytes

  const analysis = analyze(bytes.value)
  const { verdict, findings } =
    analysis.measurements === null
      ? { verdict: "fail" as Verdict, findings: analysis.findings }
      : buildReport(analysis.findings, analysis.measurements, profile, material, scaleFactor)

  const key: ReportKey = {
    designVersionId: dvId,
    printerProfileId: profile.id,
    scaleHash,
  }
  const persisted = await upsertValidationReport(deps.db, key, {
    status: verdict,
    findings,
    measurements: analysis.measurements,
  })
  if (!persisted.ok) return persisted

  if (verdict === "manual_review") {
    return flagForReview(deps, dvId, persisted.value.id)
  }
  return ok(undefined)
}

/** Record the ops review flag + enqueue the ops notification for a manual review. */
async function flagForReview(deps: ValidationDeps, dvId: string, reportId: string): Promise<Result<void>> {
  const audit = await insertAuditEvent(deps.db, {
    actorKind: "system",
    entityType: "validation_report",
    entityId: reportId,
    action: "manual_review_flagged",
    metadata: { designVersionId: dvId },
  })
  if (!audit.ok) return audit

  const notify = await deps.queue.enqueue({
    type: "notification.send",
    payload: { template: "ops_manual_review", validationReportId: reportId, designVersionId: dvId },
    idempotencyKey: `ops_manual_review:${reportId}`,
  })
  return notify.ok ? ok(undefined) : notify
}

/** Parse + analyze the STL (geometry validity + overhang), unreadable → empty. */
function analyze(bytes: Uint8Array): { findings: Finding[]; measurements: Measurements | null } {
  const parsed = parseStl(bytes)
  if (!parsed.ok) {
    return {
      findings: [
        { kind: "empty_mesh", severity: "blocking", detail: `unreadable STL (${parsed.error.kind})` },
      ],
      measurements: null,
    }
  }
  const geometry = analyzeGeometry(parsed.value)
  const overhang = analyzeOverhang(buildIndexedMesh(parsed.value))
  return { findings: [...geometry.findings, ...overhang], measurements: geometry.measurements }
}
