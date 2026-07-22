import {
  BoxGeometry,
  Color,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three"
import { describe, expect, it } from "vitest"

import { cloneWireframe, cloneWithColor } from "@/src/viewer/canvas/sceneClone"

function boxMesh(color = "#112233"): Mesh {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: new Color(color) }))
}

describe("cloneWireframe", () => {
  it("replaces materials with wireframe without mutating the source", () => {
    const source = boxMesh()
    const sourceMaterial = source.material as MeshStandardMaterial
    const clone = cloneWireframe(source) as Mesh
    expect(clone.material).toBeInstanceOf(MeshBasicMaterial)
    expect((clone.material as MeshBasicMaterial).wireframe).toBe(true)
    // Source untouched.
    expect(source.material).toBe(sourceMaterial)
    expect(sourceMaterial.wireframe).toBe(false)
  })

  it("falls back to a default colour when the material has none", () => {
    const source = boxMesh()
    ;(source as unknown as { material: Material }).material = {} as Material
    const clone = cloneWireframe(source) as Mesh
    expect(clone.material).toBeInstanceOf(MeshBasicMaterial)
  })

  it("reads the first material of a multi-material mesh for the wireframe colour", () => {
    const source = boxMesh()
    source.material = [
      new MeshStandardMaterial({ color: new Color("#abcdef") }),
      new MeshStandardMaterial({ color: new Color("#123456") }),
    ]
    const clone = cloneWireframe(source) as Mesh
    expect(clone.material).toBeInstanceOf(MeshBasicMaterial)
  })
})

describe("cloneWithColor", () => {
  it("tints a single material on the clone only", () => {
    const source = boxMesh("#112233")
    const original = source.material as MeshStandardMaterial
    const clone = cloneWithColor(source, "#ff0000") as Mesh
    const cloned = clone.material as MeshStandardMaterial
    expect(cloned.color.getHexString()).toBe("ff0000")
    // Original colour unchanged.
    expect(original.color.getHexString()).toBe("112233")
    expect(cloned).not.toBe(original)
  })

  it("tints every material of a multi-material mesh", () => {
    const source = boxMesh()
    source.material = [new MeshStandardMaterial({ color: new Color("#111111") }), new MeshStandardMaterial({ color: new Color("#222222") })]
    const clone = cloneWithColor(source, "#00ff00") as Mesh
    const materials = clone.material as MeshStandardMaterial[]
    expect(materials).toHaveLength(2)
    expect(materials[0]!.color.getHexString()).toBe("00ff00")
    expect(materials[1]!.color.getHexString()).toBe("00ff00")
  })

  it("leaves a color-less material untinted on the clone", () => {
    const source = new Mesh(new BoxGeometry(1, 1, 1), new Material())
    const clone = cloneWithColor(source, "#00ff00") as Mesh
    // A base Material has no color; the clone still swaps in a fresh instance.
    expect(clone.material).not.toBe(source.material)
    expect(clone.material).toBeInstanceOf(Material)
  })

  it("skips non-mesh nodes while traversing a group", () => {
    const group = new Group()
    group.add(boxMesh("#112233"))
    const wire = cloneWireframe(group)
    const tinted = cloneWithColor(group, "#00ff00")
    // The group root is not a mesh; only its mesh child is transformed.
    expect(wire).toBeInstanceOf(Group)
    expect(tinted).toBeInstanceOf(Group)
    const wireMesh = wire.children[0] as Mesh
    expect(wireMesh.material).toBeInstanceOf(MeshBasicMaterial)
  })
})
