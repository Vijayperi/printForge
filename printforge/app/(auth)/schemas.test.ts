import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  fieldErrorsOf,
  loginSchema,
  profileSchema,
  resetRequestSchema,
  signUpSchema,
  updatePasswordSchema,
} from "@/app/(auth)/schemas"

describe("signUpSchema", () => {
  const valid = { name: "A", email: "a@b.com", password: "password123", confirm: "password123" }

  it("accepts valid input", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ["empty name", { ...valid, name: "  " }, "name"],
    ["long name", { ...valid, name: "x".repeat(81) }, "name"],
    ["bad email", { ...valid, email: "nope" }, "email"],
    ["short password", { ...valid, password: "short", confirm: "short" }, "password"],
    ["mismatched confirm", { ...valid, confirm: "different1" }, "confirm"],
  ])("rejects %s", (_label, input, key) => {
    const result = signUpSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsOf(result.error)[key]).toBeDefined()
    }
  })
})

describe("loginSchema", () => {
  it("accepts valid input without next", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true)
  })

  it("accepts a same-origin next path", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x", next: "/projects" }).success).toBe(true)
  })

  it("rejects an absolute-url next", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x", next: "https://evil.test" }).success).toBe(false)
  })

  it("rejects a protocol-relative next", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x", next: "//evil.test" }).success).toBe(false)
  })

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false)
  })
})

describe("resetRequestSchema", () => {
  it("validates the email", () => {
    expect(resetRequestSchema.safeParse({ email: "a@b.com" }).success).toBe(true)
    expect(resetRequestSchema.safeParse({ email: "nope" }).success).toBe(false)
  })
})

describe("updatePasswordSchema", () => {
  it("requires matching, long-enough passwords", () => {
    expect(updatePasswordSchema.safeParse({ password: "password123", confirm: "password123" }).success).toBe(true)
    expect(updatePasswordSchema.safeParse({ password: "password123", confirm: "other12345" }).success).toBe(false)
    expect(updatePasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false)
  })
})

describe("profileSchema", () => {
  it("trims and validates the name", () => {
    const result = profileSchema.safeParse({ name: "  Vijay  " })
    expect(result.success && result.data.name).toBe("Vijay")
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false)
  })
})

describe("fieldErrorsOf", () => {
  it("groups multiple issues per field", () => {
    const result = signUpSchema.safeParse({ name: "", email: "bad", password: "x", confirm: "y" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = fieldErrorsOf(result.error)
      expect(Object.keys(errors).sort()).toEqual(["confirm", "email", "name", "password"])
    }
  })

  it("buckets path-less (form-level) issues under 'form'", () => {
    // A top-level refine with no `path` produces an issue with an empty path.
    const formLevel = z.object({ a: z.string() }).refine(() => false, { message: "whole form invalid" })
    const result = formLevel.safeParse({ a: "x" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsOf(result.error)["form"]).toEqual(["whole form invalid"])
    }
  })
})
