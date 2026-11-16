import { describe, expect, it, vi } from "vitest"

import { toggleFullscreen } from "@/src/viewer/canvas/fullscreen"

describe("toggleFullscreen", () => {
  it("enters fullscreen when none is active", async () => {
    const requestFullscreen = vi.fn(async () => {})
    const result = await toggleFullscreen({ requestFullscreen }, { fullscreenElement: null })
    expect(requestFullscreen).toHaveBeenCalledOnce()
    expect(result).toBe(true)
  })

  it("exits fullscreen when one is active", async () => {
    const exitFullscreen = vi.fn(async () => {})
    const result = await toggleFullscreen({}, { fullscreenElement: {} as Element, exitFullscreen })
    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(result).toBe(false)
  })

  it("no-ops gracefully when the APIs or element are unavailable", async () => {
    expect(await toggleFullscreen({}, { fullscreenElement: null })).toBe(true)
    expect(await toggleFullscreen({}, { fullscreenElement: {} as Element })).toBe(false)
    expect(await toggleFullscreen(null, { fullscreenElement: null })).toBe(true)
  })
})
