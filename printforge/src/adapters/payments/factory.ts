import "server-only"

import type { PaymentProvider } from "@/src/adapters/payments"
import { DodoProvider } from "@/src/adapters/payments/dodo"
import { MockPaymentProvider } from "@/src/adapters/payments/mock"
import { getEnv } from "@/src/config/env"

/**
 * Resolve the payment provider from env (plan §4.4). `getEnv` already refuses to
 * load a `dodo` configuration without its three credentials, so the casts below
 * cannot widen at runtime.
 */
export function getPaymentProvider(): PaymentProvider {
  const env = getEnv()
  if (env.PAYMENT_PROVIDER === "dodo") {
    return new DodoProvider({
      apiKey: env.DODO_API_KEY as string,
      productId: env.DODO_PRODUCT_ID as string,
      webhookSecret: env.DODO_WEBHOOK_SECRET as string,
      environment: env.DODO_ENV,
    })
  }
  return new MockPaymentProvider()
}
