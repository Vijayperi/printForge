import { getPrintJob } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import { printJobActionSchema } from "@/src/domain/ops/production"
import { printJobMachine, type PrintJobState } from "@/src/domain/stateMachines/printJob"
import { getDispatchDeps } from "@/src/jobs/dispatchDeps"
import { dispatchPrintJob } from "@/src/jobs/handlers/printDispatch"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Release a print job to its machine (plan §6-S15 step 2). The dispatch runs
 * while the operator waits, rather than being handed to the worker, so that a
 * refusal — "that printer is busy", "this order has no consumed quote" — comes
 * back as the response to the button they pressed.
 *
 * A second press answers **409**: the machine already has the file, and the
 * gateway's own idempotency is a safety net, not the user-facing rule.
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

  if (!printJobMachine.can(found.value.status as PrintJobState, "RELEASE")) {
    return jsonError(
      appError("conflict", `a ${found.value.status} print job has already been released`)
    )
  }

  const dispatched = await dispatchPrintJob(getDispatchDeps(), {
    printJobId: id,
    actorId: operator.value.userId,
    reason: body.value.reason,
  })
  if (!dispatched.ok) return jsonError(dispatched.error)

  return Response.json({ printJobId: id, status: "released" }, { status: 200 })
}
