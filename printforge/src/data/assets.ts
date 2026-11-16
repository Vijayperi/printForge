import "server-only"

import { insertReturning, maybeOneWhere, type Db } from "@/src/data/db"
import type { AssetRow, AssetType } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "assets"

export function insertAsset(
  db: Db,
  input: {
    type: AssetType
    storageKey: string
    checksumSha256: string
    bytes: number
    mime: string
    sourceAssetId?: string
  }
): Promise<Result<AssetRow>> {
  return insertReturning<AssetRow>(db, TABLE, {
    id: newId("ast"),
    type: input.type,
    storage_key: input.storageKey,
    checksum_sha256: input.checksumSha256,
    bytes: input.bytes,
    mime: input.mime,
    source_asset_id: input.sourceAssetId ?? null,
  } as AssetRow)
}

export function getAsset(db: Db, id: string): Promise<Result<AssetRow | null>> {
  return maybeOneWhere<AssetRow>(db, TABLE, [["id", id]])
}

export function getAssetByStorageKey(
  db: Db,
  storageKey: string
): Promise<Result<AssetRow | null>> {
  return maybeOneWhere<AssetRow>(db, TABLE, [["storage_key", storageKey]])
}
