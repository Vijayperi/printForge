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

const createClient = vi.fn(() => ({ marker: "service-client" }))
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...(args as [])),
}))

import {
  createServerSupabase,
  getRequestDb,
  getServiceDb,
  getServiceStorageClient,
  supabaseConfigured,
} from "@/src/data/supabaseClients"

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

describe("getRequestDb", () => {
  it("returns the cookie-bound client as a Db handle", async () => {
    configureEnv()
    const db = await getRequestDb()
    expect(db).toEqual({ marker: "supabase-client" })
  })
})

describe("getServiceDb", () => {
  it("throws an AppError when the service key is missing", () => {
    configureEnv() // url + anon only, no service role key
    expect(() => getServiceDb()).toThrow(AppError)
  })

  it("builds a service-role client that bypasses RLS", () => {
    resetEnvCache()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local.supabase.test")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    const db = getServiceDb()
    expect(db).toEqual({ marker: "service-client" })
    const [url, key, opts] = createClient.mock.calls[0] as unknown as [
      string,
      string,
      { auth: { persistSession: boolean; autoRefreshToken: boolean } },
    ]
    expect(url).toBe("https://local.supabase.test")
    expect(key).toBe("service-key")
    expect(opts.auth.persistSession).toBe(false)
  })
})

describe("getServiceStorageClient", () => {
  it("throws an AppError when the service key is missing", () => {
    configureEnv() // url + anon only, no service role key
    expect(() => getServiceStorageClient()).toThrow(AppError)
  })

  it("builds a service-role storage client", () => {
    resetEnvCache()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local.supabase.test")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    expect(getServiceStorageClient()).toEqual({ marker: "service-client" })
    const [url, key] = createClient.mock.calls[0] as unknown as [string, string]
    expect(url).toBe("https://local.supabase.test")
    expect(key).toBe("service-key")
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
