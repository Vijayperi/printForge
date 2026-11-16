"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { ordersContent } from "@/src/config/content"
import { isExceptionalOrderState, orderTimeline } from "@/src/domain/checkout/timeline"
import { ORDER_CUSTOMER_LABELS, type OrderState } from "@/src/domain/stateMachines/order"

/** How often the return page re-checks an order the webhook has not settled yet. */
export const PENDING_POLL_MS = 2000

export interface OrderStatusProps {
  state: OrderState
  heldFrom: OrderState | null
}

/**
 * The customer status track (plan §6-S13 step 4). Payment is confirmed by a
 * webhook, not by the browser coming back from the payment page, so an order
 * still in `pending_payment` refreshes itself until the webhook lands.
 */
export function OrderStatus({ state, heldFrom }: OrderStatusProps) {
  const router = useRouter()
  const pending = state === "pending_payment"

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => router.refresh(), PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [pending, router])

  const steps = orderTimeline(state, heldFrom)

  return (
    <section aria-labelledby="order-status-heading" className="space-y-3">
      <h2 id="order-status-heading" className="text-sm font-semibold">
        {ordersContent.statusHeading}
      </h2>

      {isExceptionalOrderState(state) ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {ORDER_CUSTOMER_LABELS[state]}
        </p>
      ) : null}

      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {ordersContent.pendingNote}
        </p>
      ) : null}

      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.state}
            aria-current={step.status === "current" ? "step" : undefined}
            className="flex items-center gap-3 text-sm"
          >
            <span
              aria-hidden
              className={`size-2 rounded-full ${
                step.status === "upcoming" ? "bg-muted-foreground/30" : "bg-primary"
              }`}
            />
            <span
              className={
                step.status === "current"
                  ? "font-medium"
                  : step.status === "done"
                    ? "text-foreground"
                    : "text-muted-foreground"
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
