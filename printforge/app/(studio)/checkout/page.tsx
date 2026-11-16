import { notFound, redirect } from "next/navigation"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import { CheckoutForm } from "@/src/components/checkout/checkout-form"
import { OrderSummary } from "@/src/components/checkout/order-summary"
import { PageHeader } from "@/src/components/layout/primitives"
import { checkoutContent } from "@/src/config/content"
import { getDesignVersion } from "@/src/data/designVersions"
import { getConfigurationById } from "@/src/data/printConfigurations"
import { getQuote } from "@/src/data/quotes"
import { getRequestDb } from "@/src/data/supabaseClients"
import { freezeConfiguration } from "@/src/domain/checkout/frozenConfig"
import { isExpired } from "@/src/domain/quoting/quote"
import { SystemClock } from "@/src/lib/clock"

/**
 * Checkout (plan §6-S13 step 4): review the frozen configuration and price, then
 * hand off to the hosted payment page. Reads go through the RLS client, so
 * someone else's quote is simply not found. The form posts only
 * `{quoteId, contact, shippingAddress}` — the amount stays server-side.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string }>
}) {
  const { quoteId } = await searchParams

  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) redirect("/login")
  if (quoteId === undefined) notFound()

  const db = await getRequestDb()
  const quote = await getQuote(db, quoteId)
  if (!quote.ok || quote.value === null) notFound()

  const config = await getConfigurationById(db, quote.value.configuration_id)
  if (!config.ok || config.value === null) notFound()

  const dv = await getDesignVersion(db, config.value.design_version_id)
  if (!dv.ok || dv.value === null) notFound()

  const payable =
    quote.value.status === "active" && !isExpired(quote.value.expires_at, new SystemClock().now())

  return (
    <div className="space-y-6">
      <PageHeader title={checkoutContent.title} description={checkoutContent.intro} />

      <div className="grid gap-6 lg:grid-cols-2">
        <OrderSummary
          heading={checkoutContent.reviewHeading}
          thumbnailAssetId={dv.value.thumbnail_asset_id}
          config={freezeConfiguration(config.value)}
          breakdown={quote.value.breakdown_json}
          totalMinor={quote.value.amount_minor}
          totalLabel={checkoutContent.totalLabel}
        />

        {payable ? (
          <CheckoutForm quoteId={quote.value.id} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {checkoutContent.unavailable}
          </p>
        )}
      </div>
    </div>
  )
}
