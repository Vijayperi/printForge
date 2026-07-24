import type { CheckoutInput, PaymentEvent, PaymentProvider } from "@/src/adapters/payments"
import { normalizePaymentPayload } from "@/src/adapters/payments/payload"
import {
  signStandardWebhook,
  verifyStandardWebhook,
} from "@/src/adapters/payments/standardWebhook"
import { SystemClock, type Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import type { Money } from "@/src/lib/money"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * Not a credential: a fixed base64 key so the dev `/mock-checkout` page and the
 * E2E suite can sign webhooks that travel the REAL Standard Webhooks verification
 * path (plan §6-S13 step 2). The mock provider is only ever selected when
 * PAYMENT_PROVIDER=mock.
 */
export const MOCK_PAYMENT_WEBHOOK_SECRET = "cHJpbnRmb3JnZS1tb2NrLXdlYmhvb2stc2VjcmV0LXYx"

const SESSION_PREFIX = "cks_mock_"

/** Deterministic session id — the order id is recoverable from it, so the dev page needs no store. */
export function mockSessionId(orderId: string): string {
  return `${SESSION_PREFIX}${orderId}`
}

export function orderIdFromMockSession(sessionId: string): Result<string> {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    return err(appError("validation", `not a mock checkout session: ${sessionId}`))
  }
  const orderId = sessionId.slice(SESSION_PREFIX.length)
  if (orderId.length === 0) {
    return err(appError("validation", "mock checkout session has no order id"))
  }
  return ok(orderId)
}

/** Deterministic payment reference for an order, mirroring Dodo's `payment_id`. */
export function mockPaymentRef(orderId: string): string {
  return `pay_mock_${orderId}`
}

export type MockWebhookInput =
  | { type: "payment.succeeded"; orderId: string; quoteId: string; amount: Money }
  | { type: "payment.failed"; orderId: string; quoteId: string; reason?: string }
  | { type: "refund.succeeded"; orderId: string; amount: Money }
  | { type: "dispute.opened"; orderId: string }
  | { type: "ignored"; rawType: string }

function mockPayloadData(input: MockWebhookInput): Record<string, unknown> {
  switch (input.type) {
    case "payment.succeeded":
      return {
        payload_type: "Payment",
        payment_id: mockPaymentRef(input.orderId),
        total_amount: input.amount.amountMinor,
        currency: input.amount.currency,
        metadata: { order_id: input.orderId, quote_id: input.quoteId },
      }
    case "payment.failed":
      return {
        payload_type: "Payment",
        payment_id: mockPaymentRef(input.orderId),
        error_message: input.reason ?? "mock payment declined",
        metadata: { order_id: input.orderId, quote_id: input.quoteId },
      }
    case "refund.succeeded":
      return {
        payload_type: "Refund",
        refund_id: `rfnd_mock_${input.orderId}`,
        payment_id: mockPaymentRef(input.orderId),
        amount: input.amount.amountMinor,
        currency: input.amount.currency,
      }
    case "dispute.opened":
      return {
        payload_type: "Dispute",
        dispute_id: `dis_mock_${input.orderId}`,
        payment_id: mockPaymentRef(input.orderId),
      }
    case "ignored":
      return { payload_type: "Subscription" }
  }
}

/**
 * Build a signed, Dodo-shaped webhook the dev checkout page (or a test) can POST
 * straight at `/api/webhooks/dodo`. Returns the exact raw body that was signed —
 * callers must send it byte-for-byte.
 */
export function buildMockWebhook(
  input: MockWebhookInput,
  opts: { eventId?: string; at?: Date; secret?: string } = {}
): { rawBody: string; headers: Record<string, string> } {
  const eventType = input.type === "ignored" ? input.rawType : input.type
  const at = opts.at ?? new Date()
  const eventId = opts.eventId ?? `evt_mock_${at.getTime()}_${eventType}`
  const rawBody = JSON.stringify({
    business_id: "biz_mock",
    type: eventType,
    timestamp: at.toISOString(),
    data: mockPayloadData(input),
  })
  return {
    rawBody,
    headers: signStandardWebhook(opts.secret ?? MOCK_PAYMENT_WEBHOOK_SECRET, eventId, at, rawBody),
  }
}

/**
 * Deterministic in-process payment provider for development and tests. Webhooks
 * are genuinely signed and genuinely verified — only the hosted checkout page is
 * faked (plan §6-S13 step 2).
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly clock: Clock
  private readonly secret: string

  constructor(opts: { clock?: Clock; secret?: string } = {}) {
    this.clock = opts.clock ?? new SystemClock()
    this.secret = opts.secret ?? MOCK_PAYMENT_WEBHOOK_SECRET
  }

  async createCheckout(
    input: CheckoutInput
  ): Promise<Result<{ providerSessionId: string; checkoutUrl: string }>> {
    const providerSessionId = mockSessionId(input.orderId)
    return ok({ providerSessionId, checkoutUrl: `/mock-checkout/${providerSessionId}` })
  }

  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): Result<PaymentEvent> {
    const verified = verifyStandardWebhook(this.secret, rawBody, headers, this.clock)
    if (!verified.ok) return verified
    return normalizePaymentPayload(verified.value.eventId, verified.value.payload)
  }

  async createRefund(paymentRef: string, amount?: Money): Promise<Result<{ refundRef: string }>> {
    const suffix = amount === undefined ? "full" : String(amount.amountMinor)
    return ok({ refundRef: `rfnd_mock_${paymentRef}_${suffix}` })
  }
}
