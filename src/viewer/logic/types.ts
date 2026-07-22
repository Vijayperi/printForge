/** Pure viewer state and actions (plan §5.4). No three.js / React imports. */

export type ViewerMode = "visual" | "mesh"
export type ViewerStatus = "loading" | "ready" | "error"

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface ViewerState {
  mode: ViewerMode
  showNormals: boolean
  showBoundingBox: boolean
  fullscreen: boolean
  status: ViewerStatus
  bounds: Bounds | null
  triangleCount: number | null
  /** Set when a reset is requested; the R3F rig clears it after handling. */
  resetRequested: boolean
}

export type ViewerAction =
  | { type: "SET_MODE"; mode: ViewerMode }
  | { type: "TOGGLE_NORMALS" }
  | { type: "TOGGLE_BBOX" }
  | { type: "SET_FULLSCREEN"; fullscreen: boolean }
  | { type: "MODEL_LOADED"; bounds: Bounds; triangleCount: number }
  | { type: "LOAD_ERROR" }
  | { type: "RESET_VIEW_REQUESTED" }
  | { type: "RESET_VIEW_HANDLED" }

export const initialViewerState: ViewerState = {
  mode: "visual",
  showNormals: false,
  showBoundingBox: false,
  fullscreen: false,
  status: "loading",
  bounds: null,
  triangleCount: null,
  resetRequested: false,
}
