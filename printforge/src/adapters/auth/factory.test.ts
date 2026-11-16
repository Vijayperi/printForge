import { afterEach, describe, expect, it, vi } from "vitest"

const supabaseConfigured = vi.fn(() => false)
const createServerSupabase = vi.fn(async () => ({
  auth: {},
  from: vi.fn(),
}))

vi.mock("@/src/data/supabaseClients", () => ({
  supabaseConfigured: () => supabaseConfigured(),
  createServerSupabase: () => createServerSupabase(),
}))

import { getAuthGateway, resetAuthGatewayForTests } from "@/src/adapters/auth/factory"
import { MockAuthGateway } from "@/src/adapters/auth/mock"
import { SupabaseAuthGateway } from "@/src/adapters/auth/supabase"

afterEach(() => {
  resetAuthGatewayForTests()
  vi.clearAllMocks()
  supabaseConfigured.mockReturnValue(false)
})

describe("getAuthGateway", () => {
  it("returns the process-wide mock when Supabase is not configured", async () => {
    const first = await getAuthGateway()
    const second = await getAuthGateway()
    expect(first).toBeInstanceOf(MockAuthGateway)
    expect(second).toBe(first)
  })

  it("resetAuthGatewayForTests drops the singleton", async () => {
    const first = await getAuthGateway()
    resetAuthGatewayForTests()
    const second = await getAuthGateway()
    expect(second).not.toBe(first)
  })

  it("returns a fresh Supabase gateway per call when configured", async () => {
    supabaseConfigured.mockReturnValue(true)
    const gateway = await getAuthGateway()
    expect(gateway).toBeInstanceOf(SupabaseAuthGateway)
    expect(createServerSupabase).toHaveBeenCalledOnce()
  })
})
