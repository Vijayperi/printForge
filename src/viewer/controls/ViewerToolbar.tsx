"use client"

import { Button } from "@/src/components/ui/button"
import { Label } from "@/src/components/ui/label"
import { Switch } from "@/src/components/ui/switch"
import type { ViewerMode } from "@/src/viewer/logic/types"

export interface ViewerToolbarProps {
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  fullscreen: boolean
  onSetMode: (mode: ViewerMode) => void
  onToggleNormals: () => void
  onToggleBbox: () => void
  onReset: () => void
  onFit: () => void
  onFullscreen: () => void
  onScreenshot: () => void
}

export function ViewerToolbar({
  mode,
  showNormals,
  showBoundingBox,
  fullscreen,
  onSetMode,
  onToggleNormals,
  onToggleBbox,
  onReset,
  onFit,
  onFullscreen,
  onScreenshot,
}: ViewerToolbarProps) {
  return (
    <div
      data-viewer-mode={mode}
      role="toolbar"
      aria-label="3D viewer controls"
      aria-orientation="horizontal"
      className="flex flex-wrap items-center gap-4"
    >
      <div role="group" aria-label="View mode" className="inline-flex gap-1 rounded-lg border p-0.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "visual" ? "default" : "ghost"}
          aria-pressed={mode === "visual"}
          onClick={() => onSetMode("visual")}
        >
          Visual
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "mesh" ? "default" : "ghost"}
          aria-pressed={mode === "mesh"}
          onClick={() => onSetMode("mesh")}
        >
          Technical Mesh
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="viewer-normals"
          checked={showNormals}
          onCheckedChange={onToggleNormals}
        />
        <Label htmlFor="viewer-normals">Show normals</Label>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="viewer-bbox"
          checked={showBoundingBox}
          onCheckedChange={onToggleBbox}
        />
        <Label htmlFor="viewer-bbox">Bounding box</Label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Reset view
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onFit}>
          Fit to view
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onFullscreen} aria-pressed={fullscreen}>
          Fullscreen
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onScreenshot}>
          Screenshot
        </Button>
      </div>
    </div>
  )
}
