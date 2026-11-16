import ReactThreeTestRenderer from "@react-three/test-renderer"
import { describe, expect, it, vi } from "vitest"

vi.mock("@react-three/drei", () => ({
  // A no-op OrbitControls: the ref stays null so resetControls takes the
  // no-controls path; the effect's own branch is what we exercise here.
  OrbitControls: () => null,
}))

import { OrbitRig } from "@/src/viewer/canvas/OrbitRig"

describe("OrbitRig", () => {
  it("does not reset until requested, then signals completion once", async () => {
    const onResetHandled = vi.fn()
    const renderer = await ReactThreeTestRenderer.create(
      <OrbitRig reducedMotion={false} resetRequested={false} onResetHandled={onResetHandled} />
    )
    expect(onResetHandled).not.toHaveBeenCalled()

    await renderer.update(
      <OrbitRig reducedMotion resetRequested onResetHandled={onResetHandled} />
    )
    expect(onResetHandled).toHaveBeenCalledTimes(1)
    await renderer.unmount()
  })
})
