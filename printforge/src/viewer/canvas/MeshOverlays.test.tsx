import ReactThreeTestRenderer from "@react-three/test-renderer"
import { Box3, Box3Helper, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three"
import { VertexNormalsHelper } from "three/addons/helpers/VertexNormalsHelper.js"
import { describe, expect, it } from "vitest"

import { MeshOverlays, type MeshOverlaysProps } from "@/src/viewer/canvas/MeshOverlays"
import { sampleScene } from "@/tests/helpers/threeScene"

async function render(overrides: Partial<MeshOverlaysProps> = {}) {
  const scene = overrides.scene ?? sampleScene()
  const props: MeshOverlaysProps = {
    scene,
    box: new Box3().setFromObject(scene),
    mode: "visual",
    showNormals: false,
    showBoundingBox: false,
    swatchColor: null,
    ...overrides,
  }
  const renderer = await ReactThreeTestRenderer.create(<MeshOverlays {...props} />)
  return { renderer, scene }
}

function instances(renderer: Awaited<ReturnType<typeof render>>["renderer"]) {
  return renderer.scene.findAll(() => true).map((n) => n.instance)
}

describe("MeshOverlays", () => {
  it("shows original PBR materials in visual mode", async () => {
    const { renderer } = await render({ mode: "visual" })
    const meshes = instances(renderer).filter((o): o is Mesh => o instanceof Mesh)
    expect(meshes.some((m) => m.material instanceof MeshStandardMaterial)).toBe(true)
    await renderer.unmount()
  })

  it("shows a wireframe clone in mesh mode without mutating the source", async () => {
    const { renderer, scene } = await render({ mode: "mesh" })
    const meshes = instances(renderer).filter((o): o is Mesh => o instanceof Mesh)
    expect(meshes.some((m) => m.material instanceof MeshBasicMaterial && m.material.wireframe)).toBe(true)
    // Source mesh material untouched.
    const sourceMesh = scene.children[0] as Mesh
    expect(sourceMesh.material).toBeInstanceOf(MeshStandardMaterial)
    await renderer.unmount()
  })

  it("applies a swatch colour clone in visual mode", async () => {
    const { renderer } = await render({ mode: "visual", swatchColor: "#ff0000" })
    const meshes = instances(renderer).filter((o): o is Mesh => o instanceof Mesh)
    const tinted = meshes.find((m) => m.material instanceof MeshStandardMaterial) as Mesh
    expect((tinted.material as MeshStandardMaterial).color.getHexString()).toBe("ff0000")
    await renderer.unmount()
  })

  it("renders the bounding box helper only when enabled", async () => {
    const off = await render({ showBoundingBox: false })
    expect(instances(off.renderer).some((o) => o instanceof Box3Helper)).toBe(false)
    await off.renderer.unmount()

    const on = await render({ showBoundingBox: true })
    expect(instances(on.renderer).some((o) => o instanceof Box3Helper)).toBe(true)
    await on.renderer.unmount()
  })

  it("renders normals helpers only in mesh mode when enabled", async () => {
    const visual = await render({ mode: "visual", showNormals: true })
    expect(instances(visual.renderer).some((o) => o instanceof VertexNormalsHelper)).toBe(false)
    await visual.renderer.unmount()

    const mesh = await render({ mode: "mesh", showNormals: true })
    expect(instances(mesh.renderer).some((o) => o instanceof VertexNormalsHelper)).toBe(true)
    await mesh.renderer.unmount()
  })
})
