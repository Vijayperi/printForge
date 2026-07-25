import { insertAuditEvent } from "@/src/data/auditEvents"
import { assignPrinter, getPrintJob } from "@/src/data/printJobs"
import { getPrinter } from "@/src/data/printers"
import { getServiceDb } from "@/src/data/supabaseClients"
import { assertCanAssignPrinter, assignPrinterSchema } from "@/src/domain/ops/production"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"
import { jsonError, parseJsonBody } from "@/src/lib/opsRoute"

/**
 * Put a queued print job on a specific machine (plan §6-S14 step 4). Only a
 * `pending` job can be assigned — once it has been released the printer holds
 * the file, and moving it is Session 15's cancel-and-re-release, not an edit.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  const body = await parseJsonBody(request, assignPrinterSchema)
  if (!body.ok) return jsonError(body.error)

  const db = getServiceDb()
  const found = await getPrintJob(db, id)
  if (!found.ok) return jsonError(found.error)
  if (found.value === null) return jsonError(appError("not_found", "print job not found"))

  const allowed = assertCanAssignPrinter(found.value)
  if (!allowed.ok) return jsonError(allowed.error)

  const printer = await getPrinter(db, body.value.printerId)
  if (!printer.ok) return jsonError(printer.error)
  if (printer.value === null) return jsonError(appError("not_found", "printer not found"))

  const assigned = await assignPrinter(db, id, printer.value.id)
  if (!assigned.ok) return jsonError(assigned.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "print_job",
    entityId: id,
    action: "print_job.assigned",
    metadata: {
      reason: body.value.reason,
      orderId: found.value.order_id,
      printerId: printer.value.id,
      printerName: printer.value.name,
      previousPrinterId: found.value.printer_id,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json({ printJobId: id, printerId: printer.value.id }, { status: 200 })
}
