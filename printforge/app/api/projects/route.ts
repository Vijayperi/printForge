import { createProjectSchema } from "@/app/(studio)/projects/schemas"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { createProject, listProjectsByUser } from "@/src/data/projects"
import { getRequestDb } from "@/src/data/supabaseClients"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

async function requireUserId(): Promise<string | null> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return null
  return user.value.userId
}

export async function POST(request: Request): Promise<Response> {
  const userId = await requireUserId()
  if (userId === null) return jsonError(appError("unauthorized", "sign in required"))

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(appError("validation", "request body must be valid JSON"))
  }

  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    // A failed zod parse always carries at least one issue.
    return jsonError(appError("validation", parsed.error.issues[0]!.message))
  }

  const db = await getRequestDb()
  const result = await createProject(db, { userId, title: parsed.data.title })
  if (!result.ok) return jsonError(result.error)
  return Response.json({ project: result.value }, { status: 201 })
}

export async function GET(): Promise<Response> {
  const userId = await requireUserId()
  if (userId === null) return jsonError(appError("unauthorized", "sign in required"))

  const db = await getRequestDb()
  const result = await listProjectsByUser(db, userId)
  if (!result.ok) return jsonError(result.error)
  return Response.json({ projects: result.value }, { status: 200 })
}
