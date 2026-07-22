import "server-only"

import { z } from "zod"

import type { GlbConverter } from "@/src/adapters/conversion"
import type { AssetStorage } from "@/src/adapters/storage"
import { insertAsset } from "@/src/data/assets"
import { attachAssets, getDesignVersion } from "@/src/data/designVersions"
import type { Db } from "@/src/data/db"
import type { AssetType } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface IngestionDeps {
  db: Db
  storage: AssetStorage
  converter: GlbConverter
  appUrl: string
}

const payloadSchema = z.object({
  designVersionId: z.string().min(1),
  glbUrl: z.string().min(1),
  stlUrl: z.string().nullable().optional(),
})

const MAX_GLB_BYTES = 50 * 1024 * 1024

function resolveUrl(url: string, appUrl: string): string {
  return url.startsWith("http") ? url : `${appUrl}${url}`
}

async function storeDerived(
  deps: IngestionDeps,
  keyPrefix: string,
  bytes: Uint8Array,
  mime: string,
  type: AssetType
): Promise<Result<string>> {
  const put = await deps.storage.put(bytes, { keyPrefix, mime })
  if (!put.ok) return put
  const asset = await insertAsset(deps.db, {
    type,
    storageKey: put.value.storageKey,
    checksumSha256: put.value.checksumSha256,
    bytes: put.value.bytes,
    mime: put.value.mime,
  })
  return asset.ok ? ok(asset.value.id) : asset
}

/**
 * asset.ingest: copy the provider GLB into private storage, derive an STL and a
 * thumbnail, and attach all three to the (already ready) design version. The
 * provider URL is never persisted — only storage keys. Idempotent.
 */
export async function handleAssetIngest(deps: IngestionDeps, rawPayload: unknown): Promise<Result<void>> {
  const parsed = payloadSchema.safeParse(rawPayload)
  if (!parsed.success) return { ok: false, error: appError("validation", "invalid asset.ingest payload") }
  const { designVersionId: dvId, glbUrl } = parsed.data

  const dvResult = await getDesignVersion(deps.db, dvId)
  if (!dvResult.ok) return dvResult
  if (dvResult.value === null) return { ok: false, error: appError("not_found", `design version ${dvId} not found`) }
  const dv = dvResult.value

  if (dv.glb_asset_id !== null) return ok(undefined) // already ingested (retry-safe)

  const ingest = await deps.storage.ingestFromUrl(resolveUrl(glbUrl, deps.appUrl), {
    keyPrefix: `models/${dvId}`,
    expectedMime: "model/gltf-binary",
    maxBytes: MAX_GLB_BYTES,
  })
  if (!ingest.ok) return ingest
  const glbAsset = await insertAsset(deps.db, {
    type: "model_glb",
    storageKey: ingest.value.storageKey,
    checksumSha256: ingest.value.checksumSha256,
    bytes: ingest.value.bytes,
    mime: ingest.value.mime,
  })
  if (!glbAsset.ok) return glbAsset

  const glbBytes = await deps.storage.read(ingest.value.storageKey)
  if (!glbBytes.ok) return glbBytes

  const stl = await deps.converter.toStl(glbBytes.value)
  if (!stl.ok) return stl
  const stlAssetId = await storeDerived(deps, `models/${dvId}`, stl.value, "model/stl", "model_stl")
  if (!stlAssetId.ok) return stlAssetId

  const thumbnail = await deps.converter.toThumbnail(glbBytes.value)
  if (!thumbnail.ok) return thumbnail
  const thumbnailAssetId = await storeDerived(deps, `thumbnails/${dvId}`, thumbnail.value, "image/png", "thumbnail")
  if (!thumbnailAssetId.ok) return thumbnailAssetId

  const attach = await attachAssets(deps.db, dvId, {
    glbAssetId: glbAsset.value.id,
    stlAssetId: stlAssetId.value,
    thumbnailAssetId: thumbnailAssetId.value,
  })
  return attach.ok ? ok(undefined) : attach
}
