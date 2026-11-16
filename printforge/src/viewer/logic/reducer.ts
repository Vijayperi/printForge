import type { ViewerAction, ViewerState } from "@/src/viewer/logic/types"

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode }
    case "TOGGLE_NORMALS":
      return { ...state, showNormals: !state.showNormals }
    case "TOGGLE_BBOX":
      return { ...state, showBoundingBox: !state.showBoundingBox }
    case "SET_FULLSCREEN":
      return { ...state, fullscreen: action.fullscreen }
    case "MODEL_LOADED":
      return {
        ...state,
        status: "ready",
        bounds: action.bounds,
        triangleCount: action.triangleCount,
      }
    case "LOAD_ERROR":
      return { ...state, status: "error" }
    case "RESET_VIEW_REQUESTED":
      return { ...state, resetRequested: true }
    case "RESET_VIEW_HANDLED":
      return { ...state, resetRequested: false }
  }
}
