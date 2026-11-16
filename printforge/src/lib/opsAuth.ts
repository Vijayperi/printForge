import { getAuthGateway } from "@/src/adapters/auth/factory"
import type { AuthUser } from "@/src/adapters/auth"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

/**
 * Gate an operations route (plan §4.6). Anyone who is not staff gets
 * `not_found`, never `forbidden` — the ops surface does not confirm its own
 * existence to customers (plan §6-S3, mirrored by `decideRoute`).
 */
export async function requireOperator(): Promise<Result<AuthUser>> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null || user.value.role === "customer") {
    return { ok: false, error: appError("not_found", "not found") }
  }
  return ok(user.value)
}
