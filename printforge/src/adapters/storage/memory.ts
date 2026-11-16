import { looksLikeGlb, type AssetStorage, type StoredAsset } from "@/src/adapters/storage"
import { appError } from "@/src/lib/errors"
import { sha256Hex } from "@/src/lib/hash"
import { newId } from "@/src/lib/ids"
import { err, ok, type Result } from "@/src/lib/result"

interface StoredObject {
  bytes: Uint8Array
  mime: string
  checksum: string
}

/** In-memory AssetStorage for development and unit tests. */
export class InMemoryStorage implements AssetStorage {
  private objects = new Map<string, StoredObject>()

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
    const checksum = await sha256Hex(bytes)
    const storageKey = `${opts.keyPrefix}/${newId("ast")}`
    this.objects.set(storageKey, { bytes: new Uint8Array(bytes), mime: opts.mime, checksum })
    return ok({ storageKey, checksumSha256: checksum, bytes: bytes.length, mime: opts.mime })
  }

  async getSignedUrl(storageKey: string, ttlSeconds: number): Promise<Result<string>> {
    if (!this.objects.has(storageKey)) {
      return err(appError("not_found", `no object at ${storageKey}`))
    }
    return ok(`memory://${storageKey}?ttl=${ttlSeconds}`)
  }

  async read(storageKey: string): Promise<Result<Uint8Array>> {
    const object = this.objects.get(storageKey)
    if (object === undefined) {
      return err(appError("not_found", `no object at ${storageKey}`))
    }
    return ok(new Uint8Array(object.bytes))
  }
}
