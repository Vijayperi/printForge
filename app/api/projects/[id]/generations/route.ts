import { generationRequestSchema } from "@/app/api/projects/[id]/generations/schema"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { getModerator } from "@/src/adapters/moderation/factory"
import { dbErrorToAppError } from "@/src/data/db"
import { getProjectOwned } from "@/src/data/projects"
import { getRequestDb } from "@/src/data/supabaseClients"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { newId } from "@/src/lib/ids"
import { checkRateLimit } from "@/src/lib/rateLimit"

const GENERATION_WINDOW_SECONDS = 3600
const GENERATION_LIMIT = 5

function jsonError(error: AppError, headers?: HeadersInit): Response {
  const { status, body } = toHttpError(error)
  return headers === undefined
    ? Response.json(body, { status })
    : Response.json(body, { status, headers })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))
  const userId = user.value.userId
  const { id: projectId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(appError("validation", "request body must be valid JSON"))
  }
  const parsed = generationRequestSchema.safeParse(body)
  if (!parsed.success) return jsonError(appError("validation", parsed.error.issues[0]!.message))
  const brief = parsed.data

  const db = await getRequestDb()

  const project = await getProjectOwned(db, userId, projectId)
  if (!project.ok) return jsonError(project.error)
  if (project.value === null) return jsonError(appError("not_found", "project not found"))

  const moderation = await getModerator().check({ text: brief.rawPrompt })
  if (!moderation.ok) return jsonError(moderation.error)
  if (moderation.value.verdict === "deny") {
    return jsonError(appError("validation", "This request violates our content policy."))
  }
  // A flagged prompt is still allowed but marked so ops can review it (S14).
  const flagged = moderation.value.verdict === "flag"

  const rate = await checkRateLimit(db, new SystemClock(), {
    key: `generation:${userId}`,
    windowSeconds: GENERATION_WINDOW_SECONDS,
    limit: GENERATION_LIMIT,
  })
  if (!rate.ok) return jsonError(rate.error)
  if (!rate.value.allowed) {
    return jsonError(appError("rate_limited", "Too many generations. Please wait and try again."), {
      "Retry-After": String(rate.value.retryAfterSeconds),
    })
  }

  const { data, error } = await db.rpc<Array<{ design_version_id: string; job_id: string }>>(
    "enqueue_generation",
    {
      p_project_id: projectId,
      p_prompt: brief.rawPrompt,
      p_brief: flagged ? { ...brief, flagged: true } : brief,
      p_idempotency_key: newId("job"),
    }
  )
  if (error !== null) return jsonError(dbErrorToAppError(error))
  const designVersionId = (data ?? [])[0]?.design_version_id
  if (designVersionId === undefined) return jsonError(appError("internal", "generation enqueue returned no id"))
  return Response.json({ designVersionId }, { status: 202 })
}
