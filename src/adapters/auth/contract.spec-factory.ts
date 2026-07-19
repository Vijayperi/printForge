import { describe, expect, it } from "vitest"

import { MIN_PASSWORD_LENGTH, type AuthGateway } from "@/src/adapters/auth"

/** Unique per call so the suite is re-runnable against persistent backends. */
function email(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@contract.test`
}

const PASSWORD = "password123"

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
      const address = email("signup")
      const result = await gw.signUp({ email: address, password: PASSWORD, name: "New Customer" })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.email).toBe(address)
        expect(result.value.role).toBe("customer")
        expect(result.value.name).toBe("New Customer")
      }
      const current = await gw.getUser()
      expect(current.ok && current.value?.email).toBe(address)
    })

    it("rejects a short password at sign-up", async () => {
      const gw = await makeGateway()
      const result = await gw.signUp({
        email: email("short"),
        password: "x".repeat(MIN_PASSWORD_LENGTH - 1),
        name: "B",
      })
      expect(!result.ok && result.error.code).toBe("validation")
    })

    it("rejects a duplicate email at sign-up", async () => {
      const gw = await makeGateway()
      const address = email("dup")
      await gw.signUp({ email: address, password: PASSWORD, name: "One" })
      const again = await gw.signUp({ email: address, password: "password456", name: "Two" })
      expect(!again.ok && again.error.code).toBe("conflict")
    })

    it("signs in with correct credentials and rejects wrong ones", async () => {
      const gw = await makeGateway()
      const address = email("signin")
      await gw.signUp({ email: address, password: PASSWORD, name: "C" })
      await gw.signOut()

      const wrongPassword = await gw.signInWithPassword({ email: address, password: "wrong-wrong" })
      expect(!wrongPassword.ok && wrongPassword.error.code).toBe("unauthorized")

      const unknownUser = await gw.signInWithPassword({ email: email("ghost"), password: PASSWORD })
      expect(!unknownUser.ok && unknownUser.error.code).toBe("unauthorized")

      const good = await gw.signInWithPassword({ email: address, password: PASSWORD })
      expect(good.ok).toBe(true)
    })

    it("signs out and clears the session", async () => {
      const gw = await makeGateway()
      await gw.signUp({ email: email("signout"), password: PASSWORD, name: "D" })
      expect(await gw.signOut()).toEqual({ ok: true, value: undefined })
      expect(await gw.getUser()).toEqual({ ok: true, value: null })
    })

    it("password reset requests never reveal whether the email exists", async () => {
      const gw = await makeGateway()
      expect(await gw.requestPasswordReset(email("nobody"))).toEqual({ ok: true, value: undefined })
    })

    it("updates the password only for a signed-in user, then honors it", async () => {
      const gw = await makeGateway()

      const anonymous = await gw.updatePassword("newpassword1")
      expect(!anonymous.ok && anonymous.error.code).toBe("unauthorized")

      const address = email("updatepw")
      await gw.signUp({ email: address, password: PASSWORD, name: "E" })

      const tooShort = await gw.updatePassword("short")
      expect(!tooShort.ok && tooShort.error.code).toBe("validation")

      expect((await gw.updatePassword("newpassword1")).ok).toBe(true)
      await gw.signOut()

      const oldPassword = await gw.signInWithPassword({ email: address, password: PASSWORD })
      expect(oldPassword.ok).toBe(false)
      const newPassword = await gw.signInWithPassword({ email: address, password: "newpassword1" })
      expect(newPassword.ok).toBe(true)
    })

    it("updates the display name only for a signed-in user", async () => {
      const gw = await makeGateway()

      const anonymous = await gw.updateName("Nobody")
      expect(!anonymous.ok && anonymous.error.code).toBe("unauthorized")

      await gw.signUp({ email: email("rename"), password: PASSWORD, name: "Before" })

      const empty = await gw.updateName("   ")
      expect(!empty.ok && empty.error.code).toBe("validation")

      const renamed = await gw.updateName("After Name")
      expect(renamed.ok && renamed.value.name).toBe("After Name")

      const current = await gw.getUser()
      expect(current.ok && current.value?.name).toBe("After Name")
    })
  })
}
