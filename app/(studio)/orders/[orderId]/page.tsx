import { notFound, redirect } from "next/navigation"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import { OrderSummary } from "@/src/components/checkout/order-summary"
import { PageHeader } from "@/src/components/layout/primitives"
import { OrderStatus } from "@/src/components/orders/order-status"
import { ShipmentTracking } from "@/src/components/orders/shipment-tracking"
import { ordersContent } from "@/src/config/content"
import { getDesignVersion } from "@/src/data/designVersions"
import { getOrderOwned } from "@/src/data/orders"
import { getQuote } from "@/src/data/quotes"
import { listShipmentsByOrder } from "@/src/data/shipments"
import { getRequestDb } from "@/src/data/supabaseClients"
import { readFrozenConfig } from "@/src/domain/checkout/frozenConfig"
import { readStoredAddress, readStoredContact } from "@/src/domain/checkout/schema"
import type { OrderState } from "@/src/domain/stateMachines/order"

/**
 * Order detail / payment return page (plan §6-S13 step 4). Everything shown is
 * the snapshot frozen at purchase, and the status track is driven by the
 * webhook — arriving here from the payment page proves nothing on its own.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params

  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) redirect("/login")

  const db = await getRequestDb()
  const order = await getOrderOwned(db, user.value.userId, orderId)
  if (!order.ok || order.value === null) notFound()

  const quote = await getQuote(db, order.value.quote_id)
  const dv = await getDesignVersion(db, order.value.frozen_dv_id)
  const shipments = await listShipmentsByOrder(db, orderId)
  const shipment = shipments.ok ? (shipments.value[0] ?? null) : null

  const config = readFrozenConfig(order.value.frozen_config_json)
  const address = readStoredAddress(order.value.shipping_address_json)
  const contact = readStoredContact(order.value.contact_json)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${ordersContent.detailTitle} ${order.value.id}`}
        description={`${ordersContent.placedLabel} ${new Date(order.value.created_at).toLocaleDateString()}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <OrderSummary
          heading={ordersContent.configHeading}
          thumbnailAssetId={dv.ok && dv.value !== null ? dv.value.thumbnail_asset_id : null}
          config={config}
          breakdown={quote.ok && quote.value !== null ? quote.value.breakdown_json : []}
          totalMinor={quote.ok && quote.value !== null ? quote.value.amount_minor : 0}
          totalLabel={ordersContent.totalLabel}
        />

        <div className="space-y-6">
          <OrderStatus
            state={order.value.status as OrderState}
            heldFrom={order.value.held_from_status as OrderState | null}
          />

          <ShipmentTracking
            shipment={
              shipment === null
                ? null
                : { carrier: shipment.carrier, trackingNumber: shipment.tracking_number }
            }
          />

          <section aria-labelledby="order-shipping-heading" className="space-y-1 text-sm">
            <h2 id="order-shipping-heading" className="text-sm font-semibold">
              {ordersContent.shippingHeading}
            </h2>
            <p className="text-muted-foreground">
              {contact.name}
              <br />
              {address.line1}
              {address.line2 === "" ? null : (
                <>
                  <br />
                  {address.line2}
                </>
              )}
              <br />
              {address.city}, {address.state} {address.pincode}
              <br />
              {address.country}
            </p>
          </section>

          <section aria-labelledby="order-payment-heading" className="space-y-1 text-sm">
            <h2 id="order-payment-heading" className="text-sm font-semibold">
              {ordersContent.paymentHeading}
            </h2>
            <p className="text-muted-foreground">
              {order.value.payment_ref ?? "—"}
              <br />
              {ordersContent.receiptPlaceholder}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
