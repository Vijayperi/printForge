import { afterEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

import { requireOperator } from "@/src/lib/opsAuth"
import { appError } from "@/src/lib/errors"
import { ok } from "@/src/lib/result"

const user = (role: "customer" | "operator" | "admin") => ({
  userId: "u1",
  email: "a@b.com",
  name: "A",
  role,
})

afterEach(() => vi.clearAllMocks())

describe("requireOperator", () => {
  it.each(["operator", "admin"] as const)("admits %s", async (role) => {
    getUser.mockResolvedValue(ok(user(role)))
    const result = await requireOperator()
    expect(result.ok && result.value.role).toBe(role)
  })

  it("answers not_found — never forbidden — to a customer", async () => {
    getUser.mockResolvedValue(ok(user("customer")))
    const result = await requireOperator()
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("answers not_found when there is no session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await requireOperator()).ok).toBe(false)
  })

  it("answers not_found when the gateway errors", async () => {
    getUser.mockResolvedValue({ ok: false, error: appError("unauthorized", "nope") })
    expect((await requireOperator()).ok).toBe(false)
  })
})
