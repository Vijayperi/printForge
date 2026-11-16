import { describe, expect, it } from "vitest"

import {
  findValidationReport,
  getLatestValidationReport,
  upsertValidationReport,
  type ReportKey,
} from "@/src/data/validationReports"
import type { Finding, Measurements } from "@/src/domain/types"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const KEY: ReportKey = { designVersionId: "dv_1", printerProfileId: "prof_generic", scaleHash: "" }

const MEASUREMENTS: Measurements = {
  boundingMm: { x: 10, y: 10, z: 10 },
  volumeCm3: 1,
  surfaceAreaCm2: 6,
  triangleCount: 12,
  componentCount: 1,
  smallestComponentVolumeFraction: 1,
}

const FINDINGS: Finding[] = [{ kind: "boundary_holes", severity: "warning", detail: "x", count: 4 }]

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ validation_reports: { rows, unique: ["id"] } })
}

describe("findValidationReport", () => {
  it("returns the report matching the natural key", async () => {
    const fake = db([
      { id: "vr_1", design_version_id: "dv_1", printer_profile_id: "prof_generic", scale_hash: "" },
      { id: "vr_2", design_version_id: "dv_1", printer_profile_id: "prof_other", scale_hash: "" },
    ])
    const result = await findValidationReport(fake, KEY)
    expect(result.ok && result.value?.id).toBe("vr_1")
  })

  it("returns null when no report matches", async () => {
    const result = await findValidationReport(db(), KEY)
    expect(result.ok && result.value).toBeNull()
  })
})

describe("getLatestValidationReport", () => {
  it("returns the newest report for a design version", async () => {
    const fake = db([
      { id: "vr_old", design_version_id: "dv_1", created_at: "2026-01-01" },
      { id: "vr_new", design_version_id: "dv_1", created_at: "2026-02-01" },
      { id: "vr_other", design_version_id: "dv_2", created_at: "2026-03-01" },
    ])
    const result = await getLatestValidationReport(fake, "dv_1")
    expect(result.ok && result.value?.id).toBe("vr_new")
  })

  it("returns null when a design version has no reports", async () => {
    const result = await getLatestValidationReport(db(), "dv_x")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("upsertValidationReport", () => {
  it("inserts a new report with a vr_ id when none exists", async () => {
    const fake = db()
    const result = await upsertValidationReport(fake, KEY, {
      status: "warning",
      findings: FINDINGS,
      measurements: MEASUREMENTS,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("vr", result.value.id)).toBe(true)
      expect(result.value.design_version_id).toBe("dv_1")
      expect(result.value.scale_hash).toBe("")
      expect(result.value.status).toBe("warning")
      expect(result.value.findings_json).toEqual(FINDINGS)
      expect(result.value.measurements_json).toEqual(MEASUREMENTS)
    }
  })

  it("replaces an existing report for the same key (idempotent re-run)", async () => {
    const fake = db([
      {
        id: "vr_existing",
        design_version_id: "dv_1",
        printer_profile_id: "prof_generic",
        scale_hash: "",
        status: "pass",
        findings_json: [],
        measurements_json: null,
      },
    ])
    const result = await upsertValidationReport(fake, KEY, {
      status: "fail",
      findings: FINDINGS,
      measurements: MEASUREMENTS,
    })
    expect(result.ok && result.value.id).toBe("vr_existing") // same row, replaced
    expect(result.ok && result.value.status).toBe("fail")
    expect(result.ok && result.value.findings_json).toEqual(FINDINGS)
  })

  it("propagates a lookup failure", async () => {
    const fake = db()
    fake.failNext({ message: "boom", code: "internal" })
    const result = await upsertValidationReport(fake, KEY, {
      status: "pass",
      findings: [],
      measurements: null,
    })
    expect(result.ok).toBe(false)
  })
})
