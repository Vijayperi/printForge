import "server-only"

import { z } from "zod"

import type { AssetStorage } from "@/src/adapters/storage"
import { getAsset } from "@/src/data/assets"
import type { Db } from "@/src/data/db"
import { getDesignVersion } from "@/src/data/designVersions"
import { upsertValidationReport, type ReportKey } from "@/src/data/validationReports"
import { analyzeGeometry } from "@/src/domain/geometry/analyze"
import { parseStl } from "@/src/domain/geometry/stlParse"
import type { ValidationState } from "@/src/domain/stateMachines/validation"
import type { Finding, Measurements } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface ValidationDeps {
  db: Db
  storage: AssetStorage
}

/**
 * Placeholder printer profile for S9. S10 introduces real `PrinterProfile`s in
 * `src/config/profiles.ts` and threads the selected profile id + scale through
 * the payload; until then every report is keyed to this generic profile at
 * scale 1 (empty scale hash).
 */
export const DEFAULT_PRINTER_PROFILE_ID = "generic-fdm"

const payloadSchema = z.object({ designVersionId: z.string().min(1) })

/**
 * validation.run (plan §6-S9 step 4): load the design version's STL from
 * storage, parse + analyze its geometry, and persist findings + measurements on
 * `validation_reports`. Idempotent — a re-run replaces the report for the same
 * (design version, profile, scale).
 *
 * S9 interim verdict maps only pass/fail on blocking findings; the full
 * pass/warning/manual_review/fail mapping against printer/material profiles
 * arrives in S10 and will route the terminal status through `validationMachine`.
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

  const { findings, measurements } = analyze(bytes.value)
  const key: ReportKey = {
    designVersionId: dvId,
    printerProfileId: DEFAULT_PRINTER_PROFILE_ID,
    scaleHash: "",
  }
  const persisted = await upsertValidationReport(deps.db, key, {
    status: interimStatus(findings),
    findings,
    measurements,
  })
  return persisted.ok ? ok(undefined) : persisted
}

/** Parse + analyze the STL, treating an unreadable file as an empty mesh. */
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
  return analyzeGeometry(parsed.value)
}

/**
 * S9 interim: pass unless a blocking finding is present (then fail). This is a
 * fresh terminal report (initial state assignment, not a transition), so it is
 * set directly; S10 replaces this with the full verdict mapping routed through
 * `validationMachine`.
 */
function interimStatus(findings: Finding[]): ValidationState {
  return findings.some((f) => f.severity === "blocking") ? "fail" : "pass"
}
