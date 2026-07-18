import { describe, expect, it } from "vitest"

import { MIN_PASSWORD_LENGTH, type AuthGateway } from "@/src/adapters/auth"

/**
 * Shared contract suite per plan §4.4: every AuthGateway implementation must
 * pass exactly these behaviors so mock and real can never drift.
 */
export function authGatewayContract(makeGateway: () => AuthGateway | Promise<AuthGateway>): void {
  describe("AuthGateway contract", () => {
    it("starts with no signed-in user", async () => {
      const gw = await makeGateway()
      expect(await gw.getUser()).toEqual({ ok: true, value: null })
    })

    it("signs up a new customer and signs them in", async () => {
      const gw = await makeGateway()
      const result = await gw.signUp({ email: "a@example.com", password: "password123", name: "A" })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.email).toBe("a@example.com")
        expect(result.value.role).toBe("customer")
      }
      const current = await gw.getUser()
      expect(current.ok && current.value?.email).toBe("a@example.com")
    })

    it("rejects a short password at sign-up", async () => {
      const gw = await makeGateway()
      const result = await gw.signUp({
        email: "b@example.com",
        password: "x".repeat(MIN_PASSWORD_LENGTH - 1),
        name: "B",
      })
      expect(!result.ok && result.error.code).toBe("validation")
    })

    it("rejects a duplicate email at sign-up", async () => {
      const gw = await makeGateway()
      await gw.signUp({ email: "dup@example.com", password: "password123", name: "One" })
      const again = await gw.signUp({ email: "dup@example.com", password: "password456", name: "Two" })
      expect(!again.ok && again.error.code).toBe("conflict")
    })

    it("signs in with correct credentials and rejects wrong ones", async () => {
      const gw = await makeGateway()
      await gw.signUp({ email: "c@example.com", password: "password123", name: "C" })
      await gw.signOut()

      const wrongPassword = await gw.signInWithPassword({ email: "c@example.com", password: "nope-nope" })
      expect(!wrongPassword.ok && wrongPassword.error.code).toBe("unauthorized")

      const unknownUser = await gw.signInWithPassword({ email: "ghost@example.com", password: "password123" })
      expect(!unknownUser.ok && unknownUser.error.code).toBe("unauthorized")

      const good = await gw.signInWithPassword({ email: "c@example.com", password: "password123" })
      expect(good.ok).toBe(true)
    })

    it("signs out and clears the session", async () => {
      const gw = await makeGateway()
      await gw.signUp({ email: "d@example.com", password: "password123", name: "D" })
      expect(await gw.signOut()).toEqual({ ok: true, value: undefined })
      expect(await gw.getUser()).toEqual({ ok: true, value: null })
    })

    it("password reset requests never reveal whether the email exists", async () => {
      const gw = await makeGateway()
      expect(await gw.requestPasswordReset("nobody@example.com")).toEqual({ ok: true, value: undefined })
    })

    it("updates the password only for a signed-in user, then honors it", async () => {
      const gw = await makeGateway()

      const anonymous = await gw.updatePassword("newpassword1")
      expect(!anonymous.ok && anonymous.error.code).toBe("unauthorized")

      await gw.signUp({ email: "e@example.com", password: "password123", name: "E" })

      const tooShort = await gw.updatePassword("short")
      expect(!tooShort.ok && tooShort.error.code).toBe("validation")

      expect((await gw.updatePassword("newpassword1")).ok).toBe(true)
      await gw.signOut()

      const oldPassword = await gw.signInWithPassword({ email: "e@example.com", password: "password123" })
      expect(oldPassword.ok).toBe(false)
      const newPassword = await gw.signInWithPassword({ email: "e@example.com", password: "newpassword1" })
      expect(newPassword.ok).toBe(true)
    })
  })
}
