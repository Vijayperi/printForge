import { getAssetStorage } from "@/src/adapters/storage/factory"
import { getAsset } from "@/src/data/assets"
import { getDesignVersionByAssetId } from "@/src/data/designVersions"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { getAuthGateway } from "@/src/adapters/auth/factory"

const SIGNED_URL_TTL_SECONDS = 600

/**
 * How long a browser may reuse this redirect (plan §6-S16 step 3).
 *
 * Capped below the signed URL's own lifetime with a minute to spare: caching the
 * redirect for longer than the URL it points at would hand a client a link that
 * is already dead. Asset bytes are immutable — storage keys are checksum-derived
 * and a new upload is a new asset — so `immutable` is honest here. The genuinely
 * long-lived cache belongs on the storage object at the CDN edge, which is an
 * owner-era deployment setting (see LAUNCH_CHECKLIST.md).
 */
const THUMBNAIL_CACHE_SECONDS = SIGNED_URL_TTL_SECONDS - 60

/** Thumbnails are fetched repeatedly by project lists; models are fetched once. */
export function cacheControlFor(assetType: string): string {
  return assetType === "thumbnail"
    ? `private, max-age=${THUMBNAIL_CACHE_SECONDS}, immutable`
    : "private, no-store"
}

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

  // Not `Response.redirect`, which does not take headers.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.value, "Cache-Control": cacheControlFor(asset.value.type) },
  })
}
