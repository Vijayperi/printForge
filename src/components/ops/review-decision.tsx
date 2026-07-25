"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { opsContent } from "@/src/config/content"

/**
 * Approve/reject one queued manual-review report (plan §6-S14 step 3). The
 * reason is inline rather than in a dialog: the queue is a working list, and an
 * operator triaging ten reports should not open ten modals.
 */
export function ReviewDecision({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (action: "approve" | "reject"): Promise<void> => {
    setBusy(true)
    const response = await fetch(`/api/ops/validation-reports/${reportId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, reason }),
    })
    setBusy(false)
    if (!response.ok) {
      setError("That decision could not be recorded.")
      return
    }
    setError(null)
    router.refresh()
  }

  const blocked = busy || reason.trim() === ""

  return (
    <div className="space-y-2">
      <Input
        aria-label={`${opsContent.reviewReasonLabel} for ${reportId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={opsContent.reviewReasonLabel}
      />
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={blocked} onClick={() => void decide("approve")}>
          {opsContent.queueApprove}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={blocked}
          onClick={() => void decide("reject")}
        >
          {opsContent.queueReject}
        </Button>
      </div>
    </div>
  )
}
