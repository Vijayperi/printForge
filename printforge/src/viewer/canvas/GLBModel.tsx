"use client"

import { useGLTF } from "@react-three/drei"
import { useEffect, useMemo } from "react"

import { MeshOverlays } from "@/src/viewer/canvas/MeshOverlays"
import { boundsFromBox3, computeSceneStats } from "@/src/viewer/canvas/sceneStats"
import type { Bounds, ViewerMode } from "@/src/viewer/logic/types"

export interface GLBModelProps {
  url: string
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  swatchColor: string | null
  onLoaded: (bounds: Bounds, triangleCount: number) => void
}

export function GLBModel({
  url,
  mode,
  showNormals,
  showBoundingBox,
  swatchColor,
  onLoaded,
}: GLBModelProps) {
  const { scene } = useGLTF(url)
  const stats = useMemo(() => computeSceneStats(scene), [scene])

  useEffect(() => {
    onLoaded(boundsFromBox3(stats.box), stats.triangleCount)
  }, [stats, onLoaded])

  return (
    <MeshOverlays
      scene={scene}
      box={stats.box}
      mode={mode}
      showNormals={showNormals}
      showBoundingBox={showBoundingBox}
      swatchColor={swatchColor}
    />
  )
}
