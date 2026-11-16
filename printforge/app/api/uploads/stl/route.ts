import { getAuthGateway } from "@/src/adapters/auth/factory"
import { getGlbConverter } from "@/src/adapters/conversion/factory"
import { convertStlToGlb } from "@/src/adapters/conversion/stlToGlb"
import { getUploadScanner } from "@/src/adapters/scanner/factory"
import { getAssetStorage } from "@/src/adapters/storage/factory"
import type { AssetStorage } from "@/src/adapters/storage"
import { insertAsset } from "@/src/data/assets"
import type { Db } from "@/src/data/db"
import { attachAssets, createDesignVersion, nextVersionNo } from "@/src/data/designVersions"
import { getProjectOwned } from "@/src/data/projects"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import type { AssetType } from "@/src/domain/types"
import { parseStl } from "@/src/domain/geometry/stlParse"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { enforceRateLimit } from "@/src/lib/rateLimit"
import { err, ok, type Result } from "@/src/lib/result"

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function jsonError(error: AppError, headers?: HeadersInit): Response {
  const { status, body } = toHttpError(error)
  return headers === undefined
    ? Response.json(body, { status })
    : Response.json(body, { status, headers })
}

interface UploadedFile {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** Duck-typed upload check (avoids File-class identity mismatches across runtimes). */
export function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UploadedFile).name === "string" &&
    typeof (value as UploadedFile).size === "number" &&
    typeof (value as UploadedFile).arrayBuffer === "function"
  )
}

/** Validate the uploaded file's name + size before reading its bytes. */
export function validateUploadFile(file: { name: string; size: number }): Result<void> {
  if (!file.name.toLowerCase().endsWith(".stl")) {
    return err(appError("validation", "only .stl files are supported"))
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return err(appError("validation", `file exceeds ${MAX_UPLOAD_BYTES} bytes`))
  }
  return ok(undefined)
}

/** Store bytes and record an asset row; returns the new asset id. */
async function storeModelAsset(
  db: Db,
  storage: AssetStorage,
  keyPrefix: string,
  bytes: Uint8Array,
  mime: string,
  type: AssetType
): Promise<Result<string>> {
  const put = await storage.put(bytes, { keyPrefix, mime })
  if (!put.ok) return put
  const asset = await insertAsset(db, {
    type,
    storageKey: put.value.storageKey,
    checksumSha256: put.value.checksumSha256,
    bytes: put.value.bytes,
    mime: put.value.mime,
  })
  return asset.ok ? ok(asset.value.id) : asset
}

export async function POST(request: Request): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))
  const userId = user.value.userId

  // Before reading the body: an upload flood should be cheap to refuse, not
  // cost us a 50 MB parse per request (plan §6-S16 step 2).
  const serviceDb = getServiceDb()
  const rate = await enforceRateLimit(serviceDb, new SystemClock(), "upload", userId)
  if (!rate.ok) return jsonError(rate.error)
  if (!rate.value.allowed) {
    return jsonError(appError("rate_limited", "Too many uploads. Please wait and try again."), {
      "Retry-After": String(rate.value.retryAfterSeconds),
    })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError(appError("validation", "expected a multipart form upload"))
  }
  const file = form.get("file")
  const projectId = form.get("projectId")
  if (!isUploadedFile(file) || typeof projectId !== "string") {
    return jsonError(appError("validation", "file and projectId are required"))
  }

  const validation = validateUploadFile(file)
  if (!validation.ok) return jsonError(validation.error)

  const bytes = new Uint8Array(await file.arrayBuffer())

  const scan = await getUploadScanner().scan(bytes)
  if (!scan.ok) return jsonError(scan.error)
  if (!scan.value.clean) return jsonError(appError("validation", "the uploaded file failed a malware scan"))

  const parsed = parseStl(bytes)
  if (!parsed.ok) return jsonError(appError("validation", `invalid STL (${parsed.error.kind})`))

  const requestDb = await getRequestDb()
  const project = await getProjectOwned(requestDb, userId, projectId)
  if (!project.ok) return jsonError(project.error)
  if (project.value === null) return jsonError(appError("not_found", "project not found"))

  const glb = await convertStlToGlb(bytes)
  if (!glb.ok) return jsonError(glb.error)
  const thumbnail = await getGlbConverter().toThumbnail(glb.value)
  if (!thumbnail.ok) return jsonError(thumbnail.error)

  const db = serviceDb
  const storage = getAssetStorage()

  const version = await nextVersionNo(db, projectId)
  if (!version.ok) return jsonError(version.error)
  const dv = await createDesignVersion(db, {
    projectId,
    source: "uploaded",
    versionNo: version.value,
    generationStatus: "ready",
  })
  if (!dv.ok) return jsonError(dv.error)
  const dvId = dv.value.id

  const stlAsset = await storeModelAsset(db, storage, `models/${dvId}`, bytes, "model/stl", "model_stl")
  if (!stlAsset.ok) return jsonError(stlAsset.error)
  const glbAsset = await storeModelAsset(db, storage, `models/${dvId}`, glb.value, "model/gltf-binary", "model_glb")
  if (!glbAsset.ok) return jsonError(glbAsset.error)
  const thumbAsset = await storeModelAsset(db, storage, `thumbnails/${dvId}`, thumbnail.value, "image/png", "thumbnail")
  if (!thumbAsset.ok) return jsonError(thumbAsset.error)

  const attach = await attachAssets(db, dvId, {
    glbAssetId: glbAsset.value,
    stlAssetId: stlAsset.value,
    thumbnailAssetId: thumbAsset.value,
  })
  if (!attach.ok) return jsonError(attach.error)

  const enqueue = await new PostgresJobQueue(db, new SystemClock()).enqueue({
    type: "validation.run",
    payload: { designVersionId: dvId },
    idempotencyKey: `validate:${dvId}`,
  })
  if (!enqueue.ok) return jsonError(enqueue.error)

  return Response.json({ designVersionId: dvId }, { status: 201 })
}
