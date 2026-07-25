import { z } from "zod"

import { insertAuditEvent } from "@/src/data/auditEvents"
import { getServiceDb } from "@/src/data/supabaseClients"
import {
  getValidationReport,
  updateValidationReportStatus,
} from "@/src/data/validationReports"
import {
  validationMachine,
  type ValidationEvent,
  type ValidationState,
} from "@/src/domain/stateMachines/validation"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { requireOperator } from "@/src/lib/opsAuth"

const decisionRequestSchema = z.strictObject({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1, "a reason is required").max(500),
})

const DECISION_EVENTS: Record<"approve" | "reject", ValidationEvent> = {
  approve: "OPERATOR_APPROVE",
  reject: "OPERATOR_REJECT",
}

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * Operator override of a `manual_review` verdict (plan §4.3, §6-S14 step 3).
 * The validation machine decides what is legal, so a report that has already
 * been decided — or was never in manual review — is a 409, not a silent rewrite.
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
  const parsed = decisionRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return jsonError(appError("validation", detail))
  }
  const { action, reason } = parsed.data

  const db = getServiceDb()
  const report = await getValidationReport(db, id)
  if (!report.ok) return jsonError(report.error)
  if (report.value === null) return jsonError(appError("not_found", "validation report not found"))

  const next = validationMachine.next(
    report.value.status as ValidationState,
    DECISION_EVENTS[action]
  )
  if (!next.ok) return jsonError(next.error)

  const updated = await updateValidationReportStatus(db, id, next.value)
  if (!updated.ok) return jsonError(updated.error)

  const audited = await insertAuditEvent(db, {
    actorId: operator.value.userId,
    actorKind: "user",
    entityType: "validation_report",
    entityId: id,
    action: `validation.operator_${action}`,
    metadata: {
      reason,
      from: report.value.status,
      to: next.value,
      designVersionId: report.value.design_version_id,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json({ status: next.value }, { status: 200 })
}
