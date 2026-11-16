"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Badge } from "@/src/components/ui/badge"
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
import { MAX_PRINT_ATTEMPTS, type Control, type PrintJobControls } from "@/src/domain/ops/production"
import { PRINT_JOB_LABELS, type PrintJobState } from "@/src/domain/stateMachines/printJob"

export interface PrintJobView {
  id: string
  status: PrintJobState
  attempt: number
  printerName: string | null
  failureReason: string | null
}

export interface PrinterOption {
  id: string
  name: string
}

export const JOB_ACTIONS = [
  "create",
  "assign",
  "release",
  "retry",
  "cancel",
  "qc_pass",
  "qc_fail",
] as const
export type JobAction = (typeof JOB_ACTIONS)[number]

export const JOB_ACTION_LABELS: Record<JobAction, string> = {
  create: opsContent.createJob,
  assign: opsContent.assign,
  release: opsContent.release,
  retry: opsContent.retry,
  cancel: opsContent.cancelJob,
  qc_pass: opsContent.qcPass,
  qc_fail: opsContent.qcFail,
}

/**
 * Where each control posts, and what it sends (plan §4.6). Pure, so the wiring
 * of six endpoints is asserted directly rather than through six render tests.
 */
export function jobRequest(
  action: JobAction,
  ctx: { orderId: string; jobId: string; printerId: string; reason: string }
): { url: string; body: Record<string, unknown> } {
  const job = `/api/ops/print-jobs/${ctx.jobId}`
  switch (action) {
    case "create":
      return { url: `/api/ops/orders/${ctx.orderId}/print-jobs`, body: { reason: ctx.reason } }
    case "assign":
      return { url: `${job}/assign`, body: { printerId: ctx.printerId, reason: ctx.reason } }
    case "release":
      return { url: `${job}/release`, body: { reason: ctx.reason } }
    case "retry":
      return { url: `${job}/retry`, body: { reason: ctx.reason } }
    case "cancel":
      return { url: `${job}/cancel`, body: { reason: ctx.reason } }
    case "qc_pass":
      return { url: `${job}/qc`, body: { outcome: "pass", reason: ctx.reason } }
    default:
      return { url: `${job}/qc`, body: { outcome: "fail", reason: ctx.reason } }
  }
}

/**
 * A control, drawn only when it applies and inert with its reason spelled out
 * beside it — a disabled button on its own tells an operator nothing, and a
 * hover-only tooltip would not reach a keyboard or screen-reader user.
 */
function ActionButton({
  action,
  control,
  variant,
  onPick,
}: {
  action: JobAction
  control: Control
  variant?: "outline" | "destructive"
  onPick: (action: JobAction) => void
}) {
  if (!control.shown) return null
  const disabled = control.disabledReason !== null
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant={variant ?? "outline"}
        disabled={disabled}
        aria-describedby={disabled ? `job-reason-${action}` : undefined}
        onClick={() => onPick(action)}
      >
        {JOB_ACTION_LABELS[action]}
      </Button>
      {control.disabledReason === null ? null : (
        <p id={`job-reason-${action}`} className="text-xs text-muted-foreground">
          {control.disabledReason}
        </p>
      )}
    </div>
  )
}

/**
 * Print-job controls on the ops order detail page (plan §6-S14 step 4). Which
 * controls apply is decided on the server by `printJobControls` and re-checked
 * by every route; this panel renders that decision and collects the mandatory
 * reason each action is audited with.
 */
export function PrintJobPanel({
  orderId,
  latest,
  printers,
  controls,
  nextAttempt,
}: {
  orderId: string
  latest: PrintJobView | null
  printers: PrinterOption[]
  controls: PrintJobControls
  nextAttempt: number
}) {
  const router = useRouter()
  const [pending, setPending] = useState<JobAction | null>(null)
  const [reason, setReason] = useState("")
  const [printerId, setPrinterId] = useState(printers[0]?.id ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = (): void => {
    setPending(null)
    setReason("")
    setError(null)
  }

  const submit = async (action: JobAction): Promise<void> => {
    const { url, body } = jobRequest(action, {
      orderId,
      jobId: latest === null ? "" : latest.id,
      printerId,
      reason,
    })
    setBusy(true)
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } }
      setError(payload.error?.message ?? "That action could not be applied.")
      return
    }
    close()
    router.refresh()
  }

  return (
    <section aria-labelledby="ops-production-heading" className="space-y-3">
      <h2 id="ops-production-heading" className="text-sm font-semibold">
        {opsContent.productionHeading}
      </h2>

      {latest === null ? (
        <p className="text-sm text-muted-foreground">{opsContent.productionEmpty}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 text-sm">
          <dt className="text-muted-foreground">
            {opsContent.attemptLabel} {latest.attempt}/{MAX_PRINT_ATTEMPTS}
          </dt>
          <dd className="text-right">
            <Badge variant="secondary">{PRINT_JOB_LABELS[latest.status]}</Badge>
          </dd>
          <dt className="text-muted-foreground">{opsContent.printerLabel}</dt>
          <dd className="text-right">{latest.printerName ?? opsContent.unassigned}</dd>
          {latest.failureReason === null ? null : (
            <>
              <dt className="text-muted-foreground">Failure</dt>
              <dd className="text-right text-destructive">{latest.failureReason}</dd>
            </>
          )}
        </dl>
      )}

      {controls.assign.shown ? (
        <div className="space-y-1">
          <Label htmlFor="ops-printer">{opsContent.printerLabel}</Label>
          <select
            id="ops-printer"
            value={printerId}
            onChange={(event) => setPrinterId(event.target.value)}
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            {printers.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-2">
        <ActionButton action="create" control={controls.create} onPick={setPending} />
        <ActionButton action="assign" control={controls.assign} onPick={setPending} />
        <ActionButton action="release" control={controls.release} onPick={setPending} />
        <ActionButton action="retry" control={controls.retry} onPick={setPending} />
        <ActionButton
          action="cancel"
          control={controls.cancel}
          variant="destructive"
          onPick={setPending}
        />
        <ActionButton action="qc_pass" control={controls.qc} onPick={setPending} />
        <ActionButton
          action="qc_fail"
          control={controls.qc}
          variant="destructive"
          onPick={setPending}
        />
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
        {pending === null ? null : (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{JOB_ACTION_LABELS[pending]}</DialogTitle>
              <DialogDescription>
                {latest === null || pending === "create"
                  ? `This will be print ${nextAttempt} of ${MAX_PRINT_ATTEMPTS} for this order.`
                  : pending === "release"
                    ? opsContent.releaseConfirm
                    : "This is recorded against your account in the order’s audit trail."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="job-reason">{opsContent.reviewReasonLabel}</Label>
              <Textarea
                id="job-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {error === null ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
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
