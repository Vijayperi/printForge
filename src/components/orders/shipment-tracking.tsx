import { carrierLabel } from "@/src/config/commerce"
import { ordersContent } from "@/src/config/content"

export interface TrackedShipment {
  carrier: string
  trackingNumber: string
}

/**
 * Carrier and tracking number for a shipped order (plan §6-S14 step 4: "customer
 * timeline reflects every step"). Absent until an operator records a shipment,
 * which is the same moment the order becomes `shipped`.
 */
export function ShipmentTracking({ shipment }: { shipment: TrackedShipment | null }) {
  if (shipment === null) return null
  return (
    <section aria-labelledby="order-tracking-heading" className="space-y-1 text-sm">
      <h2 id="order-tracking-heading" className="text-sm font-semibold">
        {ordersContent.trackingHeading}
      </h2>
      <dl className="grid grid-cols-2 gap-x-4">
        <dt className="text-muted-foreground">{ordersContent.trackingCarrierLabel}</dt>
        <dd className="text-right">{carrierLabel(shipment.carrier)}</dd>
        <dt className="text-muted-foreground">{ordersContent.trackingNumberLabel}</dt>
        <dd className="text-right tabular-nums">{shipment.trackingNumber}</dd>
      </dl>
      <p className="text-muted-foreground">{ordersContent.trackingNote}</p>
    </section>
  )
}
