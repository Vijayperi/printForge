"use client"

import { useMemo } from "react"
import { Box3, Box3Helper, Color, Mesh, type Object3D } from "three"
import { VertexNormalsHelper } from "three/addons/helpers/VertexNormalsHelper.js"

import { cloneWireframe, cloneWithColor } from "@/src/viewer/canvas/sceneClone"
import type { ViewerMode } from "@/src/viewer/logic/types"

const BBOX_COLOR = new Color("#f97316")

export interface MeshOverlaysProps {
  scene: Object3D
  box: Box3
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  swatchColor: string | null
}

function collectMeshes(object: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  object.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child)
  })
  return meshes
}

export function MeshOverlays({
  scene,
  box,
  mode,
  showNormals,
  showBoundingBox,
  swatchColor,
}: MeshOverlaysProps) {
  const wireframe = useMemo(() => cloneWireframe(scene), [scene])
  const tinted = useMemo(
    () => (swatchColor === null ? null : cloneWithColor(scene, swatchColor)),
    [scene, swatchColor]
  )
  const boxHelper = useMemo(() => new Box3Helper(box, BBOX_COLOR), [box])
  const normalHelpers = useMemo(
    () => collectMeshes(scene).map((mesh) => new VertexNormalsHelper(mesh, 0.2, 0x2266ff)),
    [scene]
  )

  const visualObject = tinted ?? scene

  return (
    <group>
      {mode === "visual" ? (
        <primitive object={visualObject} />
      ) : (
        <primitive object={wireframe} />
      )}
      {showBoundingBox ? <primitive object={boxHelper} /> : null}
      {showNormals && mode === "mesh"
        ? normalHelpers.map((helper, i) => <primitive key={i} object={helper} />)
        : null}
    </group>
  )
}
