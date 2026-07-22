import { describe, expect, it, vi } from "vitest"

import { resetControls } from "@/src/viewer/canvas/orbitReset"

describe("resetControls", () => {
  it("resets the controls and signals completion when present", () => {
    const reset = vi.fn()
    const onHandled = vi.fn()
    resetControls({ reset }, onHandled)
    expect(reset).toHaveBeenCalledOnce()
    expect(onHandled).toHaveBeenCalledOnce()
  })

  it("signals completion even when there are no controls", () => {
    const onHandled = vi.fn()
    resetControls(null, onHandled)
    expect(onHandled).toHaveBeenCalledOnce()
  })
})
