import { describe, expect, it, vi } from "vitest"

import { SupabaseAuthGateway, type MinimalSupabase } from "@/src/adapters/auth/supabase"

interface FakeOptions {
  signUp?: Awaited<ReturnType<MinimalSupabase["auth"]["signUp"]>>
  signIn?: Awaited<ReturnType<MinimalSupabase["auth"]["signInWithPassword"]>>
  signOutError?: { message: string } | null
  resetError?: { message: string } | null
  getUser?: Awaited<ReturnType<MinimalSupabase["auth"]["getUser"]>>
  updateUser?: Awaited<ReturnType<MinimalSupabase["auth"]["updateUser"]>>
  profile?: { data: ProfileRowLike | null; error: { message: string } | null }
  profileUpdate?: { data: ProfileRowLike | null; error: { message: string } | null }
}

interface ProfileRowLike {
  user_id: string
  role: "customer" | "operator" | "admin"
  name: string
  email: string
}

const USER = { id: "uuid-1", email: "u@example.com" }
const PROFILE: ProfileRowLike = { user_id: "uuid-1", role: "customer", name: "U", email: "u@example.com" }

function fake(opts: FakeOptions = {}) {
  const calls = {
    resetArgs: [] as unknown[],
    updateNameArgs: [] as unknown[],
  }
  const client: MinimalSupabase = {
    auth: {
      signUp: vi.fn(async () => opts.signUp ?? { data: { user: USER }, error: null }),
      signInWithPassword: vi.fn(async () => opts.signIn ?? { data: { user: USER }, error: null }),
      signOut: vi.fn(async () => ({ error: opts.signOutError ?? null })),
      resetPasswordForEmail: vi.fn(async (...args: unknown[]) => {
        calls.resetArgs = args
        return { error: opts.resetError ?? null }
      }),
      updateUser: vi.fn(async () => opts.updateUser ?? { data: { user: USER }, error: null }),
      getUser: vi.fn(async () => opts.getUser ?? { data: { user: USER }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => opts.profile ?? { data: PROFILE, error: null }),
        })),
      })),
      update: vi.fn((values: unknown) => {
        calls.updateNameArgs.push(values)
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => opts.profileUpdate ?? { data: PROFILE, error: null }),
            })),
          })),
        }
      }),
    })) as unknown as MinimalSupabase["from"],
  }
  return { client, calls, gateway: new SupabaseAuthGateway(client, "https://app.test") }
}

const good = { email: "u@example.com", password: "password123", name: "U" }

describe("SupabaseAuthGateway.signUp", () => {
  it("rejects short passwords before calling the provider", async () => {
    const { gateway, client } = fake()
    const result = await gateway.signUp({ ...good, password: "short" })
    expect(!result.ok && result.error.code).toBe("validation")
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })

  it("maps duplicate sign-ups to conflict by error code", async () => {
    const { gateway } = fake({
      signUp: { data: { user: null }, error: { message: "x", code: "user_already_exists" } },
    })
    const result = await gateway.signUp(good)
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it("maps duplicate sign-ups to conflict by message", async () => {
    const { gateway } = fake({
      signUp: { data: { user: null }, error: { message: "User already registered" } },
    })
    const result = await gateway.signUp(good)
    expect(!result.ok && result.error.code).toBe("conflict")
  })

  it("maps other provider errors to provider_error", async () => {
    const { gateway } = fake({ signUp: { data: { user: null }, error: { message: "boom" } } })
    const result = await gateway.signUp(good)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("treats a missing user in the response as provider_error", async () => {
    const { gateway } = fake({ signUp: { data: { user: null }, error: null } })
    const result = await gateway.signUp(good)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("returns the profile-backed user on success", async () => {
    const { gateway } = fake()
    const result = await gateway.signUp(good)
    expect(result.ok && result.value).toEqual({
      userId: "uuid-1",
      email: "u@example.com",
      name: "U",
      role: "customer",
    })
  })

  it("fails when the profile row is missing after sign-up", async () => {
    const { gateway } = fake({ profile: { data: null, error: null } })
    const result = await gateway.signUp(good)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("SupabaseAuthGateway.signInWithPassword", () => {
  it("maps invalid credentials to unauthorized (code)", async () => {
    const { gateway } = fake({
      signIn: { data: { user: null }, error: { message: "x", code: "invalid_credentials" } },
    })
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("maps 400-class failures to unauthorized (status)", async () => {
    const { gateway } = fake({ signIn: { data: { user: null }, error: { message: "x", status: 400 } } })
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("maps unexpected failures to provider_error", async () => {
    const { gateway } = fake({ signIn: { data: { user: null }, error: { message: "x", status: 500 } } })
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("treats a missing user as provider_error", async () => {
    const { gateway } = fake({ signIn: { data: { user: null }, error: null } })
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("returns the profile-backed user on success", async () => {
    const { gateway } = fake()
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(result.ok && result.value.userId).toBe("uuid-1")
  })

  it("propagates a profile lookup error", async () => {
    const { gateway } = fake({ profile: { data: null, error: { message: "db down" } } })
    const result = await gateway.signInWithPassword({ email: "e@x.com", password: "p" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("SupabaseAuthGateway.signOut", () => {
  it("succeeds", async () => {
    const { gateway } = fake()
    expect(await gateway.signOut()).toEqual({ ok: true, value: undefined })
  })

  it("maps errors to provider_error", async () => {
    const { gateway } = fake({ signOutError: { message: "nope" } })
    const result = await gateway.signOut()
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("SupabaseAuthGateway.requestPasswordReset", () => {
  it("always reports success and sends the redirect target", async () => {
    const { gateway, calls } = fake({ resetError: { message: "smtp down" } })
    expect(await gateway.requestPasswordReset("a@b.com")).toEqual({ ok: true, value: undefined })
    expect(calls.resetArgs[0]).toBe("a@b.com")
    expect(calls.resetArgs[1]).toEqual({ redirectTo: "https://app.test/reset-password/update" })
  })
})

describe("SupabaseAuthGateway.updatePassword", () => {
  it("rejects short passwords", async () => {
    const { gateway } = fake()
    const result = await gateway.updatePassword("short")
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("requires a session (error case)", async () => {
    const { gateway } = fake({ getUser: { data: { user: null }, error: { message: "no session" } } })
    const result = await gateway.updatePassword("password123")
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("requires a session (null user case)", async () => {
    const { gateway } = fake({ getUser: { data: { user: null }, error: null } })
    const result = await gateway.updatePassword("password123")
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("maps authn failures during update to unauthorized", async () => {
    const { gateway } = fake({ updateUser: { data: { user: null }, error: { message: "x", status: 401 } } })
    const result = await gateway.updatePassword("password123")
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("maps other update failures to provider_error", async () => {
    const { gateway } = fake({ updateUser: { data: { user: null }, error: { message: "x", status: 500 } } })
    const result = await gateway.updatePassword("password123")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("succeeds", async () => {
    const { gateway } = fake()
    expect(await gateway.updatePassword("password123")).toEqual({ ok: true, value: undefined })
  })
})

describe("SupabaseAuthGateway.updateName", () => {
  it("rejects an empty name", async () => {
    const { gateway } = fake()
    const result = await gateway.updateName("   ")
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("requires a session", async () => {
    const { gateway } = fake({ getUser: { data: { user: null }, error: null } })
    const result = await gateway.updateName("New Name")
    expect(!result.ok && result.error.code).toBe("unauthorized")
  })

  it("maps update failures to provider_error", async () => {
    const { gateway } = fake({ profileUpdate: { data: null, error: { message: "rls" } } })
    const result = await gateway.updateName("New Name")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("maps a missing updated row to provider_error", async () => {
    const { gateway } = fake({ profileUpdate: { data: null, error: null } })
    const result = await gateway.updateName("New Name")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("trims and saves the name", async () => {
    const { gateway, calls } = fake({
      profileUpdate: { data: { ...PROFILE, name: "New Name" }, error: null },
    })
    const result = await gateway.updateName("  New Name  ")
    expect(calls.updateNameArgs[0]).toEqual({ name: "New Name" })
    expect(result.ok && result.value.name).toBe("New Name")
  })
})

describe("SupabaseAuthGateway.getUser", () => {
  it("returns null when there is no session (error)", async () => {
    const { gateway } = fake({ getUser: { data: { user: null }, error: { message: "no" } } })
    expect(await gateway.getUser()).toEqual({ ok: true, value: null })
  })

  it("returns null when there is no session (null user)", async () => {
    const { gateway } = fake({ getUser: { data: { user: null }, error: null } })
    expect(await gateway.getUser()).toEqual({ ok: true, value: null })
  })

  it("returns the profile-backed user", async () => {
    const { gateway } = fake()
    const result = await gateway.getUser()
    expect(result.ok && result.value?.role).toBe("customer")
  })

  it("fails when the profile is missing", async () => {
    const { gateway } = fake({ profile: { data: null, error: null } })
    const result = await gateway.getUser()
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})
