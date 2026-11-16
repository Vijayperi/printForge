"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { carrierLabel, SHIPPING_CARRIERS } from "@/src/config/commerce"
import { opsContent } from "@/src/config/content"
import type { ShipmentStage } from "@/src/domain/ops/production"

export interface ShipmentView {
  carrier: string
  trackingNumber: string
}

/**
 * Record the shipment that ships the order (plan §6-S14 step 4). This is the
 * second half of §4.3's "QC_PASSED + tracking added": the form only appears
 * once a passing quality check is on the record, and posting it is what moves
 * the order to `shipped`.
 */
export function ShipmentForm({
  orderId,
  stage,
  shipment,
}: {
  orderId: string
  stage: ShipmentStage
  shipment: ShipmentView | null
}) {
  const router = useRouter()
  const [carrier, setCarrier] = useState<string>(SHIPPING_CARRIERS[0].id)
  const [trackingNumber, setTrackingNumber] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (shipment !== null) {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">
          {opsContent.shipmentRecorded} {carrierLabel(shipment.carrier)} ·{" "}
          <span className="tabular-nums">{shipment.trackingNumber}</span>
        </p>
      </Section>
    )
  }

  if (stage === "hidden") return null

  if (stage === "awaiting_qc") {
    return (
      <Section>
        <p className="text-sm text-muted-foreground">{opsContent.shipmentAwaitingQc}</p>
      </Section>
    )
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    const response = await fetch(`/api/ops/orders/${orderId}/shipment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ carrier, trackingNumber }),
    })
    setBusy(false)
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } }
      setError(payload.error?.message ?? "That shipment could not be recorded.")
      return
    }
    setError(null)
    router.refresh()
  }

  return (
    <Section>
      <div className="space-y-1">
        <Label htmlFor="shipment-carrier">{opsContent.carrierLabel}</Label>
        <select
          id="shipment-carrier"
          value={carrier}
          onChange={(event) => setCarrier(event.target.value)}
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          {SHIPPING_CARRIERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="shipment-tracking">{opsContent.trackingLabel}</Label>
        <Input
          id="shipment-tracking"
          value={trackingNumber}
          onChange={(event) => setTrackingNumber(event.target.value)}
        />
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="button"
        size="sm"
        disabled={busy || trackingNumber.trim() === ""}
        onClick={() => void submit()}
      >
        {opsContent.shipmentSubmit}
      </Button>
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="ops-shipment-heading" className="space-y-3">
      <h2 id="ops-shipment-heading" className="text-sm font-semibold">
        {opsContent.shipmentHeading}
      </h2>
      {children}
    </section>
  )
}
