import { describe, expect, it } from "vitest"

import { viewerReducer } from "@/src/viewer/logic/reducer"
import { initialViewerState, type Bounds, type ViewerState } from "@/src/viewer/logic/types"

const bounds: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

describe("viewerReducer", () => {
  it("sets the mode", () => {
    expect(viewerReducer(initialViewerState, { type: "SET_MODE", mode: "mesh" }).mode).toBe("mesh")
    expect(viewerReducer(initialViewerState, { type: "SET_MODE", mode: "visual" }).mode).toBe("visual")
  })

  it("toggles normals and bounding box", () => {
    const withNormals = viewerReducer(initialViewerState, { type: "TOGGLE_NORMALS" })
    expect(withNormals.showNormals).toBe(true)
    expect(viewerReducer(withNormals, { type: "TOGGLE_NORMALS" }).showNormals).toBe(false)

    const withBox = viewerReducer(initialViewerState, { type: "TOGGLE_BBOX" })
    expect(withBox.showBoundingBox).toBe(true)
    expect(viewerReducer(withBox, { type: "TOGGLE_BBOX" }).showBoundingBox).toBe(false)
  })

  it("sets fullscreen on and off", () => {
    expect(viewerReducer(initialViewerState, { type: "SET_FULLSCREEN", fullscreen: true }).fullscreen).toBe(true)
    const fs: ViewerState = { ...initialViewerState, fullscreen: true }
    expect(viewerReducer(fs, { type: "SET_FULLSCREEN", fullscreen: false }).fullscreen).toBe(false)
  })

  it("records a loaded model", () => {
    const next = viewerReducer(initialViewerState, { type: "MODEL_LOADED", bounds, triangleCount: 1200 })
    expect(next.status).toBe("ready")
    expect(next.bounds).toEqual(bounds)
    expect(next.triangleCount).toBe(1200)
  })

  it("records a load error", () => {
    expect(viewerReducer(initialViewerState, { type: "LOAD_ERROR" }).status).toBe("error")
  })

  it("requests and clears a reset", () => {
    const requested = viewerReducer(initialViewerState, { type: "RESET_VIEW_REQUESTED" })
    expect(requested.resetRequested).toBe(true)
    expect(viewerReducer(requested, { type: "RESET_VIEW_HANDLED" }).resetRequested).toBe(false)
  })

  it("does not mutate the input state", () => {
    const before = { ...initialViewerState }
    viewerReducer(initialViewerState, { type: "SET_MODE", mode: "mesh" })
    expect(initialViewerState).toEqual(before)
  })
})
