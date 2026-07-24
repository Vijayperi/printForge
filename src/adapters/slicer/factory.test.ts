import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn()
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

import { getSlicer } from "@/src/adapters/slicer/factory"
import { MockSlicer } from "@/src/adapters/slicer/mock"
import { PrusaSlicerCli } from "@/src/adapters/slicer/prusa"
import { InMemoryStorage } from "@/src/adapters/storage/memory"

const storage = new InMemoryStorage()

afterEach(() => vi.clearAllMocks())

describe("getSlicer", () => {
  it("returns the mock slicer when SLICER is mock", () => {
    getEnv.mockReturnValue({ SLICER: "mock" })
    expect(getSlicer(storage)).toBeInstanceOf(MockSlicer)
  })

  it("returns the PrusaSlicer CLI when SLICER is prusa", () => {
    getEnv.mockReturnValue({ SLICER: "prusa", PRUSA_SLICER_PATH: "/usr/bin/prusa-slicer" })
    expect(getSlicer(storage)).toBeInstanceOf(PrusaSlicerCli)
  })
})
