import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn()
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

import { getNotifier, resetMockNotifier } from "@/src/adapters/email/factory"
import { MockNotifier } from "@/src/adapters/email/mock"
import { ResendNotifier } from "@/src/adapters/email/resend"

afterEach(() => {
  vi.clearAllMocks()
  resetMockNotifier()
})

describe("getNotifier", () => {
  it("returns the mock notifier when EMAIL is mock", () => {
    getEnv.mockReturnValue({ EMAIL: "mock" })
    expect(getNotifier()).toBeInstanceOf(MockNotifier)
  })

  it("returns the same mock notifier every call, so its outbox survives", () => {
    getEnv.mockReturnValue({ EMAIL: "mock" })
    expect(getNotifier()).toBe(getNotifier())
  })

  it("forgets the outbox on reset", () => {
    getEnv.mockReturnValue({ EMAIL: "mock" })
    const first = getNotifier()
    resetMockNotifier()
    expect(getNotifier()).not.toBe(first)
  })

  it("returns the Resend notifier when EMAIL is resend", () => {
    getEnv.mockReturnValue({
      EMAIL: "resend",
      RESEND_API_KEY: "re_key",
      EMAIL_FROM: "PrintForge <orders@printforge.test>",
    })
    expect(getNotifier()).toBeInstanceOf(ResendNotifier)
  })
})
