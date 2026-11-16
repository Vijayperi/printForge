import { describe, expect, it } from "vitest"

import { getOpsOrder, listOpsOrders } from "@/src/data/opsOrders"
import { endOfDay, opsOrderFilterSchema, paidAtCutoffForDue } from "@/src/domain/ops/board"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

function row(over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    user_id: "u1",
    status: "production_queued",
    payment_status: "paid",
    held_from_status: null,
    paid_at: "2026-01-05T00:00:00.000Z",
    created_at: "2026-01-05T00:00:00.000Z",
    quote_id: "qt_1",
    frozen_dv_id: "dv_1",
    payment_ref: "pay_1",
    customer_name: "Asha Rao",
    customer_email: "asha@example.com",
    material_id: "pla",
    amount_minor: 24360,
    print_job_id: null,
    printer_id: null,
    print_job_status: null,
    validation_status: "pass",
    exception_reason: null,
    ...over,
  }
}

function db(rows: Record<string, unknown>[]): FakeDb {
  return createFakeDb({ ops_orders: { rows, unique: ["id"] } })
}

const filter = (over: Record<string, unknown> = {}) => opsOrderFilterSchema.parse(over)

describe("listOpsOrders", () => {
  it("returns the newest orders first", async () => {
    const result = await listOpsOrders(
      db([
        row({ id: "ord_old", created_at: "2026-01-01T00:00:00.000Z" }),
        row({ id: "ord_new", created_at: "2026-02-01T00:00:00.000Z" }),
      ]),
      filter()
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["ord_new", "ord_old"])
    expect(result.ok && result.value.hasMore).toBe(false)
  })

  it.each([
    ["status", { status: "printing" }, { status: "printing" }],
    ["printer", { printerId: "prn_2" }, { printer_id: "prn_2" }],
    ["material", { materialId: "petg" }, { material_id: "petg" }],
    ["exception reason", { exception: "print_failed" }, { exception_reason: "print_failed" }],
  ])("filters by %s in the database", async (_label, query, matching) => {
    const result = await listOpsOrders(
      db([row({ id: "ord_match", ...matching }), row({ id: "ord_other" })]),
      filter(query)
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["ord_match"])
  })

  it("translates a due-date filter into a bound on paid_at", async () => {
    const dueBefore = "2026-02-01"
    const cutoff = paidAtCutoffForDue(endOfDay(dueBefore))
    const result = await listOpsOrders(
      db([
        row({ id: "ord_due", paid_at: new Date(cutoff.getTime() - 86_400_000).toISOString() }),
        row({ id: "ord_later", paid_at: new Date(cutoff.getTime() + 86_400_000).toISOString() }),
      ]),
      filter({ dueBefore })
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["ord_due"])
  })

  it("excludes an unpaid order from a due-date filter", async () => {
    const result = await listOpsOrders(
      db([row({ id: "ord_unpaid", paid_at: null })]),
      filter({ dueBefore: "2026-02-01" })
    )
    expect(result.ok && result.value.rows).toEqual([])
  })

  it("combines filters", async () => {
    const result = await listOpsOrders(
      db([
        row({ id: "ord_both", status: "printing", material_id: "petg" }),
        row({ id: "ord_status_only", status: "printing" }),
        row({ id: "ord_material_only", material_id: "petg" }),
      ]),
      filter({ status: "printing", materialId: "petg" })
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["ord_both"])
  })

  it("pages, reporting whether more rows exist", async () => {
    const rows = Array.from({ length: 27 }, (_, i) =>
      row({ id: `ord_${String(i).padStart(2, "0")}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}` })
    )
    const first = await listOpsOrders(db(rows), filter())
    expect(first.ok && first.value.rows).toHaveLength(25)
    expect(first.ok && first.value.hasMore).toBe(true)

    const second = await listOpsOrders(db(rows), filter({ page: "1" }))
    expect(second.ok && second.value.rows).toHaveLength(2)
    expect(second.ok && second.value.hasMore).toBe(false)
  })

  it("surfaces a database error", async () => {
    const fake = db([row()])
    fake.failNext({ message: "boom" })
    const result = await listOpsOrders(fake, filter())
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("getOpsOrder", () => {
  it("finds one board row by id", async () => {
    const result = await getOpsOrder(db([row()]), "ord_1")
    expect(result.ok && result.value?.customer_name).toBe("Asha Rao")
  })

  it("returns null when absent", async () => {
    const result = await getOpsOrder(db([]), "ord_missing")
    expect(result.ok && result.value).toBeNull()
  })
})
