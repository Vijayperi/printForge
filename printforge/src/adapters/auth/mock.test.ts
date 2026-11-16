import { describe, expect, it } from "vitest"

import { authGatewayContract } from "@/src/adapters/auth/contract.spec-factory"
import { MockAuthGateway } from "@/src/adapters/auth/mock"

authGatewayContract(() => new MockAuthGateway())

describe("MockAuthGateway extras", () => {
  it("seed creates users with any role without signing them in", async () => {
    const gw = new MockAuthGateway()
    const operator = gw.seed({
      email: "ops@example.com",
      password: "password123",
      name: "Op",
      role: "operator",
    })
    expect(operator.role).toBe("operator")
    expect(await gw.getUser()).toEqual({ ok: true, value: null })

    const signedIn = await gw.signInWithPassword({ email: "ops@example.com", password: "password123" })
    expect(signedIn.ok && signedIn.value.role).toBe("operator")
  })

  it("resolves the correct user when several accounts exist", async () => {
    const gw = new MockAuthGateway()
    gw.seed({ email: "first@example.com", password: "password123", name: "First", role: "customer" })
    gw.seed({ email: "second@example.com", password: "password123", name: "Second", role: "customer" })
    await gw.signInWithPassword({ email: "second@example.com", password: "password123" })

    const current = await gw.getUser()
    expect(current.ok && current.value?.email).toBe("second@example.com")

    expect((await gw.updatePassword("brand-new-pass")).ok).toBe(true)
    await gw.signOut()
    const first = await gw.signInWithPassword({ email: "first@example.com", password: "password123" })
    expect(first.ok).toBe(true) // first user's password untouched
    const second = await gw.signInWithPassword({ email: "second@example.com", password: "brand-new-pass" })
    expect(second.ok).toBe(true)
  })

  it("seeded users get distinct ids", () => {
    const gw = new MockAuthGateway()
    const a = gw.seed({ email: "1@example.com", password: "password123", name: "1", role: "customer" })
    const b = gw.seed({ email: "2@example.com", password: "password123", name: "2", role: "admin" })
    expect(a.userId).not.toBe(b.userId)
  })
})
