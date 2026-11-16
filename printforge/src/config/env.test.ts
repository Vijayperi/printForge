import { afterEach, describe, expect, it } from "vitest"

import { getEnv, loadEnv, resetEnvCache } from "@/src/config/env"
import { AppError } from "@/src/lib/errors"

function expectInvalid(raw: Record<string, string | undefined>, pattern: RegExp): void {
  const result = loadEnv(raw)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(AppError)
    expect(result.error.code).toBe("validation")
    expect(result.error.message).toMatch(pattern)
  }
}

describe("loadEnv", () => {
  it("applies all defaults on an empty environment", () => {
    const result = loadEnv({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatchObject({
        NODE_ENV: "development",
        APP_URL: "http://localhost:3000",
        GENERATION_PROVIDER: "mock",
        PAYMENT_PROVIDER: "mock",
        DODO_ENV: "test_mode",
        SLICER: "mock",
        PRINTER_GATEWAY: "mock",
        EMAIL: "mock",
      })
    }
  })

  it("rejects an invalid APP_URL", () => {
    expectInvalid({ APP_URL: "not-a-url" }, /APP_URL/)
  })

  it("rejects an unknown provider value", () => {
    expectInvalid({ PAYMENT_PROVIDER: "stripe" }, /PAYMENT_PROVIDER/)
  })

  it("requires MESHY_API_KEY when GENERATION_PROVIDER=meshy", () => {
    expectInvalid({ GENERATION_PROVIDER: "meshy" }, /MESHY_API_KEY: required when GENERATION_PROVIDER=meshy/)
  })

  it("accepts meshy with its key", () => {
    expect(loadEnv({ GENERATION_PROVIDER: "meshy", MESHY_API_KEY: "mk" }).ok).toBe(true)
  })

  it("requires all three Dodo values when PAYMENT_PROVIDER=dodo", () => {
    const result = loadEnv({ PAYMENT_PROVIDER: "dodo" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/DODO_API_KEY/)
      expect(result.error.message).toMatch(/DODO_WEBHOOK_SECRET/)
      expect(result.error.message).toMatch(/DODO_PRODUCT_ID/)
    }
  })

  it("reports only the missing Dodo values", () => {
    const result = loadEnv({ PAYMENT_PROVIDER: "dodo", DODO_API_KEY: "k" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).not.toMatch(/DODO_API_KEY/)
      expect(result.error.message).toMatch(/DODO_WEBHOOK_SECRET/)
    }
  })

  it("accepts dodo with all keys", () => {
    const result = loadEnv({
      PAYMENT_PROVIDER: "dodo",
      DODO_API_KEY: "k",
      DODO_WEBHOOK_SECRET: "s",
      DODO_PRODUCT_ID: "p",
      DODO_ENV: "live_mode",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.DODO_ENV).toBe("live_mode")
  })

  it("requires PRUSA_SLICER_PATH when SLICER=prusa", () => {
    expectInvalid({ SLICER: "prusa" }, /PRUSA_SLICER_PATH/)
    expect(loadEnv({ SLICER: "prusa", PRUSA_SLICER_PATH: "/usr/bin/prusa-slicer" }).ok).toBe(true)
  })

  it("requires PRINTER_GATEWAY_CONFIG when PRINTER_GATEWAY=octoprint", () => {
    expectInvalid({ PRINTER_GATEWAY: "octoprint" }, /PRINTER_GATEWAY_CONFIG: required/)
  })

  it("requires PRINTER_GATEWAY_CONFIG to be valid JSON", () => {
    expectInvalid({ PRINTER_GATEWAY: "octoprint", PRINTER_GATEWAY_CONFIG: "{oops" }, /must be valid JSON/)
    expect(loadEnv({ PRINTER_GATEWAY: "octoprint", PRINTER_GATEWAY_CONFIG: "{\"printers\":[]}" }).ok).toBe(true)
  })

  it("requires RESEND_API_KEY when EMAIL=resend", () => {
    expectInvalid({ EMAIL: "resend" }, /RESEND_API_KEY/)
    expect(
      loadEnv({ EMAIL: "resend", RESEND_API_KEY: "rk", EMAIL_FROM: "PF <o@printforge.in>" }).ok
    ).toBe(true)
  })

  it("refuses the placeholder sending address when EMAIL=resend", () => {
    expectInvalid({ EMAIL: "resend", RESEND_API_KEY: "rk" }, /verified sending address/)
  })

  it("defaults the sending identity and the ops inbox so the app runs env-free", () => {
    const env = loadEnv({})
    expect(env.ok && env.value.EMAIL).toBe("mock")
    expect(env.ok && env.value.EMAIL_FROM.length).toBeGreaterThan(0)
    expect(env.ok && env.value.OPS_ALERT_EMAIL).toContain("@")
  })

  it("rejects an ops inbox that is not an email address", () => {
    expectInvalid({ OPS_ALERT_EMAIL: "not-an-inbox" }, /OPS_ALERT_EMAIL/)
  })

  it("accepts optional Supabase values when present and valid", () => {
    const result = loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    })
    expect(result.ok).toBe(true)
  })

  it("rejects an invalid Supabase URL", () => {
    expectInvalid({ NEXT_PUBLIC_SUPABASE_URL: "nope" }, /NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe("getEnv", () => {
  afterEach(() => {
    resetEnvCache()
    delete process.env["APP_URL"]
    delete process.env["PAYMENT_PROVIDER"]
  })

  it("parses process.env and memoizes the result", () => {
    resetEnvCache()
    process.env["APP_URL"] = "https://printforge.example"
    const first = getEnv()
    expect(first.APP_URL).toBe("https://printforge.example")
    process.env["APP_URL"] = "https://changed.example"
    expect(getEnv()).toBe(first) // cached, not re-read
  })

  it("throws the AppError when process.env is invalid", () => {
    resetEnvCache()
    process.env["PAYMENT_PROVIDER"] = "dodo"
    expect(() => getEnv()).toThrow(AppError)
  })
})
