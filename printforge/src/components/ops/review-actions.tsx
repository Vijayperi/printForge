"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { opsContent } from "@/src/config/content"
import { REVIEW_ACTIONS, type ReviewAction } from "@/src/domain/ops/review"
import { orderMachine, releaseHold, type OrderState } from "@/src/domain/stateMachines/order"
import { REVIEW_EVENTS } from "@/src/domain/ops/review"

/** Which review actions the order machine will actually accept right now. */
export function availableActions(state: OrderState, heldFrom: OrderState | null): ReviewAction[] {
  return REVIEW_ACTIONS.filter((action) =>
    action === "release_hold"
      ? releaseHold(state, heldFrom).ok
      : orderMachine.can(state, REVIEW_EVENTS[action])
  )
}

/**
 * Approve / reject / hold / release-hold (plan §6-S14 step 3). The reason is
 * mandatory: the confirm button stays disabled until one is typed, mirroring the
 * server-side rule rather than relying on it.
 */
export function ReviewActions({
  orderId,
  state,
  heldFrom,
}: {
  orderId: string
  state: OrderState
  heldFrom: OrderState | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState<ReviewAction | null>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const actions = availableActions(state, heldFrom)

  const close = (): void => {
    setPending(null)
    setReason("")
    setError(null)
  }

  const submit = async (action: ReviewAction): Promise<void> => {
    setBusy(true)
    const response = await fetch(`/api/ops/orders/${orderId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    })
    setBusy(false)
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } }
      setError(body.error?.message ?? "That action could not be applied.")
      return
    }
    close()
    router.refresh()
  }

  return (
    <section aria-labelledby="ops-review-heading" className="space-y-3">
      <h2 id="ops-review-heading" className="text-sm font-semibold">
        {opsContent.reviewHeading}
      </h2>

      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No review actions apply in this state.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={action === "reject" ? "destructive" : "outline"}
              onClick={() => setPending(action)}
            >
              {opsContent.reviewActions[action]}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
        {pending === null ? null : (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{opsContent.reviewActions[pending]}</DialogTitle>
              <DialogDescription>
                This is recorded against your account in the order&rsquo;s audit trail.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="review-reason">{opsContent.reviewReasonLabel}</Label>
              <Textarea
                id="review-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {error !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                {opsContent.reviewCancel}
              </Button>
              <Button
                type="button"
                onClick={() => void submit(pending)}
                disabled={busy || reason.trim() === ""}
              >
                {opsContent.reviewSubmit}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
