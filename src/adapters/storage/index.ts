import type { Result } from "@/src/lib/result"

export interface StoredAsset {
  storageKey: string
  checksumSha256: string
  bytes: number
  mime: string
}

/** Private object storage for model + thumbnail assets (plan §4.4). */
export interface AssetStorage {
  /** Copy an external (expiring) provider URL into private storage. */
  ingestFromUrl(
    url: string,
    opts: { keyPrefix: string; expectedMime: string; maxBytes: number }
  ): Promise<Result<StoredAsset>>
  /** Store raw bytes (derived STL, thumbnail, upload). */
  put(bytes: Uint8Array, opts: { keyPrefix: string; mime: string }): Promise<Result<StoredAsset>>
  /** A short-lived signed URL for a stored object. */
  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<Result<string>>
  /** Read raw bytes back (workers / server only). */
  read(storageKey: string): Promise<Result<Uint8Array>>
}

/** glTF-binary files start with the ASCII magic "glTF". */
export function looksLikeGlb(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  )
}
