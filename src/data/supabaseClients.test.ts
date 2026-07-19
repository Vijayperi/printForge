import { afterEach, describe, expect, it, vi } from "vitest"

import { resetEnvCache } from "@/src/config/env"
import { AppError } from "@/src/lib/errors"

const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb", value: "token" }]),
  set: vi.fn(),
}

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}))

const createServerClient = vi.fn(() => ({ marker: "supabase-client" }))
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...(args as [])),
}))

import { createServerSupabase, supabaseConfigured } from "@/src/data/supabaseClients"

function configureEnv(): void {
  resetEnvCache()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local.supabase.test")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetEnvCache()
  vi.clearAllMocks()
})

describe("supabaseConfigured", () => {
  it("is false without env", () => {
    resetEnvCache()
    expect(supabaseConfigured()).toBe(false)
  })

  it("is true with url and anon key", () => {
    configureEnv()
    expect(supabaseConfigured()).toBe(true)
  })
})

describe("createServerSupabase", () => {
  it("throws an AppError when not configured", async () => {
    resetEnvCache()
    await expect(createServerSupabase()).rejects.toBeInstanceOf(AppError)
  })

  it("builds a cookie-bound client", async () => {
    configureEnv()
    const client = await createServerSupabase()
    expect(client).toEqual({ marker: "supabase-client" })
    const [url, key, opts] = createServerClient.mock.calls[0] as unknown as [
      string,
      string,
      { cookies: { getAll(): unknown; setAll(list: unknown[]): void } },
    ]
    expect(url).toBe("https://local.supabase.test")
    expect(key).toBe("anon-key")

    expect(opts.cookies.getAll()).toEqual([{ name: "sb", value: "token" }])

    opts.cookies.setAll([{ name: "sb", value: "v2", options: { path: "/" } }])
    expect(cookieStore.set).toHaveBeenCalledWith("sb", "v2", { path: "/" })
  })

  it("swallows cookie writes from read-only render contexts", async () => {
    configureEnv()
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("read-only in server component")
    })
    await createServerSupabase()
    const call = createServerClient.mock.calls[0] as unknown as unknown[]
    const opts = call[2] as { cookies: { setAll(list: unknown[]): void } }
    expect(() => opts.cookies.setAll([{ name: "a", value: "b", options: {} }])).not.toThrow()
  })
})
