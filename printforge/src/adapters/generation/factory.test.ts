import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn()
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

import { getGenerationProvider } from "@/src/adapters/generation/factory"
import { MeshyProvider } from "@/src/adapters/generation/meshy"
import { MockGenerationProvider } from "@/src/adapters/generation/mock"

afterEach(() => vi.clearAllMocks())

describe("getGenerationProvider", () => {
  it("returns the mock provider when GENERATION_PROVIDER is mock", () => {
    getEnv.mockReturnValue({ GENERATION_PROVIDER: "mock" })
    expect(getGenerationProvider()).toBeInstanceOf(MockGenerationProvider)
  })

  it("returns the Meshy provider when GENERATION_PROVIDER is meshy", () => {
    getEnv.mockReturnValue({ GENERATION_PROVIDER: "meshy", MESHY_API_KEY: "mk" })
    expect(getGenerationProvider()).toBeInstanceOf(MeshyProvider)
  })
})
