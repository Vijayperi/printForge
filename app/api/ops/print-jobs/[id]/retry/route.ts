import { insertAuditEvent } from "@/src/data/auditEvents"
import { getPrintJob, updatePrintJobStatus } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import { printJobActionSchema, retryPrintJob } from "@/src/domain/ops/production"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Retry a failed print (plan §6-S14 step 4). The job goes back to `pending`
 * with its attempt counter advanced and its failure reason cleared — the reason
 * is not lost, it is in the audit trail, and leaving it on the row would make a
 * freshly queued job look broken.
 *
 * Past the attempt cap this answers `precondition_failed`; the ops board
 * already surfaces such an order as a `print_failed` exception.
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

  const retry = retryPrintJob(found.value)
  if (!retry.ok) return jsonError(retry.error)

  const updated = await updatePrintJobStatus(db, id, retry.value.status, {
    failureReason: null,
    attempt: retry.value.attempt,
  })
  if (!updated.ok) return jsonError(updated.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "print_job",
    entityId: id,
    action: "print_job.retry",
    metadata: {
      reason: body.value.reason,
      orderId: found.value.order_id,
      attempt: retry.value.attempt,
      previousFailure: found.value.failure_reason,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json(
    { printJobId: id, status: retry.value.status, attempt: retry.value.attempt },
    { status: 200 }
  )
}
