"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/src/components/ui/button"

/** A pre-signed webhook: the raw body must be POSTed byte-for-byte. */
export interface SignedWebhook {
  rawBody: string
  headers: Record<string, string>
}

export interface MockCheckoutPanelProps {
  orderId: string
  amountLabel: string
  returnUrl: string
  pay: SignedWebhook
  fail: SignedWebhook
}

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string }

/**
 * The dev-only hosted-checkout stand-in (plan §6-S13 step 2). "Pay" and "Fail"
 * POST genuinely signed, Dodo-shaped webhooks at our real webhook route, so
 * local and E2E runs exercise the production code path end to end — the raw
 * body is sent exactly as it was signed, never re-serialized.
 */
export function MockCheckoutPanel({
  orderId,
  amountLabel,
  returnUrl,
  pay,
  fail,
}: MockCheckoutPanelProps) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: "idle" })

  const send = async (webhook: SignedWebhook): Promise<void> => {
    setState({ kind: "sending" })
    const response = await fetch("/api/webhooks/dodo", {
      method: "POST",
      headers: { ...webhook.headers, "content-type": "application/json" },
      body: webhook.rawBody,
    })
    if (!response.ok) {
      setState({ kind: "error", message: `Webhook rejected (${response.status})` })
      return
    }
    router.push(returnUrl)
  }

  const busy = state.kind === "sending"

  return (
    <section aria-labelledby="mock-checkout-heading" className="space-y-4">
      <div className="space-y-1">
        <h1 id="mock-checkout-heading" className="text-xl font-semibold">
          Mock payment
        </h1>
        <p className="text-sm text-muted-foreground">
          Development stand-in for the hosted Dodo checkout. Order {orderId} — {amountLabel}.
        </p>
      </div>

      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="button" disabled={busy} onClick={() => void send(pay)}>
          Pay
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void send(fail)}>
          Fail
        </Button>
      </div>
    </section>
  )
}
