import { afterEach, describe, expect, it, vi } from "vitest"

import { prefersReducedMotion } from "@/src/viewer/logic/motion"

describe("prefersReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns true when the injected media query matches", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true)
  })

  it("returns false when the injected media query does not match", () => {
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false)
  })

  it("reads globalThis.matchMedia when no source is injected", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }))
    expect(prefersReducedMotion()).toBe(true)
  })

  it("returns false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
