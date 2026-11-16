import { z } from "zod"

import { insertAuditEvent } from "@/src/data/auditEvents"
import { getOrder } from "@/src/data/orders"
import { getServiceDb } from "@/src/data/supabaseClients"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"

/** The action an operator note is recorded under, and the thread's read filter. */
export const ORDER_NOTE_ACTION = "order.note"

const noteRequestSchema = z.strictObject({
  note: z.string().trim().min(1, "a note cannot be empty").max(2000),
})

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * Append an operator note to an order (plan §6-S14 step 2). Notes are stored as
 * `audit_events` rows: that table is INSERT-only by trigger, so the thread is
 * append-only and attributed by construction rather than by convention.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const operator = await requireOperator()
  if (!operator.ok) return jsonError(operator.error)
  const { id } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(appError("validation", "request body must be json"))
  }
  const parsed = noteRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return jsonError(appError("validation", detail))
  }

  const db = getServiceDb()
  const order = await getOrder(db, id)
  if (!order.ok) return jsonError(order.error)
  if (order.value === null) return jsonError(appError("not_found", "order not found"))

  const note = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "order",
    entityId: id,
    action: ORDER_NOTE_ACTION,
    metadata: { note: parsed.data.note, authorEmail: operator.value.email },
  })
  if (!note.ok) return jsonError(note.error)

  return Response.json({ id: note.value.id }, { status: 201 })
}
