import ReactThreeTestRenderer from "@react-three/test-renderer"
import { describe, expect, it, vi } from "vitest"

vi.mock("@react-three/drei", async () => {
  const { sampleScene } = await import("@/tests/helpers/threeScene")
  const scene = sampleScene()
  return { useGLTF: Object.assign(() => ({ scene }), { clear: vi.fn() }), OrbitControls: () => null }
})

import { ViewerScene } from "@/src/viewer/canvas/ViewerScene"

describe("ViewerScene", () => {
  it("composes lighting, the model, and orbit controls", async () => {
    const onLoaded = vi.fn()
    const onResetHandled = vi.fn()
    const renderer = await ReactThreeTestRenderer.create(
      <ViewerScene
        url="/samples/cube.glb"
        mode="visual"
        showNormals={false}
        showBoundingBox={false}
        swatchColor={null}
        reducedMotion={false}
        resetRequested={false}
        onLoaded={onLoaded}
        onResetHandled={onResetHandled}
      />
    )
    const types = renderer.scene.findAll(() => true).map((n) => n.type)
    expect(types).toContain("AmbientLight")
    expect(types).toContain("Mesh")
    expect(onLoaded).toHaveBeenCalled()
    await renderer.unmount()
  })
})
