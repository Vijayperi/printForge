import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn()
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

import { DodoProvider } from "@/src/adapters/payments/dodo"
import { getPaymentProvider } from "@/src/adapters/payments/factory"
import { MockPaymentProvider } from "@/src/adapters/payments/mock"

const DODO_ENV = {
  PAYMENT_PROVIDER: "dodo",
  DODO_API_KEY: "dk",
  DODO_PRODUCT_ID: "pdt_1",
  DODO_WEBHOOK_SECRET: "ZG9kby10ZXN0LXdlYmhvb2stc2VjcmV0LXZhbA==",
  DODO_ENV: "test_mode",
}

afterEach(() => vi.clearAllMocks())

describe("getPaymentProvider", () => {
  it("returns the mock provider when PAYMENT_PROVIDER is mock", () => {
    getEnv.mockReturnValue({ PAYMENT_PROVIDER: "mock" })
    expect(getPaymentProvider()).toBeInstanceOf(MockPaymentProvider)
  })

  it("returns the Dodo provider when PAYMENT_PROVIDER is dodo", () => {
    getEnv.mockReturnValue(DODO_ENV)
    expect(getPaymentProvider()).toBeInstanceOf(DodoProvider)
  })

  it("honours DODO_ENV=live_mode", () => {
    getEnv.mockReturnValue({ ...DODO_ENV, DODO_ENV: "live_mode" })
    expect(getPaymentProvider()).toBeInstanceOf(DodoProvider)
  })
})
