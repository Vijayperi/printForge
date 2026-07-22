import { Color, Mesh, MeshBasicMaterial, type Material, type Object3D } from "three"

function materialColor(material: Material | Material[]): Color {
  const first = Array.isArray(material) ? material[0] : material
  const withColor = first as unknown as { color?: Color }
  return withColor?.color instanceof Color ? withColor.color.clone() : new Color("#8899aa")
}

/**
 * A wireframe clone of the scene. The clone reuses geometry but REPLACES each
 * mesh's material with a wireframe basic material, so the original scene's
 * materials are never mutated (plan §6-S6).
 */
export function cloneWireframe(object: Object3D): Object3D {
  const clone = object.clone(true)
  clone.traverse((child) => {
    if (child instanceof Mesh) {
      child.material = new MeshBasicMaterial({ wireframe: true, color: materialColor(child.material) })
    }
  })
  return clone
}

/**
 * A colour-overridden clone for material swatches. Each mesh material is cloned
 * (not mutated) and tinted; the original scene is left untouched.
 */
export function cloneWithColor(object: Object3D, colorHex: string): Object3D {
  const clone = object.clone(true)
  const color = new Color(colorHex)
  clone.traverse((child) => {
    if (child instanceof Mesh) {
      const source = Array.isArray(child.material) ? child.material : [child.material]
      const tinted = source.map((m) => {
        const copy = m.clone() as Material & { color?: Color }
        if (copy.color instanceof Color) copy.color.copy(color)
        return copy
      })
      child.material = tinted.length === 1 ? tinted[0]! : tinted
    }
  })
  return clone
}
