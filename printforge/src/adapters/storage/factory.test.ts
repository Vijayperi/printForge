import { afterEach, describe, expect, it, vi } from "vitest"

import { resetEnvCache } from "@/src/config/env"

const getServiceStorageClient = vi.fn(() => ({ storage: { from: () => ({}) } }))
vi.mock("@/src/data/supabaseClients", () => ({
  getServiceStorageClient: () => getServiceStorageClient(),
}))

import { getAssetStorage } from "@/src/adapters/storage/factory"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { SupabaseStorage } from "@/src/adapters/storage/supabase"

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvCache()
  vi.clearAllMocks()
})

describe("getAssetStorage", () => {
  it("returns a process-wide in-memory store without Supabase configured", () => {
    resetEnvCache()
    const first = getAssetStorage()
    expect(first).toBeInstanceOf(InMemoryStorage)
    expect(getAssetStorage()).toBe(first) // singleton
  })

  it("returns Supabase storage when the service key is configured", () => {
    resetEnvCache()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local.supabase.test")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    expect(getAssetStorage()).toBeInstanceOf(SupabaseStorage)
    expect(getServiceStorageClient).toHaveBeenCalledOnce()
  })
})
