import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/ops/orders/[id]/shipment/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "ord_1" }) }

const ORDER = {
  id: "ord_1",
  user_id: "u1",
  status: "quality_check",
  payment_status: "paid",
  created_at: "1",
}

function seed(order: Record<string, unknown> = ORDER) {
  return createFakeDb({
    orders: { rows: [order], unique: ["id"] },
    shipments: { rows: [], unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

function post(body: unknown, raw?: string): Request {
  return new Request("http://test/api/ops/orders/ord_1/shipment", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  })
}

const VALID = { carrier: "delhivery", trackingNumber: "DL-99887766" }

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/shipment", () => {
  it("404s a customer without shipping", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post(VALID), ctx)).status).toBe(404)
    expect(db.rows("shipments")).toHaveLength(0)
    expect(db.rows("orders")[0]?.status).toBe("quality_check")
  })

  it("records the shipment, ships the order and queues the customer notification", async () => {
    const response = await POST(post(VALID), ctx)
    expect(response.status).toBe(201)
    const body = (await response.json()) as { shipmentId: string; status: string }
    expect(body.status).toBe("shipped")

    expect(db.rows("shipments")[0]).toMatchObject({
      order_id: "ord_1",
      carrier: "delhivery",
      tracking_number: "DL-99887766",
      status: "created",
    })
    expect(db.rows("orders")[0]?.status).toBe("shipped")
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      entity_type: "order",
      entity_id: "ord_1",
      action: "order.shipped",
      metadata: {
        shipmentId: body.shipmentId,
        carrier: "delhivery",
        trackingNumber: "DL-99887766",
        from: "quality_check",
        to: "shipped",
      },
    })
    expect(db.rows("jobs")[0]).toMatchObject({
      type: "notification.send",
      idempotency_key: `shipment:${body.shipmentId}`,
      payload: {
        template: "shipment",
        orderId: "ord_1",
        carrier: "delhivery",
        trackingNumber: "DL-99887766",
      },
    })
  })

  it.each(["paid", "design_review", "production_queued", "printing", "shipped", "cancelled"])(
    "409s an order in %s — only a quality-checked order ships",
    async (status) => {
      db = seed({ ...ORDER, status })
      expect((await POST(post(VALID), ctx)).status).toBe(409)
      expect(db.rows("shipments")).toHaveLength(0)
      expect(db.rows("orders")[0]?.status).toBe(status)
    }
  )

  it("404s an unknown order", async () => {
    db = createFakeDb({
      orders: { rows: [], unique: ["id"] },
      shipments: { rows: [], unique: ["id"] },
      audit_events: { rows: [], unique: ["id"] },
      jobs: { rows: [], unique: ["id", "idempotency_key"] },
    })
    expect((await POST(post(VALID), ctx)).status).toBe(404)
  })

  it.each([
    ["a non-json body", undefined, "{"],
    ["an unknown carrier", { carrier: "fedex", trackingNumber: "ABC123" }, undefined],
    ["a missing tracking number", { carrier: "dtdc" }, undefined],
    ["a tracking number with spaces", { carrier: "dtdc", trackingNumber: "AB 12345" }, undefined],
  ])("400s %s", async (_name, body, raw) => {
    expect((await POST(post(body, raw), ctx)).status).toBe(400)
    expect(db.rows("shipments")).toHaveLength(0)
    expect(db.rows("orders")[0]?.status).toBe("quality_check")
  })
})

describe("POST …/shipment — persistence failures", () => {
  it.each([
    ["the order lookup", 1],
    ["the shipment insert", 2],
    ["the order update", 3],
    ["the audit write", 4],
    ["the notification enqueue", 5],
  ])("502s when %s fails", async (_name, call) => {
    db.failCall(call, { message: "boom" })
    expect((await POST(post(VALID), ctx)).status).toBe(502)
  })
})
