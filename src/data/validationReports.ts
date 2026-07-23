import "server-only"

import { insertReturning, maybeOneWhere, selectWhere, updateReturning, type Db } from "@/src/data/db"
import type { Finding, Measurements, ValidationReportRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import { ok, type Result } from "@/src/lib/result"

const TABLE = "validation_reports"

/** The natural key of a report: one per (design version, profile, scale). */
export interface ReportKey {
  designVersionId: string
  printerProfileId: string
  scaleHash: string
}

export interface ReportContent {
  status: string
  findings: Finding[]
  measurements: Measurements | null
}

function keyFilters(key: ReportKey): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["design_version_id", key.designVersionId],
    ["printer_profile_id", key.printerProfileId],
    ["scale_hash", key.scaleHash],
  ]
}

export function findValidationReport(
  db: Db,
  key: ReportKey
): Promise<Result<ValidationReportRow | null>> {
  return maybeOneWhere<ValidationReportRow>(db, TABLE, keyFilters(key))
}

/** The most recent report for a design version (any profile/scale), or null. */
export async function getLatestValidationReport(
  db: Db,
  designVersionId: string
): Promise<Result<ValidationReportRow | null>> {
  const rows = await selectWhere<ValidationReportRow>(db, TABLE, [["design_version_id", designVersionId]], {
    orderBy: "created_at",
    ascending: false,
  })
  return rows.ok ? ok(rows.value[0] ?? null) : rows
}

/**
 * Persist the report for a natural key, replacing any existing one so a
 * re-validation (plan §6-S9: idempotent re-run) overwrites rather than
 * duplicates. Returns the persisted row.
 */
export async function upsertValidationReport(
  db: Db,
  key: ReportKey,
  content: ReportContent
): Promise<Result<ValidationReportRow>> {
  const values = {
    status: content.status,
    findings_json: content.findings,
    measurements_json: content.measurements,
  }

  const existing = await findValidationReport(db, key)
  if (!existing.ok) return existing
  if (existing.value !== null) {
    return updateReturning<ValidationReportRow>(db, TABLE, values, [["id", existing.value.id]])
  }
  return insertReturning<ValidationReportRow>(db, TABLE, {
    id: newId("vr"),
    design_version_id: key.designVersionId,
    printer_profile_id: key.printerProfileId,
    scale_hash: key.scaleHash,
    ...values,
  } as ValidationReportRow)
}
