import type { Money } from "@/src/lib/money"
import type { Result } from "@/src/lib/result"

/** Everything a provider needs to open a hosted checkout for one order (plan §4.4). */
export interface CheckoutInput {
  quoteId: string
  orderId: string
  amount: Money
  customer: { email: string; name: string }
  returnUrl: string
  metadata: Record<string, string>
}

/**
 * Normalized payment lifecycle events (plan §4.4). Provider event types we do
 * not act on collapse into `ignored`, which the webhook route logs and ACKs so
 * the provider stops retrying.
 */
export type PaymentEvent =
  | {
      type: "payment.succeeded"
      eventId: string
      paymentRef: string
      metadata: Record<string, string>
      amount: Money
    }
  | { type: "payment.failed"; eventId: string; metadata: Record<string, string>; reason: string }
  | { type: "refund.succeeded"; eventId: string; paymentRef: string; amount: Money }
  | { type: "dispute.opened"; eventId: string; paymentRef: string }
  | { type: "ignored"; eventId: string; rawType: string }

export interface PaymentProvider {
  createCheckout(
    input: CheckoutInput
  ): Promise<Result<{ providerSessionId: string; checkoutUrl: string }>>
  /**
   * Verify a raw webhook body against its signature headers and normalize it.
   * The RAW body string must be passed — parsing and re-stringifying breaks the
   * signature (plan §2.2).
   */
  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): Result<PaymentEvent>
  createRefund(paymentRef: string, amount?: Money): Promise<Result<{ refundRef: string }>>
}

/** Standard Webhooks signature headers, lower-cased (plan §2.2). */
export const WEBHOOK_ID_HEADER = "webhook-id"
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp"
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature"

/** How far a webhook timestamp may drift from our clock before we reject it. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000
