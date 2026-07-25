import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PaymentEvent } from "@/src/adapters/payments"
import { appError } from "@/src/lib/errors"
import { inr } from "@/src/lib/money"
import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const verifyAndParseWebhook = vi.fn()
vi.mock("@/src/adapters/payments/factory", () => ({
  getPaymentProvider: vi.fn(() => ({ verifyAndParseWebhook })),
}))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { POST } from "@/app/api/webhooks/dodo/route"

const RAW = JSON.stringify({ type: "payment.succeeded" })

function post(rawBody = RAW): Request {
  return new Request("http://test/api/webhooks/dodo", {
    method: "POST",
    body: rawBody,
    headers: { "webhook-id": "evt_1" },
  })
}

const succeeded = (over: Partial<Record<string, unknown>> = {}): PaymentEvent => ({
  type: "payment.succeeded",
  eventId: "evt_1",
  paymentRef: "pay_1",
  metadata: { order_id: "ord_1", quote_id: "qt_1" },
  amount: inr(24360),
  ...over,
})

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: "ord_1",
    user_id: "u1",
    quote_id: "qt_1",
    status: "pending_payment",
    payment_status: "unpaid",
    payment_ref: null,
    held_from_status: null,
    frozen_dv_id: "dv_1",
    frozen_config_json: {},
    contact_json: {},
    shipping_address_json: {},
    provider_session_id: "cks_mock_ord_1",
    created_at: "2026-01-01",
    ...over,
  }
}

function seed(
  opts: {
    orders?: Record<string, unknown>[]
    reports?: Record<string, unknown>[]
    quotes?: Record<string, unknown>[]
    webhooks?: Record<string, unknown>[]
  } = {}
) {
  return createFakeDb({
    orders: { rows: opts.orders ?? [orderRow()], unique: ["id"] },
    quotes: {
      rows: opts.quotes ?? [{ id: "qt_1", amount_minor: 24360, currency: "INR", created_at: "1" }],
      unique: ["id"],
    },
    validation_reports: {
      rows: opts.reports ?? [
        { id: "vr_1", design_version_id: "dv_1", status: "pass", created_at: "2026-01-02" },
      ],
      unique: ["id"],
    },
    webhook_events: { rows: opts.webhooks ?? [], unique: ["provider", "event_id"] },
    audit_events: { rows: [], unique: ["id"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
}

function order(fake: FakeDb, id = "ord_1"): Record<string, unknown> {
  return fake.rows("orders").find((row) => row.id === id) as Record<string, unknown>
}

function auditActions(fake: FakeDb): unknown[] {
  return fake.rows("audit_events").map((row) => row.action)
}

function jobTemplates(fake: FakeDb): unknown[] {
  return fake.rows("jobs").map((row) => (row.payload as { template: string }).template)
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  db = seed()
  verifyAndParseWebhook.mockReturnValue(ok(succeeded()))
})

afterEach(() => vi.clearAllMocks())

describe("POST /api/webhooks/dodo — verification", () => {
  it("401s a bad signature", async () => {
    verifyAndParseWebhook.mockReturnValue({
      ok: false,
      error: appError("unauthorized", "webhook signature verification failed"),
    })
    const response = await POST(post())
    expect(response.status).toBe(401)
    expect(db.rows("webhook_events")).toHaveLength(0)
  })

  it("401s a stale timestamp", async () => {
    verifyAndParseWebhook.mockReturnValue({
      ok: false,
      error: appError("unauthorized", "webhook timestamp outside tolerance"),
    })
    expect((await POST(post())).status).toBe(401)
  })

  it("400s a well-signed but malformed payload, so it is never retried", async () => {
    verifyAndParseWebhook.mockReturnValue({
      ok: false,
      error: appError("provider_error", "malformed payment.succeeded payload"),
    })
    expect((await POST(post())).status).toBe(400)
  })

  it("passes the raw body and lower-cased headers straight to the adapter", async () => {
    await POST(post("raw-bytes"))
    expect(verifyAndParseWebhook).toHaveBeenCalledWith(
      "raw-bytes",
      expect.objectContaining({ "webhook-id": "evt_1" })
    )
  })
})

describe("POST /api/webhooks/dodo — idempotency", () => {
  it("records the event and processes it once", async () => {
    const response = await POST(post())
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ status: "processed" })
    const row = db.rows("webhook_events")[0]!
    expect(row.event_id).toBe("evt_1")
    expect(row.processing_result).toBe("processed")
  })

  it("answers 200 duplicate for a replayed event id and changes nothing", async () => {
    await POST(post())
    const before = order(db)
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "duplicate" })
    expect(db.rows("webhook_events")).toHaveLength(1)
    expect(order(db)).toEqual(before)
  })

  it("re-processes an event whose earlier attempt never completed", async () => {
    db = seed({
      webhooks: [
        {
          id: "wh_1",
          provider: "dodo",
          event_id: "evt_1",
          payload: {},
          processing_result: null,
          received_at: "1",
          created_at: "1",
        },
      ],
    })
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "processed" })
    expect(order(db).status).toBe("production_queued")
  })

  it("stores a non-object body verbatim rather than dropping it", async () => {
    await POST(post("not json at all"))
    expect(db.rows("webhook_events")[0]!.payload).toEqual({ raw: "not json at all" })
  })

  it("stores the parsed body when it is a json object", async () => {
    await POST(post(JSON.stringify({ type: "payment.succeeded", data: { a: 1 } })))
    expect(db.rows("webhook_events")[0]!.payload).toEqual({
      type: "payment.succeeded",
      data: { a: 1 },
    })
  })

  it("500s when the event row cannot be written", async () => {
    db.failNext({ message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when a conflicting row cannot be read back", async () => {
    await POST(post())
    // The first request used ops 1–7; op 8 is the replay's conflicting insert
    // and op 9 the read-back of the existing row.
    db.failCall(9, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the conflicting row has vanished", async () => {
    db = seed({
      webhooks: [
        {
          id: "wh_1",
          provider: "dodo",
          event_id: "other",
          payload: {},
          processing_result: null,
          received_at: "1",
          created_at: "1",
        },
      ],
    })
    // Force the insert to report a conflict for an event id that is not stored,
    // so the read-back finds nothing.
    db.failNext({ message: "duplicate key value", code: "23505" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the processing result cannot be stamped", async () => {
    // 1 insert webhook, 2 get order, 3 get report, 4 update order, 5 audit,
    // 6 enqueue receipt, 7 stamp processing_result.
    db.failCall(7, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })
})

describe("POST /api/webhooks/dodo — payment.succeeded", () => {
  it("auto-approves a passing order into production_queued", async () => {
    await POST(post())
    const row = order(db)
    expect(row.status).toBe("production_queued")
    expect(row.payment_status).toBe("paid")
    expect(row.payment_ref).toBe("pay_1")
    // The ops board measures its due date from payment, not order creation.
    expect(Date.parse(row.paid_at as string)).not.toBeNaN()
    expect(auditActions(db)).toEqual(["payment.succeeded"])
    expect(jobTemplates(db)).toEqual(["order_receipt"])
  })

  it("leaves a warning verdict in design_review and alerts ops", async () => {
    db = seed({
      reports: [{ id: "vr_1", design_version_id: "dv_1", status: "warning", created_at: "1" }],
    })
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "processed" })
    expect(order(db).status).toBe("design_review")
    expect(auditActions(db)).toContain("order.awaiting_design_review")
    expect(jobTemplates(db)).toEqual(["order_receipt", "ops_order_review"])
  })

  it("leaves an order with no report in design_review", async () => {
    db = seed({ reports: [] })
    await POST(post())
    expect(order(db).status).toBe("design_review")
  })

  it("alerts ops when the metadata names an order we do not have", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(succeeded({ metadata: { order_id: "ord_gone" } })))
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "unknown_order" })
    expect(jobTemplates(db)).toEqual(["ops_payment_unmatched"])
  })

  it("alerts ops when the metadata carries no order id at all", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(succeeded({ metadata: {} })))
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "unknown_order" })
    expect(db.rows("audit_events")[0]!.entity_id).toBe("evt_1")
  })

  it("records late money on a cancelled order and escalates instead of transitioning", async () => {
    db = seed({ orders: [orderRow({ status: "cancelled" })] })
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "late_payment_on_cancelled_order" })
    const row = order(db)
    expect(row.status).toBe("cancelled")
    expect(row.payment_status).toBe("paid")
    expect(row.payment_ref).toBe("pay_1")
    expect(Date.parse(row.paid_at as string)).not.toBeNaN()
    expect(jobTemplates(db)).toEqual(["ops_late_payment"])
  })

  it("no-ops a success replayed under a new event id after the order is already paid", async () => {
    db = seed({ orders: [orderRow({ status: "production_queued", payment_status: "paid" })] })
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "already_paid" })
    expect(auditActions(db)).toEqual([])
  })

  it("500s when the order lookup fails", async () => {
    db.failCall(2, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the validation report lookup fails", async () => {
    db.failCall(3, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the order update fails", async () => {
    db.failCall(4, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the audit row cannot be written", async () => {
    db.failCall(5, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the receipt cannot be queued", async () => {
    db.failCall(6, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the ops review alert cannot be audited", async () => {
    db = seed({
      reports: [{ id: "vr_1", design_version_id: "dv_1", status: "warning", created_at: "1" }],
    })
    db.failCall(7, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the unmatched-payment alert cannot be queued", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(succeeded({ metadata: { order_id: "ord_gone" } })))
    db.failCall(4, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the late-payment record cannot be written", async () => {
    db = seed({ orders: [orderRow({ status: "cancelled" })] })
    db.failCall(3, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the late-payment alert cannot be raised", async () => {
    db = seed({ orders: [orderRow({ status: "cancelled" })] })
    db.failCall(4, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })
})

describe("POST /api/webhooks/dodo — payment.failed", () => {
  const failed = (metadata: Record<string, string> = { order_id: "ord_1" }): PaymentEvent => ({
    type: "payment.failed",
    eventId: "evt_1",
    metadata,
    reason: "card declined",
  })

  it("cancels a pending order", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(failed()))
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "processed" })
    expect(order(db).status).toBe("cancelled")
    expect(auditActions(db)).toEqual(["payment.failed"])
  })

  it("no-ops for an order that is no longer pending", async () => {
    db = seed({ orders: [orderRow({ status: "paid" })] })
    verifyAndParseWebhook.mockReturnValue(ok(failed()))
    expect(await body(await POST(post()))).toEqual({ status: "not_pending" })
  })

  it("no-ops for an unknown order without alerting — no money moved", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(failed({ order_id: "ord_gone" })))
    expect(await body(await POST(post()))).toEqual({ status: "unknown_order" })
    expect(db.rows("jobs")).toHaveLength(0)
  })

  it("500s when the order lookup fails", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(failed()))
    db.failCall(2, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the cancellation cannot be written", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(failed()))
    db.failCall(3, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the audit row cannot be written", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(failed()))
    db.failCall(4, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })
})

describe("POST /api/webhooks/dodo — refund.succeeded", () => {
  const refund = (amountMinor: number): PaymentEvent => ({
    type: "refund.succeeded",
    eventId: "evt_1",
    paymentRef: "pay_1",
    amount: inr(amountMinor),
  })

  const paidOrder = (over: Record<string, unknown> = {}) =>
    orderRow({ status: "production_queued", payment_status: "paid", payment_ref: "pay_1", ...over })

  it("marks a full refund refunded without touching fulfillment", async () => {
    db = seed({ orders: [paidOrder()] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    expect(await body(await POST(post()))).toEqual({ status: "processed" })
    expect(order(db).payment_status).toBe("refunded")
    expect(order(db).status).toBe("production_queued")
  })

  it("marks a smaller refund partially_refunded", async () => {
    db = seed({ orders: [paidOrder()] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(5000)))
    await POST(post())
    expect(order(db).payment_status).toBe("partially_refunded")
    expect(auditActions(db)).toEqual(["refund.succeeded"])
  })

  it("logs out_of_order when the refund arrives before the payment we can match", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "out_of_order" })
    expect(order(db).payment_status).toBe("unpaid")
    expect(jobTemplates(db)).toEqual(["ops_refund_unmatched"])
  })

  it("refuses a refund the payment axis cannot take", async () => {
    db = seed({ orders: [paidOrder({ payment_status: "refunded" })] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    expect(await body(await POST(post()))).toEqual({ status: "illegal_refund" })
    expect(order(db).payment_status).toBe("refunded")
  })

  it("escalates when the order's quote has gone missing", async () => {
    db = seed({ orders: [paidOrder()], quotes: [] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    expect(await body(await POST(post()))).toEqual({ status: "unknown_order" })
    expect(jobTemplates(db)).toEqual(["ops_refund_unmatched"])
  })

  it("500s when the order lookup fails", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(2, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the unmatched-refund alert cannot be raised", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(3, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the quote lookup fails", async () => {
    db = seed({ orders: [paidOrder()] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(3, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the missing-quote alert cannot be raised", async () => {
    db = seed({ orders: [paidOrder()], quotes: [] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(4, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the payment-axis update fails", async () => {
    db = seed({ orders: [paidOrder()] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(4, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the refund audit row cannot be written", async () => {
    db = seed({ orders: [paidOrder()] })
    verifyAndParseWebhook.mockReturnValue(ok(refund(24360)))
    db.failCall(5, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })
})

describe("POST /api/webhooks/dodo — dispute.opened", () => {
  const dispute: PaymentEvent = {
    type: "dispute.opened",
    eventId: "evt_1",
    paymentRef: "pay_1",
  }

  it("holds a live order at the state it was in and tells ops", async () => {
    db = seed({
      orders: [orderRow({ status: "printing", payment_status: "paid", payment_ref: "pay_1" })],
    })
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    expect(await body(await POST(post()))).toEqual({ status: "processed" })
    const row = order(db)
    expect(row.status).toBe("on_hold")
    expect(row.held_from_status).toBe("printing")
    expect(jobTemplates(db)).toEqual(["ops_dispute_opened"])
  })

  it("still alerts ops for an order that cannot be held", async () => {
    db = seed({
      orders: [orderRow({ status: "delivered", payment_status: "paid", payment_ref: "pay_1" })],
    })
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    expect(await body(await POST(post()))).toEqual({ status: "not_holdable" })
    expect(order(db).status).toBe("delivered")
    expect(jobTemplates(db)).toEqual(["ops_dispute_opened"])
  })

  it("alerts ops for a dispute on a payment we cannot match", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    expect(await body(await POST(post()))).toEqual({ status: "out_of_order" })
    expect(db.rows("audit_events")[0]!.action).toBe("dispute.unmatched_payment")
  })

  it("500s when the order lookup fails", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    db.failCall(2, { message: "select exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the unmatched-dispute alert cannot be raised", async () => {
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    db.failCall(3, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the hold cannot be written", async () => {
    db = seed({
      orders: [orderRow({ status: "printing", payment_status: "paid", payment_ref: "pay_1" })],
    })
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    db.failCall(3, { message: "update exploded" })
    expect((await POST(post())).status).toBe(500)
  })

  it("500s when the dispute alert cannot be queued", async () => {
    db = seed({
      orders: [orderRow({ status: "printing", payment_status: "paid", payment_ref: "pay_1" })],
    })
    verifyAndParseWebhook.mockReturnValue(ok(dispute))
    db.failCall(5, { message: "insert exploded" })
    expect((await POST(post())).status).toBe(500)
  })
})

describe("POST /api/webhooks/dodo — unhandled types", () => {
  it("logs and ACKs an event type we do not act on", async () => {
    verifyAndParseWebhook.mockReturnValue(
      ok({ type: "ignored", eventId: "evt_1", rawType: "subscription.renewed" } as PaymentEvent)
    )
    const response = await POST(post())
    expect(await body(response)).toEqual({ status: "ignored" })
    expect(db.rows("webhook_events")[0]!.processing_result).toBe("ignored")
    expect(db.rows("audit_events")).toHaveLength(0)
  })
})
