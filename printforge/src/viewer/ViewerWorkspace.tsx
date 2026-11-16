"use client"

import { useCallback, useReducer, useRef } from "react"

import { SystemClock } from "@/src/lib/clock"
import { toggleFullscreen } from "@/src/viewer/canvas/fullscreen"
import { ModelViewer } from "@/src/viewer/canvas/ModelViewer"
import { DimensionReadout } from "@/src/viewer/controls/DimensionReadout"
import { TextureDisclaimer } from "@/src/viewer/controls/TextureDisclaimer"
import { ViewerAnnouncer } from "@/src/viewer/controls/ViewerAnnouncer"
import { ViewerToolbar } from "@/src/viewer/controls/ViewerToolbar"
import { computeDimensionsMm } from "@/src/viewer/logic/geometry"
import { prefersReducedMotion } from "@/src/viewer/logic/motion"
import { viewerReducer } from "@/src/viewer/logic/reducer"
import { screenshotFileName } from "@/src/viewer/logic/screenshot"
import { initialViewerState } from "@/src/viewer/logic/types"

export interface ViewerWorkspaceProps {
  url: string
  projectTitle: string
  swatchColor?: string | null
  scaleFactor?: number
}

export function ViewerWorkspace({
  url,
  projectTitle,
  swatchColor = null,
  scaleFactor = 1,
}: ViewerWorkspaceProps) {
  const [state, dispatch] = useReducer(viewerReducer, initialViewerState)
  const containerRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<((filename: string) => void) | null>(null)

  const reducedMotion = prefersReducedMotion()
  const dimensionsMm = state.bounds === null ? null : computeDimensionsMm(state.bounds, scaleFactor)

  const handleScreenshot = useCallback(() => {
    captureRef.current?.(screenshotFileName(projectTitle, new SystemClock()))
  }, [projectTitle])

  const handleFullscreen = useCallback(() => {
    void toggleFullscreen(containerRef.current, document).then((fullscreen) =>
      dispatch({ type: "SET_FULLSCREEN", fullscreen })
    )
  }, [])

  return (
    <div ref={containerRef} data-viewer-mode={state.mode} className="flex h-full flex-col gap-3">
      <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl border bg-muted/30">
        <ModelViewer
          url={url}
          mode={state.mode}
          showNormals={state.showNormals}
          showBoundingBox={state.showBoundingBox}
          swatchColor={swatchColor}
          reducedMotion={reducedMotion}
          resetRequested={state.resetRequested}
          status={state.status}
          onLoaded={(bounds, triangleCount) => dispatch({ type: "MODEL_LOADED", bounds, triangleCount })}
          onLoadError={() => dispatch({ type: "LOAD_ERROR" })}
          onResetHandled={() => dispatch({ type: "RESET_VIEW_HANDLED" })}
          onCaptureReady={(fn) => {
            captureRef.current = fn
          }}
        />
      </div>

      <ViewerToolbar
        mode={state.mode}
        showNormals={state.showNormals}
        showBoundingBox={state.showBoundingBox}
        fullscreen={state.fullscreen}
        onSetMode={(mode) => dispatch({ type: "SET_MODE", mode })}
        onToggleNormals={() => dispatch({ type: "TOGGLE_NORMALS" })}
        onToggleBbox={() => dispatch({ type: "TOGGLE_BBOX" })}
        onReset={() => dispatch({ type: "RESET_VIEW_REQUESTED" })}
        onFit={() => dispatch({ type: "RESET_VIEW_REQUESTED" })}
        onFullscreen={handleFullscreen}
        onScreenshot={handleScreenshot}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DimensionReadout dimensionsMm={dimensionsMm} />
        {state.mode === "visual" ? <TextureDisclaimer /> : null}
      </div>

      <ViewerAnnouncer status={state.status} mode={state.mode} />
    </div>
  )
}
