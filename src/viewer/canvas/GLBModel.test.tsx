import ReactThreeTestRenderer from "@react-three/test-renderer"
import { Mesh } from "three"
import { describe, expect, it, vi } from "vitest"

vi.mock("@react-three/drei", async () => {
  const { sampleScene } = await import("@/tests/helpers/threeScene")
  const scene = sampleScene()
  return { useGLTF: Object.assign(() => ({ scene }), { clear: vi.fn() }) }
})

import { GLBModel } from "@/src/viewer/canvas/GLBModel"

describe("GLBModel", () => {
  it("computes stats from the loaded scene and reports them", async () => {
    const onLoaded = vi.fn()
    const renderer = await ReactThreeTestRenderer.create(
      <GLBModel
        url="/samples/cube.glb"
        mode="visual"
        showNormals={false}
        showBoundingBox={false}
        swatchColor={null}
        onLoaded={onLoaded}
      />
    )
    expect(onLoaded).toHaveBeenCalled()
    const [bounds, triangleCount] = onLoaded.mock.calls[0] as [
      { max: { x: number } },
      number,
    ]
    expect(triangleCount).toBe(12)
    expect(bounds.max.x).toBeCloseTo(1)

    const meshes = renderer.scene.findAll(() => true).map((n) => n.instance)
    expect(meshes.some((o) => o instanceof Mesh)).toBe(true)
    await renderer.unmount()
  })
})
