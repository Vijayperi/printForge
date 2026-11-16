import { insertAuditEvent } from "@/src/data/auditEvents"
import { getOrder } from "@/src/data/orders"
import { insertPrintJob, listPrintJobsByOrder } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import {
  assertCanCreatePrintJob,
  createPrintJobSchema,
  nextAttemptNumber,
} from "@/src/domain/ops/production"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Queue a print for an approved order (plan §6-S14 step 4). The job is created
 * `pending` and unassigned: choosing a machine is a separate, separately
 * audited decision, and releasing it to that machine is Session 15.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  const body = await parseJsonBody(request, createPrintJobSchema)
  if (!body.ok) return jsonError(body.error)

  const db = getServiceDb()
  const found = await getOrder(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "order not found"))

  const jobs = await listPrintJobsByOrder(db, id)
  if (!jobs.ok) return jsonError(jobs.error)

  const allowed = assertCanCreatePrintJob(found.value, jobs.value)
  if (!allowed.ok) return jsonError(allowed.error)

  const created = await insertPrintJob(db, {
    orderId: id,
    attempt: nextAttemptNumber(jobs.value),
  })
  if (!created.ok) return jsonError(created.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "print_job",
    entityId: created.value.id,
    action: "print_job.created",
    metadata: {
      reason: body.value.reason,
      orderId: id,
      attempt: created.value.attempt,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json(
    {
      printJobId: created.value.id,
      status: created.value.status,
      attempt: created.value.attempt,
    },
    { status: 201 }
  )
}
