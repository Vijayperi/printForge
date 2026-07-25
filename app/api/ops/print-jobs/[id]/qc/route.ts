import { insertAuditEvent } from "@/src/data/auditEvents"
import { applyPaymentOutcome, getOrder } from "@/src/data/orders"
import { getPrintJob } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import { qcAuditAction, qcPrintJob, qcRequestSchema } from "@/src/domain/ops/production"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Record the quality check on a finished print (plan §6-S14 step 4).
 *
 * A pass does not move the order: §4.3 spells that transition "QC_PASSED **+
 * tracking added** → shipped", so the order waits in `quality_check` until the
 * shipment route supplies a carrier and tracking number. A fail sends it back
 * to the production queue, where an operator can queue a reprint (which spends
 * one of the order's three attempts).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  const body = await parseJsonBody(request, qcRequestSchema)
  if (!body.ok) return jsonError(body.error)

  const db = getServiceDb()
  const found = await getPrintJob(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "print job not found"))

  const order = await getOrder(db, found.value.order_id)
  if (!order.ok) return jsonError(order.error)
  if (order.value === null) return jsonError(appError("not_found", "order not found"))

  const outcome = qcPrintJob(body.value.outcome, order.value.status, found.value.status)
  if (!outcome.ok) return jsonError(outcome.error)

  if (outcome.value.orderStatus !== order.value.status) {
    const updated = await applyPaymentOutcome(db, order.value.id, {
      status: outcome.value.orderStatus,
    })
    if (!updated.ok) return jsonError(updated.error)
  }

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "print_job",
    entityId: id,
    action: qcAuditAction(body.value.outcome),
    metadata: {
      reason: body.value.reason,
      orderId: order.value.id,
      attempt: found.value.attempt,
      from: order.value.status,
      to: outcome.value.orderStatus,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json(
    {
      printJobId: id,
      orderStatus: outcome.value.orderStatus,
      awaitingShipment: outcome.value.awaitingShipment,
    },
    { status: 200 }
  )
}
