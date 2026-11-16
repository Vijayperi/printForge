import { describe, expect, it } from "vitest"

import { paymentProviderContract } from "@/src/adapters/payments/contract.spec-factory"
import {
  buildMockWebhook,
  MOCK_PAYMENT_WEBHOOK_SECRET,
  MockPaymentProvider,
  mockPaymentRef,
  mockSessionId,
  orderIdFromMockSession,
} from "@/src/adapters/payments/mock"
import { inr } from "@/src/lib/money"

paymentProviderContract(() => ({
  provider: new MockPaymentProvider(),
  webhookSecret: MOCK_PAYMENT_WEBHOOK_SECRET,
}))

const CHECKOUT_INPUT = {
  quoteId: "qt_1",
  orderId: "ord_1",
  amount: inr(24360),
  customer: { email: "asha@example.com", name: "Asha Rao" },
  returnUrl: "http://localhost:3000/orders/ord_1",
  metadata: {},
}

describe("mock session ids", () => {
  it("derives a deterministic session id from the order id", () => {
    expect(mockSessionId("ord_1")).toBe("cks_mock_ord_1")
    expect(mockSessionId("ord_1")).toBe(mockSessionId("ord_1"))
  })

  it("round-trips the order id back out", () => {
    expect(orderIdFromMockSession(mockSessionId("ord_9"))).toEqual({ ok: true, value: "ord_9" })
  })

  it("rejects a session id from another provider", () => {
    const result = orderIdFromMockSession("cks_Gi6KGJ2zFJo9rq9Ukifwa")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("validation")
  })

  it("rejects a session id with no order id", () => {
    const result = orderIdFromMockSession("cks_mock_")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("no order id")
  })

  it("derives a deterministic payment reference", () => {
    expect(mockPaymentRef("ord_1")).toBe("pay_mock_ord_1")
  })
})

describe("MockPaymentProvider.createCheckout", () => {
  it("points at the dev mock-checkout page", async () => {
    const result = await new MockPaymentProvider().createCheckout(CHECKOUT_INPUT)
    expect(result).toEqual({
      ok: true,
      value: { providerSessionId: "cks_mock_ord_1", checkoutUrl: "/mock-checkout/cks_mock_ord_1" },
    })
  })

  it("is deterministic across calls for the same order", async () => {
    const provider = new MockPaymentProvider()
    const first = await provider.createCheckout(CHECKOUT_INPUT)
    const second = await provider.createCheckout(CHECKOUT_INPUT)
    expect(first).toEqual(second)
  })
})

describe("MockPaymentProvider.createRefund", () => {
  it("labels a full refund", async () => {
    const result = await new MockPaymentProvider().createRefund("pay_mock_ord_1")
    expect(result).toEqual({ ok: true, value: { refundRef: "rfnd_mock_pay_mock_ord_1_full" } })
  })

  it("labels a partial refund with its amount", async () => {
    const result = await new MockPaymentProvider().createRefund("pay_mock_ord_1", inr(5000))
    expect(result).toEqual({ ok: true, value: { refundRef: "rfnd_mock_pay_mock_ord_1_5000" } })
  })
})

describe("buildMockWebhook", () => {
  it("generates a default event id carrying the event type", () => {
    const { rawBody, headers } = buildMockWebhook({ type: "dispute.opened", orderId: "ord_1" })
    expect(headers["webhook-id"]).toContain("dispute.opened")
    expect(JSON.parse(rawBody).type).toBe("dispute.opened")
  })

  it("emits Dodo-shaped payloads so mock webhooks exercise the real normalizer", () => {
    const { rawBody } = buildMockWebhook({
      type: "payment.succeeded",
      orderId: "ord_1",
      quoteId: "qt_1",
      amount: inr(100),
    })
    const payload = JSON.parse(rawBody)
    expect(payload).toMatchObject({
      business_id: "biz_mock",
      type: "payment.succeeded",
      data: { payload_type: "Payment", total_amount: 100, currency: "INR" },
    })
    expect(typeof payload.timestamp).toBe("string")
  })

  it("defaults a payment.failed reason", () => {
    const { rawBody } = buildMockWebhook({
      type: "payment.failed",
      orderId: "ord_1",
      quoteId: "qt_1",
    })
    expect(JSON.parse(rawBody).data.error_message).toBe("mock payment declined")
  })

  it("labels a refund payload with the mock refund and payment refs", () => {
    const { rawBody } = buildMockWebhook({
      type: "refund.succeeded",
      orderId: "ord_1",
      amount: inr(100),
    })
    expect(JSON.parse(rawBody).data).toMatchObject({
      payload_type: "Refund",
      refund_id: "rfnd_mock_ord_1",
      payment_id: "pay_mock_ord_1",
    })
  })

  it("emits an unhandled type verbatim so the provider can ignore it", () => {
    const { rawBody } = buildMockWebhook({ type: "ignored", rawType: "payout.success" })
    expect(JSON.parse(rawBody)).toMatchObject({
      type: "payout.success",
      data: { payload_type: "Subscription" },
    })
  })

  it("signs with a caller-supplied secret", () => {
    const secret = "b3RoZXItc2VjcmV0LXZhbHVlLWhlcmU="
    const { rawBody, headers } = buildMockWebhook({ type: "dispute.opened", orderId: "ord_1" }, { secret })
    const wrongSecret = new MockPaymentProvider().verifyAndParseWebhook(rawBody, headers)
    expect(wrongSecret.ok).toBe(false)
    const rightSecret = new MockPaymentProvider({ secret }).verifyAndParseWebhook(rawBody, headers)
    expect(rightSecret.ok).toBe(true)
  })
})
