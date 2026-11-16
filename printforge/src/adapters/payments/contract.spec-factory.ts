import { describe, expect, it } from "vitest"

import type { PaymentProvider } from "@/src/adapters/payments"
import { buildMockWebhook, type MockWebhookInput } from "@/src/adapters/payments/mock"
import { inr } from "@/src/lib/money"

const AMOUNT = inr(24360)

const CHECKOUT_INPUT = {
  quoteId: "qt_1",
  orderId: "ord_1",
  amount: AMOUNT,
  customer: { email: "asha@example.com", name: "Asha Rao" },
  returnUrl: "http://localhost:3000/orders/ord_1",
  metadata: { quote_id: "qt_1", order_id: "ord_1" },
}

/**
 * Shared contract every PaymentProvider must satisfy (plan §4.4), run against
 * both the mock and the real Dodo provider (the latter behind MSW) so they can
 * never drift. Webhook cases sign a Dodo-shaped payload with the subject's own
 * secret and push it through the subject's real verification path.
 */
export function paymentProviderContract(
  makeSubject: () => { provider: PaymentProvider; webhookSecret: string }
): void {
  function signed(input: MockWebhookInput, opts: { at?: Date; eventId?: string } = {}) {
    const { provider, webhookSecret } = makeSubject()
    const built = buildMockWebhook(input, { ...opts, secret: webhookSecret })
    return { provider, ...built }
  }

  describe("PaymentProvider contract", () => {
    it("createCheckout returns a session id and a checkout url", async () => {
      const { provider } = makeSubject()
      const result = await provider.createCheckout(CHECKOUT_INPUT)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.providerSessionId.length).toBeGreaterThan(0)
        expect(result.value.checkoutUrl.length).toBeGreaterThan(0)
      }
    })

    it("parses a signed payment.succeeded into paymentRef, amount and metadata", () => {
      const { provider, rawBody, headers } = signed(
        { type: "payment.succeeded", orderId: "ord_1", quoteId: "qt_1", amount: AMOUNT },
        { eventId: "evt_ok" }
      )
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok).toBe(true)
      if (result.ok && result.value.type === "payment.succeeded") {
        expect(result.value.eventId).toBe("evt_ok")
        expect(result.value.paymentRef.length).toBeGreaterThan(0)
        expect(result.value.amount).toEqual(AMOUNT)
        expect(result.value.metadata).toMatchObject({ order_id: "ord_1", quote_id: "qt_1" })
      } else {
        expect.unreachable("expected a payment.succeeded event")
      }
    })

    it("parses a signed payment.failed with a reason", () => {
      const { provider, rawBody, headers } = signed({
        type: "payment.failed",
        orderId: "ord_1",
        quoteId: "qt_1",
        reason: "card declined",
      })
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok).toBe(true)
      if (result.ok && result.value.type === "payment.failed") {
        expect(result.value.reason).toBe("card declined")
        expect(result.value.metadata["order_id"]).toBe("ord_1")
      } else {
        expect.unreachable("expected a payment.failed event")
      }
    })

    it("parses a signed refund.succeeded with its amount", () => {
      const { provider, rawBody, headers } = signed({
        type: "refund.succeeded",
        orderId: "ord_1",
        amount: inr(10000),
      })
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok).toBe(true)
      if (result.ok && result.value.type === "refund.succeeded") {
        expect(result.value.amount).toEqual(inr(10000))
      } else {
        expect.unreachable("expected a refund.succeeded event")
      }
    })

    it("parses a signed dispute.opened", () => {
      const { provider, rawBody, headers } = signed({ type: "dispute.opened", orderId: "ord_1" })
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok && result.value.type).toBe("dispute.opened")
    })

    it("collapses an unhandled event type into `ignored`", () => {
      const { provider, rawBody, headers } = signed({
        type: "ignored",
        rawType: "subscription.renewed",
      })
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok).toBe(true)
      if (result.ok && result.value.type === "ignored") {
        expect(result.value.rawType).toBe("subscription.renewed")
      } else {
        expect.unreachable("expected an ignored event")
      }
    })

    it("rejects a tampered body", () => {
      const { provider, rawBody, headers } = signed({
        type: "payment.succeeded",
        orderId: "ord_1",
        quoteId: "qt_1",
        amount: AMOUNT,
      })
      const tampered = rawBody.replace(String(AMOUNT.amountMinor), "1")
      const result = provider.verifyAndParseWebhook(tampered, headers)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("unauthorized")
    })

    it("rejects a wrong signature", () => {
      const { provider, rawBody, headers } = signed({ type: "dispute.opened", orderId: "ord_1" })
      const result = provider.verifyAndParseWebhook(rawBody, {
        ...headers,
        "webhook-signature": "v1,ZGVmaW5pdGVseS1ub3QtdGhlLXNpZ25hdHVyZQ==",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("unauthorized")
    })

    it("rejects missing signature headers", () => {
      const { provider, rawBody } = signed({ type: "dispute.opened", orderId: "ord_1" })
      const result = provider.verifyAndParseWebhook(rawBody, {})
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("unauthorized")
    })

    it("rejects a stale timestamp outside the ±5 minute window", () => {
      const { provider, rawBody, headers } = signed(
        { type: "dispute.opened", orderId: "ord_1" },
        { at: new Date(Date.now() - 10 * 60 * 1000) }
      )
      const result = provider.verifyAndParseWebhook(rawBody, headers)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.message).toContain("timestamp")
    })

    it("createRefund returns a refund reference for a full refund", async () => {
      const { provider } = makeSubject()
      const result = await provider.createRefund("pay_1")
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.refundRef.length).toBeGreaterThan(0)
    })

    it("createRefund returns a refund reference for a partial refund", async () => {
      const { provider } = makeSubject()
      const result = await provider.createRefund("pay_1", inr(5000))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.refundRef.length).toBeGreaterThan(0)
    })
  })
}
