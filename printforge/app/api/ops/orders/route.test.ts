import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DUE_BUSINESS_DAYS, shiftBusinessDays } from "@/src/domain/ops/board"
import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { GET } from "@/app/api/ops/orders/route"

const OPERATOR = { userId: "op1", email: "op@b.com", name: "Op", role: "operator" as const }

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

function get(query = ""): Request {
  return new Request(`http://test/api/ops/orders${query}`)
}

async function body(response: Response): Promise<{
  orders: { id: string; dueAt: string | null; exceptionReason: string | null }[]
  page: number
  pageSize: number
  hasMore: boolean
}> {
  return (await response.json()) as never
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = createFakeDb({ ops_orders: { rows: [row()], unique: ["id"] } })
})

afterEach(() => vi.clearAllMocks())

describe("GET /api/ops/orders — role guard", () => {
  it.each(["operator", "admin"] as const)("admits %s", async (role) => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role }))
    expect((await GET(get())).status).toBe(200)
  })

  it("404s a customer rather than revealing the ops surface", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    const response = await GET(get())
    expect(response.status).toBe(404)
  })

  it("404s an anonymous request", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(get())).status).toBe(404)
  })
})

describe("GET /api/ops/orders — listing", () => {
  it("returns board rows with the derived due date", async () => {
    const response = await GET(get())
    const payload = await body(response)
    expect(payload.pageSize).toBe(25)
    expect(payload.page).toBe(0)
    expect(payload.hasMore).toBe(false)
    expect(payload.orders[0]!.id).toBe("ord_1")
    expect(payload.orders[0]!.dueAt).toBe(
      shiftBusinessDays(new Date("2026-01-05T00:00:00.000Z"), DUE_BUSINESS_DAYS).toISOString()
    )
  })

  it("has no due date for an order that has not been paid", async () => {
    db = createFakeDb({
      ops_orders: { rows: [row({ paid_at: null, status: "pending_payment" })], unique: ["id"] },
    })
    expect((await body(await GET(get()))).orders[0]!.dueAt).toBeNull()
  })

  it("passes filters through to the database", async () => {
    db = createFakeDb({
      ops_orders: {
        rows: [row({ id: "ord_petg", material_id: "petg" }), row({ id: "ord_pla" })],
        unique: ["id"],
      },
    })
    const payload = await body(await GET(get("?materialId=petg")))
    expect(payload.orders.map((o) => o.id)).toEqual(["ord_petg"])
  })

  it("ignores blank query parameters instead of failing on them", async () => {
    expect((await GET(get("?status=&materialId="))).status).toBe(200)
  })

  it("400s an unparseable filter", async () => {
    const response = await GET(get("?exception=exploded"))
    expect(response.status).toBe(400)
  })

  it("400s an unknown query parameter", async () => {
    expect((await GET(get("?sortBy=amount"))).status).toBe(400)
  })

  it("reports a further page when one exists", async () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      row({ id: `ord_${String(i).padStart(2, "0")}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}` })
    )
    db = createFakeDb({ ops_orders: { rows, unique: ["id"] } })
    const payload = await body(await GET(get()))
    expect(payload.orders).toHaveLength(25)
    expect(payload.hasMore).toBe(true)
  })

  it("502s when the query fails", async () => {
    db.failNext({ message: "boom" })
    expect((await GET(get())).status).toBe(502)
  })
})
