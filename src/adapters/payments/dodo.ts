import "server-only"

import DodoPayments from "dodopayments"

import type { CheckoutInput, PaymentEvent, PaymentProvider } from "@/src/adapters/payments"
import { normalizePaymentPayload } from "@/src/adapters/payments/payload"
import { verifyStandardWebhook } from "@/src/adapters/payments/standardWebhook"
import { SHIPPING_COUNTRY } from "@/src/config/commerce"
import type { Clock } from "@/src/lib/clock"
import { SystemClock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import type { Money } from "@/src/lib/money"
import { err, ok, type Result } from "@/src/lib/result"

export interface DodoProviderOptions {
  apiKey: string
  /** Catalog product with "pay what you want" enabled — the per-quote price carrier (plan §2.2). */
  productId: string
  webhookSecret: string
  environment?: "test_mode" | "live_mode"
  clock?: Clock
  /** Test seam: an already-constructed SDK client. */
  client?: DodoPayments
}

function providerError(action: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return appError("provider_error", `dodo ${action} failed: ${message}`, cause)
}

/**
 * Dodo Payments provider (plan §2.2). Amounts never come from the client: the
 * quote total is passed as the pay-what-you-want `amount` on a single catalog
 * product, in INR paise.
 *
 * This file is the ONLY place that may reference a Dodo credential.
 */
export class DodoProvider implements PaymentProvider {
  private readonly client: DodoPayments
  private readonly productId: string
  private readonly webhookSecret: string
  private readonly clock: Clock

  constructor(opts: DodoProviderOptions) {
    this.client =
      opts.client ??
      new DodoPayments({
        bearerToken: opts.apiKey,
        environment: opts.environment ?? "test_mode",
      })
    this.productId = opts.productId
    this.webhookSecret = opts.webhookSecret
    this.clock = opts.clock ?? new SystemClock()
  }

  async createCheckout(
    input: CheckoutInput
  ): Promise<Result<{ providerSessionId: string; checkoutUrl: string }>> {
    try {
      const session = await this.client.checkoutSessions.create({
        product_cart: [
          { product_id: this.productId, quantity: 1, amount: input.amount.amountMinor },
        ],
        customer: { email: input.customer.email, name: input.customer.name },
        billing_address: { country: SHIPPING_COUNTRY },
        return_url: input.returnUrl,
        metadata: { ...input.metadata, quote_id: input.quoteId, order_id: input.orderId },
      })
      const checkoutUrl = session.checkout_url
      if (checkoutUrl === undefined || checkoutUrl === null || checkoutUrl.length === 0) {
        return err(appError("provider_error", "dodo returned a session without a checkout url"))
      }
      return ok({ providerSessionId: session.session_id, checkoutUrl })
    } catch (cause) {
      return err(providerError("checkout session create", cause))
    }
  }

  verifyAndParseWebhook(rawBody: string, headers: Record<string, string>): Result<PaymentEvent> {
    const verified = verifyStandardWebhook(this.webhookSecret, rawBody, headers, this.clock)
    if (!verified.ok) return verified
    return normalizePaymentPayload(verified.value.eventId, verified.value.payload)
  }

  /**
   * Refund a payment. Dodo has no top-level partial amount: a partial refund is
   * expressed per line item, and our cart is always the single catalog product.
   */
  async createRefund(paymentRef: string, amount?: Money): Promise<Result<{ refundRef: string }>> {
    try {
      const refund = await this.client.refunds.create(
        amount === undefined
          ? { payment_id: paymentRef }
          : {
              payment_id: paymentRef,
              items: [{ item_id: this.productId, amount: amount.amountMinor }],
            }
      )
      return ok({ refundRef: refund.refund_id })
    } catch (cause) {
      return err(providerError("refund create", cause))
    }
  }
}
