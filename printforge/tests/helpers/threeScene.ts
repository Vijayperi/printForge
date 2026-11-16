import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from "three"

/** A small real THREE scene (group → box mesh) for R3F test-renderer specs. */
export function sampleScene(color = "#3366ff"): Group {
  const group = new Group()
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ color: new Color(color) }))
  group.add(mesh)
  return group
}
