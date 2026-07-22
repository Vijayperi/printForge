"use client"

import { useProgress } from "@react-three/drei"
import { Canvas, useThree } from "@react-three/fiber"
import { Suspense, useEffect } from "react"

import { LoadingOverlay } from "@/src/viewer/canvas/LoadingOverlay"
import { triggerDownload } from "@/src/viewer/canvas/download"
import { ViewerErrorBoundary } from "@/src/viewer/canvas/ViewerErrorBoundary"
import { ViewerScene } from "@/src/viewer/canvas/ViewerScene"
import type { Bounds, ViewerMode, ViewerStatus } from "@/src/viewer/logic/types"

// This file hosts the raw WebGL <Canvas>. It cannot execute under jsdom, so it
// is the single coverage-excluded viewer module (plan §5.1/§5.4). All testable
// logic lives in its covered children (ViewerScene, LoadingOverlay, download,
// ViewerErrorBoundary) and the pure viewer logic.

export interface ModelViewerProps {
  url: string
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  swatchColor: string | null
  reducedMotion: boolean
  resetRequested: boolean
  status: ViewerStatus
  onLoaded: (bounds: Bounds, triangleCount: number) => void
  onLoadError: () => void
  onResetHandled: () => void
  onCaptureReady: (capture: (filename: string) => void) => void
}

function CaptureBridge({ onCaptureReady }: { onCaptureReady: (fn: (filename: string) => void) => void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    onCaptureReady((filename) => {
      triggerDownload(gl.domElement.toDataURL("image/png"), filename, document)
    })
  }, [gl, onCaptureReady])
  return null
}

export function ModelViewer(props: ModelViewerProps) {
  const { progress } = useProgress()
  return (
    <div className="relative h-full w-full" data-testid="viewer-canvas">
      <Canvas shadows camera={{ fov: 50, position: [3, 3, 3] }}>
        <ViewerErrorBoundary onError={props.onLoadError}>
          <Suspense fallback={null}>
            <ViewerScene
              url={props.url}
              mode={props.mode}
              showNormals={props.showNormals}
              showBoundingBox={props.showBoundingBox}
              swatchColor={props.swatchColor}
              reducedMotion={props.reducedMotion}
              resetRequested={props.resetRequested}
              onLoaded={props.onLoaded}
              onResetHandled={props.onResetHandled}
            />
          </Suspense>
        </ViewerErrorBoundary>
        <CaptureBridge onCaptureReady={props.onCaptureReady} />
      </Canvas>
      <LoadingOverlay status={props.status} progress={progress} />
    </div>
  )
}
