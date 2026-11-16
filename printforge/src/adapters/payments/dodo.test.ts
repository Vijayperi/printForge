import type DodoPayments from "dodopayments"
import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"

import { paymentProviderContract } from "@/src/adapters/payments/contract.spec-factory"
import { DodoProvider } from "@/src/adapters/payments/dodo"
import { buildMockWebhook } from "@/src/adapters/payments/mock"
import { FixedClock } from "@/src/lib/clock"
import { inr } from "@/src/lib/money"
import { server } from "@/tests/msw/server"

import checkoutSessionCreated from "@/tests/fixtures/dodo/checkout-session-created.json"
import checkoutSessionNoUrl from "@/tests/fixtures/dodo/checkout-session-no-url.json"
import refundCreated from "@/tests/fixtures/dodo/refund-created.json"
import webhookPaymentSucceeded from "@/tests/fixtures/dodo/webhook-payment-succeeded.json"

const BASE = "https://test.dodopayments.com"
const CHECKOUT_URL = `${BASE}/checkouts`
const REFUND_URL = `${BASE}/refunds`

const SECRET = "ZG9kby10ZXN0LXdlYmhvb2stc2VjcmV0LXZhbA=="
const PRODUCT_ID = "pdt_custom_3d_print"

function makeProvider() {
  return new DodoProvider({
    apiKey: "dodo-test-key",
    productId: PRODUCT_ID,
    webhookSecret: SECRET,
    environment: "test_mode",
  })
}

const CHECKOUT_INPUT = {
  quoteId: "qt_1",
  orderId: "ord_1",
  amount: inr(24360),
  customer: { email: "asha@example.com", name: "Asha Rao" },
  returnUrl: "http://localhost:3000/orders/ord_1",
  metadata: { source: "quote_panel" },
}

/** Capture what we actually put on the wire. */
let lastCheckoutBody: Record<string, unknown> | null
let lastRefundBody: Record<string, unknown> | null
let lastAuthorization: string | null

beforeEach(() => {
  lastCheckoutBody = null
  lastRefundBody = null
  lastAuthorization = null
  server.use(
    http.post(CHECKOUT_URL, async ({ request }) => {
      lastCheckoutBody = (await request.json()) as Record<string, unknown>
      lastAuthorization = request.headers.get("authorization")
      return HttpResponse.json(checkoutSessionCreated)
    }),
    http.post(REFUND_URL, async ({ request }) => {
      lastRefundBody = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(refundCreated)
    })
  )
})

paymentProviderContract(() => ({ provider: makeProvider(), webhookSecret: SECRET }))

describe("DodoProvider.createCheckout", () => {
  it("returns the session id and hosted checkout url", async () => {
    const result = await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(result).toEqual({
      ok: true,
      value: {
        providerSessionId: checkoutSessionCreated.session_id,
        checkoutUrl: checkoutSessionCreated.checkout_url,
      },
    })
  })

  it("sends the server-computed amount as the pay-what-you-want line amount", async () => {
    await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(lastCheckoutBody).toMatchObject({
      product_cart: [{ product_id: PRODUCT_ID, quantity: 1, amount: 24360 }],
      customer: { email: "asha@example.com", name: "Asha Rao" },
      billing_address: { country: "IN" },
      return_url: "http://localhost:3000/orders/ord_1",
    })
  })

  it("always carries quote_id and order_id in metadata", async () => {
    await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(lastCheckoutBody?.["metadata"]).toEqual({
      source: "quote_panel",
      quote_id: "qt_1",
      order_id: "ord_1",
    })
  })

  it("authenticates with the configured api key", async () => {
    await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(lastAuthorization).toBe("Bearer dodo-test-key")
  })

  it("fails when the session comes back without a checkout url", async () => {
    server.use(http.post(CHECKOUT_URL, () => HttpResponse.json(checkoutSessionNoUrl)))
    const result = await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("without a checkout url")
  })

  it("fails when the session comes back with an empty checkout url", async () => {
    server.use(
      http.post(CHECKOUT_URL, () => HttpResponse.json({ session_id: "cks_1", checkout_url: "" }))
    )
    const result = await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("without a checkout url")
  })

  it("maps an api error onto provider_error", async () => {
    server.use(
      http.post(CHECKOUT_URL, () =>
        HttpResponse.json({ error: "product not found" }, { status: 404 })
      )
    )
    const result = await makeProvider().createCheckout(CHECKOUT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("provider_error")
      expect(result.error.message).toContain("checkout session create failed")
    }
  })
})

describe("DodoProvider.createRefund", () => {
  it("refunds the whole payment when no amount is given", async () => {
    const result = await makeProvider().createRefund("pay_8Jw3nQx1Ab")
    expect(result).toEqual({ ok: true, value: { refundRef: refundCreated.refund_id } })
    expect(lastRefundBody).toEqual({ payment_id: "pay_8Jw3nQx1Ab" })
  })

  it("expresses a partial refund as an amount on the single catalog item", async () => {
    await makeProvider().createRefund("pay_8Jw3nQx1Ab", inr(5000))
    expect(lastRefundBody).toEqual({
      payment_id: "pay_8Jw3nQx1Ab",
      items: [{ item_id: PRODUCT_ID, amount: 5000 }],
    })
  })

  it("maps an api error onto provider_error", async () => {
    server.use(
      http.post(REFUND_URL, () => HttpResponse.json({ error: "already refunded" }, { status: 422 }))
    )
    const result = await makeProvider().createRefund("pay_8Jw3nQx1Ab")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("provider_error")
      expect(result.error.message).toContain("refund create failed")
    }
  })
})

describe("DodoProvider.verifyAndParseWebhook", () => {
  it("rejects the documented payload when it is not signed", () => {
    const result = makeProvider().verifyAndParseWebhook(
      JSON.stringify(webhookPaymentSucceeded),
      {}
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unauthorized")
  })

  it("measures the timestamp tolerance against the injected clock", () => {
    const { rawBody, headers } = buildMockWebhook(
      { type: "dispute.opened", orderId: "ord_1" },
      { secret: SECRET }
    )
    const skewed = new DodoProvider({
      apiKey: "k",
      productId: PRODUCT_ID,
      webhookSecret: SECRET,
      clock: new FixedClock(new Date(Date.now() + 10 * 60 * 1000)),
    })
    const result = skewed.verifyAndParseWebhook(rawBody, headers)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("timestamp")
  })
})

describe("DodoProvider construction", () => {
  it("defaults to test_mode", async () => {
    const provider = new DodoProvider({
      apiKey: "k",
      productId: PRODUCT_ID,
      webhookSecret: SECRET,
    })
    expect((await provider.createCheckout(CHECKOUT_INPUT)).ok).toBe(true)
  })

  it("stringifies a rejection that is not an Error", async () => {
    const provider = new DodoProvider({
      apiKey: "k",
      productId: PRODUCT_ID,
      webhookSecret: SECRET,
      client: {
        checkoutSessions: {
          create: async () => {
            throw "socket hang up"
          },
        },
      } as unknown as DodoPayments,
    })
    const result = await provider.createCheckout(CHECKOUT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("socket hang up")
  })

  it("targets live_mode when asked", async () => {
    let hit = false
    server.use(
      http.post("https://live.dodopayments.com/checkouts", () => {
        hit = true
        return HttpResponse.json(checkoutSessionCreated)
      })
    )
    const provider = new DodoProvider({
      apiKey: "k",
      productId: PRODUCT_ID,
      webhookSecret: SECRET,
      environment: "live_mode",
    })
    expect((await provider.createCheckout(CHECKOUT_INPUT)).ok).toBe(true)
    expect(hit).toBe(true)
  })
})
