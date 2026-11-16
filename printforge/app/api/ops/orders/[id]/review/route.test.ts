import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

const createRefund = vi.fn()
vi.mock("@/src/adapters/payments/factory", () => ({
  getPaymentProvider: vi.fn(() => ({ createRefund })),
}))

import { POST } from "@/app/api/ops/orders/[id]/review/route"

const OPERATOR = { userId: "op1", email: "op@b.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "ord_1" }) }

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    user_id: "u1",
    quote_id: "qt_1",
    status: "design_review",
    payment_status: "paid",
    payment_ref: "pay_1",
    held_from_status: null,
    frozen_dv_id: "dv_1",
    created_at: "2026-01-01",
    ...over,
  }
}

function seed(rows: Record<string, unknown>[] = [orderRow()]): FakeDb {
  return createFakeDb({
    orders: { rows, unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown): Request {
  return new Request("http://test/api/ops/orders/ord_1/review", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function order(): Record<string, unknown> {
  return db.rows("orders")[0]!
}

function audit(): Record<string, unknown> {
  return db.rows("audit_events")[0]!
}

function notifications(): Record<string, unknown>[] {
  return db.rows("jobs").filter((row) => row["type"] === "notification.send")
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  createRefund.mockResolvedValue(ok({ refundRef: "rfnd_1" }))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/review — role guard", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    const response = await POST(post({ action: "approve", reason: "ok" }), ctx)
    expect(response.status).toBe(404)
    expect(order().status).toBe("design_review")
  })

  it("404s an anonymous request", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(404)
  })

  it("admits an admin", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "admin" }))
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(200)
  })
})

describe("POST …/review — validation", () => {
  it("400s a non-json body", async () => {
    const request = new Request("http://test/api/ops/orders/ord_1/review", {
      method: "POST",
      body: "{",
    })
    expect((await POST(request, ctx)).status).toBe(400)
  })

  it("400s when the reason is missing — every action must be explained", async () => {
    const response = await POST(post({ action: "approve" }), ctx)
    expect(response.status).toBe(400)
    expect(order().status).toBe("design_review")
  })

  it("400s an unknown action", async () => {
    expect((await POST(post({ action: "nuke", reason: "why" }), ctx)).status).toBe(400)
  })

  it("404s an order that does not exist", async () => {
    db = seed([])
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(404)
  })

  it("502s when the order lookup fails", async () => {
    db.failNext({ message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("409s an action the order machine forbids", async () => {
    db = seed([orderRow({ status: "shipped" })])
    const response = await POST(post({ action: "approve", reason: "ok" }), ctx)
    expect(response.status).toBe(409)
    expect(order().status).toBe("shipped")
  })
})

describe("POST …/review — actions", () => {
  it("approves into production and audits the actor and reason", async () => {
    const response = await POST(post({ action: "approve", reason: "geometry fine" }), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "production_queued", refundRef: null })
    expect(order().status).toBe("production_queued")
    expect(audit()).toMatchObject({
      actor_id: "op1",
      actor_kind: "user",
      entity_type: "order",
      entity_id: "ord_1",
      action: "order.review.approve",
      metadata: { reason: "geometry fine", from: "design_review", to: "production_queued" },
    })
    expect(createRefund).not.toHaveBeenCalled()
  })

  it("holds an order and remembers where it was held from", async () => {
    db = seed([orderRow({ status: "printing" })])
    await POST(post({ action: "hold", reason: "filament jam" }), ctx)
    expect(order().status).toBe("on_hold")
    expect(order().held_from_status).toBe("printing")
  })

  it("releases a hold back to the state it interrupted", async () => {
    db = seed([orderRow({ status: "on_hold", held_from_status: "production_queued" })])
    const response = await POST(post({ action: "release_hold", reason: "resolved" }), ctx)
    expect(await response.json()).toEqual({ status: "production_queued", refundRef: null })
    expect(order().status).toBe("production_queued")
    expect(order().held_from_status).toBeNull()
  })

  it("409s a release with no recorded origin", async () => {
    db = seed([orderRow({ status: "on_hold", held_from_status: null })])
    expect((await POST(post({ action: "release_hold", reason: "resolved" }), ctx)).status).toBe(409)
  })
})

describe("POST …/review — what the customer is told", () => {
  it("tells the customer their order is on hold", async () => {
    db = seed([orderRow({ status: "printing" })])
    await POST(post({ action: "hold", reason: "filament jam" }), ctx)

    const [queued] = notifications()
    expect(queued).toMatchObject({
      type: "notification.send",
      payload: { template: "review_hold", orderId: "ord_1" },
    })
    // Keyed by the audit event, so a hold → release → hold really does mail twice.
    expect(queued?.idempotency_key).toBe(`review_hold:${audit().id as string}`)
  })

  it("tells the customer about a rejection and its refund", async () => {
    await POST(post({ action: "reject", reason: "unprintable" }), ctx)
    expect(notifications()[0]).toMatchObject({
      payload: { template: "cancellation_refund", orderId: "ord_1" },
    })
  })

  it.each(["approve", "release_hold"] as const)(
    "says nothing to the customer on %s — the order simply carries on",
    async (action) => {
      db = seed([orderRow({ status: "on_hold", held_from_status: "production_queued" })])
      await POST(post({ action, reason: "ok" }), ctx)
      expect(notifications()).toHaveLength(0)
    }
  )

  it("502s when the customer notification cannot be queued", async () => {
    db = seed([orderRow({ status: "printing" })])
    // 1 order read · 2 status update · 3 audit event · 4 the notification job.
    db.failCall(4, { message: "boom" })
    expect((await POST(post({ action: "hold", reason: "jam" }), ctx)).status).toBe(502)
  })
})

describe("POST …/review — reject refunds the customer", () => {
  it("initiates a refund, cancels the order, and records the refund reference", async () => {
    const response = await POST(post({ action: "reject", reason: "unprintable" }), ctx)
    expect(await response.json()).toEqual({ status: "cancelled", refundRef: "rfnd_1" })
    expect(createRefund).toHaveBeenCalledWith("pay_1")
    expect(order().status).toBe("cancelled")
    expect(audit().metadata).toMatchObject({ refundRef: "rfnd_1", reason: "unprintable" })
  })

  it("leaves the payment axis alone — only the refund webhook may move it", async () => {
    await POST(post({ action: "reject", reason: "unprintable" }), ctx)
    expect(order().payment_status).toBe("paid")
  })

  it("does not cancel when the refund fails", async () => {
    createRefund.mockResolvedValue({ ok: false, error: appError("provider_error", "gateway down") })
    const response = await POST(post({ action: "reject", reason: "unprintable" }), ctx)
    expect(response.status).toBe(502)
    expect(order().status).toBe("design_review")
  })

  it("412s an order with no payment to refund", async () => {
    db = seed([orderRow({ payment_ref: null })])
    const response = await POST(post({ action: "reject", reason: "unprintable" }), ctx)
    expect(response.status).toBe(412)
    expect(createRefund).not.toHaveBeenCalled()
    expect(order().status).toBe("design_review")
  })
})

describe("POST …/review — persistence failures", () => {
  it("502s when the status update fails", async () => {
    db.failCall(2, { message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })

  it("502s when the audit row cannot be written", async () => {
    db.failCall(3, { message: "boom" })
    expect((await POST(post({ action: "approve", reason: "ok" }), ctx)).status).toBe(502)
  })
})
