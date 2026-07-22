import ReactThreeTestRenderer from "@react-three/test-renderer"
import { describe, expect, it } from "vitest"

import { Lighting } from "@/src/viewer/canvas/Lighting"

describe("Lighting", () => {
  it("renders ambient, hemisphere, and directional lights", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Lighting />)
    const types = renderer.scene.findAll(() => true).map((n) => n.type)
    expect(types).toContain("AmbientLight")
    expect(types).toContain("HemisphereLight")
    expect(types.filter((t) => t === "DirectionalLight")).toHaveLength(2)
    await renderer.unmount()
  })
})
