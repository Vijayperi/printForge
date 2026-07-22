import { getAssetStorage } from "@/src/adapters/storage/factory"
import { getAsset } from "@/src/data/assets"
import { getDesignVersionByAssetId } from "@/src/data/designVersions"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { getAuthGateway } from "@/src/adapters/auth/factory"

const SIGNED_URL_TTL_SECONDS = 600

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * Serve a private asset by redirecting to a short-lived signed URL, but only
 * after verifying the caller owns a design version that references it. Assets
 * are staff-only under RLS, so the storage key is fetched with the service
 * client after the ownership check passes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))

  const { id } = await params

  // Ownership: the request (RLS) client only sees the caller's design versions.
  const owned = await getDesignVersionByAssetId(await getRequestDb(), id)
  if (!owned.ok) return jsonError(owned.error)
  if (owned.value === null) return jsonError(appError("not_found", "asset not found"))

  // The asset row itself is staff-only; read it with the service client.
  const asset = await getAsset(getServiceDb(), id)
  if (!asset.ok) return jsonError(asset.error)
  if (asset.value === null) return jsonError(appError("not_found", "asset not found"))

  const signed = await getAssetStorage().getSignedUrl(asset.value.storage_key, SIGNED_URL_TTL_SECONDS)
  if (!signed.ok) return jsonError(signed.error)

  return Response.redirect(signed.value, 302)
}
