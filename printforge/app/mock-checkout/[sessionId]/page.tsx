import { notFound } from "next/navigation"

import { buildMockWebhook, orderIdFromMockSession } from "@/src/adapters/payments/mock"
import { MockCheckoutPanel } from "@/src/components/checkout/mock-checkout-panel"
import { getEnv } from "@/src/config/env"
import { getOrder } from "@/src/data/orders"
import { getQuote } from "@/src/data/quotes"
import { getServiceDb } from "@/src/data/supabaseClients"
import { formatINR, inr } from "@/src/lib/money"

/**
 * Dev-only stand-in for Dodo's hosted checkout (plan §6-S13 step 2). It exists
 * only when the mock provider is selected and we are not in production; the real
 * provider redirects to Dodo instead. Both webhooks are signed here on the
 * server, and the client POSTs the signed bytes unchanged.
 */
export default async function MockCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const env = getEnv()
  if (env.NODE_ENV === "production" || env.PAYMENT_PROVIDER !== "mock") notFound()

  const { sessionId } = await params
  const orderId = orderIdFromMockSession(sessionId)
  if (!orderId.ok) notFound()

  const db = getServiceDb()
  const order = await getOrder(db, orderId.value)
  if (!order.ok || order.value === null) notFound()

  const quote = await getQuote(db, order.value.quote_id)
  if (!quote.ok || quote.value === null) notFound()

  const amount = inr(quote.value.amount_minor)
  const common = { orderId: order.value.id, quoteId: quote.value.id }

  return (
    <main className="mx-auto max-w-md p-10">
      <MockCheckoutPanel
        orderId={order.value.id}
        amountLabel={formatINR(amount)}
        returnUrl={`/orders/${order.value.id}`}
        pay={buildMockWebhook({ type: "payment.succeeded", ...common, amount })}
        fail={buildMockWebhook({ type: "payment.failed", ...common })}
      />
    </main>
  )
}
