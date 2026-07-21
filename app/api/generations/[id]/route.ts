import { getAuthGateway } from "@/src/adapters/auth/factory"
import { getDesignVersion } from "@/src/data/designVersions"
import { getRequestDb } from "@/src/data/supabaseClients"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/** Normalized generation status. Never exposes provider fields (plan §4.6). */
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
  if (dv.value === null) return jsonError(appError("not_found", "generation not found"))

  return Response.json(
    { designVersionId: dv.value.id, status: dv.value.generation_status },
    { status: 200 }
  )
}
