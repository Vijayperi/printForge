import { listOpsOrders } from "@/src/data/opsOrders"
import { getServiceDb } from "@/src/data/supabaseClients"
import { dueDateFor, parseOpsOrderFilter, OPS_PAGE_SIZE } from "@/src/domain/ops/board"
import type { OpsOrderRow } from "@/src/domain/types"
import { toHttpError, type AppError } from "@/src/lib/errors"
import { appError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/** One board row, with the derived due date resolved server-side. */
function boardDto(row: OpsOrderRow) {
  return {
    id: row.id,
    status: row.status,
    paymentStatus: row.payment_status,
    customerName: row.customer_name,
    materialId: row.material_id,
    printerId: row.printer_id,
    printJobStatus: row.print_job_status,
    validationStatus: row.validation_status,
    exceptionReason: row.exception_reason,
    amountMinor: row.amount_minor,
    paidAt: row.paid_at,
    dueAt: dueDateFor(row.paid_at)?.toISOString() ?? null,
    createdAt: row.created_at,
  }
}

/**
 * Operations orders board (plan §4.6, §6-S14 step 1). Operator-only: a customer
 * gets a 404, not a 403. Every filter is applied by the database.
 */
export async function GET(request: Request): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)

  const url = new URL(request.url)
  const parsed = parseOpsOrderFilter(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return jsonError(appError("validation", detail))
  }

  const page = await listOpsOrders(getServiceDb(), parsed.data)
  if (!page.ok) return jsonError(page.error)

  return Response.json(
    {
      orders: page.value.rows.map(boardDto),
      page: parsed.data.page,
      pageSize: OPS_PAGE_SIZE,
      hasMore: page.value.hasMore,
    },
    { status: 200 }
  )
}
