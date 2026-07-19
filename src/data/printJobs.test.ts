import { describe, expect, it } from "vitest"

import {
  assignPrinter,
  getPrintJob,
  insertPrintJob,
  listPrintJobsByOrder,
  updatePrintJobStatus,
} from "@/src/data/printJobs"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ print_jobs: { rows, unique: ["id"] } })
}

describe("insertPrintJob", () => {
  it("inserts with defaults and a pj_ id", async () => {
    const fake = db()
    const result = await insertPrintJob(fake, { orderId: "ord_1" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("pj", result.value.id)).toBe(true)
      expect(result.value.order_id).toBe("ord_1")
      expect(result.value.printer_id).toBeNull()
      expect(result.value.status).toBe("pending")
      expect(result.value.gcode_asset_id).toBeNull()
    }
  })

  it("honors provided printer, status, and gcode asset", async () => {
    const fake = db()
    const result = await insertPrintJob(fake, {
      orderId: "ord_1",
      printerId: "prn_1",
      status: "released",
      gcodeAssetId: "ast_1",
    })
    expect(result.ok && result.value.printer_id).toBe("prn_1")
    expect(result.ok && result.value.status).toBe("released")
    expect(result.ok && result.value.gcode_asset_id).toBe("ast_1")
  })
})

describe("getPrintJob", () => {
  it("returns the job or null", async () => {
    const fake = db([{ id: "pj_1", order_id: "ord_1", status: "pending" }])
    expect((await getPrintJob(fake, "pj_1")).ok).toBe(true)
    const missing = await getPrintJob(fake, "pj_x")
    expect(missing.ok && missing.value).toBeNull()
  })
})

describe("listPrintJobsByOrder", () => {
  it("lists an order's jobs newest first", async () => {
    const fake = db([
      { id: "pj_1", order_id: "ord_1", status: "pending", created_at: "2026-01-01" },
      { id: "pj_2", order_id: "ord_1", status: "failed", created_at: "2026-01-02" },
      { id: "pj_3", order_id: "ord_2", status: "pending", created_at: "2026-01-03" },
    ])
    const result = await listPrintJobsByOrder(fake, "ord_1")
    expect(result.ok && result.value.map((j) => j.id)).toEqual(["pj_2", "pj_1"])
  })
})

describe("updatePrintJobStatus", () => {
  it("updates status only", async () => {
    const fake = db([{ id: "pj_1", order_id: "ord_1", status: "released" }])
    const result = await updatePrintJobStatus(fake, "pj_1", "printing")
    expect(result.ok && result.value.status).toBe("printing")
  })

  it("updates status and failure reason", async () => {
    const fake = db([{ id: "pj_1", order_id: "ord_1", status: "printing", failure_reason: null }])
    const result = await updatePrintJobStatus(fake, "pj_1", "failed", { failureReason: "nozzle jam" })
    expect(result.ok && result.value.status).toBe("failed")
    expect(result.ok && result.value.failure_reason).toBe("nozzle jam")
  })
})

describe("assignPrinter", () => {
  it("sets the printer id", async () => {
    const fake = db([{ id: "pj_1", order_id: "ord_1", status: "pending", printer_id: null }])
    const result = await assignPrinter(fake, "pj_1", "prn_9")
    expect(result.ok && result.value.printer_id).toBe("prn_9")
  })
})
