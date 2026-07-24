import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => db),
  getServiceDb: vi.fn(() => db),
}))

const createCheckout = vi.fn()
vi.mock("@/src/adapters/payments/factory", () => ({
  getPaymentProvider: vi.fn(() => ({ createCheckout })),
}))

vi.mock("@/src/config/env", () => ({ getEnv: () => ({ APP_URL: "http://test.local" }) }))

import { POST } from "@/app/api/checkout/session/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

const CONTACT = { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" }
const ADDRESS = {
  line1: "12 Residency Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560025",
}

function post(body: unknown): Request {
  return new Request("http://test/api/checkout/session", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

const validBody = { quoteId: "qt_1", contact: CONTACT, shippingAddress: ADDRESS }

const configRow = {
  id: "cfg_1",
  design_version_id: "dv_1",
  material_id: "pla",
  color_id: "pla-white",
  dimensions_mm: { x: 10, y: 10, z: 10 },
  scale_factor: 1.5,
  quality_id: "standard",
  strength_id: "everyday",
  shipping_speed: "standard",
  special_instructions: "handle with care",
  created_at: "2026-01-01",
}

const quoteRow = (over: Record<string, unknown> = {}) => ({
  id: "qt_1",
  configuration_id: "cfg_1",
  config_hash: "1.5|pla|standard|everyday|standard",
  status: "active",
  amount_minor: 24360,
  currency: "INR",
  breakdown_json: [],
  slice_json: { materialGrams: 20 },
  expires_at: "2099-01-01T00:00:00.000Z",
  created_at: "2026-01-03",
  ...over,
})

function seed(
  opts: {
    quoteRows?: Record<string, unknown>[]
    configRows?: Record<string, unknown>[]
    dvRows?: Record<string, unknown>[]
    reportRows?: Record<string, unknown>[]
    orderRows?: Record<string, unknown>[]
  } = {}
) {
  return createFakeDb({
    quotes: { rows: opts.quoteRows ?? [quoteRow()], unique: ["id"] },
    print_configurations: { rows: opts.configRows ?? [configRow], unique: ["id"] },
    design_versions: {
      rows: opts.dvRows ?? [{ id: "dv_1", project_id: "proj_1", generation_status: "ready" }],
    },
    validation_reports: {
      rows: opts.reportRows ?? [
        { id: "vr_1", design_version_id: "dv_1", status: "pass", created_at: "2026-01-02" },
      ],
      unique: ["id"],
    },
    orders: { rows: opts.orderRows ?? [], unique: ["id", "quote_id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  createCheckout.mockResolvedValue(
    ok({ providerSessionId: "cks_mock_ord_1", checkoutUrl: "/mock-checkout/cks_mock_ord_1" })
  )
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST /api/checkout/session — guards", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(post(validBody))).status).toBe(401)
  })

  it("401 when the auth gateway errors", async () => {
    getUser.mockResolvedValue({ ok: false, error: appError("unauthorized", "nope") })
    expect((await POST(post(validBody))).status).toBe(401)
  })

  it("400 when the body is not json", async () => {
    const request = new Request("http://test/api/checkout/session", { method: "POST", body: "{" })
    expect((await POST(request)).status).toBe(400)
  })

  it("400 when the body fails validation", async () => {
    const res = await POST(post({ ...validBody, contact: { ...CONTACT, phone: "123" } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toContain("phone")
  })

  // Plan §6-S13 "Done when": the client never sends an amount.
  it("400 when the client tries to send an amount", async () => {
    const res = await POST(post({ ...validBody, amount: 1 }))
    expect(res.status).toBe(400)
    expect(db.rows("orders")).toHaveLength(0)
  })

  it("404 when the quote does not exist (or belongs to someone else)", async () => {
    db = seed({ quoteRows: [] })
    expect((await POST(post(validBody))).status).toBe(404)
  })

  it("404 when the quote's configuration is gone", async () => {
    db = seed({ configRows: [] })
    expect((await POST(post(validBody))).status).toBe(404)
  })

  it("404 when the design version is not visible", async () => {
    db = seed({ dvRows: [] })
    expect((await POST(post(validBody))).status).toBe(404)
  })

  it("412 when there is no validation report", async () => {
    db = seed({ reportRows: [] })
    expect((await POST(post(validBody))).status).toBe(412)
  })

  it("412 when the verdict is not printable", async () => {
    db = seed({
      reportRows: [{ id: "vr_1", design_version_id: "dv_1", status: "fail", created_at: "1" }],
    })
    expect((await POST(post(validBody))).status).toBe(412)
  })

  it("accepts a warning verdict", async () => {
    db = seed({
      reportRows: [{ id: "vr_1", design_version_id: "dv_1", status: "warning", created_at: "1" }],
    })
    expect((await POST(post(validBody))).status).toBe(201)
  })

  it.each(["consumed", "superseded", "expired"])("409 when the quote is %s", async (status) => {
    db = seed({ quoteRows: [quoteRow({ status })] })
    const res = await POST(post(validBody))
    expect(res.status).toBe(409)
    expect(db.rows("orders")).toHaveLength(0)
  })

  it("409 and expires the quote when it has lapsed", async () => {
    db = seed({ quoteRows: [quoteRow({ expires_at: "2000-01-01T00:00:00.000Z" })] })
    const res = await POST(post(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toContain("expired")
    expect(db.rows("quotes")[0]!["status"]).toBe("expired")
    expect(db.rows("orders")).toHaveLength(0)
  })
})

describe("POST /api/checkout/session — success", () => {
  it("201 with the order id and hosted checkout url", async () => {
    const res = await POST(post(validBody))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.checkoutUrl).toBe("/mock-checkout/cks_mock_ord_1")
    expect(body.orderId).toMatch(/^ord_/)
  })

  it("creates the order pending_payment and unpaid, owned by the caller", async () => {
    await POST(post(validBody))
    const order = db.rows("orders")[0]!
    expect(order["status"]).toBe("pending_payment")
    expect(order["payment_status"]).toBe("unpaid")
    expect(order["user_id"]).toBe("u1")
    expect(order["quote_id"]).toBe("qt_1")
  })

  it("freezes the design version and the configuration onto the order", async () => {
    await POST(post(validBody))
    const order = db.rows("orders")[0]!
    expect(order["frozen_dv_id"]).toBe("dv_1")
    expect(order["frozen_config_json"]).toEqual({
      configurationId: "cfg_1",
      materialId: "pla",
      colorId: "pla-white",
      dimensionsMm: { x: 10, y: 10, z: 10 },
      scaleFactor: 1.5,
      qualityId: "standard",
      strengthId: "everyday",
      shippingSpeed: "standard",
      specialInstructions: "handle with care",
    })
  })

  it("stores the normalized contact and shipping address", async () => {
    await POST(post({ ...validBody, contact: { ...CONTACT, phone: "09876543210" } }))
    const order = db.rows("orders")[0]!
    expect(order["contact_json"]).toEqual(CONTACT)
    expect(order["shipping_address_json"]).toEqual({ ...ADDRESS, country: "IN" })
  })

  it("CONSUMEs the quote so it can never be paid twice", async () => {
    await POST(post(validBody))
    expect(db.rows("quotes")[0]!["status"]).toBe("consumed")
  })

  it("re-reads the amount from the stored quote", async () => {
    await POST(post(validBody))
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { amountMinor: 24360, currency: "INR" } })
    )
  })

  it("passes quote and order ids through as provider metadata", async () => {
    await POST(post(validBody))
    const orderId = db.rows("orders")[0]!["id"]
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: "qt_1",
        orderId,
        metadata: { quote_id: "qt_1", order_id: orderId },
        returnUrl: `http://test.local/orders/${orderId}`,
        customer: { email: "asha@example.com", name: "Asha Rao" },
      })
    )
  })

  it("records the provider session id on the order", async () => {
    await POST(post(validBody))
    expect(db.rows("orders")[0]!["provider_session_id"]).toBe("cks_mock_ord_1")
  })

  it("writes an audit event for the checkout", async () => {
    await POST(post(validBody))
    const audit = db.rows("audit_events")[0]!
    expect(audit["actor_id"]).toBe("u1")
    expect(audit["actor_kind"]).toBe("user")
    expect(audit["entity_type"]).toBe("order")
    expect(audit["action"]).toBe("checkout.session_created")
    expect(audit["metadata"]).toMatchObject({ quoteId: "qt_1", amountMinor: 24360 })
  })

  it("refuses a second checkout for the same quote", async () => {
    expect((await POST(post(validBody))).status).toBe(201)
    const second = await POST(post(validBody))
    expect(second.status).toBe(409)
    expect(db.rows("orders")).toHaveLength(1)
  })
})

describe("POST /api/checkout/session — provider and database failures", () => {
  it("cancels the order and reports 502 when the session cannot be opened", async () => {
    createCheckout.mockResolvedValue({ ok: false, error: appError("provider_error", "dodo down") })
    const res = await POST(post(validBody))
    expect(res.status).toBe(502)
    expect(db.rows("orders")[0]!["status"]).toBe("cancelled")
    expect(db.rows("quotes")[0]!["status"]).toBe("consumed")
  })

  it("reports the write failure when even the cancellation cannot be persisted", async () => {
    createCheckout.mockResolvedValue({ ok: false, error: appError("provider_error", "dodo down") })
    db.failCall(7, { message: "cancel boom" }) // op7 = updateOrderStatus
    expect((await POST(post(validBody))).status).toBe(502)
  })

  it.each([
    ["quote lookup", 1],
    ["configuration lookup", 2],
    ["design version lookup", 3],
    ["validation report lookup", 4],
    ["order insert", 5],
    ["quote consume", 6],
    ["provider session write", 7],
    ["audit insert", 8],
  ])("502 when the %s fails", async (_label, call) => {
    db = seed()
    db.failCall(call, { message: "boom" })
    expect((await POST(post(validBody))).status).toBe(502)
  })

  it("502 when expiring a lapsed quote fails", async () => {
    db = seed({ quoteRows: [quoteRow({ expires_at: "2000-01-01T00:00:00.000Z" })] })
    db.failCall(5, { message: "expire boom" })
    expect((await POST(post(validBody))).status).toBe(502)
  })
})
