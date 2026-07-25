import { describe, expect, it } from "vitest"

import {
  activePrintJob,
  assertCanAssignPrinter,
  assertCanCreatePrintJob,
  assignPrinterSchema,
  createPrintJobSchema,
  MAX_PRINT_ATTEMPTS,
  nextAttemptNumber,
  printJobActionSchema,
  qcPrintJob,
  qcRequestSchema,
  RELEASE_DISABLED_REASON,
  retryPrintJob,
  shipmentRequestSchema,
} from "@/src/domain/ops/production"
import type { PrintJobRow } from "@/src/domain/types"

function job(overrides: Partial<PrintJobRow> = {}): PrintJobRow {
  return {
    id: "pj_1",
    order_id: "ord_1",
    printer_id: null,
    status: "pending",
    gcode_asset_id: null,
    slice_json: null,
    gateway_job_ref: null,
    failure_reason: null,
    attempt: 1,
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
    ...overrides,
  }
}

describe("activePrintJob", () => {
  it("returns null when there are no jobs at all", () => {
    expect(activePrintJob([])).toBeNull()
  })

  it.each([
    ["pending", true],
    ["released", true],
    ["printing", true],
    ["completed", false],
    ["failed", false],
    ["cancelled", false],
  ])("%s job is active: %s", (status, active) => {
    expect(activePrintJob([job({ status })])).toEqual(active ? job({ status }) : null)
  })

  it("picks the active job out of a history of finished ones", () => {
    const jobs = [job({ id: "pj_3", status: "cancelled" }), job({ id: "pj_2", status: "printing" })]
    expect(activePrintJob(jobs)?.id).toBe("pj_2")
  })
})

describe("assertCanCreatePrintJob", () => {
  const paid = { status: "production_queued", payment_status: "paid" }

  it("allows a paid, approved order with no active job", () => {
    expect(assertCanCreatePrintJob(paid, [job({ status: "cancelled" })])).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it("refuses an unpaid order", () => {
    const result = assertCanCreatePrintJob({ ...paid, payment_status: "unpaid" }, [])
    expect(result).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    if (!result.ok) expect(result.error.message).toMatch(/not been paid/)
  })

  it("allows a partially refunded order — the money question is a separate axis", () => {
    expect(assertCanCreatePrintJob({ ...paid, payment_status: "partially_refunded" }, []).ok).toBe(
      true
    )
  })

  it("refuses an order that is not queued for production", () => {
    const result = assertCanCreatePrintJob({ ...paid, status: "design_review" }, [])
    expect(result).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    if (!result.ok) expect(result.error.message).toMatch(/design_review/)
  })

  it("refuses a second job while one is still active", () => {
    const result = assertCanCreatePrintJob(paid, [job({ id: "pj_9", status: "printing" })])
    expect(result).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    if (!result.ok) expect(result.error.message).toMatch(/pj_9/)
  })

  it("allows the reprint that lands exactly on the cap", () => {
    const spent = job({ status: "completed", attempt: MAX_PRINT_ATTEMPTS - 1 })
    expect(assertCanCreatePrintJob(paid, [spent]).ok).toBe(true)
  })

  it("refuses a reprint once the order has spent every attempt", () => {
    const spent = job({ status: "failed", attempt: MAX_PRINT_ATTEMPTS })
    const result = assertCanCreatePrintJob(paid, [spent])
    expect(result).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    if (!result.ok) expect(result.error.message).toMatch(/escalate instead of reprinting/)
  })
})

describe("nextAttemptNumber", () => {
  it("starts at 1 for an order that has never been printed", () => {
    expect(nextAttemptNumber([])).toBe(1)
  })

  it("counts from the highest attempt spent so far", () => {
    expect(nextAttemptNumber([job({ attempt: 1 }), job({ attempt: 2, status: "failed" })])).toBe(3)
  })

  it("ignores cancelled jobs — a job that never printed costs nothing", () => {
    expect(nextAttemptNumber([job({ attempt: 3, status: "cancelled" })])).toBe(1)
    expect(
      nextAttemptNumber([job({ attempt: 1, status: "failed" }), job({ attempt: 2, status: "cancelled" })])
    ).toBe(2)
  })
})

describe("assertCanAssignPrinter", () => {
  it("allows assigning a pending job", () => {
    expect(assertCanAssignPrinter({ status: "pending" }).ok).toBe(true)
  })

  it.each(["released", "printing", "completed", "failed", "cancelled"])("refuses a %s job", (s) => {
    expect(assertCanAssignPrinter({ status: s })).toMatchObject({
      ok: false,
      error: { code: "precondition_failed" },
    })
  })
})

describe("retryPrintJob", () => {
  it("moves a failed job back to pending and counts the attempt", () => {
    expect(retryPrintJob({ status: "failed", attempt: 1 })).toEqual({
      ok: true,
      value: { status: "pending", attempt: 2 },
    })
  })

  it("allows the last attempt permitted by the cap", () => {
    expect(retryPrintJob({ status: "failed", attempt: MAX_PRINT_ATTEMPTS - 1 })).toEqual({
      ok: true,
      value: { status: "pending", attempt: MAX_PRINT_ATTEMPTS },
    })
  })

  it("refuses to retry past the attempt cap", () => {
    const result = retryPrintJob({ status: "failed", attempt: MAX_PRINT_ATTEMPTS })
    expect(result).toMatchObject({ ok: false, error: { code: "precondition_failed" } })
    if (!result.ok) expect(result.error.message).toMatch(/escalate/)
  })

  it.each(["pending", "released", "printing", "completed", "cancelled"])(
    "refuses to retry a %s job",
    (status) => {
      expect(retryPrintJob({ status, attempt: 1 })).toMatchObject({
        ok: false,
        error: { code: "conflict" },
      })
    }
  )
})

describe("qcPrintJob", () => {
  it("a pass leaves the order in quality_check and asks for a shipment", () => {
    expect(qcPrintJob("pass", "quality_check", "completed")).toEqual({
      ok: true,
      value: { orderStatus: "quality_check", awaitingShipment: true },
    })
  })

  it("a fail sends the order back to the production queue", () => {
    expect(qcPrintJob("fail", "quality_check", "completed")).toEqual({
      ok: true,
      value: { orderStatus: "production_queued", awaitingShipment: false },
    })
  })

  it.each(["pending", "released", "printing", "failed", "cancelled"])(
    "refuses to check a %s job",
    (jobStatus) => {
      expect(qcPrintJob("pass", "quality_check", jobStatus)).toMatchObject({
        ok: false,
        error: { code: "precondition_failed" },
      })
    }
  )

  it.each(["paid", "production_queued", "printing", "shipped", "cancelled"])(
    "refuses when the order is %s rather than in quality check",
    (orderStatus) => {
      expect(qcPrintJob("fail", orderStatus, "completed")).toMatchObject({
        ok: false,
        error: { code: "conflict" },
      })
    }
  )
})

describe("request schemas", () => {
  it.each([
    ["print job action", printJobActionSchema, { reason: "  scrapped  " }, { reason: "scrapped" }],
    ["create", createPrintJobSchema, { reason: "queued" }, { reason: "queued" }],
    [
      "assign",
      assignPrinterSchema,
      { printerId: " prn_1 ", reason: "free bed" },
      { printerId: "prn_1", reason: "free bed" },
    ],
    [
      "qc",
      qcRequestSchema,
      { outcome: "fail", reason: "layer shift" },
      { outcome: "fail", reason: "layer shift" },
    ],
    [
      "shipment",
      shipmentRequestSchema,
      { carrier: "delhivery", trackingNumber: " ABC-123 " },
      { carrier: "delhivery", trackingNumber: "ABC-123" },
    ],
  ])("%s accepts and trims a valid body", (_name, schema, input, expected) => {
    expect(schema.parse(input)).toEqual(expected)
  })

  it.each([
    ["a blank reason", printJobActionSchema, { reason: "   " }],
    ["an over-long reason", printJobActionSchema, { reason: "x".repeat(501) }],
    ["an extra key", printJobActionSchema, { reason: "ok", force: true }],
    ["a missing printer", assignPrinterSchema, { printerId: " ", reason: "ok" }],
    ["an unknown qc outcome", qcRequestSchema, { outcome: "maybe", reason: "ok" }],
    ["an unknown carrier", shipmentRequestSchema, { carrier: "fedex", trackingNumber: "ABC123" }],
    ["a short tracking number", shipmentRequestSchema, { carrier: "dtdc", trackingNumber: "AB" }],
    [
      "a tracking number with spaces inside",
      shipmentRequestSchema,
      { carrier: "dtdc", trackingNumber: "AB 123456" },
    ],
    [
      "an over-long tracking number",
      shipmentRequestSchema,
      { carrier: "dtdc", trackingNumber: "A".repeat(65) },
    ],
  ])("rejects %s", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })
})

describe("RELEASE_DISABLED_REASON", () => {
  it("explains that release is not built yet rather than blaming a precondition", () => {
    expect(RELEASE_DISABLED_REASON).toMatch(/printer gateway/i)
  })
})
