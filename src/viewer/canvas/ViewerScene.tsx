"use client"

import { GLBModel } from "@/src/viewer/canvas/GLBModel"
import { Lighting } from "@/src/viewer/canvas/Lighting"
import { OrbitRig } from "@/src/viewer/canvas/OrbitRig"
import type { Bounds, ViewerMode } from "@/src/viewer/logic/types"

export interface ViewerSceneProps {
  url: string
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  swatchColor: string | null
  reducedMotion: boolean
  resetRequested: boolean
  onLoaded: (bounds: Bounds, triangleCount: number) => void
  onResetHandled: () => void
}

/** The R3F subtree rendered inside the Canvas host. */
export function ViewerScene({
  url,
  mode,
  showNormals,
  showBoundingBox,
  swatchColor,
  reducedMotion,
  resetRequested,
  onLoaded,
  onResetHandled,
}: ViewerSceneProps) {
  return (
    <>
      <Lighting />
      <GLBModel
        url={url}
        mode={mode}
        showNormals={showNormals}
        showBoundingBox={showBoundingBox}
        swatchColor={swatchColor}
        onLoaded={onLoaded}
      />
      <OrbitRig
        reducedMotion={reducedMotion}
        resetRequested={resetRequested}
        onResetHandled={onResetHandled}
      />
    </>
  )
}
