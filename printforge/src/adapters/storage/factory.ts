import "server-only"

import type { AssetStorage } from "@/src/adapters/storage"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { SupabaseStorage, type MinimalStorageClient } from "@/src/adapters/storage/supabase"
import { getEnv } from "@/src/config/env"
import { getServiceStorageClient } from "@/src/data/supabaseClients"

let memorySingleton: InMemoryStorage | null = null

/**
 * Resolve the asset storage. The Supabase-backed implementation is selected when
 * a service-role key is configured; otherwise a process-wide in-memory store is
 * used (demo mode / dev without Supabase).
 */
export function getAssetStorage(): AssetStorage {
  const env = getEnv()
  if (env.NEXT_PUBLIC_SUPABASE_URL !== undefined && env.SUPABASE_SERVICE_ROLE_KEY !== undefined) {
    return new SupabaseStorage(getServiceStorageClient() as unknown as MinimalStorageClient)
  }
  if (memorySingleton === null) memorySingleton = new InMemoryStorage()
  return memorySingleton
}
