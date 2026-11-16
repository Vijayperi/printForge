import "server-only"

import { looksLikeGlb, type AssetStorage, type StoredAsset } from "@/src/adapters/storage"
import { appError } from "@/src/lib/errors"
import { sha256Hex } from "@/src/lib/hash"
import { newId } from "@/src/lib/ids"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * The narrow slice of the Supabase Storage client this adapter uses. Defined
 * locally so the adapter never imports @supabase/* directly (ESLint boundary);
 * the real client is passed in cast to this shape from the data layer.
 */
export interface MinimalStorageClient {
  storage: {
    from(bucket: string): {
      uploadToSignedUrl?: never
      upload(
        path: string,
        body: Uint8Array,
        opts?: { contentType?: string; upsert?: boolean }
      ): Promise<{ data: unknown; error: { message: string } | null }>
      createSignedUrl(
        path: string,
        expiresIn: number
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>
    }
  }
}

/** First path segment of a storage key: the bucket. */
export function bucketOf(storageKey: string): string {
  const slash = storageKey.indexOf("/")
  return slash === -1 ? storageKey : storageKey.slice(0, slash)
}

/** Everything after the bucket: the object path within the bucket. */
export function pathOf(storageKey: string): string {
  const slash = storageKey.indexOf("/")
  return slash === -1 ? "" : storageKey.slice(slash + 1)
}

/** Supabase Storage-backed AssetStorage (private buckets `models`, `thumbnails`). */
export class SupabaseStorage implements AssetStorage {
  constructor(private readonly client: MinimalStorageClient) {}

  async ingestFromUrl(
    url: string,
    opts: { keyPrefix: string; expectedMime: string; maxBytes: number }
  ): Promise<Result<StoredAsset>> {
    let response: Response
    try {
      response = await fetch(url)
    } catch (cause) {
      return err(appError("provider_error", `failed to fetch asset: ${url}`, cause))
    }
    if (!response.ok) {
      return err(appError("provider_error", `asset fetch returned ${response.status}`))
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > opts.maxBytes) {
      return err(appError("validation", `asset exceeds ${opts.maxBytes} bytes`))
    }
    if (opts.expectedMime === "model/gltf-binary" && !looksLikeGlb(bytes)) {
      return err(appError("validation", "asset is not a valid GLB"))
    }
    return this.put(bytes, { keyPrefix: opts.keyPrefix, mime: opts.expectedMime })
  }

  async put(
    bytes: Uint8Array,
    opts: { keyPrefix: string; mime: string }
  ): Promise<Result<StoredAsset>> {
    const bucket = bucketOf(opts.keyPrefix)
    const prefixPath = pathOf(opts.keyPrefix)
    const objectPath = prefixPath === "" ? newId("ast") : `${prefixPath}/${newId("ast")}`
    const { error } = await this.client.storage
      .from(bucket)
      .upload(objectPath, bytes, { contentType: opts.mime, upsert: false })
    if (error !== null) {
      return err(appError("provider_error", `upload failed: ${error.message}`))
    }
    const checksum = await sha256Hex(bytes)
    return ok({
      storageKey: `${bucket}/${objectPath}`,
      checksumSha256: checksum,
      bytes: bytes.length,
      mime: opts.mime,
    })
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<Result<string>> {
    const { data, error } = await this.client.storage
      .from(bucketOf(storageKey))
      .createSignedUrl(pathOf(storageKey), ttlSeconds)
    if (error !== null || data === null) {
      return err(appError("not_found", `could not sign ${storageKey}`))
    }
    return ok(data.signedUrl)
  }

  async read(storageKey: string): Promise<Result<Uint8Array>> {
    const { data, error } = await this.client.storage
      .from(bucketOf(storageKey))
      .download(pathOf(storageKey))
    if (error !== null || data === null) {
      return err(appError("not_found", `no object at ${storageKey}`))
    }
    return ok(new Uint8Array(await data.arrayBuffer()))
  }
}
