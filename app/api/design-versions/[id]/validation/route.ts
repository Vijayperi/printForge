import { getAuthGateway } from "@/src/adapters/auth/factory"
import { getDesignVersion } from "@/src/data/designVersions"
import { getRequestDb } from "@/src/data/supabaseClients"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * Latest printability report for an owned design version (plan §6-S10). The
 * request (RLS) client scopes both the design version and the report to the
 * caller. Returns `{ status: "pending" }` while no report exists yet (validation
 * is still queued/running); otherwise the verdict + findings + measurements.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))

  const { id } = await params
  const db = await getRequestDb()
  const dv = await getDesignVersion(db, id)
  if (!dv.ok) return jsonError(dv.error)
  if (dv.value === null) return jsonError(appError("not_found", "design version not found"))

  const report = await getLatestValidationReport(db, id)
  if (!report.ok) return jsonError(report.error)
  if (report.value === null) {
    return Response.json({ status: "pending", findings: [], measurements: null }, { status: 200 })
  }
  return Response.json(
    {
      status: report.value.status,
      findings: report.value.findings_json,
      measurements: report.value.measurements_json,
    },
    { status: 200 }
  )
}
