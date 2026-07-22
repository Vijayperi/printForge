import "server-only"

import type { AssetStorage } from "@/src/adapters/storage"
import { InMemoryStorage } from "@/src/adapters/storage/memory"

let memorySingleton: InMemoryStorage | null = null

/**
 * Resolve the asset storage. The Supabase-backed implementation is selected when
 * configured; otherwise a process-wide in-memory store is used (demo mode / dev
 * without Supabase). NOTE: the SupabaseStorage branch is added by that adapter.
 */
export function getAssetStorage(): AssetStorage {
  if (memorySingleton === null) memorySingleton = new InMemoryStorage()
  return memorySingleton
}
