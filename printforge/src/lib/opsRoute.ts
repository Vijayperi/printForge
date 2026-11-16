import type { z } from "zod"

import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/** Render an `AppError` as the JSON error body every route returns (plan §4.6). */
export function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * The shared front half of every ops mutation: read the body as JSON, then
 * validate it, reporting both failures as `validation` with the field paths
 * spelled out. Kept in one place because the print-job controls (plan §6-S14
 * step 4) are six routes that differ only in their schema and their verb.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<Result<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return err(appError("validation", "request body must be json"))
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return err(appError("validation", detail))
  }
  return ok(parsed.data as z.infer<S>)
}
