import { insertAuditEvent } from "@/src/data/auditEvents"
import { getPrintJob, updatePrintJobStatus } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import { printJobActionSchema } from "@/src/domain/ops/production"
import { printJobMachine, type PrintJobState } from "@/src/domain/stateMachines/printJob"
import { getDispatchDeps } from "@/src/jobs/dispatchDeps"
import { cancelDispatchedJob } from "@/src/jobs/handlers/printDispatch"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Cancel a print job (plan §6-S14 step 4, extended by §6-S15 step 4). Safe by
 * construction: the machine only permits CANCEL from `pending`, `released` and
 * `printing`, so a finished or already-cancelled job answers `conflict` rather
 * than being rewritten. If the job had reached a printer, the printer is told to
 * stop first.
 *
 * A cancelled job does not spend one of the order's print attempts, and the
 * order itself is untouched — it stays queued for production, ready for a new
 * job. Cancelling the *order* is the review route's `reject`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  const body = await parseJsonBody(request, printJobActionSchema)
  if (!body.ok) return jsonError(body.error)

  const db = getServiceDb()
  const found = await getPrintJob(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "print job not found"))

  const next = printJobMachine.next(found.value.status as PrintJobState, "CANCEL")
  if (!next.ok) return jsonError(next.error)

  // Stop the machine before the database: a released job cancelled only in our
  // records would leave a printer working on an order nobody is watching.
  const stopped = await cancelDispatchedJob(getDispatchDeps(), found.value)
  if (!stopped.ok) return jsonError(stopped.error)

  const updated = await updatePrintJobStatus(db, id, next.value, {
    failureReason: body.value.reason,
  })
  if (!updated.ok) return jsonError(updated.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "print_job",
    entityId: id,
    action: "print_job.cancel",
    metadata: {
      reason: body.value.reason,
      orderId: found.value.order_id,
      from: found.value.status,
      gatewayJobRef: found.value.gateway_job_ref,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json({ printJobId: id, status: next.value }, { status: 200 })
}
