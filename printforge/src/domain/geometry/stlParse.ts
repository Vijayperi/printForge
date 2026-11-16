import { err, ok, type Result } from "@/src/lib/result"

/** Interleaved XYZ vertex positions, 9 floats per triangle. */
export interface RawTriangles {
  positions: Float32Array
  triangleCount: number
}

export type StlRejectKind =
  | "truncated"
  | "count_mismatch"
  | "nan_vertex"
  | "empty"
  | "too_large"
  | "unrecognized"

export interface StlParseError {
  kind: StlRejectKind
  message: string
}

export interface StlLimits {
  maxBytes: number
  maxTriangles: number
}

export const DEFAULT_STL_LIMITS: StlLimits = {
  maxBytes: 50 * 1024 * 1024,
  maxTriangles: 2_000_000,
}

const BINARY_HEADER = 80
const BINARY_COUNT = 4
const BINARY_RECORD = 50 // 12 (normal) + 36 (3 verts) + 2 (attribute)

function reject(kind: StlRejectKind, message: string): Result<RawTriangles, StlParseError> {
  return err({ kind, message })
}

/** Does the binary layout (84 + 50·count) exactly match the byte length? */
function isBinaryLayout(bytes: Uint8Array): boolean {
  if (bytes.length < BINARY_HEADER + BINARY_COUNT) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(BINARY_HEADER, true)
  return bytes.length === BINARY_HEADER + BINARY_COUNT + count * BINARY_RECORD
}

function startsWithSolid(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase() === "solid"
}

// Only called when isBinaryLayout(bytes) is true, so byteLength === 84 + 50·count.
function parseBinary(bytes: Uint8Array, limits: StlLimits): Result<RawTriangles, StlParseError> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(BINARY_HEADER, true)
  if (count > limits.maxTriangles) {
    return reject("too_large", `mesh has ${count} triangles (max ${limits.maxTriangles})`)
  }
  if (count === 0) return reject("empty", "mesh has no triangles")

  const positions = new Float32Array(count * 9)
  for (let i = 0; i < count; i += 1) {
    const base = BINARY_HEADER + BINARY_COUNT + i * BINARY_RECORD + 12 // skip the normal
    for (let v = 0; v < 9; v += 1) {
      const value = view.getFloat32(base + v * 4, true)
      if (Number.isNaN(value)) return reject("nan_vertex", "vertex contains NaN")
      positions[i * 9 + v] = value
    }
  }
  return ok({ positions, triangleCount: count })
}

const VERTEX_RE = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g

function parseAscii(text: string, limits: StlLimits): Result<RawTriangles, StlParseError> {
  if (!/facet/i.test(text) && !/vertex/i.test(text)) {
    return reject("unrecognized", "not a recognizable ASCII STL")
  }
  const coords: number[] = []
  let match: RegExpExecArray | null
  VERTEX_RE.lastIndex = 0
  while ((match = VERTEX_RE.exec(text)) !== null) {
    for (let k = 1; k <= 3; k += 1) {
      const value = Number.parseFloat(match[k] as string)
      if (Number.isNaN(value)) return reject("nan_vertex", "vertex contains NaN")
      coords.push(value)
    }
  }
  if (coords.length === 0) return reject("empty", "mesh has no vertices")
  if (coords.length % 9 !== 0) {
    return reject("count_mismatch", `vertex count ${coords.length / 3} is not a multiple of 3`)
  }
  const triangleCount = coords.length / 9
  if (triangleCount > limits.maxTriangles) {
    return reject("too_large", `mesh has ${triangleCount} triangles (max ${limits.maxTriangles})`)
  }
  return ok({ positions: Float32Array.from(coords), triangleCount })
}

/** Parse a binary or ASCII STL into raw triangles, or a typed rejection. */
export function parseStl(
  bytes: Uint8Array,
  limits: StlLimits = DEFAULT_STL_LIMITS
): Result<RawTriangles, StlParseError> {
  if (bytes.length > limits.maxBytes) return reject("too_large", `file exceeds ${limits.maxBytes} bytes`)

  // A file whose byte length matches the binary layout is binary — even if its
  // header happens to start with "solid".
  if (isBinaryLayout(bytes)) return parseBinary(bytes, limits)

  if (startsWithSolid(bytes)) return parseAscii(new TextDecoder().decode(bytes), limits)

  if (bytes.length >= BINARY_HEADER + BINARY_COUNT) {
    return reject("count_mismatch", "binary layout does not match the triangle count")
  }
  return reject("truncated", "file is too small to be a valid STL")
}
