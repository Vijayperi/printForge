import { insertAuditEvent } from "@/src/data/auditEvents"
import { applyPaymentOutcome, getOrder } from "@/src/data/orders"
import { insertShipment } from "@/src/data/shipments"
import { getServiceDb } from "@/src/data/supabaseClients"
import { shipmentRequestSchema } from "@/src/domain/ops/production"
import { orderMachine, type OrderState } from "@/src/domain/stateMachines/order"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Ship a quality-checked order (plan §4.6, §6-S14 step 4). This is the
 * "QC_PASSED + tracking added" transition of §4.3: the shipment row is written
 * first, so an order can never be `shipped` without the tracking number the
 * customer is about to be told to use.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  const body = await parseJsonBody(request, shipmentRequestSchema)
  if (!body.ok) return jsonError(body.error)

  const db = getServiceDb()
  const found = await getOrder(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "order not found"))

  const next = orderMachine.next(found.value.status as OrderState, "QC_PASSED")
  if (!next.ok) return jsonError(next.error)

  const shipment = await insertShipment(db, {
    orderId: id,
    carrier: body.value.carrier,
    trackingNumber: body.value.trackingNumber,
  })
  if (!shipment.ok) return jsonError(shipment.error)

  const updated = await applyPaymentOutcome(db, id, { status: next.value })
  if (!updated.ok) return jsonError(updated.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "order",
    entityId: id,
    action: "order.shipped",
    metadata: {
      shipmentId: shipment.value.id,
      carrier: body.value.carrier,
      trackingNumber: body.value.trackingNumber,
      from: found.value.status,
      to: next.value,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  // Keyed by the shipment, not the order: a reshipped order is a second, real
  // notification, not a duplicate of the first.
  const notified = await new PostgresJobQueue(db, new SystemClock()).enqueue({
    type: "notification.send",
    payload: {
      template: "order_shipped",
      orderId: id,
      carrier: body.value.carrier,
      trackingNumber: body.value.trackingNumber,
    },
    idempotencyKey: `order_shipped:${shipment.value.id}`,
  })
  if (!notified.ok) return jsonError(notified.error)

  return Response.json(
    { shipmentId: shipment.value.id, status: next.value },
    { status: 201 }
  )
}
