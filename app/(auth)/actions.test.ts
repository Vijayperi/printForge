import { afterEach, describe, expect, it, vi } from "vitest"

import type { AuthGateway } from "@/src/adapters/auth"
import { err, ok } from "@/src/lib/result"
import { appError } from "@/src/lib/errors"

class RedirectSentinel extends Error {
  constructor(readonly target: string) {
    super(`redirect:${target}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSentinel(to)
  }),
}))

const gateway: Record<keyof AuthGateway, ReturnType<typeof vi.fn>> = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  updateName: vi.fn(),
  getUser: vi.fn(),
}

vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => gateway),
}))

import {
  loginAction,
  resetRequestAction,
  signOutAction,
  signUpAction,
  updatePasswordAction,
  updateProfileAction,
} from "@/app/(auth)/actions"

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

afterEach(() => {
  vi.clearAllMocks()
})

describe("signUpAction", () => {
  const valid = { name: "A", email: "a@b.com", password: "password123", confirm: "password123" }

  it("returns field errors on invalid input without calling the gateway", async () => {
    const state = await signUpAction({}, form({ ...valid, email: "bad" }))
    expect(state.fieldErrors?.["email"]).toBeDefined()
    expect(gateway.signUp).not.toHaveBeenCalled()
  })

  it("surfaces gateway failures as a form error", async () => {
    gateway.signUp.mockResolvedValue(err(appError("conflict", "an account with this email already exists")))
    const state = await signUpAction({}, form(valid))
    expect(state.formError).toMatch(/already exists/)
  })

  it("redirects to projects on success", async () => {
    gateway.signUp.mockResolvedValue(ok(USER))
    await expect(signUpAction({}, form(valid))).rejects.toThrow("redirect:/projects")
    expect(gateway.signUp).toHaveBeenCalledWith({ email: "a@b.com", password: "password123", name: "A" })
  })
})

describe("loginAction", () => {
  it("returns field errors on invalid input", async () => {
    const state = await loginAction({}, form({ email: "bad", password: "" }))
    expect(state.fieldErrors?.["email"]).toBeDefined()
    expect(state.fieldErrors?.["password"]).toBeDefined()
  })

  it("surfaces bad credentials as a form error", async () => {
    gateway.signInWithPassword.mockResolvedValue(err(appError("unauthorized", "invalid email or password")))
    const state = await loginAction({}, form({ email: "a@b.com", password: "wrong" }))
    expect(state.formError).toMatch(/invalid email or password/)
  })

  it("redirects to the requested next path on success", async () => {
    gateway.signInWithPassword.mockResolvedValue(ok(USER))
    await expect(
      loginAction({}, form({ email: "a@b.com", password: "password123", next: "/projects/proj_1" }))
    ).rejects.toThrow("redirect:/projects/proj_1")
  })

  it("redirects to projects when no next is given", async () => {
    gateway.signInWithPassword.mockResolvedValue(ok(USER))
    await expect(loginAction({}, form({ email: "a@b.com", password: "password123" }))).rejects.toThrow(
      "redirect:/projects"
    )
  })
})

describe("signOutAction", () => {
  it("signs out and redirects home", async () => {
    gateway.signOut.mockResolvedValue(ok(undefined))
    await expect(signOutAction()).rejects.toThrow("redirect:/")
    expect(gateway.signOut).toHaveBeenCalledOnce()
  })
})

describe("resetRequestAction", () => {
  it("returns field errors on a bad email", async () => {
    const state = await resetRequestAction({}, form({ email: "bad" }))
    expect(state.fieldErrors?.["email"]).toBeDefined()
  })

  it("reports done without revealing account existence", async () => {
    gateway.requestPasswordReset.mockResolvedValue(ok(undefined))
    const state = await resetRequestAction({}, form({ email: "a@b.com" }))
    expect(state).toEqual({ done: true })
  })
})

describe("updatePasswordAction", () => {
  it("returns field errors on mismatch", async () => {
    const state = await updatePasswordAction({}, form({ password: "password123", confirm: "nope12345" }))
    expect(state.fieldErrors?.["confirm"]).toBeDefined()
  })

  it("surfaces gateway failure as a form error", async () => {
    gateway.updatePassword.mockResolvedValue(err(appError("unauthorized", "not signed in")))
    const state = await updatePasswordAction({}, form({ password: "password123", confirm: "password123" }))
    expect(state.formError).toMatch(/not signed in/)
  })

  it("redirects to profile on success", async () => {
    gateway.updatePassword.mockResolvedValue(ok(undefined))
    await expect(
      updatePasswordAction({}, form({ password: "password123", confirm: "password123" }))
    ).rejects.toThrow("redirect:/profile")
  })
})

describe("updateProfileAction", () => {
  it("returns field errors on an empty name", async () => {
    const state = await updateProfileAction({}, form({ name: "   " }))
    expect(state.fieldErrors?.["name"]).toBeDefined()
  })

  it("surfaces gateway failure as a form error", async () => {
    gateway.updateName.mockResolvedValue(err(appError("provider_error", "profile update failed")))
    const state = await updateProfileAction({}, form({ name: "New" }))
    expect(state.formError).toMatch(/update failed/)
  })

  it("reports done on success", async () => {
    gateway.updateName.mockResolvedValue(ok({ ...USER, name: "New" }))
    const state = await updateProfileAction({}, form({ name: "New" }))
    expect(state).toEqual({ done: true })
  })
})
