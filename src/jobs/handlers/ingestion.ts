import "server-only"

import { z } from "zod"

import type { GlbConverter } from "@/src/adapters/conversion"
import { optimizeGlb } from "@/src/adapters/conversion/optimizeGlb"
import type { AssetStorage, StoredAsset } from "@/src/adapters/storage"
import { insertAsset } from "@/src/data/assets"
import { attachAssets, getDesignVersion } from "@/src/data/designVersions"
import type { Db } from "@/src/data/db"
import type { AssetType } from "@/src/domain/types"
import type { JobQueue } from "@/src/jobs/queue"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface IngestionDeps {
  db: Db
  storage: AssetStorage
  converter: GlbConverter
  appUrl: string
  queue: JobQueue
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
 * Store the copy the viewer will download, shrunk when we can shrink it
 * (plan §6-S16 step 3).
 *
 * A GLB the optimizer cannot parse, or cannot improve, is kept exactly as it
 * arrived: the model is the customer's, and a container we do not understand is
 * our problem, not theirs.
 */
async function storeViewerGlb(
  deps: IngestionDeps,
  dvId: string,
  ingested: StoredAsset,
  bytes: Uint8Array
): Promise<Result<{ assetId: string; bytes: Uint8Array }>> {
  const optimized = optimizeGlb(bytes)
  if (optimized.ok && optimized.value.optimizedBytes < optimized.value.originalBytes) {
    const stored = await storeDerived(
      deps,
      `models/${dvId}`,
      optimized.value.bytes,
      "model/gltf-binary",
      "model_glb"
    )
    return stored.ok ? ok({ assetId: stored.value, bytes: optimized.value.bytes }) : stored
  }

  const asset = await insertAsset(deps.db, {
    type: "model_glb",
    storageKey: ingested.storageKey,
    checksumSha256: ingested.checksumSha256,
    bytes: ingested.bytes,
    mime: ingested.mime,
  })
  return asset.ok ? ok({ assetId: asset.value.id, bytes }) : asset
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

  const ingested = await deps.storage.read(ingest.value.storageKey)
  if (!ingested.ok) return ingested

  const viewerGlb = await storeViewerGlb(deps, dvId, ingest.value, ingested.value)
  if (!viewerGlb.ok) return viewerGlb
  const glbBytes = viewerGlb.value.bytes

  const stl = await deps.converter.toStl(glbBytes)
  if (!stl.ok) return stl
  const stlAssetId = await storeDerived(deps, `models/${dvId}`, stl.value, "model/stl", "model_stl")
  if (!stlAssetId.ok) return stlAssetId

  const thumbnail = await deps.converter.toThumbnail(glbBytes)
  if (!thumbnail.ok) return thumbnail
  const thumbnailAssetId = await storeDerived(deps, `thumbnails/${dvId}`, thumbnail.value, "image/png", "thumbnail")
  if (!thumbnailAssetId.ok) return thumbnailAssetId

  const attach = await attachAssets(deps.db, dvId, {
    glbAssetId: viewerGlb.value.assetId,
    stlAssetId: stlAssetId.value,
    thumbnailAssetId: thumbnailAssetId.value,
  })
  if (!attach.ok) return attach

  // The generated model now has a first-class STL — send it through the same
  // printability validation as an uploaded one. Shares the upload route's
  // idempotency key so a re-ingest never double-queues.
  const enqueue = await deps.queue.enqueue({
    type: "validation.run",
    payload: { designVersionId: dvId },
    idempotencyKey: `validate:${dvId}`,
  })
  return enqueue.ok ? ok(undefined) : enqueue
}
